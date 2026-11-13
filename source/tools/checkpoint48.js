// EightMax 4.8 (Priority 11): EMZ1 compression LEVEL study on realistic states, and raw vs
// compressed save / restore / resume. For each study and each deflate level (1, 3, 6, 9):
// compressed size, compress time, decompress time, restore time from the EMZ1 file, peak RSS of
// each step (median of --rounds), byte-exact round trip, and a resumed segment from the EMZ1 file
// equal to the uninterrupted state. Raw EMMW4 save (training writes it) and raw restore are the
// reference. The default level is chosen from these numbers (see RELEASE-4.8.md).
// usage: node tools/checkpoint48.js <mwcli> <out.json> [--rounds=5]
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), { execFileSync } = require('node:child_process');
const G = require('./games48');
const args = process.argv.slice(2), [cli, out] = args.filter(a => !a.startsWith('--'));
const rounds = +((args.find(a => a.startsWith('--rounds=')) || '--rounds=5').slice(9));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em48-ckpt-'));
const studies = [
  ['eight-player linked study, random ranges, ICM (4.5 fixture), 3,000 updates', path.join(__dirname, '..', '..', 'validation', '4.5', 'fixtures', 'icm-final8.spec.json'), 3000],
  ['six-player flop, weighted three-hand ranges, two bet sizes, 50,000 updates', 'flop6w', 50000],
  ['four-player turn and river, 50,000 updates', 'turn4', 50000],
];
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const timed = a => { const t0 = process.hrtime.bigint(); const o = execFileSync(cli, a.map(String), { encoding: 'utf8', maxBuffer: 1 << 26 }); return { s: Number(process.hrtime.bigint() - t0) / 1e9, j: JSON.parse(o.trim().split('\n').pop()) }; };
const med = v => { const s = v.slice().sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const report = { tool: 'checkpoint48', generated: new Date().toISOString(), cpu: os.cpus()[0].model, rounds, studies: [] };
for (const [name, cfg, updates] of studies) {
  const spec = cfg.endsWith('.json') ? cfg : path.join(dir, cfg + '.json'); if (!cfg.endsWith('.json')) fs.writeFileSync(spec, JSON.stringify(G.spec(cfg, 21)));
  const st = path.join(dir, 'a.state'); const tr = timed([spec, updates, 4, st, 2048]);
  const ref = path.join(dir, 'ref.state'); timed([spec, updates + 100, 4, ref, 2048]);
  const rawR = []; let rr; for (let i = 0; i < rounds; i++) { rr = timed(['--restore', spec, st, 2048]); rawR.push(rr.s); }
  const fromRaw = path.join(dir, 'fr.state'); timed([spec, 100, 4, fromRaw, 2048, st]);
  const row = { study: name, updates, rawBytes: fs.statSync(st).size, trainingSaveIncludedSeconds: tr.s, restoreSecondsRaw: med(rawR), restorePeakRssMiBRaw: rr.j.processPeakRssMiB, resumedFromRawEqualsUninterrupted: sha(fromRaw) === sha(ref), levels: [] };
  for (const level of [1, 3, 6, 9]) {
    const z = path.join(dir, 'a' + level + '.emz'), back = path.join(dir, 'b.state'); const comp = [], dec = [], rz = []; let c, d, r;
    for (let i = 0; i < rounds; i++) { c = timed(['--compress', st, z, level]); comp.push(c.s); d = timed(['--decompress', z, back]); dec.push(d.s); r = timed(['--restore', spec, z, 2048]); rz.push(r.s); }
    const resumed = path.join(dir, 'rz.state'); timed([spec, 100, 4, resumed, 2048, z]);
    const L = { level, compressedBytes: fs.statSync(z).size, ratio: fs.statSync(z).size / row.rawBytes, compressSeconds: med(comp), decompressSeconds: med(dec), restoreSecondsCompressed: med(rz), compressPeakRssMiB: c.j.processPeakRssMiB, decompressPeakRssMiB: d.j.processPeakRssMiB, restorePeakRssMiBCompressed: r.j.processPeakRssMiB, byteExactRoundTrip: sha(back) === sha(st), resumedEqualsUninterrupted: sha(resumed) === sha(ref) };
    row.levels.push(L);
    console.log(name.slice(0, 40).padEnd(40), 'level', level, (row.rawBytes / 1048576).toFixed(2), '->', (L.compressedBytes / 1048576).toFixed(2), 'MiB', L.ratio.toFixed(3), 'compress', L.compressSeconds.toFixed(3), 's restore raw/emz', row.restoreSecondsRaw.toFixed(3) + '/' + L.restoreSecondsCompressed.toFixed(3), 's exact', L.byteExactRoundTrip, 'resume', L.resumedEqualsUninterrupted);
  }
  report.studies.push(row);
}
fs.writeFileSync(out, JSON.stringify(report, null, 1));
fs.rmSync(dir, { recursive: true, force: true });
if (report.studies.some(s => !s.resumedFromRawEqualsUninterrupted || s.levels.some(l => !l.byteExactRoundTrip || !l.resumedEqualsUninterrupted))) { console.error('FAIL: a round trip or resume differed'); process.exit(1); }
