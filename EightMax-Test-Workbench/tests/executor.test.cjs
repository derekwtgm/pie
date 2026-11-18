'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http');
const EMG = require('../src/engine.js'), HS = require('../src/hand-state.js'), SS = require('../src/solver-service.js'), X = require('../src/test-executor.js'), F = require('./study-fixture.cjs');

function rig(seed = 4127) {
  const t = new EMG.Table(1, seed); t.startHand();
  const e = new HS.HandStateEngine(1), actions = [];
  const observe = () => e.ingest(HS.observeSimulator(t, e.accepted + e.rejected + 1, { actions }));
  observe();
  let clock = 1000;
  const ex = new X.TestExecutor({ stateOf: () => ({ state: e.state, paused: e.paused, pauseReason: e.pauseReason, revision: e.revision }), now: () => clock, maxActionAgeMs: 1500, ackTimeoutMs: 40 });
  const decide = () => { const req = SS.requestFromState(e.state); const d = F.study().src.decide(req); return { ...d, actor: req.actor, issuedAt: clock }; };
  return { t, e, ex, observe, decide, actions, tick: (n) => { clock += n; } };
}
const sim = (r) => new X.SimulatorAdapter(r.t, () => 0);

test('Study Mode is the default and never acts', async () => {
  const r = rig(); r.ex.attach(1, sim(r)); assert.equal(r.ex.mode, 'study');
  const before = r.t.revision, res = await r.ex.execute(r.decide());
  assert.equal(res.status, 'blocked'); assert.match(res.reason, /Study mode/); assert.equal(r.t.revision, before);
});

test('Simulation Mode executes a validated solver decision through the simulator and logs it', async () => {
  const r = rig(); r.ex.setMode('simulation'); r.ex.attach(1, sim(r));
  const d = r.decide(), res = await r.ex.execute(d);
  assert.equal(res.status, 'confirmed', JSON.stringify(res));
  assert.equal(r.t.players[r.t.actor === 4 ? 3 : 3].folded || r.t.actor !== 3, true);
  assert.equal(r.ex.counts.executed, 1); assert.equal(r.ex.log.at(-1).kind, 'executed');
  assert.equal(r.ex.log.at(-1).source, 'eightmax-study');
});

test('stale decisions are rejected: any change to the table after the decision invalidates it', async () => {
  const r = rig(); r.ex.setMode('simulation'); r.ex.attach(1, sim(r));
  const d = r.decide();
  r.t.execute(r.t.request('fold', 0, 0), 0); r.actions.push({ seat: 3, type: 'fold', amount: 0 }); r.observe();
  const res = await r.ex.execute(d);
  assert.equal(res.status, 'rejected'); assert.match(res.reason, /Stale decision/);
});

test('decisions older than the maximum action age are rejected', async () => {
  const r = rig(); r.ex.setMode('simulation'); r.ex.attach(1, sim(r));
  const d = r.decide(); r.tick(1600);
  const res = await r.ex.execute(d); assert.equal(res.status, 'rejected'); assert.match(res.reason, /too old/);
});

test('duplicate actions for the same state are refused even if the first call is still in flight', async () => {
  const r = rig(); r.ex.setMode('simulation');
  let release; r.ex.attach(1, { kind: 'simulator', submit: () => new Promise((res) => { release = () => res({ accepted: true }); }) });
  const d = r.decide(), first = r.ex.execute(d), second = await r.ex.execute(d);
  assert.equal(second.status, 'duplicate'); release(); assert.equal((await first).status, 'confirmed');
  assert.equal((await r.ex.execute(d)).status, 'duplicate', 'and after completion');
});

test('only EightMax study decisions execute; scripted fallback output and unavailable results never do', async () => {
  const r = rig(); r.ex.setMode('simulation'); r.ex.attach(1, sim(r));
  const d = r.decide();
  assert.equal((await r.ex.execute({ ...d, source: 'scripted-fallback' })).status, 'rejected');
  assert.equal((await r.ex.execute({ ...d, status: 'unavailable' })).status, 'rejected');
  assert.equal(r.t.revision, 1 + 0 * r.t.revision || r.t.revision);
  assert.equal(r.ex.counts.executed, 0);
});

test('illegal concrete actions are refused from reconstructed legal actions only', () => {
  const r = rig(), s = r.e.state;
  assert.equal(X.concretize({ type: 'check' }, s).error, 'check-not-legal');
  assert.deepEqual(X.concretize({ type: 'allin' }, s), { type: 'raise', amount: 2490 });
  assert.deepEqual(X.concretize({ type: 'call' }, s), { type: 'call', amount: 100 });
  assert.equal(X.concretize({ type: 'raise', amount: 150 }, s).error, 'raise-size-illegal');
  assert.deepEqual(X.concretize({ type: 'raise', amount: 300 }, s), { type: 'raise', amount: 300 });
  assert.equal(X.concretize({ type: 'dance' }, s).error, 'unknown-action');
});

test('a paused table or ambiguous state blocks execution; unknown tables are unrecognised', async () => {
  const r = rig(); r.ex.setMode('simulation'); r.ex.attach(1, sim(r));
  const d = r.decide();
  r.ex.pauseTable(1, 'operator'); assert.match((await r.ex.execute(d)).reason, /paused/);
  r.ex.resumeTable(1);
  assert.match((await r.ex.execute({ ...d, table: 7 })).reason, /unrecognised table/);
  const bad = H => { const o = HS.observeSimulator(r.t, 99, { actions: [] }); o.pot += 1; return o; };
  r.e.ingest(bad()); assert.equal(r.e.paused, true);
  const res = await r.ex.execute(d); assert.equal(res.status, 'blocked'); assert.match(res.reason, /not reconstructed or paused/);
});

