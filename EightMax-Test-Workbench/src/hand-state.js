/* EightMax Test Workbench 0.20: hand-state reconstruction from observations.
 *
 * Input is an "eightmax-observation" (from a structured simulator feed, a replayed recording or
 * recognised screenshots). Output is either an accepted, internally consistent table state or an
 * explicit rejection. Nothing is guessed: missing cards, bets and actions stay missing, and a
 * table whose state cannot be reconstructed is paused until consistent frames return.
 * Units follow the simulator: 100 chips = 1 BB (SB 50, BB 100, ante 10, eight-handed start pot 230).
 *
 * 0.24: stakes are configurable (options sb / bb / ante), and `track: true` turns on frame-to-frame
 * reconstruction through an independent rules ledger (hand-ledger.js): action history, per-seat
 * contributions, side pots, minimum raises and settlement are DERIVED from consecutive screen readings
 * and every reading is cross-checked against them. Gaps that cannot be explained uniquely are rejected.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./hand-ledger.js'));
  else root.WorkbenchHandState = factory(root.WorkbenchLedger);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (LG) {
  'use strict';

  const SEATS = 8, SB = 50, BB = 100, ANTE = 10, START_POT = SEATS * ANTE + SB + BB;
  const STREETS = ['preflop', 'flop', 'turn', 'river'];
  const BOARD_LEN = { preflop: 0, flop: 3, turn: 4, river: 5 };
  const RANKS = '23456789TJQKA', SUITS = 'cdhs';
  const DEFAULTS = Object.freeze({
    minOverallConfidence: 0.9, minFieldConfidence: 0.85, autoResumeAfter: 2,
    expectedLayout: 'eightmax-8max-v1', expectedBankroll: null, maxSeqGap: 1000,
    sb: SB, bb: BB, ante: ANTE, track: false, maxGapActions: 8, requireControlsMatch: true,
  });

  const isInt = (x) => Number.isSafeInteger(x);
  const isCard = (c) => isInt(c) && c >= 0 && c < 52;
  function cardToString(c) { return RANKS[Math.floor(c / 4)] + SUITS[c % 4]; }
  function cardFromString(s) {
    if (typeof s !== 'string' || !/^[2-9TJQKA][cdhs]$/.test(s)) return null;
    return RANKS.indexOf(s[0]) * 4 + SUITS.indexOf(s[1]);
  }

  /** Stable content key: any change of board, bets, stacks, actor or folds produces a new key. */
  function stateKey(s) {
    return [s.table, s.hand, s.street, s.board.join('.'), s.actor, s.pot, s.currentBet,
      s.seats.map((p) => [p.stack, p.bet, p.total, p.folded ? 1 : 0].join(':')).join('|')].join('/');
  }

  function legalFrom(s) {
    if (s.actor < 0 || s.status !== 'playing') return null;
    const p = s.seats[s.actor], toCall = Math.max(0, s.currentBet - p.bet), max = p.bet + p.stack;
    const exact = Number.isFinite(s.lastRaise);
    const minRaiseTo = exact ? s.currentBet + s.lastRaise : null;
    const others = s.seats.some((q, i) => i !== s.actor && !q.folded && q.stack > 0);
    return {
      exact, toCall, callAmount: Math.min(toCall, p.stack), canCheck: toCall === 0,
      canCall: toCall > 0, canFold: toCall > 0, // folding is never offered for free; the simulator permits it, a client would not need it
      canRaise: others && max > s.currentBet && (!exact || s.canReopen !== false),
      minRaiseTo, maxRaiseTo: max, allInAmount: max,
    };
  }

  class HandStateEngine {
    constructor(table, options = {}) {
      if (!isInt(table) || table < 1 || table > 10) throw new Error('Table id must be 1 to 10');
      this.table = table; this.opt = { ...DEFAULTS, ...options };
      this.reset();
    }
    reset() {
      this.last = null; this.revision = this.revision || 0; this.paused = false; this.pauseReason = null;
      this.goodStreak = 0; this.accepted = 0; this.rejected = 0; this.lastSeq = -1;
      this.rejections = []; this.bankroll = this.opt.expectedBankroll;
      this.tr = { led: null, hand: null, untracked: null };
      this.startPot = SEATS * this.opt.ante + this.opt.sb + this.opt.bb;
    }
    get state() { return this.last; }
    /** Restart support: everything needed to continue a hand after the process stops. Nothing here is trusted blindly: restore() re-validates chips. */
    exportCheckpoint() { return { format: 'eightmax-handstate-checkpoint', version: 1, table: this.table, revision: this.revision, lastSeq: this.lastSeq, bankroll: this.bankroll, tr: { hand: this.tr.hand, led: this.tr.led ? this.tr.led.toJSON() : null }, last: this.last ? JSON.parse(JSON.stringify(this.last)) : null }; }
    restoreCheckpoint(c) {
      if (!c || c.format !== 'eightmax-handstate-checkpoint' || c.version !== 1 || c.table !== this.table) throw new Error('Checkpoint is not for this table');
      this.reset(); this.revision = c.revision; this.lastSeq = -1; this.bankroll = c.bankroll; this.tr = { hand: c.tr.hand, led: c.tr.led ? LG.HandLedger.fromJSON(c.tr.led) : null, untracked: null }; this.last = c.last;
      this.paused = true; this.pauseReason = 'Restored from checkpoint; waiting for consistent readings'; this.goodStreak = 0; // never resumes without fresh agreement with the screen
    }

    /** Operator or supervisor resume. Never resumes a table whose last frame was rejected for contradiction. */
    resume() { this.paused = false; this.pauseReason = null; this.goodStreak = 0; }

    ingest(obs) {
      const issues = [];
      let state = null, trk = null;
      try {
        if (this.opt.track) { trk = this._track(obs, issues); if (trk) obs = trk.obs; }
        if (!issues.length) state = this._build(obs, issues);
      } catch (e) { issues.push({ code: 'malformed', detail: e.message }); }
      if (state && !issues.length) this._continuity(state, issues);
      if (state && trk && !issues.length) this._decorate(state, trk);
      if (issues.length) {
        this.rejected++; this.goodStreak = 0;
        this.paused = true; this.pauseReason = issues[0].code + ': ' + issues[0].detail;
        this.rejections.push({ seq: obs && obs.seq, issues });
        if (this.rejections.length > 100) this.rejections.shift();
        return { accepted: false, paused: true, issues, state: null, revision: this.revision };
      }
      const changed = !this.last || stateKey(this.last) !== stateKey(state);
      if (changed) this.revision++;
      if (this.bankroll === null && this._pendingBankroll !== undefined) this.bankroll = this._pendingBankroll;
      state.revision = this.revision; state.key = stateKey(state);
      this.last = state; this.accepted++; this.lastSeq = obs.seq;
      if (trk) { this.tr.led = trk.led; this.tr.hand = trk.hand; this.tr.untracked = null; if (trk.bankroll !== undefined) this.bankroll = trk.bankroll; }
      if (this.paused) {
        this.goodStreak++;
        if (this.goodStreak >= this.opt.autoResumeAfter) this.resume();
      }
      return { accepted: true, paused: this.paused, issues: [], state, revision: this.revision, changed };
    }

    _build(obs, issues) {
      const o = this.opt, bad = (code, detail) => issues.push({ code, detail });
      if (!obs || obs.format !== 'eightmax-observation' || obs.version !== 1) { bad('unsupported-format', 'Not an eightmax-observation v1'); return null; }
      if (obs.table !== this.table) { bad('wrong-table', 'Observation is for table ' + obs.table + ', engine is table ' + this.table); return null; }
      const okLayouts = Array.isArray(o.expectedLayout) ? o.expectedLayout : [o.expectedLayout];
      if (!obs.layout || !okLayouts.includes(obs.layout.id) || obs.layout.seats !== SEATS) { bad('unrecognized-layout', 'Layout ' + JSON.stringify(obs.layout && obs.layout.id) + ' is not ' + okLayouts.join(' or ')); return null; }
      if (!isInt(obs.seq) || obs.seq < 0) { bad('bad-sequence', 'Missing or invalid observation sequence'); return null; }
      if (obs.seq <= this.lastSeq) { bad('stale-observation', 'Sequence ' + obs.seq + ' is not newer than ' + this.lastSeq); return null; }
      const conf = obs.confidence;
      if (!conf || !Number.isFinite(conf.overall) || !conf.fields) { bad('missing-confidence', 'Observation has no confidence scores'); return null; }
      if (conf.overall < o.minOverallConfidence) bad('low-confidence', 'Overall confidence ' + conf.overall.toFixed(3) + ' below ' + o.minOverallConfidence);
      for (const f of ['board', 'pot', 'stacks', 'button', 'actor', 'street']) {
        if (!Number.isFinite(conf.fields[f])) bad('missing-field', 'No confidence for ' + f);
        else if (conf.fields[f] < o.minFieldConfidence) bad('low-confidence', f + ' confidence ' + conf.fields[f].toFixed(3) + ' below ' + o.minFieldConfidence);
      }
      if (issues.length) return null;
      if (!STREETS.includes(obs.street)) { bad('missing-field', 'Street not recognised'); return null; }
      if (!Array.isArray(obs.board) || !obs.board.every(isCard)) { bad('invalid-card', 'Board contains an invalid card'); return null; }
      if (obs.board.length !== BOARD_LEN[obs.street]) { bad('contradiction', obs.board.length + ' board cards on ' + obs.street); return null; }
      if (!Array.isArray(obs.seats) || obs.seats.length !== SEATS) { bad('ambiguous-seats', 'Expected exactly ' + SEATS + ' seat records'); return null; }
      const seen = new Set(obs.board);
      if (seen.size !== obs.board.length) { bad('invalid-card', 'Duplicate board card'); return null; }
      const seats = [];
      for (let i = 0; i < SEATS; i++) {
        const r = obs.seats[i];
        if (!r || r.seat !== i) { bad('ambiguous-seats', 'Seat record ' + i + ' is out of order or missing'); return null; }
        for (const k of ['stack', 'bet']) if (!isInt(r[k]) || r[k] < 0) { bad('missing-field', 'Seat ' + i + ' has no valid ' + k); return null; }
        if (r.total !== undefined && (!isInt(r.total) || r.total < r.bet)) { bad('contradiction', 'Seat ' + i + ' total below street bet'); return null; }
        let cards = null;
        if (r.cards !== null && r.cards !== undefined) {
          if (!Array.isArray(r.cards) || r.cards.length !== 2 || !r.cards.every(isCard) || r.cards[0] === r.cards[1]) { bad('invalid-card', 'Seat ' + i + ' hole cards invalid'); return null; }
          cards = r.cards.slice();
          for (const c of cards) { if (seen.has(c)) { bad('invalid-card', 'Card ' + cardToString(c) + ' appears twice'); return null; } seen.add(c); }
        }
        seats.push({ seat: i, stack: r.stack, bet: r.bet, total: r.total === undefined ? null : r.total, folded: !!r.folded, allIn: r.stack === 0 && !r.folded, cards });
      }
      if (!isInt(obs.button) || obs.button < 0 || obs.button >= SEATS) { bad('ambiguous-seats', 'Dealer button not identified'); return null; }
      if (!isInt(obs.pot) || obs.pot < 0) { bad('missing-field', 'Pot not recognised'); return null; }
      const live = seats.filter((p) => !p.folded);
      if (live.length < 1) { bad('contradiction', 'No live players'); return null; }
      const status = obs.status === 'complete' ? 'complete' : 'playing';
      let actor = obs.actor;
      if (status === 'playing') {
        if (!isInt(actor) || actor < 0 || actor >= SEATS) { bad('ambiguous-seats', 'Acting seat not identified'); return null; }
        if (seats[actor].folded || seats[actor].stack === 0) { bad('contradiction', 'Acting seat ' + actor + ' is folded or all-in'); return null; }
      } else actor = -1;
      // Accounting. Pot must equal everything committed; totals are required for an exact check.
      const sumBets = seats.reduce((n, p) => n + p.bet, 0);
      const haveTotals = seats.every((p) => p.total !== null);
      if (haveTotals) {
        const sumTotal = seats.reduce((n, p) => n + p.total, 0);
        if (status === 'playing' && sumTotal !== obs.pot) { bad('inconsistent-pot', 'Pot ' + obs.pot + ' != committed chips ' + sumTotal); return null; }
        const bankroll = seats.reduce((n, p) => n + p.stack + p.total, 0), ref = obs._tb !== undefined ? obs._tb : this.bankroll;
        if (ref !== null && status === 'playing' && bankroll !== ref) { bad('inconsistent-stacks', 'Chips in play ' + bankroll + ' != established ' + ref); return null; }
      } else if (this.bankroll !== null && status === 'playing' && obs.pot + seats.reduce((n, p) => n + p.stack, 0) !== this.bankroll) {
        bad('inconsistent-pot', 'Pot ' + obs.pot + ' + stacks ' + seats.reduce((n, p) => n + p.stack, 0) + ' != chips in play ' + this.bankroll); return null;
      } else if (obs.pot < sumBets) { bad('inconsistent-pot', 'Pot ' + obs.pot + ' below current street bets ' + sumBets); return null; }
      const currentBet = Math.max(...seats.map((p) => p.bet));
      if (status === 'playing' && obs.currentBet !== undefined && obs.currentBet !== currentBet) { bad('contradiction', 'Reported bet to match ' + obs.currentBet + ' != largest wager ' + currentBet); return null; }
      const history = obs.actions === undefined ? null : obs.actions;
      if (history !== null) {
        if (!Array.isArray(history) || !history.every((a) => a && isInt(a.seat) && a.seat >= 0 && a.seat < SEATS && ['fold', 'check', 'call', 'raise', 'bet', 'allin'].includes(a.type))) { bad('incomplete-history', 'Action history malformed'); return null; }
      }
      const handStart = obs.street === 'preflop' && history !== null && history.length === 0;
      if (handStart && haveTotals) {
        if (obs.pot !== this.startPot) { bad('inconsistent-start-pot', 'Opening pot ' + obs.pot + ' != ' + this.startPot + ' (' + SEATS + ' antes plus blinds)'); return null; }
        const blinds = seats.map((p) => p.total);
        if (blinds.some((t) => t < this.opt.ante)) { bad('inconsistent-start-pot', 'A seat has not posted its ante'); return null; }
      }
      if (haveTotals && this.bankroll === null) this._pendingBankroll = seats.reduce((n, p) => n + p.stack + p.total, 0);
      return {
        table: this.table, hand: isInt(obs.hand) ? obs.hand : null, status, street: obs.street, board: obs.board.slice(),
        button: obs.button, actor, pot: obs.pot, currentBet, lastRaise: Number.isFinite(obs.lastRaise) ? obs.lastRaise : null,
        canReopen: obs.canReopen, stakes: { sb: this.opt.sb, bb: this.opt.bb, ante: this.opt.ante }, seats, actions: history, handStart, source: obs.source || 'unknown',
        confidence: conf.overall, seq: obs.seq, simRevision: isInt(obs.simRevision) ? obs.simRevision : null,
        legal: null,
      };
    }


    /* ---------- 0.24 tracking: derive history, contributions and legality from consecutive readings ---------- */
    _track(obs, issues) {
      const bad = (code, detail) => { issues.push({ code, detail }); return null; }, o = this.opt;
      if (!obs || obs.format !== 'eightmax-observation' || obs.version !== 1) return null; // _build reports the format error
      if (obs.table !== this.table || !Array.isArray(obs.seats) || obs.seats.length !== SEATS || !Array.isArray(obs.board)) return null; // ditto
      if (!isInt(obs.hand)) return bad('missing-hand-id', 'Tracking needs the hand number to tell hands apart');
      for (const r of obs.seats) if (!r || !isInt(r.stack) || !isInt(r.bet) || r.stack < 0 || r.bet < 0) return null; // _build reports it
      const sIdx = STREETS.indexOf(obs.street); if (sIdx < 0 || !isInt(obs.button) || obs.button < 0 || obs.button >= SEATS) return null;
      const complete = obs.status === 'complete';
      let led, newHand = false, bankroll;
      if (this.tr.untracked === obs.hand) return bad('untracked-hand', 'Hand ' + obs.hand + ' began before observation started; waiting for the next hand to see its blinds');
      if (!this.tr.led || this.tr.hand !== obs.hand) {
        newHand = true;
        if (this.tr.hand !== null && obs.hand < this.tr.hand) return bad('contradiction', 'Hand number went backwards');
        const start = obs.seats.map((r) => r.stack + r.bet + o.ante);
        if (complete || obs.street !== 'preflop' || obs.board.length || obs.seats.some((r) => r.folded)) { this.tr.untracked = obs.hand; return bad('missed-hand-start', 'First frame of hand ' + obs.hand + ' is not its opening position; the hand cannot be reconstructed'); }
        try { led = new LG.HandLedger({ seats: SEATS, button: obs.button, stacks: start, sb: o.sb, bb: o.bb, ante: o.ante }); } catch (e) { this.tr.untracked = obs.hand; return bad('hand-start-mismatch', 'Opening position cannot be a legal start: ' + e.message); }
        const why = this._mismatch(led, obs, false);
        if (why) { this.tr.untracked = obs.hand; return bad('hand-start-mismatch', 'Opening position disagrees with blinds and antes: ' + why); }
        bankroll = start.reduce((a, b) => a + b, 0) - 0;
      } else led = this.tr.led.clone();
      const actions = [];
      if (!newHand) {
        const seen = new Set(); let guard = 0;
        for (;;) {
          if (this._matches(led, obs)) break;
          if (++guard > o.maxGapActions + 4) return bad('ambiguous-gap', 'More than ' + o.maxGapActions + ' steps separate consecutive readings');
          if (led.status === 'awaiting-board' || (led.status === 'showdown' && led.board.length < 5)) {
            const have = led.board.length;
            if (obs.board.length > have && led.board.every((c, i) => obs.board[i] === c)) { try { led.dealBoard(obs.board.slice(have)); } catch (e) { return bad('contradiction', 'Board advanced illegally: ' + e.message); } continue; }
            return bad('missing-board', 'Betting closed but the next street is not shown');
          }
          if (led.status !== 'betting') break;
          const A = led.actor; if (seen.has(A)) return bad('ambiguous-gap', 'Seat ' + A + ' would have to act twice between readings; the intermediate raise sizes are unknowable');
          seen.add(A);
          const act = this._deriveAction(led, obs, A, complete, seen.size);
          if (act.error) return bad(act.code || 'unexplained-change', act.error);
          try { const e = led.apply(act); actions.push(e); } catch (e) { return bad('illegal-action', 'Inferred ' + act.type + ' by seat ' + A + ' is illegal: ' + e.message); }
        }
        // Several unseen actions are accepted only when they are unambiguous. A raise followed (in the same gap) by another player's call or check
        // could equally have been "smaller raise, re-raise, call": the screen cannot tell, and the history decides which solver node applies.
        for (let i = 0; i < actions.length; i++) if (actions[i].type === 'raise') for (let j = i + 1; j < actions.length; j++) if ((actions[j].type === 'call' || actions[j].type === 'check') && actions[j].seat !== actions[i].seat) return bad('ambiguous-gap', 'A raise and a later call/check by another seat fall between two readings; hidden re-raises cannot be excluded, so the history is not reconstructed');
        if (!this._matches(led, obs)) return bad('unexplained-change', 'No sequence of legal actions explains the new reading: ' + (this._mismatch(led, obs, complete) || 'state differs'));
      }
      if (complete) {
        const cs = led.checkSettlement(obs.seats.map((r) => r.stack)); if (!cs.ok) return bad('bad-settlement', cs.reasons.join('; '));
        if (led.live.length > 1 && led.board.length !== 5) return bad('missing-board', 'Showdown without a full board');
      } else if (led.status !== 'betting') return bad('contradiction', 'Ledger says no player is to act (' + led.status + ') but the reading is mid-hand');
      // The screen's own pot and controls are checked against what the rules say.
      if (!complete && obs.pot !== led.pot) return bad('inconsistent-pot', 'Pot read ' + obs.pot + ' but the hand history accounts for ' + led.pot);
      const lg = !complete ? led.legal() : null;
      if (lg && o.requireControlsMatch && obs.controls) {
        const c = obs.controls, mism = [];
        if (c.fold !== lg.canFold) mism.push('fold ' + c.fold + ' vs ' + lg.canFold); if (c.check !== lg.canCheck) mism.push('check ' + c.check + ' vs ' + lg.canCheck);
        if (c.call !== lg.canCall) mism.push('call ' + c.call + ' vs ' + lg.canCall); if (c.raise !== lg.canRaise) mism.push('raise ' + c.raise + ' vs ' + lg.canRaise);
        if (c.call && obs.callAmount !== lg.callAmount) mism.push('call amount ' + obs.callAmount + ' vs ' + lg.callAmount);
        if (c.raise && obs.minRaiseTo !== lg.minRaiseTo) mism.push('minimum raise ' + obs.minRaiseTo + ' vs ' + lg.minRaiseTo);
        if (mism.length) return bad('controls-disagree', 'Action controls on screen disagree with the rules: ' + mism.join('; '));
      }
      for (let i = 0; i < SEATS; i++) { const r = obs.seats[i]; if (r.allInMarker !== undefined && r.allInMarker !== (r.stack === 0 && !r.folded)) return bad('contradiction', 'Seat ' + i + ' all-in marker disagrees with its stack'); }
      const out = JSON.parse(JSON.stringify(obs)); out.seats.forEach((r, i) => { r.total = led.p[i].total; delete r.allInMarker; }); out._tb = led.start.reduce((a, b) => a + b, 0);
      out.actions = led.history.map((h) => ({ seat: h.seat, type: h.type === 'raise' ? (h.allIn ? 'allin' : (h.street && led.history.filter((x) => x.street === h.street).indexOf(h) >= 0 && this._opening(led, h) ? 'bet' : 'raise')) : h.type, amount: h.to, street: h.street }));
      out.lastRaise = led.raiseSize; out.currentBet = complete ? undefined : led.currentBet; out.canReopen = lg ? lg.reopened : undefined;
      return { obs: out, led, hand: obs.hand, bankroll: led.start.reduce((a, b) => a + b, 0) };
    }
    /** An opening postflop wager is a "bet"; preflop (blinds are the first wager) and any later one is a "raise". */
    _opening(led, h) { if (h.street === 'preflop') return false; const prior = led.history.filter((x) => x.street === h.street); for (const x of prior) { if (x === h) return true; if (x.type === 'raise') return false; } return false; }
    _matches(led, obs) {
      const why = this._mismatch(led, obs, obs.status === 'complete'); return why === null;
    }
    /** null when the ledger's state equals what the screen shows; otherwise the first difference. */
    _mismatch(led, obs, complete) {
      if (obs.board.length !== led.board.length || obs.board.some((c, i) => c !== led.board[i])) return 'board';
      for (let i = 0; i < SEATS; i++) { const q = led.p[i], r = obs.seats[i]; if (q.folded !== !!r.folded) return 'seat ' + i + ' fold flag'; if (!complete) { if (q.stack !== r.stack) return 'seat ' + i + ' stack ' + r.stack + ' vs ' + q.stack; if (q.bet !== r.bet) return 'seat ' + i + ' bet ' + r.bet + ' vs ' + q.bet; } }
      if (complete) return led.status === 'complete' || led.status === 'showdown' ? null : 'hand not finished (' + led.status + ')';
      if (STREETS.indexOf(obs.street) !== led.street) return 'street';
      if (led.status !== 'betting') return 'betting closed';
      if (obs.actor !== led.actor) return 'actor ' + obs.actor + ' vs ' + led.actor;
      return null;
    }
    /** What must seat A have done for the screen to look the way it does? Never a guess: only the unique consistent action. */
    _deriveAction(led, obs, A, complete, stepNo) {
      const q = led.p[A], r = obs.seats[A], l = led.legal(A), toCall = l.toCall;
      if (r.folded) return { seat: A, type: 'fold' };
      if (complete) {
        // The closing action of a finished hand is forced: only a fold (visible) or a non-raising call/check can end it.
        if (stepNo > 1) return { error: 'More than one unobserved action precedes the end of the hand', code: 'ambiguous-gap' };
        return toCall > 0 ? { seat: A, type: 'call' } : { seat: A, type: 'check' };
      }
      const sameStreet = led.street === STREETS.indexOf(obs.street);
      let to;
      if (sameStreet) to = r.bet;
      else { const startA = led.start[A], totalNow = startA - r.stack, newStreetBet = r.bet; to = totalNow - newStreetBet - (q.total - q.bet); }
      if (!isInt(to) || to < q.bet) return { error: 'Seat ' + A + ' wager moved backwards or is not an integer', code: 'contradiction' };
      if (to === q.bet) return toCall > 0 ? { error: 'Seat ' + A + ' is facing a wager but shows no change; the reading is not an outcome of any legal action', code: 'unexplained-change' } : { seat: A, type: 'check' };
      if (to <= led.currentBet) return { seat: A, type: 'call' };
      return { seat: A, type: 'raise', amount: to };
    }
    _decorate(state, trk) {
      const led = trk.led, anyAllIn = led.live.some((i) => led.p[i].stack === 0), pk = led.pots();
      // Mid-hand with nobody all-in there is one pot; levels of unmatched wagers are not side pots until a player is all-in or the hand ends.
      if (state.status === 'playing' && !anyAllIn) { state.sidePots = [{ amount: led.pot, eligible: led.live.slice() }]; state.refunds = []; }
      else { state.sidePots = pk.pots.map((p) => ({ amount: p.amount, eligible: p.eligible.slice() })); state.refunds = pk.refunds.map((r) => ({ ...r })); }
      state.startStacks = led.start.slice(); state.tracked = true; state.ledgerStatus = led.status;
      const lg = state.status === 'playing' ? led.legal() : null;
      if (lg) state.legal = { exact: true, toCall: lg.toCall, callAmount: lg.callAmount, canCheck: lg.canCheck, canCall: lg.canCall, canFold: lg.canFold, canRaise: lg.canRaise, minRaiseTo: lg.minRaiseTo, fullMinRaiseTo: lg.fullMinRaiseTo, maxRaiseTo: lg.maxRaiseTo, allInAmount: lg.maxRaiseTo, reopened: lg.reopened };
      state.settlement = state.status === 'complete' ? led.checkSettlement(state.seats.map((p) => p.stack)) : null;
    }

    _continuity(s, issues) {
      const p = this.last, bad = (code, detail) => issues.push({ code, detail });
      if (p && p.hand !== null && s.hand !== null && s.hand < p.hand) bad('contradiction', 'Hand number went backwards');
      const sameHand = p && (p.hand === s.hand || (p.hand === null && s.hand === null && STREETS.indexOf(s.street) >= STREETS.indexOf(p.street) && p.status === 'playing'));
      if (sameHand && p.hand !== null) {
        if (STREETS.indexOf(s.street) < STREETS.indexOf(p.street)) bad('contradiction', 'Street regressed ' + p.street + ' -> ' + s.street);
        if (p.board.some((c, i) => s.board[i] !== c)) bad('contradiction', 'Board cards changed within a hand');
        if (p.button !== s.button) bad('contradiction', 'Dealer button moved within a hand');
        for (let i = 0; i < SEATS; i++) {
          const a = p.seats[i], b = s.seats[i];
          if (a.folded && !b.folded) bad('contradiction', 'Seat ' + i + ' unfolded');
          if (a.total !== null && b.total !== null && s.status === 'playing') {
            if (b.total < a.total) bad('contradiction', 'Seat ' + i + ' committed chips decreased');
            if (p.status === 'playing' && a.stack + a.total !== b.stack + b.total && s.status === 'playing') bad('inconsistent-stacks', 'Seat ' + i + ' chips changed outside betting');
          }
          if (a.cards && b.cards && (a.cards[0] !== b.cards[0] || a.cards[1] !== b.cards[1])) bad('contradiction', 'Seat ' + i + ' hole cards changed');
        }
        if (p.actions && s.actions) {
          if (s.actions.length < p.actions.length) bad('incomplete-history', 'Action history shortened');
          else for (let i = 0; i < p.actions.length; i++) {
            if (p.actions[i].seat !== s.actions[i].seat || p.actions[i].type !== s.actions[i].type) { bad('incomplete-history', 'Action history rewritten at step ' + i); break; }
          }
        }
      }
      if (!issues.length) s.legal = legalFrom(s);
    }
  }

  /** Reference structured feed: simulator table -> observation. Optional corruption hooks for tests. */
  function observeSimulator(table, seq, options = {}) {
    const t = table, snap = t.snapshot();
    const fields = { board: 1, pot: 1, stacks: 1, button: 1, actor: 1, street: 1 };
    const obs = {
      format: 'eightmax-observation', version: 1, table: t.id, seq, source: options.source || 'structured-feed',
      capturedAt: options.now === undefined ? 0 : options.now, layout: { id: 'eightmax-8max-v1', seats: t.seats },
      hand: t.hand, simRevision: t.revision, status: t.status === 'complete' ? 'complete' : 'playing', street: t.street,
      board: snap.board.slice(), button: t.dealer, actor: t.actor, pot: snap.pot, currentBet: t.currentBet, lastRaise: t.lastRaise,
      seats: snap.players.map((p, i) => ({
        seat: i, stack: p.stack, bet: p.bet, total: p.total, folded: p.folded,
        cards: options.revealCards === false ? null : p.cards.slice(),
      })),
      actions: options.actions === undefined ? undefined : options.actions,
      confidence: { overall: 1, fields },
    };
    return obs;
  }

  return { SEATS, SB, BB, ANTE, START_POT, STREETS, BOARD_LEN, DEFAULTS, HandStateEngine, observeSimulator, stateKey, legalFrom, cardToString, cardFromString };
});
