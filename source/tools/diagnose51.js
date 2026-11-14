// EightMax 5.1 (Requirement 1 diagnosis): why does parallel64 train faster without a matching quality gain?
// For each game and arm, trains a fixed number of deals (median of --repeats interleaved runs) and records
// microseconds per deal, committed (visible) updates, deals per update, worker threads actually used, the
// engine's phase seconds (deal / traverse / merge) and the state-body SHA-256, so thread count can be
// separated from batching (parallel64 on 1 and 4 threads must give the same bytes).
// usage: node tools/diagnose51.js <mwcli> <out.json> [--deals=64000] [--repeats=5] [--games=flop6w,flop6,river3-chip,turn4] [--seed=601]
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), { execFileSync } = require('node:child_process');
const G = require('./games48');
const args = process.argv.slice(2), [cliArg, out] = args.filter(a => !a.startsWith('--')), opt = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const cli = path.resolve(cliArg), deals = +opt('deals', 64000), repeats = +opt('repeats', 5), games = opt('games', 'flop6w,flop6,river3-chip,turn4').split(','), seed = +opt('seed', 601);
const arms = [['default 1 thread', {}, 1], ['default 4 threads', {}, 4], ['parallel64 1 thread', { batchDeals: 64, actionStreams: 'deal' }, 1], ['parallel64 4 threads', { batchDeals: 64, actionStreams: 'deal' }, 4], ['warm-4-256 4 threads', { batchDeals: 64, actionStreams: 'deal', batchSchedule: { start: 4, doubleEvery: 256 } }, 4]];
const dealsBefore = (o, t) => { const B = o.batchDeals || 1; if (!o.batchSchedule) return t * B; let d = 0, b = o.batchSchedule.start, done = 0; while (done < t) { const cur = Math.min(b, B), span = b >= B ? t - done : Math.min(t - done, o.batchSchedule.doubleEvery); d += span * cur; done += span; b *= 2; } return d; };
const updatesFor = o => { let t = 0; while (dealsBefore(o, t) < deals) t++; return t; };
const body = f => { const b = fs.readFileSync(f), hl = b.readUInt32LE(8); return crypto.createHash('sha256').update(b.subarray(12 + hl)).digest('hex'); };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diag51-')), med = v => { const s = v.slice().sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const report = { tool: 'diagnose51', generated: new Date().toISOString(), build: execFileSync(cli, ['--build-id'], { encoding: 'utf8' }).trim(), cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, deals, repeats, seed, games: {} };
for (const key of games) {
  const res = {};
  for (let r = 0; r < repeats; r++) for (let i = 0; i < arms.length; i++) {
    const [name, o, threads] = arms[(i + r) % arms.length], { batchSchedule, ...so } = o, sp = G.spec(key, seed, so); if (batchSchedule) sp.batchSchedule = batchSchedule;
    const spec = path.join(dir, 'spec.json'), st = path.join(dir, 'state'), u = updatesFor(sp); fs.writeFileSync(spec, JSON.stringify(sp));
    const info = JSON.parse(execFileSync(cli, [spec, u, threads, st, 512].map(String), { encoding: 'utf8', maxBuffer: 256 << 20 }));
    (res[name] ||= []).push({ wall: info.wallSeconds, updates: info.iterations, deals: info.trainingDeals, threads: info.threads, seconds: info.seconds, sha: body(st) });
  }
  report.games[key] = Object.fromEntries(Object.entries(res).map(([name, rs]) => [name, { trainingDeals: rs[0].deals, committedUpdates: rs[0].updates, dealsPerCommittedUpdate: rs[0].deals / rs[0].updates, threadsUsed: rs[0].threads, medianSeconds: med(rs.map(x => x.wall)), microsecondsPerDeal: med(rs.map(x => x.wall)) / rs[0].deals * 1e6, phaseSecondsMedian: Object.fromEntries(Object.keys(rs[0].seconds || {}).map(k => [k, med(rs.map(x => x.seconds[k]))])), stateBodySha256: rs[0].sha, sameStateEveryRepeat: rs.every(x => x.sha === rs[0].sha) }]));
  const g = report.games[key]; g.parallel64SameStateOn1And4Threads = g['parallel64 1 thread'].stateBodySha256 === g['parallel64 4 threads'].stateBodySha256;
  for (const [n, v] of Object.entries(g)) if (typeof v === 'object') console.log(key.padEnd(12), n.padEnd(22), v.microsecondsPerDeal.toFixed(2) + ' us/deal', 'updates', v.committedUpdates, 'threads', v.threadsUsed, JSON.stringify(v.phaseSecondsMedian));
  console.log(key.padEnd(12), 'parallel64 same state on 1 and 4 threads:', g.parallel64SameStateOn1And4Threads);
}
fs.writeFileSync(out, JSON.stringify(report, null, 1)); fs.rmSync(dir, { recursive: true, force: true });
