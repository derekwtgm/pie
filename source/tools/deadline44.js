// EightMax 4.4: interleaved sampled-EV deadline measurements of one or more builds.
// usage: node tools/deadline44.js out.json <dir with spec.json and state> reps "100,250,600,1000" "1,2,4,8,16,24" label=mwcli [label=mwcli ...]
// For every repetition, limit and thread count each build runs once, in rotating order. Records the
// response time, the overrun past the limit, the status, deadline.phasesMs and the overrun distribution
// (minimum, median, 90th percentile, maximum). DL_QUERY overrides the request (default: the 4.3 audit's
// eight-handed request: one hand, then the range, sampled).
const fs = require('fs'), path = require('path'), cp = require('child_process');
const [out, dir, reps, limits, threads, ...builds] = process.argv.slice(2);
const B = builds.map(b => { const i = b.indexOf('='); return { label: b.slice(0, i), cli: b.slice(i + 1) }; });
const q0 = JSON.parse(process.env.DL_QUERY || '{"path":[],"hands":[3],"range":true,"method":"sampled","samples":2000000}');
const rows = [];
for (let r = 0; r < +reps; r++) for (const ms of limits.split(',').map(Number)) for (const t of threads.split(',').map(Number))
  for (let k = 0; k < B.length; k++) {
    const b = B[(k + r) % B.length], f = path.join(dir, 'dlq.json');
    fs.writeFileSync(f, JSON.stringify({ ...q0, timeLimitMs: ms, threads: t, seed: 1 + r }));
    const p = cp.spawnSync(b.cli, ['--ev', path.join(dir, 'spec.json'), path.join(dir, 'state'), f], { encoding: 'utf8', maxBuffer: 64 << 20, env: { ...process.env, EM_QUERY_TIMING: '1' } });
    let timing = null, j = null; try { timing = JSON.parse(p.stderr.trim().split('\n')[0]); } catch { } try { j = JSON.parse(p.stdout); } catch { }
    rows.push({ build: b.label, limitMs: ms, threads: t, rep: r, queryMs: timing && timing.queryMs, overrunMs: timing && +(timing.queryMs - ms).toFixed(3), httpStatus: timing && timing.status, status: j && j.status,
      samples: j && (j.range ? j.range.samples : j.hands[0] && j.hands[0].samples), maxCheckGapMs: j && j.deadline && j.deadline.maxCheckGapMs, checks: j && j.deadline && j.deadline.checks, phases: j && j.deadline && j.deadline.phasesMs });
  }
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const summary = [];
for (const b of B) for (const ms of limits.split(',').map(Number)) for (const t of threads.split(',').map(Number)) {
  const o = rows.filter(x => x.build === b.label && x.limitMs === ms && x.threads === t).map(x => x.overrunMs);
  summary.push({ build: b.label, limitMs: ms, threads: t, n: o.length, minOverrunMs: Math.min(...o), medianOverrunMs: q(o, 0.5), p90OverrunMs: q(o, 0.9), maxOverrunMs: Math.max(...o) });
}
fs.writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), cpus: require('os').cpus().length, cpu: require('os').cpus()[0].model, query: q0, reps: +reps, summary, rows }, null, 1));
for (const s of summary) console.log(s.build.padEnd(8), String(s.limitMs).padStart(5), 'ms', String(s.threads).padStart(2), 'thr  overrun min/med/p90/max', s.minOverrunMs.toFixed(1), s.medianOverrunMs.toFixed(1), s.p90OverrunMs.toFixed(1), s.maxOverrunMs.toFixed(1));
