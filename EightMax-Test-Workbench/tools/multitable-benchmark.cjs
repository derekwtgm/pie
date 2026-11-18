'use strict';
/* Multi-table benchmark: 1, 2, 5, 8 and 10 simulated tables driven by real EightMax study decisions.
 * Output is machine-readable JSON. These are SIMULATED-TABLE results on whatever machine runs this script
 * (Node.js, one thread, no GPU). They are not Windows RTX 4060 Ti results unless run there. */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { trainStudy, cliPath } = require('./train-study.cjs'), SS = require('../src/solver-service.js'), MT = require('../src/multitable.js');

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
  const updates = +(args.updates || (cliPath() ? 500000 : 20000)), hands = +(args.hands || 40), out = args.out || null, seed = +(args.seed || 4127);
  const study = trainStudy(updates), src = new SS.StudyDecisionSource(study.EM, study.prepared, { studyId: 'preflop8-' + study.updates });
  const runs = [];
  for (const tables of [1, 2, 5, 8, 10]) {
    // Warm the per-path node cache identically for every run so cold-start cost is not charged to one table count.
    const sched = new MT.MultiTableScheduler({ tables, handsPerTable: hands, seed, decisionSource: src, allowFallback: true });
    const r = await sched.run();
    const share = r.actions ? r.solverActions / r.actions : null;
    runs.push({ ...r, solverShare: share, perTable: undefined, perTableSummary: r.perTable.map((t) => ({ table: t.table, status: t.status, hands: t.hands, deadlineMisses: t.deadlineMisses, crashes: t.crashes })) });
    process.stderr.write(tables + ' tables: ' + r.handsCompleted + ' hands, ' + r.actions + ' actions in ' + Math.round(r.wallMs) + ' ms\n');
  }
  const report = {
    format: 'eightmax-multitable-benchmark', version: 1, appVersion: require('../src/engine.js').VERSION, generatedAt: new Date().toISOString(),
    classification: 'SIMULATED TABLES on this machine; single-threaded Node.js; no GPU; not Windows target-hardware results',
    machine: { platform: process.platform, arch: process.arch, node: process.version, cpu: os.cpus()[0] && os.cpus()[0].model, logicalCpus: os.cpus().length, totalMemBytes: os.totalmem() },
    study: { example: 'preflop8 (8 seats, 25 BB, SB 0.5/BB 1/ante 0.1, push/fold)', trainingUpdates: study.updates, trainingBackend: study.backend, convergence: 'unproven', engine: '5.1 build 7d08acc7eb4577ee' },
    handsPerTable: hands, seed, runs,
  };
  if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(report, null, 2)); }
  else process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
main().catch((e) => { console.error(e); process.exit(1); });
