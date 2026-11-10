// EightMax 4.0 (Priority 8): evaluation thread scaling.
// usage: node tools/threads40.js <mwcli-4.0> <peak_rss helper> <out.json>
// Exact: root and deeper nodes of the eight-player push/fold ICM fixture
// (fixed hands: work items = actions) and the three-player river range
// aggregate (work items = actions x first opponent's hands). Sampled: the
// eight-player final table (random ranges) at a fixed sample count. For 1, 2,
// 4, 8 ... workers up to the logical CPU count: wall time, query time, CPU
// utilization ((user+sys)/wall), peak RSS, samples per second, cancellation
// latency (cancel 100 ms after the start) and agreement with the 1-thread
// result (exact: bit-identical required; sampled: identical for a fixed seed
// and completed run, by the block-stream design).
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { spawnSync, execFileSync } = require('node:child_process');
const [cli, peak, out] = process.argv.slice(2);
const src = path.join(__dirname, '..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em40-threads-'));
const logical = os.cpus().length, counts = [...new Set([1, 2, 4, 8, 16, 24, 32, logical].filter(t => t <= logical))].sort((a, b) => a - b);
const studies = { push8: [50, 2], threeSide: [1500, 1], icmFinal: [40, 2] };
for (const [n, [it, th]] of Object.entries(studies)) execFileSync(process.execPath, [path.join(__dirname, 'study40.js'), src, n, it, th, path.join(dir, n), cli], { stdio: 'ignore' });
const cases = [
  ['8-player push/fold ICM, exact, root (2 actions)', 'push8', { path: [], hands: [0], method: 'exact' }],
  ['8-player push/fold ICM, exact, range of hands at [1,1,1] path', 'push8', { path: [1, 1, 1], hands: [0], method: 'exact' }],
  ['3-player river, exact, every hand + range aggregate', 'threeSide', { path: [], hands: [0, 1, 2, 3, 4, 5], range: true, method: 'exact' }],
  ['8-player final table, sampled, 20,000 samples x 2 hands', 'icmFinal', { path: [], hands: [0, 600], method: 'sampled', samples: 20000, seed: 3 }],
];
function call(n, q, env = {}) {
  const f = path.join(dir, 'q.json'); fs.writeFileSync(f, JSON.stringify(q));
  const t0 = process.hrtime.bigint();
  const r = spawnSync(peak, [cli, '--ev', path.join(dir, n, 'spec.json'), path.join(dir, n, 'state'), f], { encoding: 'utf8', maxBuffer: 64 << 20, env: { ...process.env, EM_QUERY_TIMING: '1', ...env } });
  const wall = Number(process.hrtime.bigint() - t0) / 1e9;
  const timing = /\{"queryMs":([0-9.]+)(?:,"cancelLatencyMs":([0-9.]+))?,"status":(\d+)\}/.exec(r.stderr || ''), rss = /peakRssKiB=(\d+)/.exec(r.stderr || ''), cpu = /cpuSeconds=([0-9.]+)/.exec(r.stderr || '');
  return { wall, queryMs: timing ? +timing[1] : null, cancelLatencyMs: timing && timing[2] ? +timing[2] : null, status: timing ? +timing[3] : null, rss: rss ? +rss[1] / 1024 : null, cpu: cpu ? +cpu[1] : null, json: r.status === 0 ? JSON.parse(r.stdout) : null };
}
const report = { generated: new Date().toISOString(), cpu: os.cpus()[0].model, logicalCPUs: logical, counts, rngPolicy: 'sampled: fixed blocks of 256 samples, block b uses deriveSeed(seed, b); blocks are reduced in block order, so a completed run is identical for every thread count. Partial (time-limited) runs depend on which blocks finished.', cases: [] };
for (const [label, n, q] of cases) {
  const rows = []; let ref = null;
  for (const t of counts) {
    const r = call(n, { ...q, threads: t, timeLimitMs: 600000, maxVisits: 2000000000 });
    const c = call(n, { ...q, threads: t, timeLimitMs: 600000, maxVisits: 2000000000 }, { EM_CANCEL_AFTER_MS: '100' });
    const body = r.json && JSON.stringify(r.json.hands);
    if (!ref) ref = body;
    const samples = r.json ? r.json.hands.reduce((a, h) => a + (h.samples || 0), 0) : 0;
    rows.push({ threads: t, wallSeconds: +r.wall.toFixed(4), queryMs: r.queryMs, cpuUtilization: r.cpu != null ? +(r.cpu / r.wall).toFixed(2) : null, peakRssMiB: r.rss && +r.rss.toFixed(1), samplesPerSecond: samples && r.queryMs ? Math.round(samples / (r.queryMs / 1000)) : null,
      identicalToOneThread: body === ref, cancelStatus: c.status, cancelLatencyMs: c.cancelLatencyMs, showdownTables: r.json && r.json.execution.showdownTables, peakEvaluationMiB: r.json && r.json.execution.peakEvaluationMiB });
    console.log(label, t, JSON.stringify(rows[rows.length - 1]));
  }
  const one = rows[0].queryMs; rows.forEach(r => { r.speedup = one && r.queryMs ? +(one / r.queryMs).toFixed(2) : null; });
  report.cases.push({ label, request: q, rows });
}
fs.writeFileSync(out, JSON.stringify(report, null, 1));
fs.rmSync(dir, { recursive: true, force: true });
