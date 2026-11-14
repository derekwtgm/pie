// EightMax 4.8 (Priority 4): matched-workload benchmark of multiway response evaluation.
// For every game (tools/games48.js) a checkpoint is trained once; then each arm evaluates the
// SAME checkpoint with the SAME request, interleaved over rounds (arm order rotates per round).
// Every arm must print bit-identical results (gainBits of every seat for exact/restricted;
// the whole seats array for sampled, which uses fixed seeds); a mismatch fails the run.
//
//   node tools/brbench48.js <out.json> --arm=name:path[:ENV=1,ENV2=1] ... [--games=a,b]
//        [--rounds=5] [--method=exact|restricted|sampled] [--updates=20000] [--threads=4]
//
// Reports per game and arm: median and min wall time, time ratio to the first arm with a
// bootstrap-free paired 95% interval of the log ratio (t over rounds), peak RSS (from mwcli's
// processPeakRssMiB is not printed by --gain, so /proc is sampled through tools/peak_rss when
// available, otherwise null), and the exact-equality verdict.
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { spawnSync } = require('node:child_process');
const G = require('./games48');
const args = process.argv.slice(2), out = args.find(a => !a.startsWith('--'));
const opt = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const arms = args.filter(a => a.startsWith('--arm=')).map(a => { const [name, exe, env] = a.slice(6).split(':'); return { name, exe: path.resolve(exe), env: Object.fromEntries((env || '').split(',').filter(Boolean).map(kv => kv.split('='))) }; });
if (!out || arms.length < 1) { console.error('usage: node tools/brbench48.js out.json --arm=name:mwcli[:ENV=1] ...'); process.exit(2); }
const rounds = +opt('rounds', 5), method = opt('method', 'exact'), updates = opt('updates', '20000'), threads = opt('threads', '4');
const keys = (opt('games') || 'hu-river,river3-chip,turn4,bubble4,flop5,flop6').split(',');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brbench48-'));
const peakTool = path.join(__dirname, '..', 'build', 'peak_rss');
function runArm(arm, argv) {
  const env = { ...process.env, ...arm.env };
  const t0 = process.hrtime.bigint();
  const r = fs.existsSync(peakTool) ? spawnSync(peakTool, [arm.exe, ...argv], { encoding: 'utf8', env, maxBuffer: 1 << 30 }) : spawnSync(arm.exe, argv, { encoding: 'utf8', env, maxBuffer: 1 << 30 });
  const sec = Number(process.hrtime.bigint() - t0) / 1e9;
  if (r.status !== 0) throw new Error(arm.name + ' exit ' + r.status + ': ' + (r.stderr || '').slice(0, 400));
  const m = /peakRssKiB=(\d+)/.exec(r.stderr || ''); return { sec, out: r.stdout, peakMiB: m ? +m[1] / 1024 : null };
}
const report = { tool: 'brbench48', generated: new Date().toISOString(), cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, method, rounds, threads: +threads, arms: arms.map(a => ({ name: a.name, exe: a.exe, env: a.env })), games: [] };
for (const key of keys) {
  const spec = path.join(dir, key + '.json'), st = path.join(dir, key + '.state'), q = path.join(dir, key + '.q.json');
  fs.writeFileSync(spec, JSON.stringify(G.spec(key, 1)));
  const tr = spawnSync(arms[0].exe, [spec, updates, '2', st, '512'], { encoding: 'utf8' }); if (tr.status) throw new Error('training failed: ' + tr.stderr);
  const req = method === 'exact' ? { method, threads: +threads, timeLimitMs: 3600000, maxVisits: 2000000000 } : method === 'restricted' ? { method, threads: +threads, timeLimitMs: 3600000, maxVisits: 2000000000 } : { method, threads: +threads, samples: 20000, seed: 11, timeLimitMs: 3600000 };
  fs.writeFileSync(q, JSON.stringify(req));
  const rows = arms.map(() => []); let ref = null, identical = true, mismatch = null;
  for (let r = 0; r < rounds; r++) for (let j = 0; j < arms.length; j++) {
    const i = (j + r) % arms.length, x = runArm(arms[i], ['--gain', spec, st, q]);
    const d = JSON.parse(x.out), sig = JSON.stringify(method === 'sampled' ? d.seats.map(s => [s.gain, s.policyValue, s.bestResponseValue]) : d.seats.map(s => s.gainBits));
    if (ref === null) ref = sig; else if (sig !== ref) { identical = false; mismatch = { arm: arms[i].name, round: r }; }
    rows[i].push({ sec: x.sec, peakMiB: x.peakMiB, nashConv: d.nashConv });
  }
  const med = a => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
  const tq = { 2: 12.706, 3: 4.303, 4: 3.182, 5: 2.776, 6: 2.571, 7: 2.447, 8: 2.365, 9: 2.306, 10: 2.262 };
  const g = { key, description: G.byKey[key][1], identical, mismatch, nashConv: rows[0][0].nashConv, arms: [] };
  for (let i = 0; i < arms.length; i++) {
    const secs = rows[i].map(r => r.sec), peaks = rows[i].map(r => r.peakMiB).filter(v => v != null);
    const a = { name: arms[i].name, medianSec: med(secs), minSec: Math.min(...secs), seconds: secs, peakRssMiB: peaks.length ? Math.max(...peaks) : null };
    if (i > 0) {
      const lr = secs.map((s, k) => Math.log(s / rows[0][k].sec)), m = lr.reduce((x, y) => x + y, 0) / lr.length;
      const sd = Math.sqrt(lr.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, lr.length - 1)), h = (tq[lr.length] || 1.96) * sd / Math.sqrt(lr.length);
      a.timeRatioToFirst = Math.exp(m); a.ratio95 = [Math.exp(m - h), Math.exp(m + h)]; a.supported = Math.exp(m + h) < 1 ? 'faster' : Math.exp(m - h) > 1 ? 'slower' : 'no supported difference';
    }
    g.arms.push(a);
  }
  report.games.push(g);
  console.log(key.padEnd(12), identical ? 'IDENTICAL' : 'MISMATCH ' + JSON.stringify(mismatch), g.arms.map(a => a.name + ' ' + a.medianSec.toFixed(3) + 's' + (a.timeRatioToFirst ? ' x' + a.timeRatioToFirst.toFixed(3) + ' [' + a.ratio95.map(v => v.toFixed(3)).join(', ') + '] ' + a.supported : '') + (a.peakRssMiB != null ? ' ' + a.peakRssMiB.toFixed(1) + 'MiB' : '')).join(' | '));
}
fs.writeFileSync(out, JSON.stringify(report, null, 1));
fs.rmSync(dir, { recursive: true, force: true });
if (report.games.some(g => !g.identical)) { console.error('FAIL: an arm changed a result'); process.exit(1); }
