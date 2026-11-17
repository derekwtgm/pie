/* EightMax Test Workbench 0.20: hand-state reconstruction from observations.
 *
 * Input is an "eightmax-observation" (from a structured simulator feed, a replayed recording or
 * recognised screenshots). Output is either an accepted, internally consistent table state or an
 * explicit rejection. Nothing is guessed: missing cards, bets and actions stay missing, and a
 * table whose state cannot be reconstructed is paused until consistent frames return.
 * Units follow the simulator: 100 chips = 1 BB (SB 50, BB 100, ante 10, eight-handed start pot 230).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WorkbenchHandState = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SEATS = 8, SB = 50, BB = 100, ANTE = 10, START_POT = SEATS * ANTE + SB + BB;
  const STREETS = ['preflop', 'flop', 'turn', 'river'];
  const BOARD_LEN = { preflop: 0, flop: 3, turn: 4, river: 5 };
  const RANKS = '23456789TJQKA', SUITS = 'cdhs';
  const DEFAULTS = Object.freeze({
    minOverallConfidence: 0.9, minFieldConfidence: 0.85, autoResumeAfter: 2,
    expectedLayout: 'eightmax-8max-v1', expectedBankroll: null, maxSeqGap: 1000,
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
      canFold: toCall > 0, // folding is never offered for free; the simulator permits it, a client would not need it
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
    }
    get state() { return this.last; }

    /** Operator or supervisor resume. Never resumes a table whose last frame was rejected for contradiction. */
    resume() { this.paused = false; this.pauseReason = null; this.goodStreak = 0; }

    ingest(obs) {
      const issues = [];
      let state = null;
      try { state = this._build(obs, issues); } catch (e) { issues.push({ code: 'malformed', detail: e.message }); }
      if (state && !issues.length) this._continuity(state, issues);
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
      if (!obs.layout || obs.layout.id !== o.expectedLayout || obs.layout.seats !== SEATS) { bad('unrecognized-layout', 'Layout ' + JSON.stringify(obs.layout && obs.layout.id) + ' is not ' + o.expectedLayout); return null; }
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
        const bankroll = seats.reduce((n, p) => n + p.stack + p.total, 0);
        if (this.bankroll !== null && status === 'playing' && bankroll !== this.bankroll) { bad('inconsistent-stacks', 'Chips in play ' + bankroll + ' != established ' + this.bankroll); return null; }
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
        if (obs.pot !== START_POT) { bad('inconsistent-start-pot', 'Opening pot ' + obs.pot + ' != ' + START_POT + ' (2.3 BB with eight antes)'); return null; }
        const blinds = seats.map((p) => p.total);
        if (blinds.some((t) => t < ANTE)) { bad('inconsistent-start-pot', 'A seat has not posted its ante'); return null; }
      }
      if (haveTotals && this.bankroll === null) this._pendingBankroll = seats.reduce((n, p) => n + p.stack + p.total, 0);
      return {
        table: this.table, hand: isInt(obs.hand) ? obs.hand : null, status, street: obs.street, board: obs.board.slice(),
        button: obs.button, actor, pot: obs.pot, currentBet, lastRaise: Number.isFinite(obs.lastRaise) ? obs.lastRaise : null,
        canReopen: obs.canReopen, seats, actions: history, handStart, source: obs.source || 'unknown',
        confidence: conf.overall, seq: obs.seq, simRevision: isInt(obs.simRevision) ? obs.simRevision : null,
        legal: null,
      };
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
