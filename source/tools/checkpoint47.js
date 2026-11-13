// EightMax 4.7 (Priority 11): EMZ1 compressed checkpoints on realistic states. For each study:
// raw and compressed size, compress/decompress time and peak RSS, restore time and peak RSS
// from the raw and from the compressed file (median of 3), byte-exact round trip, and a resumed
// segment from each equal to the uninterrupted state.
// usage: node tools/checkpoint47.js <mwcli> <out.json>
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), { execFileSync } = require('node:child_process');
const E = require('./loadlib'); for (const l of ['lib_runouts', 'lib_wide', 'lib_river']) require('../web/' + l);
const [cli, out] = process.argv.slice(2), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em47-ckpt-'));
const base = { privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128, privateSeed: 21 };
const studies = [
  ['eight-player linked study, random ranges, ICM (4.5 fixture)', path.join(__dirname, '..', '..', 'validation', '4.5', 'fixtures', 'icm-final8.spec.json'), 3000],
  ['six-player flop, chip EV', { board: 'Td7c2h', dealt: 8, common: 1.5, stacks: [20, 35, 8, 50, 14, 3], prior: Array(6).fill(2.5), folded: [1, 2.5], ranges: ['AhTh,7s7d,KcKs', 'KdTs,9c8c,QcJc', 'QsQd,Ac7h,9s9d', 'JhTc,6s5s,AsKs', 'AdKc,2s2d,5c5d', '8h8d,As2c,Jc9c'], streets: { flop: { bets: '50,a', raises: 'a', maxBets: 2 }, turn: { bets: 'a', raises: '', maxBets: 1 } } }, 40000],
  ['heads-up turn and river, two sizes, DCFR', { board: 'Ks8d5h2c', common: 8, stacks: [30, 30], weighting: 'dcfr', ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc,9h9c,AsJs', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd,6h6d,Qc9c'], streets: { turn: { bets: '50,a', raises: 'a', maxBets: 2 }, river: { bets: '50,a', raises: 'a', maxBets: 2 } } }, 40000],
  ['heads-up river, Compact hand groups', { board: 'Ks8d5h2c2s', common: 10, stacks: [20, 20], abstraction: 'compact', ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd'], streets: { river: { bets: '50,a', raises: 'a', maxBets: 2 } } }, 20000],
];
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const timed = a => { const t0 = process.hrtime.bigint(); const o = execFileSync(cli, a.map(String), { encoding: 'utf8', maxBuffer: 1 << 26 }); return { s: Number(process.hrtime.bigint() - t0) / 1e9, j: JSON.parse(o.trim().split('\n').pop()) }; };
const med = v => v.slice().sort((a, b) => a - b)[v.length >> 1];
const report = { tool: 'checkpoint47', generated: new Date().toISOString(), cpu: os.cpus()[0].model, studies: [] };
for (const [name, cfg, updates] of studies) {
  const spec = typeof cfg === 'string' ? cfg : path.join(dir, 's.json'); if (typeof cfg !== 'string') fs.writeFileSync(spec, JSON.stringify(E.MultiwayGame({ ...base, ...cfg }).nativeSpec()));
  const st = path.join(dir, 'a.state'), z = path.join(dir, 'a.emz'), back = path.join(dir, 'b.state');
  timed([spec, updates, 4, st, 2048]);
  const comp = [], dec = [], rRaw = [], rZ = []; let c, d, rr, rz;
  for (let i = 0; i < 3; i++) { c = timed(['--compress', st, z]); comp.push(c.s); d = timed(['--decompress', z, back]); dec.push(d.s); rr = timed(['--restore', spec, st, 2048]); rRaw.push(rr.s); rz = timed(['--restore', spec, z, 2048]); rZ.push(rz.s); }
  const exact = sha(back) === sha(st);
  const r1 = path.join(dir, 'r1'), r2 = path.join(dir, 'r2'), r3 = path.join(dir, 'r3');
  timed([spec, 100, 4, r1, 2048, st]); timed([spec, 100, 4, r2, 2048, z]); timed([spec, updates + 100, 4, r3, 2048]);
  const row = { study: name, updates, rawBytes: fs.statSync(st).size, compressedBytes: fs.statSync(z).size, ratio: fs.statSync(z).size / fs.statSync(st).size, rowBlocksPlain: c.j.rowBlocksPlain, rowBlocksShuffled: c.j.rowBlocksShuffled,
    compressSeconds: med(comp), decompressSeconds: med(dec), compressPeakRssMiB: c.j.processPeakRssMiB, decompressPeakRssMiB: d.j.processPeakRssMiB,
    restoreSecondsRaw: med(rRaw), restoreSecondsCompressed: med(rZ), restorePeakRssMiBRaw: rr.j.processPeakRssMiB, restorePeakRssMiBCompressed: rz.j.processPeakRssMiB,
    byteExactRoundTrip: exact, resumedFromRawEqualsUninterrupted: sha(r1) === sha(r3), resumedFromCompressedEqualsUninterrupted: sha(r2) === sha(r3) };
  report.studies.push(row);
  console.log(name.padEnd(58), (row.rawBytes / 1048576).toFixed(2), 'MiB ->', (row.compressedBytes / 1048576).toFixed(2), 'MiB (', row.ratio.toFixed(3), ') restore raw', row.restoreSecondsRaw.toFixed(3), 's / emz', row.restoreSecondsCompressed.toFixed(3), 's', exact && row.resumedFromCompressedEqualsUninterrupted ? 'exact' : 'MISMATCH');
}
fs.writeFileSync(out, JSON.stringify(report, null, 1));
fs.rmSync(dir, { recursive: true, force: true });
