/* EightMax Test Workbench 0.24: reconstructed hand state -> EightMax game tree, preflop (linked tree) and postflop.
 *
 * What is verified here, and what is not:
 *  - A decision is returned only when the table's betting history walks the study tree step by step: every
 *    action must be a menu entry of that node (type AND size), the node's pot and every seat's remaining chips
 *    must equal the reconstructed table, and the acting seat must be the node's seat. Anything else is
 *    "unavailable" with the exact reason. No similar-looking state is substituted.
 *  - Opponent ranges are MODEL ASSUMPTIONS (a configured range text), not observed ranges. Every decision says so.
 *  - Strategies come from EightMax 5.1 sampled training with a stated update count; convergence is "unproven".
 *    Nothing here is called equilibrium or GTO-certified.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./hand-state.js'));
  else root.WorkbenchSolverTree = factory(root.WorkbenchHandState);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (HS) {
  'use strict';

  const ok = (x, m) => { if (!x) throw new Error(m); };
  const ENGINE = Object.freeze({ version: '5.1', build: '7d08acc7eb4577ee' });
  const EPS = 0.0051; // 0.01 bb label rounding
  function fnv(text) { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
  const hex8 = (n) => n.toString(16).padStart(8, '0');

  /** Parse one menu label. Amounts are returned in chips (100 per bb). */
  function parseLabel(label) {
    let m;
    if (label === 'Fold') return { kind: 'fold' };
    if (label === 'Check') return { kind: 'check' };
    if ((m = /^Call(?: ([\d.]+))?$/.exec(label))) return { kind: 'call', amount: m[1] === undefined ? null : Math.round(Number(m[1]) * 100) };
    if ((m = /^Bet ([\d.]+)$/.exec(label))) return { kind: 'bet', to: Math.round(Number(m[1]) * 100) };
    if ((m = /^Raise to ([\d.]+)$/.exec(label))) return { kind: 'raise', to: Math.round(Number(m[1]) * 100) };
    if ((m = /^All-in to ([\d.]+)$/.exec(label))) return { kind: 'allin', to: Math.round(Number(m[1]) * 100) };
    if ((m = /^All-in(?: ([\d.]+))?$/.exec(label))) return { kind: 'allin', to: m[1] === undefined ? null : Math.round(Number(m[1]) * 100) };
    return { kind: 'unknown' };
  }

  /** The executable action a menu entry stands for. Sizes are exact chip amounts from the tree; the executor re-validates them. */
  function executableFor(p) {
    switch (p.kind) {
      case 'fold': return { type: 'fold' }; case 'check': return { type: 'check' }; case 'call': return { type: 'call' };
      case 'bet': return { type: 'bet', amount: p.to }; case 'raise': return { type: 'raise', amount: p.to }; case 'allin': return { type: 'allin' };
      default: return null;
    }
  }

  /**
   * One trained study plus the geometry needed to read it for a real table.
   * `seatOrder[studySeat] = simulator seat`. `streetKind`: 'preflop' (history from the first action) or 'postflop' (history of the current street only).
   */
  class TreeStudy {
    constructor(EMlib, prepared, o) {
      this.EM = EMlib; this.prepared = prepared; this.o = o; this.id = o.id; this.seatOrder = o.seatOrder; this.kind = o.kind;
      this.nodes = new Map(); this.updates = prepared.game.iterations; this.builtAt = o.builtAt === undefined ? Date.now() : o.builtAt;
      this.convergence = o.convergence || { verdict: 'unproven', detail: 'No convergence check attached; training length alone proves nothing.' };
      this.handIndex = new Map(); prepared.spec.hands.forEach((rows, seat) => this.handIndex.set(seat, new Map(rows.map((r) => [Math.min(r[1], r[2]) * 64 + Math.max(r[1], r[2]), r]))));
      this.engine = { ...ENGINE, backend: o.backend || 'javascript-reference-cpu' };
      this.assumptions = o.assumptions || [];
    }
    studySeatOf(simSeat) { return this.seatOrder.indexOf(simSeat); }
    _view(steps) { const k = steps.join(','); let n = this.nodes.get(k); if (!n) { const v = this.prepared.game.view(steps); n = { kind: v.kind, seat: v.seat, pot: v.pot, behind: v.behind, live: v.live, labels: v.actions ? v.actions.map((a) => a.label) : [], parsed: v.actions ? v.actions.map((a) => parseLabel(a.label)) : [], hands: v.hands, raw: v.actions }; this.nodes.set(k, n); if (this.nodes.size > 4000) this.nodes.delete(this.nodes.keys().next().value); } return n; }

    /** Walk the street's recorded actions through the tree. Returns {steps,key,translations} or {error}.
     *  With `translateOffTree` a wager that is not a tree size is mapped to the nearest tree wager (log distance) and the mapping is REPORTED in `translations`;
     *  without it an off-tree wager makes the node unavailable. */
    _walk(actions) {
      const steps = [], translations = []; let key = 'r';
      for (const a of actions) {
        const v = this._view(steps);
        if (v.kind !== 'player') return { error: 'Recorded history continues past a non-decision node (' + v.kind + ')' };
        if (this.studySeatOf(a.seat) !== v.seat) return { error: 'History actor seat ' + a.seat + ' is not the tree\'s acting seat ' + (this.seatOrder[v.seat]), code: 'history-seat-mismatch' };
        let slot = -1;
        if (a.type === 'fold') slot = v.parsed.findIndex((p) => p.kind === 'fold');
        else if (a.type === 'check') slot = v.parsed.findIndex((p) => p.kind === 'check');
        else if (a.type === 'call') slot = v.parsed.findIndex((p) => p.kind === 'call');
        else if (a.type === 'bet' || a.type === 'raise' || a.type === 'allin') {
          slot = v.parsed.findIndex((p) => (p.kind === 'bet' || p.kind === 'raise' || p.kind === 'allin') && p.to === a.amount);
          if (slot < 0 && this.o.translateOffTree) {
            let best = -1, bestD = Infinity;
            v.parsed.forEach((p, i) => { if ((p.kind === 'bet' || p.kind === 'raise' || p.kind === 'allin') && p.to > 0 && a.amount > 0) { const d = Math.abs(Math.log(a.amount / p.to)); if (d < bestD) { bestD = d; best = i; } } });
            if (best >= 0 && bestD <= Math.log(this.o.maxTranslationRatio || 1.6)) { slot = best; translations.push({ seat: a.seat, street: a.street, actual: a.amount, mappedTo: v.parsed[best].to, ratio: +(a.amount / v.parsed[best].to).toFixed(3) }); }
            else return { error: 'Wager to ' + a.amount + ' by seat ' + a.seat + ' is too far from every tree size to translate (menu: ' + v.labels.join(' / ') + ')', code: 'off-tree-wager' };
          }
          if (slot < 0) return { error: 'Wager to ' + a.amount + ' by seat ' + a.seat + ' is not a tree size (menu: ' + v.labels.join(' / ') + ')', code: 'off-tree-wager' };
        }
        if (slot < 0) return { error: 'Action "' + a.type + '" by seat ' + a.seat + ' has no counterpart in the tree menu (' + v.labels.join(' / ') + ')', code: 'no-tree-counterpart' };
        steps.push(slot); key += slot;
      }
      return { steps, key, translations };
    }

    _classIndex() {
      if (this._classes) return this._classes;
      const RANKS = '23456789TJQKA', SUITS = 'cdhs', m = new Map();
      for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) {
        const ca = RANKS[Math.floor(a / 4)] + SUITS[a % 4], cb = RANKS[Math.floor(b / 4)] + SUITS[b % 4], hi = Math.max(a, b) >> 2, lo = Math.min(a, b) >> 2;
        const cls = RANKS[hi] + RANKS[lo] + (hi === lo ? '' : (a % 4 === b % 4 ? 's' : 'o')), ids = [this.EM.parseCard(ca), this.EM.parseCard(cb)];
        const k = Math.min(...ids) * 64 + Math.max(...ids); if (!m.has(cls)) m.set(cls, []); m.get(cls).push(k);
      }
      return (this._classes = m);
    }
    _pool(seat, hole, key) {
      const [a, b] = hole, RANKS = '23456789TJQKA', hi = Math.max(a, b) >> 2, lo = Math.min(a, b) >> 2, cls = RANKS[hi] + RANKS[lo] + (hi === lo ? '' : (a % 4 === b % 4 ? 's' : 'o'));
      const keys = this._classIndex().get(cls), rows = this.handIndex.get(seat); if (!keys || !rows) return null;
      let sum = null, n = 0;
      for (const k of keys) { const r = rows.get(k); if (!r) continue; const p = this.prepared.game.averageAt(key, this.prepared.spec.board, seat, { id: r[0], a: r[1], b: r[2], w: r[3] }); if (!p) continue; if (!sum) sum = new Array(p.length).fill(0); for (let i = 0; i < p.length; i++) sum[i] += p[i]; n++; }
      return n ? { mix: sum.map((x) => x / n), n, total: keys.length, cls } : null;
    }

    decide(req) {
      const base = { format: 'eightmax-decision', version: 1, table: req.table, hand: req.hand, revision: req.revision, stateKey: req.stateKey, source: 'eightmax-study', studyKind: this.kind, studyId: this.id, engine: this.engine, trainingUpdates: this.updates, convergence: this.convergence, certification: 'none', assumptions: this.assumptions.slice(), warnings: [], builtAt: this.builtAt };
      const ctx = { menu: null }, un = (reason, extra) => ({ ...base, status: 'unavailable', reason, ...(ctx.menu ? { treeMenu: ctx.menu } : {}), ...(extra || {}) });
      const sc = req.seatsState; if (!Array.isArray(sc) || sc.length !== 8) return un('Request lacks per-seat chips; the tree cannot be checked against the table');
      const segment = this.kind === 'preflop' ? req.actions : req.actions.filter((a) => a.street === req.street);
      if (this.kind === 'postflop' && req.actions.some((a) => a.street === undefined)) return un('Postflop mapping needs each action tagged with its street');
      const w = this._walk(segment); if (w.error) return un(w.error, { code: w.code });
      const v = this._view(w.steps), translated = w.translations.length > 0;
      if (v.kind === 'player') ctx.menu = { labels: v.labels.slice(), executable: v.parsed.map(executableFor), seat: this.seatOrder[v.seat] };
      if (v.kind !== 'player') return un('The tree node after this history is not a decision (' + v.kind + ')');
      const seat = this.studySeatOf(req.actor);
      if (seat < 0 || seat !== v.seat) return un('Acting seat ' + req.actor + ' does not match the tree node seat ' + this.seatOrder[v.seat]);
      // Consistency of the node with the real table: pot, remaining chips, live players.
      const potChips = req.pot, tol = this.o.maxTranslationPotError || 0.35; const deviations = [];
      if (translated) {
        // Approximate state: the tree node was reached by translating off-tree wagers, so pot and stacks cannot match exactly. Bound the mismatch and report it.
        const dp = Math.abs(v.pot * 100 - potChips) / Math.max(1, potChips); if (dp > tol) return un('Translated node pot ' + v.pot + ' bb differs from the table pot ' + potChips / 100 + ' bb by more than ' + Math.round(tol * 100) + '%', { code: 'translation-too-approximate' }); deviations.push({ what: 'pot', tree: v.pot, table: potChips / 100 });
        if (Array.isArray(v.behind)) for (let s2 = 0; s2 < this.seatOrder.length; s2++) { const q = sc[this.seatOrder[s2]], dv = Math.abs(v.behind[s2] * 100 - q.stack) / Math.max(100, q.stack); if (dv > tol) return un('Translated node stack of seat ' + this.seatOrder[s2] + ' differs by more than ' + Math.round(tol * 100) + '%', { code: 'translation-too-approximate' }); if (v.behind[s2] * 100 !== q.stack) deviations.push({ what: 'stack seat ' + this.seatOrder[s2], tree: v.behind[s2], table: q.stack / 100 }); }
      } else {
        if (Math.abs(v.pot * 100 - potChips) > 0.51) return un('Tree pot ' + v.pot + ' bb differs from the table pot ' + potChips / 100 + ' bb at this node', { code: 'state-mismatch' });
        if (Array.isArray(v.behind)) for (let s = 0; s < this.seatOrder.length; s++) { const q = sc[this.seatOrder[s]]; if (Math.abs(v.behind[s] * 100 - q.stack) > 0.51) return un('Seat ' + this.seatOrder[s] + ' has ' + q.stack / 100 + ' bb behind but the tree node says ' + v.behind[s] + ' bb', { code: 'state-mismatch' }); }
      }
      if (Array.isArray(v.live)) for (let s = 0; s < this.seatOrder.length; s++) if (v.live[s] !== !sc[this.seatOrder[s]].folded) return un('Live-player flags differ at seat ' + this.seatOrder[s], { code: 'state-mismatch' });
      // Legality of the tree's menu on the real table.
      const lg = req.legal; if (!lg) return un('Request lacks the legal-action description');
      const illegal = [];
      v.parsed.forEach((p, i) => {
        const ex = executableFor(p); let legal = !!ex;
        if (p.kind === 'fold') legal = lg.canFold; else if (p.kind === 'check') legal = lg.canCheck; else if (p.kind === 'call') legal = lg.canCall && (translated || p.amount === null || p.amount === lg.callAmount || p.amount === lg.toCall); // translated node: the tree's call price differs from the real one by construction
        else if (p.kind === 'bet' || p.kind === 'raise') legal = lg.canRaise && p.to <= lg.maxRaiseTo && (p.to >= lg.minRaiseTo || p.to === lg.maxRaiseTo) && p.to > req.currentBet;
        else if (p.kind === 'allin') legal = lg.canRaise ? (p.to === null || p.to === lg.maxRaiseTo) : (lg.toCall >= (sc[req.actor].stack) && lg.canCall);
        if (!legal) illegal.push(i);
      });
      // Study row for the hero's actual hand.
      const ids = req.holeCards.map((c) => this.EM.parseCard(HS.cardToString(c))), row = this.handIndex.get(seat) && this.handIndex.get(seat).get(Math.min(...ids) * 64 + Math.max(...ids));
      if (!row) return un('Hand ' + req.holeCards.map(HS.cardToString).join('') + ' is not in the study range for this seat; no strategy is stored for it', { code: 'hand-not-in-range' });
      let probs = this.prepared.game.averageAt(w.key, this.prepared.spec.board, seat, { id: row[0], a: row[1], b: row[2], w: row[3] }), pooled = null;
      // Preflop only: with no board, hands that differ just by a suit permutation are strategically identical, so the stored rows of the same
      // class (e.g. every suited AK) are an unbiased pool. Postflop hands are never pooled: suits matter once a board exists.
      if (!probs && this.kind === 'preflop' && this.o.poolIsomorphs !== false) { const q = this._pool(seat, req.holeCards, w.key); if (q) { probs = q.mix; pooled = { handClass: q.cls, combosUsed: q.n, combosInClass: q.total }; } }
      if (!probs) return un('No stored strategy for this hand at node ' + w.key + '; the study has not visited it (more training needed; no fallback taken)', { code: 'no-stored-row' });
      const mix = Array.from(probs);
      if (mix.length !== v.labels.length || mix.some((x) => !Number.isFinite(x) || x < -1e-9)) return { ...base, status: 'error', reason: 'Strategy/menu mismatch' };
      const massIllegal = illegal.reduce((a, i) => a + mix[i], 0);
      if (massIllegal > 0.02) return un('Tree action(s) ' + illegal.map((i) => v.labels[i]).join(', ') + ' carry ' + (massIllegal * 100).toFixed(1) + '% of the strategy but are not legal at the table (minimum raise ' + lg.minRaiseTo + ', maximum ' + lg.maxRaiseTo + ')');
      const legalMix = mix.map((x, i) => (illegal.includes(i) ? 0 : x)), tot = legalMix.reduce((a, b) => a + b, 0), norm = legalMix.map((x) => x / tot);
      const best = norm.indexOf(Math.max(...norm));
      if (this.updates < 1000) base.warnings.push('Fewer than 1,000 training updates: strategy is likely far from equilibrium');
      if (this.convergence.verdict !== 'within-target') base.warnings.push('Convergence is ' + this.convergence.verdict + '; do not treat as equilibrium play');
      if (translated) { base.warnings.push('APPROXIMATE STATE: ' + w.translations.length + ' off-tree wager(s) were mapped to the nearest tree size (' + w.translations.map((t) => t.actual / 100 + '->' + t.mappedTo / 100).join(', ') + ' bb); strategy is for the translated node'); base.assumptions.push('Off-tree wagers translated to nearest tree sizes by log distance (max ratio ' + (this.o.maxTranslationRatio || 1.6) + ')'); }
      if (illegal.length) base.warnings.push('Menu entries not legal at the table were excluded (' + illegal.map((i) => v.labels[i]).join(', ') + '; ' + (massIllegal * 100).toFixed(2) + '% mass renormalised)');
      // Per-action EV for this exact hand when the node view exposes it (sampled estimate, tree units: bb).
      let ev = null; const cs = req.holeCards.map(HS.cardToString), keyA = cs.join(''), keyB = cs.slice().reverse().join('');
      if (Array.isArray(v.hands)) { const h = v.hands.find((x) => x.cards === keyA || x.cards === keyB); if (h && Array.isArray(h.ev) && h.ev.length === v.labels.length) ev = h.ev.slice(); }
      return {
        ...base, status: 'ok', path: w.key, exactState: !translated, ...(translated ? { translations: w.translations, stateDeviations: deviations } : {}), ...(pooled ? { pooled } : {}), labels: v.labels.slice(), probabilities: norm, rawProbabilities: mix, recommended: v.labels[best], recommendedSlot: best,
        evByAction: ev, evNote: ev ? 'Sampled per-action EV for this hand at this node (bb); an estimate from training, not a proof.' : 'Per-hand action EV was not available at this node.',
        executable: v.parsed.map(executableFor), illegalSlots: illegal, node: { pot: v.pot, behind: v.behind },
      };
    }
  }

  /* ---------- preflop linked tree ---------- */
  /** Study seat s (UTG = 0 ... BB = n-1) sits at simulator seat (bb + 1 + s) % 8 for the given button. */
  function preflopSeatOrder(button, n = 8) { const bb = (button + 2) % n; return Array.from({ length: n }, (_, s) => (bb + 1 + s) % n); }

  /** Preflop decisions for an equal-stack, fixed-structure eight-handed hand, from a `preflop:{mode:'linked'}` study. */
  class PreflopTreeSource {
    constructor(EMlib, prepared, options = {}) {
      const cfg = prepared.options.config;
      ok(cfg.preflop && cfg.preflop.mode === 'linked' && cfg.stacks.length === 8, 'Only an eight-seat linked preflop study is mapped here');
      ok(cfg.stacks.every((s) => s === cfg.stacks[0]), 'Mapping requires equal starting stacks');
      this.stack = Math.round(cfg.stacks[0] * 100); this.cfg = cfg; this.EM = EMlib; this.prepared = prepared; this.options = options;
      this.study = new TreeStudy(EMlib, prepared, { id: options.studyId || 'preflop-linked', kind: 'preflop', seatOrder: null, backend: options.backend, convergence: options.convergence, builtAt: options.builtAt, translateOffTree: !!options.translateOffTree, maxTranslationRatio: options.maxTranslationRatio, maxTranslationPotError: options.maxTranslationPotError,
        assumptions: ['8-handed, equal ' + this.stack / 100 + ' BB stacks, SB 0.5 / BB 1 / ante 0.1 BB (classic)', 'Linked preflop tree: open sizes ' + (cfg.preflop.opens || '2') + ', up to ' + (cfg.preflop.maxBets || 3) + ' bets, all-in', 'Opponent ranges are the study ranges (' + (cfg.ranges[0]) + '), not observed ranges'] });
      this.id = this.study.id; this.updates = this.study.updates;
    }
    decide(req) {
      const un = (reason) => ({ format: 'eightmax-decision', version: 1, table: req.table, hand: req.hand, revision: req.revision, stateKey: req.stateKey, source: 'eightmax-study', studyKind: 'preflop', studyId: this.id, certification: 'none', status: 'unavailable', reason, warnings: [], assumptions: [] });
      if (req.board.length) return un('Preflop study cannot answer a state with community cards');
      const blind = req.blinds;
      if (blind && (blind.sb !== 50 || blind.bb !== 100 || blind.ante !== 10)) return un('Study was trained for SB 0.5 / BB 1 / ante 0.1 BB; the table uses other stakes');
      if (!req.stacks.every((s) => s === this.stack)) return un('Stacks differ from the study root (' + this.stack / 100 + ' BB each)');
      this.study.seatOrder = preflopSeatOrder(req.button);
      return this.study.decide(req);
    }
  }

  /* ---------- postflop on-demand studies ---------- */
  const DEFAULT_RANGE = '22+,A2s+,K5s+,Q8s+,J8s+,T8s+,97s+,87s,76s,65s,A7o+,KTo+,QTo+,JTo';
  const DEFAULT_STREETS = { flop: { bets: '33,75', raises: '3x,a', maxBets: 2 }, turn: { bets: '50,a', raises: 'a', maxBets: 2 }, river: { bets: '50,a', raises: 'a', maxBets: 2 } };
  const num2 = (chips) => +(chips / 100).toFixed(2);

  /**
   * Builds (and caches) a study for the START of the current street from the reconstructed table, then reads it.
   * options: EM (engine lib), adapter (study-adapter), iterations, trainer(prepared, iterations)->void|Promise,
   *          rangeModel(ctx)->range text, streets (bet/raise menus), maxStudies (cache size), clock
   */
  class PostflopStudySource {
    constructor(options) {
      this.o = { iterations: 3000, maxStudies: 24, rangeModel: null, streets: DEFAULT_STREETS, range: DEFAULT_RANGE, heroWeight: 100, ...options };
      ok(this.o.EM && this.o.adapter, 'EM library and study adapter are required');
      this.studies = new Map(); this.stats = { built: 0, hits: 0, buildMs: 0, unavailable: 0 };
    }
    /** All inputs that define the study: if any differs, it is a different study. */
    context(req) {
      const ss = req.streetStart; if (!ss || !Array.isArray(ss.behind) || ss.behind.length !== 8) return { error: 'Request lacks the street-start chip counts' };
      if (req.street === 'preflop') return { error: 'Not a postflop state' };
      const live = []; for (let k = 1; k <= 8; k++) { const s = (req.button + k) % 8; if (ss.live[s]) live.push(s); }
      if (live.length < 2) return { error: 'Fewer than two live players at the start of the street' };
      if (live.length > 6) return { error: 'Postflop studies support at most six live players (' + live.length + ' are live)' };
      if (live.some((s) => ss.behind[s] <= 0)) return { error: 'A live player was already all-in at the start of the street; side-pot trees are not mapped' };
      const hero = req.actor, heroRow = req.holeCards.map(HS.cardToString).join('');
      return { live, behind: live.map((s) => num2(ss.behind[s])), pot: num2(ss.pot), board: req.board.map(HS.cardToString).join(''), hero, heroRow };
    }
    _key(ctx, req) { return JSON.stringify([req.table, req.hand, req.street, ctx.board, ctx.live, ctx.behind, ctx.pot, ctx.heroRow, this.o.iterations, this.o.range]); }
    _config(ctx, req) {
      const n = ctx.live.length;
      const ranges = ctx.live.map((s) => { let r = this.o.rangeModel ? this.o.rangeModel({ seat: s, req, hero: s === ctx.hero }) : this.o.range; if (s === ctx.hero) r += ',' + ctx.heroRow + ':' + this.o.heroWeight; return r; });
      const streets = {}; for (const k of ['flop', 'turn', 'river']) streets[k] = this.o.streets[k];
      return { board: ctx.board, common: ctx.pot, stacks: ctx.behind, ranges, streets, privateSeed: fnv(JSON.stringify([req.table, req.hand, req.street])) % 4294967295 };
    }
    async decide(req) {
      const base = { format: 'eightmax-decision', version: 1, table: req.table, hand: req.hand, revision: req.revision, stateKey: req.stateKey, source: 'eightmax-study', studyKind: 'postflop', certification: 'none', warnings: [], assumptions: [] };
      const un = (reason) => { this.stats.unavailable++; return { ...base, status: 'unavailable', reason }; };
      if (req.board.length < 3) return un('Not a postflop state');
      const ctx = this.context(req); if (ctx.error) return un(ctx.error);
      if (req.seatsState.some((p, i) => p.stack === 0 && !p.folded && !ctx.live.includes(i))) return un('Unmapped all-in player');
      if (req.actions.some((a) => a.street === undefined)) return un('Postflop mapping needs each action tagged with its street');
      const key = this._key(ctx, req); let study = this.studies.get(key);
      if (study) { this.studies.delete(key); this.studies.set(key, study); this.stats.hits++; }
      else {
        const t0 = Date.now(); let prepared;
        try { prepared = this.o.adapter.prepare(this.o.EM, { config: this._config(ctx, req), iterations: this.o.iterations, timeMs: 600000 }); } catch (e) { return un('Study could not be built from this state: ' + e.message); }
        try { if (this.o.trainer) await this.o.trainer(prepared, this.o.iterations); else prepared.game.iterate(this.o.iterations); } catch (e) { return { ...base, status: 'error', reason: 'Training failed: ' + e.message }; }
        study = new TreeStudy(this.o.EM, prepared, { id: 'postflop-' + hex8(fnv(key)), kind: 'postflop', seatOrder: ctx.live, builtAt: Date.now(), backend: this.o.backend, translateOffTree: !!this.o.translateOffTree, maxTranslationRatio: this.o.maxTranslationRatio, maxTranslationPotError: this.o.maxTranslationPotError,
          assumptions: ['Opponent ranges are an assumed range model (' + (this.o.rangeModel ? 'custom model' : this.o.range) + '), not observed ranges', 'The hero hand is added to its own range at weight ' + this.o.heroWeight + '% (range weights are percentages; 100 = same as every other combo)', 'Tree sizes: flop ' + this.o.streets.flop.bets + ', turn ' + this.o.streets.turn.bets + ', river ' + this.o.streets.river.bets, 'Study covers this street only from its start: ' + ctx.live.length + ' live players, pot ' + ctx.pot + ' bb'] });
        this.stats.built++; this.stats.buildMs += Date.now() - t0; this.studies.set(key, study);
        while (this.studies.size > this.o.maxStudies) this.studies.delete(this.studies.keys().next().value);
      }
      return study.decide(req);
    }
    info() { return { ...this.stats, cached: this.studies.size }; }
  }

  /** First source that answers 'ok' wins; if none does, every reason is reported. Sources are never mixed within one decision. */
  /** Machine-readable reason an answer is missing. `code` is the capability that was missing, so a report can count them. */
  function classifyUnavailable(reason, code) {
    if (code) return code;
    const r = String(reason || '');
    if (/not a tree size|too far from every tree size/.test(r)) return 'off-tree-wager';
    if (/No stored strategy/.test(r)) return 'no-stored-row';
    if (/not in the study range/.test(r)) return 'hand-not-in-range';
    if (/community cards|Not a postflop|covers preflop only/.test(r)) return 'street-not-covered';
    if (/other stakes|Stacks differ|stack/.test(r) && /study|root|tree/i.test(r)) return 'stakes-or-stack-mismatch';
    if (/Tree pot|bb behind|Live-player/.test(r)) return 'state-mismatch';
    if (/Training failed/.test(r)) return 'training-failed';
    if (/multiway|players/.test(r)) return 'player-count-unsupported';
    return 'unsupported-state';
  }
  const MISSING = Object.freeze({
    'off-tree-wager': 'strategy for wager sizes outside the trained tree', 'no-stored-row': 'trained strategy for this hand at this node (more training or coverage needed)', 'hand-not-in-range': 'this hand is outside the study range',
    'street-not-covered': 'study for this street', 'stakes-or-stack-mismatch': 'study for these blinds/stack depths', 'state-mismatch': 'tree node consistent with the table state', 'training-failed': 'trained study (training failed)', 'player-count-unsupported': 'study for this player count',
    'unsupported-state': 'strategy for this state', 'no-source': 'any decision source', 'history-seat-mismatch': 'tree consistent with the betting history', 'no-tree-counterpart': 'tree action matching the recorded action', 'translation-too-approximate': 'translation close enough to the real state',
  });
  /** Stamp every decision with the identity and provenance fields a consumer needs. Never changes the strategy. */
  function finalizeDecision(d, req, clock) {
    const out = { ...d, decidedAt: (clock || Date.now)(), inputFingerprint: req.stateKey, solverVersion: d.engine && d.engine.version || (d.studyId ? ENGINE.version : null) };
    if (d.status === 'ok') {
      out.coverage = { exactState: d.exactState !== false, pooled: !!d.pooled, translated: !!(d.translations && d.translations.length), translations: d.translations || [], warnings: (d.warnings || []).slice(), assumptions: (d.assumptions || []).slice(), evAvailable: !!d.evByAction };
    } else if (d.status === 'unavailable') {
      const code = classifyUnavailable(d.reason, d.code); out.code = code; out.missingCapability = MISSING[code] || MISSING['unsupported-state']; out.executable = false; out.coverage = { exactState: false, missing: code };
    }
    return out;
  }

  class CompositeDecisionSource {
    constructor(sources, options = {}) { ok(Array.isArray(sources) && sources.length, 'At least one source'); this.sources = sources; this.o = options; this.stats = { asked: 0, ok: 0, unavailable: 0, error: 0, byMissing: {} }; }
    async decide(req) {
      const reasons = []; let last = null, menu = null; this.stats.asked++;
      for (const s of this.sources) {
        let d; try { d = await s.decide(req); } catch (e) { d = { status: 'error', reason: e.message }; }
        if (d && d.status === 'ok') { this.stats.ok++; return finalizeDecision(d, req, this.o.clock); }
        last = d; reasons.push((d && d.studyKind ? d.studyKind + ': ' : '') + (d && d.reason || 'no answer')); if (d && d.treeMenu) menu = d.treeMenu;
        if (d && d.status === 'error') break;
      }
      const out = finalizeDecision({ ...(last || {}), format: 'eightmax-decision', version: 1, table: req.table, hand: req.hand, revision: req.revision, stateKey: req.stateKey, status: last && last.status === 'error' ? 'error' : 'unavailable', reason: reasons.join(' | '), ...(menu ? { treeMenu: menu } : {}), ...(last && last.code ? {} : {}) }, req, this.o.clock);
      if (out.status === 'error') this.stats.error++; else { this.stats.unavailable++; this.stats.byMissing[out.code] = (this.stats.byMissing[out.code] || 0) + 1; }
      return out;
    }
  }

  return { ENGINE, MISSING, classifyUnavailable, finalizeDecision, parseLabel, executableFor, TreeStudy, preflopSeatOrder, PreflopTreeSource, PostflopStudySource, CompositeDecisionSource, DEFAULT_RANGE, DEFAULT_STREETS };
});
