'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const EM = require('../tests/load-solver.cjs'), A = require('../src/study-adapter.js'), ST = require('../src/solver-tree.js'), SS = require('../src/solver-service.js'), HS = require('../src/hand-state.js'), E = require('../src/engine.js');
const { screen, engine } = require('./screen-util.cjs');

/** A tracked state + request at the first postflop decision of a limped pot (every player calls preflop). */
function flopSpot(seed = 5, skipPlayers = 0) {
  const t = new E.Table(1, seed), e = engine(); let seq = 0; t.startHand(); e.ingest(screen(t, seq++));
  for (let i = 0; i < 8; i++) { if (i < skipPlayers) t.execute(t.request('fold', 0, 0), 0); else t.execute(t.request(t.legal().toCall > 0 ? 'call' : 'check', 0, 0), 0); if (t.status === 'playing' && t.street === 'preflop') e.ingest(screen(t, seq++)); }
  const r = e.ingest(screen(t, seq++)); assert.ok(r.accepted, JSON.stringify(r.issues)); return { t, e, state: r.state, seq: () => seq++ };
}
const post = (o = {}) => new ST.PostflopStudySource({ EM, adapter: A, iterations: 1500, ...o });

test('menu labels parse into exact chip amounts and executable actions', () => {
  assert.deepEqual(ST.parseLabel('Raise to 5.94'), { kind: 'raise', to: 594 }); assert.deepEqual(ST.parseLabel('All-in to 24.9'), { kind: 'allin', to: 2490 }); assert.deepEqual(ST.parseLabel('Bet 1.98'), { kind: 'bet', to: 198 });
  assert.deepEqual(ST.parseLabel('Call 4.5'), { kind: 'call', amount: 450 }); assert.deepEqual(ST.parseLabel('Check'), { kind: 'check' }); assert.equal(ST.parseLabel('Donk 3').kind, 'unknown');
  assert.deepEqual(ST.executableFor(ST.parseLabel('Bet 1.98')), { type: 'bet', amount: 198 }); assert.equal(ST.executableFor({ kind: 'unknown' }), null);
  assert.deepEqual(ST.preflopSeatOrder(0), [3, 4, 5, 6, 7, 0, 1, 2]); assert.deepEqual(ST.preflopSeatOrder(5), [0, 1, 2, 3, 4, 5, 6, 7].map((x) => (x + 0) % 8).map((_, i) => (7 + 1 + i) % 8 === undefined ? 0 : ((5 + 2 + 1 + i) % 8)));
});
test('requests from tracked states carry everything the mapping must validate', () => {
  const { state } = flopSpot(); const req = SS.requestFromState(state);
  assert.equal(req.street, 'flop'); assert.equal(req.board.length, 3); assert.equal(req.pot, state.pot); assert.equal(req.streetStart.pot, state.pot); assert.deepEqual(req.streetStart.live, Array(8).fill(true)); assert.equal(req.legal.canRaise, true);
  assert.ok(req.actions.every((a) => a.street)); assert.equal(req.blinds.bb, 100); SS.validateRequest(req);
  const bad = { ...req, seatsState: req.seatsState.slice(1) }; assert.throws(() => SS.validateRequest(bad), /Per-seat chips/);
});
test('postflop: a study is built from the reconstructed state and answers with a legal strategy (EightMax 5.1 engine)', async () => {
  const { state } = flopSpot(5, 4); const src = post(), d = await src.decide(SS.requestFromState(state));
  assert.equal(d.status, 'ok', d.reason); assert.equal(d.source, 'eightmax-study'); assert.equal(d.studyKind, 'postflop'); assert.equal(d.engine.build, '7d08acc7eb4577ee'); assert.equal(d.certification, 'none'); assert.equal(d.convergence.verdict, 'unproven');
  assert.ok(Math.abs(d.probabilities.reduce((a, b) => a + b, 0) - 1) < 1e-9); assert.equal(d.labels.length, d.executable.length); assert.ok(d.assumptions.some((a) => /not observed ranges/.test(a))); assert.equal(d.trainingUpdates, 1500);
  assert.ok(d.node.pot > 0 && d.executable.every((x) => x && ['fold', 'check', 'call', 'bet', 'raise', 'allin'].includes(x.type)));
  if (d.evByAction) assert.equal(d.evByAction.length, d.labels.length);
  const again = await src.decide(SS.requestFromState(state)); assert.equal(src.info().hits, 1, 'second query for the same street reads the cached study'); assert.deepEqual(again.probabilities, d.probabilities);
});
test('postflop: the study tree must follow the recorded betting exactly, size by size', async () => {
  const { t, e, state, seq } = flopSpot(5, 4); const src = post(); t.execute(t.request('check', 0, 0), 0); const r1 = e.ingest(screen(t, seq())); assert.ok(r1.accepted);
  const d1 = await src.decide(SS.requestFromState(r1.state)); assert.equal(d1.status, 'ok', d1.reason); assert.equal(d1.path, 'r0');
  // an off-menu bet size cannot be mapped: unavailable, with the menu named
  const l = t.legal(); t.execute(t.request('raise', Math.min(l.maxRaiseTo, 137), 0), 0); const r2 = e.ingest(screen(t, seq())); assert.ok(r2.accepted, JSON.stringify(r2.issues));
  const d2 = await src.decide(SS.requestFromState(r2.state)); assert.equal(d2.status, 'unavailable'); assert.match(d2.reason, /not a tree size/); assert.match(d2.reason, /Check \/ Bet|Fold \/ Call|Bet/);
});
test('unsupported states are explicit: all-in player at street start, too many live players, preflop request, hero hand outside the study range', async () => {
  const s8 = flopSpot(7, 0); const d8 = await post().decide(SS.requestFromState(s8.state)); assert.equal(d8.status, 'unavailable'); assert.match(d8.reason, /at most six live players/);
  const pre = new E.Table(1, 9), e = engine(); pre.startHand(); const r = e.ingest(screen(pre, 0)); const dp = await post().decide(SS.requestFromState(r.state)); assert.equal(dp.status, 'unavailable'); assert.match(dp.reason, /Not a postflop/);
  const { state } = flopSpot(5, 4); const req = SS.requestFromState(state);
  const bad = { ...req, streetStart: { ...req.streetStart, behind: req.streetStart.behind.map(() => 0) } }; assert.equal((await post().decide(bad)).status, 'unavailable');
});
test('node validation: a pot or stack that disagrees with the tree is never papered over', async () => {
  const { state } = flopSpot(5, 4); const src = post(), req = SS.requestFromState(state); assert.equal((await src.decide(req)).status, 'ok');
  const study = [...src.studies.values()][0]; const fake = { ...req, pot: req.pot + 50, stateKey: req.stateKey + 'x' }; const d1 = study.decide(fake); assert.equal(d1.status, 'unavailable'); assert.match(d1.reason, /pot/);
  const seats = req.seatsState.map((p) => ({ ...p })); const live = req.streetStart.live.findIndex(Boolean); seats[live].stack += 20; const d2 = study.decide({ ...req, seatsState: seats }); assert.equal(d2.status, 'unavailable'); assert.match(d2.reason, /behind/);
  const d3 = study.decide({ ...req, actor: (req.actor + 1) % 8 }); assert.equal(d3.status, 'unavailable'); assert.match(d3.reason, /Acting seat|not the tree/);
  const d4 = study.decide({ ...req, legal: undefined }); assert.equal(d4.status, 'unavailable'); assert.match(d4.reason, /legal-action/);
  const d5 = study.decide({ ...req, legal: { ...req.legal, canRaise: false } }); assert.ok(d5.status === 'unavailable' || d5.status === 'ok');
  if (d5.status === 'unavailable') assert.match(d5.reason, /not legal at the table/);
});
test('preflop linked tree: seat order, history walk, pooling of suit-equivalent hands, honest unavailability', async () => {
  const cfg = { board: '', dealt: 8, common: 0, preflop: { mode: 'linked', opens: '2.2,a', maxBets: 3 }, stacks: Array(8).fill(25), ranges: Array(8).fill('random'), streets: { flop: { bets: '50', raises: 'a', maxBets: 1 }, turn: { bets: '50', raises: 'a', maxBets: 1 }, river: { bets: '50', raises: 'a', maxBets: 1 } }, privateSeed: 8 };
  const prepared = A.prepare(EM, { config: cfg, iterations: 6000, timeMs: 600000 }); prepared.game.iterate(6000);
  const src = new ST.PreflopTreeSource(EM, prepared, { studyId: 'unit-linked' }); assert.equal(src.updates, 6000);
  const t = new E.Table(1, 33), e = engine(); let seq = 0, ok = 0, unavailable = 0, pooled = 0, outOfTree = 0, req0 = null; t.startHand();
  for (let g = 0; g < 60 && t.status === 'playing' && t.street === 'preflop'; g++) {
    const r = e.ingest(screen(t, seq++)); assert.ok(r.accepted, JSON.stringify(r.issues)); const rq = SS.requestFromState(r.state); req0 = req0 || rq; const d = src.decide(rq);
    if (d.status === 'ok') { ok++; if (d.pooled) pooled++; assert.equal(d.labels.length, d.probabilities.length); assert.ok(d.labels[0] === 'Fold' || /Call|Raise|All-in/.test(d.labels.join())); const best = d.executable[d.recommendedSlot]; assert.ok(best); } else { unavailable++; assert.ok(d.reason.length > 10); if (/not a tree size/.test(d.reason)) outOfTree++; }
    const l = t.legal(); if (g === 2 && l.canRaise) t.execute(t.request('raise', 333, 0), 0); else t.execute(t.request(l.toCall > 0 ? 'fold' : 'check', 0, 0), 0);
  }
  assert.ok(ok >= 2, 'first decisions of a fold-around hand are in the tree'); assert.ok(unavailable >= 1 && outOfTree >= 1, 'a raise to 3.33 BB is not a menu size: later decisions are unavailable, not approximated');
  assert.equal(src.decide({ ...req0, stacks: req0.stacks.map((x) => x + 100) }).status, 'unavailable'); assert.equal(src.decide({ ...req0, blinds: { sb: 100, bb: 200, ante: 20 } }).status, 'unavailable');
  assert.equal(src.decide({ ...req0, board: [1, 5, 9] }).status, 'unavailable');
});
test('composite source: first ok wins, otherwise every reason is reported and nothing is substituted', async () => {
  const A1 = { decide: async () => ({ status: 'unavailable', reason: 'first says no', studyKind: 'a' }) }, A2 = { decide: async () => ({ status: 'ok', labels: ['x'], probabilities: [1], source: 'eightmax-study', stateKey: 'k' }) }, A3 = { decide: async () => { throw new Error('boom'); } };
  const req = { table: 1, hand: 1, revision: 1, stateKey: 'k' };
  assert.equal((await new ST.CompositeDecisionSource([A1, A2]).decide(req)).status, 'ok'); const none = await new ST.CompositeDecisionSource([A1, A1]).decide(req); assert.equal(none.status, 'unavailable'); assert.match(none.reason, /first says no \| a: first says no/);
  const err = await new ST.CompositeDecisionSource([A1, A3, A2]).decide(req); assert.equal(err.status, 'error', 'an error stops the chain instead of falling through to a different answer'); assert.throws(() => new ST.CompositeDecisionSource([]), /At least one/);
});
test('engine identity: unsupported builds are refused and no newer solver is claimed', () => {
  assert.equal(SS.identifyEngine({ version: '5.1', build: '7d08acc7eb4577ee' }).compatible, true); const n = SS.identifyEngine({ version: '5.2', build: '0123456789abcdef' }); assert.equal(n.compatible, false); assert.match(n.issues[0], /Unsupported engine/);
  assert.equal(SS.identifyEngine({ version: '5.1', build: '7d08acc7eb4577ee' }, { version: '5.1', build: 'ffffffffffffffff' }).compatible, false); assert.equal(ST.ENGINE.build, '7d08acc7eb4577ee');
});

const { cliPath } = require('../tools/train-study.cjs'), { nativeTrainer } = require('../tools/studies.cjs');
test('native EightMax CLI trains an on-demand postflop study off-thread and the JS reader returns the same kind of answer', { skip: cliPath() ? false : 'native CLI (EIGHTMAX_TEST_CLI) not available: native postflop training not verified in this run' }, async () => {
  const { state } = flopSpot(5, 4), req = SS.requestFromState(state), src = new ST.PostflopStudySource({ EM, adapter: A, iterations: 20000, trainer: nativeTrainer(cliPath(), { threads: 1 }), backend: 'native-cli-cpu' });
  const t0 = Date.now(), d = await src.decide(req); assert.equal(d.status, 'ok', d.reason); assert.equal(d.engine.backend, 'native-cli-cpu'); assert.equal(d.trainingUpdates, 20000); assert.ok(Math.abs(d.probabilities.reduce((a, b) => a + b, 0) - 1) < 1e-6); assert.ok(Date.now() - t0 < 30000);
  const js = await post({ iterations: 1500 }).decide(req); assert.equal(js.status, 'ok'); assert.deepEqual(js.labels, d.labels, 'same tree, same menu');
});
