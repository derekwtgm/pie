'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const EM = require('../tests/load-solver.cjs'), A = require('../src/study-adapter.js'), ST = require('../src/solver-tree.js'), SS = require('../src/solver-service.js'), E = require('../src/engine.js'), FH = require('../src/full-hand.js');
const { screen, engine } = require('./screen-util.cjs');
function flopSpot(seed = 5, skip = 4) {
  const t = new E.Table(1, seed), e = engine(); let seq = 0; t.startHand(); e.ingest(screen(t, seq++));
  for (let i = 0; i < 8; i++) { if (i < skip) t.execute(t.request('fold', 0, 0), 0); else t.execute(t.request(t.legal().toCall > 0 ? 'call' : 'check', 0, 0), 0); if (t.status === 'playing' && t.street === 'preflop') e.ingest(screen(t, seq++)); }
  const r = e.ingest(screen(t, seq++)); assert.ok(r.accepted); return { t, e, state: r.state, seq: () => seq++ };
}
const post = (o = {}) => new ST.PostflopStudySource({ EM, adapter: A, iterations: 1500, ...o });
async function offTree(o) {
  const { t, e, seq } = flopSpot(); const src = post(o); t.execute(t.request('check', 0, 0), 0); const r1 = e.ingest(screen(t, seq())); assert.ok(r1.accepted);
  const l = t.legal(); t.execute(t.request('raise', Math.min(l.maxRaiseTo, 137), 0), 0); const r2 = e.ingest(screen(t, seq())); assert.ok(r2.accepted, JSON.stringify(r2.issues));
  return { src, req: SS.requestFromState(r2.state), t };
}

test('off-tree wager: strict by default (structured unavailable result), translated only when asked and then clearly labelled approximate', async () => {
  const { src, req } = await offTree({}); const comp = new ST.CompositeDecisionSource([src]);
  const d = await comp.decide(req); assert.equal(d.status, 'unavailable'); assert.equal(d.code, 'off-tree-wager'); assert.match(d.missingCapability, /outside the trained tree/); assert.equal(d.executable, false); assert.equal(d.coverage.exactState, false);
  assert.equal(d.treeMenu, undefined, 'history left the tree, so there is no current tree node to offer a menu for'); assert.equal(d.inputFingerprint, req.stateKey); assert.ok(d.decidedAt > 0);
  assert.equal(comp.stats.byMissing['off-tree-wager'], 1);
  const t = await offTree({ translateOffTree: true, iterations: 8000 }); const d2 = await new ST.CompositeDecisionSource([t.src]).decide(t.req);
  assert.equal(d2.status, 'ok', d2.reason); assert.equal(d2.exactState, false); assert.equal(d2.translations.length, 1); assert.equal(d2.translations[0].actual, 137); assert.notEqual(d2.translations[0].mappedTo, 137);
  assert.ok(d2.warnings.some((w) => /APPROXIMATE STATE/.test(w))); assert.ok(d2.assumptions.some((a) => /translated to nearest tree sizes/.test(a))); assert.equal(d2.coverage.translated, true); assert.ok(d2.stateDeviations.length >= 1);
  assert.ok(Math.abs(d2.probabilities.reduce((a, b) => a + b, 0) - 1) < 1e-9); assert.equal(d2.certification, 'none');
});
test('a translation that is too far, or leaves the state too different, is refused', async () => {
  const far = await offTree({ translateOffTree: true, maxTranslationRatio: 1.01 }); const d = await new ST.CompositeDecisionSource([far.src]).decide(far.req);
  assert.equal(d.status, 'unavailable'); assert.equal(d.code, 'off-tree-wager'); assert.match(d.reason, /too far/);
  const tight = await offTree({ translateOffTree: true, maxTranslationPotError: 0.0001 }); const d2 = await new ST.CompositeDecisionSource([tight.src]).decide(tight.req); assert.equal(d2.status, 'unavailable'); assert.equal(d2.code, 'translation-too-approximate');
});
test('every ok decision carries identity, provenance and coverage fields', async () => {
  const { state } = flopSpot(); const req = SS.requestFromState(state), d = await new ST.CompositeDecisionSource([post()], { clock: () => 1234 }).decide(req);
  assert.equal(d.status, 'ok'); assert.equal(d.decidedAt, 1234); assert.equal(d.inputFingerprint, req.stateKey); assert.equal(d.solverVersion, '5.1'); assert.match(d.studyId, /^postflop-/); assert.equal(d.convergence.verdict, 'unproven');
  assert.equal(d.coverage.exactState, true); assert.equal(d.coverage.translated, false); assert.ok(Array.isArray(d.coverage.warnings)); assert.ok('evByAction' in d && d.evNote); assert.equal(d.labels.length, d.probabilities.length);
});
test('unavailable codes are classified and every code has a stated missing capability', () => {
  const cases = { 'Wager to 137 by seat 3 is not a tree size (menu: x)': 'off-tree-wager', 'No stored strategy for this hand at node r01': 'no-stored-row', 'Hand AsKd is not in the study range for this seat': 'hand-not-in-range', 'Preflop study cannot answer a state with community cards': 'street-not-covered', 'Study was trained for SB 0.5 / BB 1 / ante 0.1 BB; the table uses other stakes': 'stakes-or-stack-mismatch', 'Tree pot 8 bb differs from the table pot 9 bb at this node': 'state-mismatch', 'Training failed: x': 'training-failed', 'something odd': 'unsupported-state' };
  for (const [r, c] of Object.entries(cases)) { assert.equal(ST.classifyUnavailable(r), c, r); assert.ok(ST.MISSING[c]); }
  assert.equal(ST.classifyUnavailable('whatever', 'state-mismatch'), 'state-mismatch');
});
test('scripted fallback stays on the tree menu when the node is known (fewer cascading off-tree states) and is labelled', () => {
  const rng = new E.RNG(9), state = { legal: { canRaise: true, canCheck: false, toCall: 100, callAmount: 100, minRaiseTo: 200, maxRaiseTo: 2500 }, currentBet: 100, street: 'preflop', pot: 330, table: 1, hand: 1, revision: 4, key: 'k', actor: 2 };
  const menu = { executable: [{ type: 'fold' }, { type: 'call' }, { type: 'raise', amount: 220 }, { type: 'raise', amount: 150 }, { type: 'allin' }] };
  const seen = new Set(); for (let i = 0; i < 200; i++) { const d = FH.scriptedDecision(state, rng, menu); assert.match(d.label, /SCRIPTED FALLBACK/); assert.equal(d.onTree, true); const a = d.executable[0]; seen.add(a.type); if (a.type === 'raise') assert.equal(a.amount, 220, 'only legal tree sizes (150 is below the minimum raise)'); }
  assert.ok(seen.has('call') && seen.has('raise') && seen.has('fold'));
  const d = FH.scriptedDecision(state, rng, null); assert.equal(d.onTree, false);
});
