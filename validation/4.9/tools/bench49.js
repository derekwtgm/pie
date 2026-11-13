// EightMax 4.9 (Priority 17): matched 4.8 vs 4.9 benchmarks of the paths 4.9 touched or must not
// have changed. Arms run interleaved (order rotated per round); every arm must produce the same
// strategy SHA-256 for the same job. Reports median and min wall time per arm, the paired ratio of
// the second arm to the first with a t interval of the log ratio, and peak RSS (tools/peak_rss).
//   workloads: short CPU training (2,400 deals, final table, CPU Only and Automatic),
//              default training of the six-player flop and the eight-player linked ICM study,
//              EMZ1 restore + 150-update resume of the 14 MiB eight-player state.
// usage: node validation/4.9/tools/bench49.js <out.json> --arm=name:mwcli ... [--rounds=7]
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
const G = require('../../../source/tools/games48');
const args = process.argv.slice(2), out = args.find(a => !a.startsWith('--'));
const arms = args.filter(a => a.startsWith('--arm=')).map(a => { const [name, exe] = a.slice(6).split(':'); return { name, exe: path.resolve(exe) }; });
const rounds = +((args.find(a => a.startsWith('--rounds=')) || '--rounds=7').slice(9));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench49-')), peak = path.join(__dirname, '..', '..', '..', 'source', 'build', 'peak_rss');
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const spec8 = path.join(__dirname, '..', '..', '4.5', 'fixtures', 'icm-final8.spec.json');
const write = (n, o) => { const f = path.join(dir, n); fs.writeFileSync(f, JSON.stringify(o)); return f; };
const fin = d => { const s = G.spec('final8', 3, { batchDeals: 16 }); s.device = d; return write('final8-' + d + '.json', s); };
const flop6 = write('flop6.json', G.spec('flop6', 7));
// shared input checkpoint for the restore workload, written by the first arm
const base = path.join(dir, 'base.state'), baseZ = path.join(dir, 'base.emz');
spawnSync(arms[0].exe, [spec8, '1500', '4', base, '2048']); spawnSync(arms[0].exe, ['--compress', base, baseZ]);
const workloads = [
  ['short training, CPU Only (final table, 150 updates x 16 deals = 2,400 deals)', o => [fin('cpu'), '150', '2', o, '512']],
  ['short training, Automatic (same job; no GPU on this machine)', o => [fin('auto'), '150', '2', o, '512']],
  ['six-player flop training, 100,000 updates, 1 thread', o => [flop6, '100000', '1', o, '512']],
  ['eight-player linked ICM study training, 1,500 updates, 4 threads', o => [spec8, '1500', '4', o, '2048']],
  ['EMZ1 restore + 150 updates (14 MiB state compressed)', o => [spec8, '150', '4', o, '2048', baseZ]],
];
const tq = { 2: 12.706, 3: 4.303, 4: 3.182, 5: 2.776, 6: 2.571, 7: 2.447, 8: 2.365, 9: 2.306, 10: 2.262 };
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const report = { tool: 'bench49', generated: new Date().toISOString(), cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, rounds, arms, workloads: [] };
for (const [name, argv] of workloads) {
  const rows = arms.map(() => []), hashes = new Set(); let route = arms.map(() => '');
  for (let r = 0; r < rounds; r++) for (let j = 0; j < arms.length; j++) {
    const i = (j + r) % arms.length, o = path.join(dir, 'o' + i + '.state'); try { fs.unlinkSync(o); } catch {}
    const t0 = process.hrtime.bigint(), x = spawnSync(peak, [arms[i].exe, ...argv(o)], { encoding: 'utf8', maxBuffer: 1 << 28 }), sec = Number(process.hrtime.bigint() - t0) / 1e9;
    if (x.status !== 0) throw new Error(arms[i].name + ' ' + name + ': ' + x.stderr);
    const info = JSON.parse(x.stdout.trim().split('\n').pop()), m = /peakRssKiB=(\d+)/.exec(x.stderr);
    rows[i].push({ sec, trainingSeconds: info.wallSeconds, peakMiB: m ? +m[1] / 1024 : null }); hashes.add(sha(o)); route[i] = info.devicePath;
  }
  const w = { workload: name, identicalStrategy: hashes.size === 1, strategySha256: [...hashes][0], arms: [] };
  for (let i = 0; i < arms.length; i++) {
    const s = rows[i].map(x => x.sec), tr = rows[i].map(x => x.trainingSeconds), a = { name: arms[i].name, medianSec: med(s), minSec: Math.min(...s), medianTrainingSec: med(tr), peakRssMiB: Math.max(...rows[i].map(x => x.peakMiB || 0)), devicePath: route[i], seconds: s };
    if (i) { const lr = s.map((v, k) => Math.log(v / rows[0][k].sec)), mu = lr.reduce((p, q) => p + q, 0) / lr.length, sd = Math.sqrt(lr.reduce((p, q) => p + (q - mu) ** 2, 0) / Math.max(1, lr.length - 1)), h = (tq[lr.length] || 1.96) * sd / Math.sqrt(lr.length);
      a.ratioToFirst = Math.exp(mu); a.ratio95 = [Math.exp(mu - h), Math.exp(mu + h)]; a.verdict = Math.exp(mu + h) < 1 ? 'faster' : Math.exp(mu - h) > 1 ? 'slower' : 'no supported difference'; }
    w.arms.push(a);
  }
  report.workloads.push(w);
  console.log(name.slice(0, 60).padEnd(60), w.identicalStrategy ? 'IDENTICAL' : 'DIFFERENT', w.arms.map(a => a.name + ' ' + a.medianSec.toFixed(3) + 's ' + a.peakRssMiB.toFixed(1) + 'MiB' + (a.ratioToFirst ? ' x' + a.ratioToFirst.toFixed(3) + ' [' + a.ratio95.map(v => v.toFixed(3)).join(', ') + '] ' + a.verdict : '')).join(' | '));
}
fs.writeFileSync(out, JSON.stringify(report, null, 1)); fs.rmSync(dir, { recursive: true, force: true });
if (report.workloads.some(w => !w.identicalStrategy)) process.exit(1);
