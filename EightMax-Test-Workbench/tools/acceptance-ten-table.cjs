'use strict';
/* End-to-end acceptance scenario (machine-readable result). Simulated tables only.
 *  1. ten tables, independent seeds, solver-made decisions flow state -> request -> decision -> guarded executor -> simulator
 *  2. every hand's chips are conserved; every action is logged
 *  3. injected faults are isolated (worker crash, corrupt table, garbage observation, solver stall)
 *  4. emergency stop halts all tables
 *  5. checkpoint mid-run, restart, identical final state
 *  Exit code 0 only if every criterion passes. Fallback actions are counted separately and never counted as solver decisions. */
const fs = require('node:fs'), path = require('node:path');
const { trainStudy, cliPath } = require('./train-study.cjs'), SS = require('../src/solver-service.js'), MT = require('../src/multitable.js');

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
  const updates = +(args.updates || (cliPath() ? 500000 : 20000)), hands = +(args.hands || 100), out = args.out;
  const study = trainStudy(updates), src = new SS.StudyDecisionSource(study.EM, study.prepared, { studyId: 'preflop8-' + study.updates });
  const crit = [], add = (id, pass, detail) => { crit.push({ id, pass: !!pass, detail }); process.stderr.write((pass ? 'PASS ' : 'FAIL ') + id + ' ' + (detail || '') + '\n'); };
  const mk = (o) => new MT.MultiTableScheduler({ tables: 10, handsPerTable: hands, decisionSource: src, allowFallback: true, ...o });
  const runs = [];
  // 1-2: three independent seeds
  for (const seed of [4127, 90001, 777777]) {
    const s = mk({ seed }), r = await s.run();
    const conserved = s.workers.every((w) => { try { w.table.validate(); return w.table.players.reduce((n, p) => n + p.stack, 0) === 20000; } catch (e) { return false; } });
    runs.push({ seed, hands: r.handsCompleted, actions: r.actions, solverActions: r.solverActions, fallbackActions: r.fallbackActions, solverShare: r.actions ? r.solverActions / r.actions : null, invalid: r.invalidObservations, crashes: r.crashes, deadlineMisses: r.deadlineMisses, wallMs: r.wallMs, endToEndP95Ms: r.latency.endToEnd.p95, peakRssBytes: r.memory.peakRssBytes });
    add('ten-tables-complete-seed-' + seed, r.handsCompleted === 10 * hands && s.workers.every((w) => w.status === 'done'), r.handsCompleted + ' hands');
    add('chip-accounting-seed-' + seed, conserved, 'all 10 tables hold exactly 20000 chips');
    add('no-invalid-observations-seed-' + seed, r.invalidObservations === 0 && r.crashes === 0, 'invalid=' + r.invalidObservations + ' crashes=' + r.crashes);
    add('fallback-counted-separately-seed-' + seed, r.solverActions + r.fallbackActions === r.actions, 'solver=' + r.solverActions + ' fallback=' + r.fallbackActions);
  }
  // 3: faults
  const f = mk({ seed: 31, handsPerTable: 6, budgets: { deadlineMs: 150, recoveryBackoffMs: 10, maxRecoveries: 1 }, faults: [{ table: 2, step: 3, kind: 'throw' }, { table: 4, step: 3, kind: 'corrupt-table' }, { table: 6, step: 3, kind: 'garbage-observation' }, { table: 8, step: 2, kind: 'stall-solver', repeat: true }] });
  const fr = await f.run(), by = Object.fromEntries(fr.perTable.map((t) => [t.table, t]));
  add('fault-crash-recovered', by[2].crashes === 1 && by[2].status === 'done', by[2].status);
  add('fault-corrupt-table-isolated', by[4].status === 'failed', by[4].status + ': ' + by[4].reason);
  add('fault-garbage-observation-paused-then-recovered', by[6].invalidObservations >= 1 && by[6].status === 'done', 'invalid=' + by[6].invalidObservations);
  add('fault-solver-stall-isolated', ['failed', 'suspended'].includes(by[8].status), by[8].status);
  add('healthy-tables-unaffected', [1, 3, 5, 7, 9, 10].every((i) => by[i].status === 'done' && by[i].hands === 6), 'tables 1,3,5,7,9,10 finished 6 hands');
  // 4: emergency stop
  const e = mk({ seed: 5, handsPerTable: 1000 }), ep = e.run(); await new Promise((r) => setTimeout(r, 200)); e.emergencyStop('acceptance'); const before = e.totals.actions; await ep; await new Promise((r) => setTimeout(r, 100));
  add('emergency-stop-halts-all', e.totals.actions === before && e.workers.every((w) => w.table.paused), 'actions frozen at ' + before);
  // 5: checkpoint / restart
  const ref = mk({ seed: 8, tables: 3, handsPerTable: 60 }); await ref.run();
  const a = mk({ seed: 8, tables: 3, handsPerTable: 60 }), ap = a.run(); while (a.totals.hands < 20) await new Promise((r) => setTimeout(r, 1)); a.emergencyStop('checkpoint'); await ap;
  const cp = JSON.parse(JSON.stringify(a.checkpoint())), b = mk({ seed: 8, tables: 3, handsPerTable: 60 }); MT.restoreCheckpoint(b, cp); await b.run();
  const sig = (s) => JSON.stringify(s.workers.map((w) => [w.table.hand, w.table.players.map((p) => p.stack), w.table.rng.state, w.table.completed]));
  add('checkpoint-restart-identical-final-state', sig(b) === sig(ref), 'checkpoint at ' + a.totals.hands + ' hands');
  const result = { format: 'eightmax-acceptance-result', version: 1, appVersion: require('../src/engine.js').VERSION, generatedAt: new Date().toISOString(), classification: 'SIMULATED TABLES; this machine; not Windows target hardware',
    study: { trainingUpdates: study.updates, backend: study.backend, convergence: 'unproven', engine: '5.1 build 7d08acc7eb4577ee' }, handsPerTable: hands, runs, criteria: crit, passed: crit.every((c) => c.pass) };
  if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(result, null, 2)); } else console.log(JSON.stringify(result, null, 2));
  process.exit(result.passed ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