test('unconfirmed actions retry with the same idempotency key, then pause the table with no further automation', async () => {
  const r = rig(); r.ex.setMode('simulation'); const keys = [];
  r.ex.attach(1, { kind: 'simulator', submit: (a) => { keys.push(a.key); return new Promise(() => {}); } });
  const d = r.decide(), res = await r.ex.execute(d);
  assert.equal(res.status, 'unconfirmed'); assert.equal(res.tries, 3); assert.equal(new Set(keys).size, 1);
  assert.equal(r.ex.pausedTables.has(1), true);
  assert.equal((await r.ex.execute(r.decide())).status, 'blocked');
});

test('a retry that succeeds on the second try is confirmed once', async () => {
  const r = rig(); r.ex.setMode('simulation'); let n = 0;
  r.ex.attach(1, { kind: 'simulator', submit: () => (++n === 1 ? new Promise(() => {}) : { accepted: true }) });
  const res = await r.ex.execute(r.decide()); assert.equal(res.status, 'confirmed'); assert.equal(res.tries, 2);
});

test('emergency stop blocks everything, aborts in-flight work, and needs an explicit reset', async () => {
  const r = rig(); r.ex.setMode('simulation'); r.ex.attach(1, { kind: 'simulator', submit: () => new Promise(() => {}) });
  const p = r.ex.execute(r.decide()); r.ex.emergencyStop('test');
  const res = await p; assert.ok(['aborted', 'unconfirmed'].includes(res.status));
  assert.match((await r.ex.execute(r.decide())).reason, /Emergency stop/);
  assert.throws(() => r.ex.setMode('study'), /Emergency stop latched/);
  r.ex.reset(); r.ex.setMode('study');
});

const goodAuth = (now, over = {}) => ({ format: 'eightmax-qa-authorization', version: 1, environment: 'local-qa-sandbox', approvedBy: 'QA lead', testEnvironmentOnly: true, noRealMoney: true, operatorOwnsTestClient: true, endpoint: 'http://127.0.0.1:9/actions', expiresAt: now + 3600000, ...over });

test('Authorized QA Mode refuses to start without a complete, current, loopback-scoped authorization', () => {
  const r = rig(), now = 1000;
  assert.throws(() => r.ex.setMode('qa'), /refused/);
  for (const over of [{ noRealMoney: false }, { testEnvironmentOnly: undefined }, { expiresAt: 500 }, { expiresAt: now + 99 * 3600000 }, { endpoint: 'https://poker.example.com/api' }, { endpoint: 'ftp://127.0.0.1/x' }, { approvedBy: '' }, { operatorOwnsTestClient: false }]) {
    assert.equal(X.validateAuthorization(goodAuth(now, over), now).valid, false, JSON.stringify(over));
  }
  assert.equal(X.validateAuthorization(goodAuth(now), now).valid, true);
  assert.equal(X.validateAuthorization(goodAuth(now, { endpoint: 'https://qa.corp.test/api', allowedHosts: ['qa.corp.test'] }), now).valid, true);
  r.ex.setMode('qa', { authorization: goodAuth(1000) });
  assert.throws(() => r.ex.attach(1, sim(r)), /approved-client/);
  r.ex.reset;
});

test('QA mode drives an approved loopback test client over real HTTP with idempotency keys', async () => {
  const received = [];
  const server = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { received.push(JSON.parse(b)); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ accepted: true })); }); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const port = server.address().port, now = 1000, auth = goodAuth(now, { endpoint: 'http://127.0.0.1:' + port + '/actions' });
    const transport = (url, body) => new Promise((resolve, reject) => {
      const u = new URL(url), req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(JSON.parse(d))); });
      req.on('error', reject); req.end(JSON.stringify(body));
    });
    const r = rig(); r.ex.setMode('qa', { authorization: auth }); r.ex.attach(1, new X.ApprovedClientAdapter(auth, now, transport));
    const res = await r.ex.execute(r.decide());
    assert.equal(res.status, 'confirmed'); assert.equal(received.length, 1);
    assert.equal(received[0].idempotencyKey, res.key); assert.equal(received[0].action, 'fold');
    assert.throws(() => new X.ApprovedClientAdapter({ ...auth, noRealMoney: false }, now, transport), /refused/);
  } finally { server.close(); }
});

test('the exported log replays on a fresh simulator to the identical table state', async () => {
  const r = rig(); r.ex.setMode('simulation'); r.ex.attach(1, sim(r));
  let n = 0;
  while (r.t.status === 'playing' && n++ < 20) {
    const actor = r.e.state.actor, d = r.decide();
    if (d.status !== 'ok') { assert.equal(F.full(), false, 'full native study must cover every node: ' + d.reason); break; }
    const res = await r.ex.execute(d);
    assert.equal(res.status, 'confirmed', JSON.stringify(res));
    r.actions.push({ seat: actor, type: res.action.type === 'raise' ? 'allin' : res.action.type, amount: res.action.amount });
    r.observe();
  }
  if (F.full()) assert.equal(r.t.status, 'complete');
  const log = JSON.parse(JSON.stringify(r.ex.exportLog()));
  const out = X.replayLog(log, (id) => new EMG.Table(id, 4127));
  assert.equal(out.applied, r.ex.counts.executed);
  assert.deepEqual(out.tables[0].players.map((p) => [p.stack, p.folded, p.bet]), r.t.players.map((p) => [p.stack, p.folded, p.bet]));
});
