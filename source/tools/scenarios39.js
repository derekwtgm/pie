// EightMax 3.9: ten-scenario comparison of the 3.8 and 3.9 native engines.
// usage: node tools/scenarios39.js <mwcli-3.8> <mwcli-3.9> <out.json> [--quick]
// Each scenario uses one identical spec (JavaScript nativeSpec, default linear
// external-sampling MCCFR, documented abstraction below) for both engines and
// three seeds (privateSeed 1..3). Runs are paired and alternate between the two
// binaries. Recorded per run: wall time of training (mwcli wallSeconds), peak
// process RSS, sampled deals, state visits and the SHA-256 of the exported
// state body. Strategy quality is measured on the 3.9-trained state with the
// 3.9 evaluator (identical states give identical quality for 3.8):
//   exact      - exact best-response gains per seat (and exploitability for
//                two seats, chip EV) inside the card/betting abstraction;
//   sampled    - per-seat one-shot response gains at each seat's first
//                decision, with standard errors. Not exploitability.
// VRAM: external-sampling training runs on the CPU (no device scoring here),
// so peak VRAM is 0 in both versions; physical GPU timing is not measured.
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), { execFileSync } = require('node:child_process');
const E = require('./loadlib'); for (const l of ['lib_runouts', 'lib_wide', 'lib_river']) require('../web/' + l);
const [cli38, cli39, out] = process.argv.slice(2), quick = process.argv.includes('--quick');
const r6 = '22+,A2s+,K9s+,QTs+,JTs,ATo+,KJo+:0.6';
const base = { privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128 };
// [name, config, updates, quality kind, abstraction note]
const scenarios = [
  ['Heads-up river', { board: 'Qs9h4d2c7s', common: 10, stacks: [40, 40], ranges: ['AsQd,KhQh,9s9c,JhTh,8d7d,AhKd,Ts8s,AcAd,5h5d', 'QcJc,TdTc,As4s,KdJd,6s5s,9d8d,7c7d,AhJh,Kc2s'], streets: { river: { bets: '50,a', raises: '2.5x', maxBets: 2 } } }, 20000, 'exact', 'exact cards; river bets 50% pot / all-in, raise 2.5x, cap 2'],
  ['Heads-up turn', { board: 'Qs9h4d2c', common: 10, stacks: [40, 40], ranges: ['AsQd,KhQh,9s9c,JhTh,8d7d,AhKd', 'QcJc,TdTc,As4s,KdJd,6s5s,9d8d'], streets: { turn: { bets: '60', raises: '', maxBets: 1 }, river: { bets: '75,a', raises: '', maxBets: 1 } } }, 20000, 'exact', 'exact cards; turn bet 60%, river 75% / all-in, cap 1'],
  ['Three-player river', { board: 'Ks8d5h2c2s', common: 12, stacks: [30, 30, 30], ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc,QhJh,9c9d', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd,6h6d,4c3c', 'Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc,6s5s,AdJd'], streets: { river: { bets: '50,125', raises: '2.5x', maxBets: 2 } } }, 20000, 'exact', 'exact cards; 50%/125% bets, 2.5x raise, cap 2'],
  ['Four-player flop', { board: 'Ks8d5h', dealt: 8, common: 1.5, stacks: Array(4).fill(60), prior: Array(4).fill(2.5), ranges: Array(4).fill('random'), streets: { flop: { bets: '33,75,a', raises: '3x,a', maxBets: 3 }, turn: { bets: '50,100', raises: 'a', maxBets: 2 }, river: { bets: '75,150,a', raises: 'a', maxBets: 2 } }, batchDeals: 16, actionStreams: 'deal' }, 150, 'sampled', 'exact cards, random ranges; 3 flop sizes'],
  ['Six-player flop', { board: 'Td7c2h', dealt: 8, common: 1.5, stacks: [40, 35, 30, 50, 45, 26], prior: Array(6).fill(2.5), ranges: Array(6).fill(r6), streets: { flop: { bets: '33,75', raises: '3x', maxBets: 2 }, turn: { bets: '66', raises: 'a', maxBets: 2 }, river: { bets: '75,a', raises: '', maxBets: 1 } }, batchDeals: 16, actionStreams: 'deal' }, 300, 'sampled', 'exact cards, 60% weighted ranges'],
  ['Eight-player preflop shove/call', { preflop: { mode: 'shove' }, dealt: 8, common: 0, board: '', stacks: [10, 6, 14, 3, 9, 12, 7.5, 11], ranges: Array(8).fill('random'), batchDeals: 16, actionStreams: 'deal' }, 2000, 'sampled', 'exact hole cards; shove or fold, call or fold'],
  ['Eight-player linked preflop to river', { preflop: { mode: 'linked', opens: '2,a', raises: '2.75x,a', maxBets: 3 }, board: '', dealt: 8, common: 0, stacks: [24.9, 18, 40, 12, 30, 9, 55, 20], ranges: Array(8).fill('random'), streets: { flop: { bets: '33,75', raises: '3x', maxBets: 2 }, turn: { bets: '66', raises: 'a', maxBets: 2 }, river: { bets: '75,a', raises: '', maxBets: 1 } }, batchDeals: 16, actionStreams: 'deal' }, 300, 'sampled', 'exact cards; opens 2bb/all-in, raises 2.75x/all-in'],
  ['Short-stack multiway all-ins (6-seat flop)', { board: 'Td7c2h', dealt: 8, common: 1.5, stacks: [20, 35, 8, 50, 14, 3], prior: Array(6).fill(2.5), folded: [1, 2.5], ranges: Array(6).fill(r6), streets: { flop: { bets: '33,a', raises: '3x,a', maxBets: 3 }, turn: { bets: '50,g', raises: 'a', maxBets: 2 }, river: { bets: '75,150', raises: 'a', maxBets: 2 } }, batchDeals: 4, actionStreams: 'deal' }, 500, 'sampled', 'exact cards; side pots from 3/8/14 BB stacks'],
  ['Tournament bubble ICM (4 left, 3 paid)', { preflop: { mode: 'shove' }, dealt: 4, common: 0, board: '', stacks: [12, 7, 20, 4], ranges: Array(4).fill('random'), icm: { payouts: [50, 30, 20] }, batchDeals: 16, actionStreams: 'deal' }, 3000, 'sampled', 'shove/call, ICM 50/30/20'],
  ['Eight-player final-table ICM', { preflop: { mode: 'linked', opens: '2.2,a', raises: 'a', maxBets: 2 }, board: '', dealt: 8, common: 0, stacks: [30, 22, 15, 40, 9, 18, 25, 12], ranges: Array(8).fill('random'), icm: { payouts: [30, 20, 14, 11, 9, 7, 5, 4] }, streets: { flop: { bets: '50', raises: '', maxBets: 1 }, turn: { bets: 'a', raises: '', maxBets: 1 }, river: { bets: 'a', raises: '', maxBets: 1 } }, batchDeals: 16, actionStreams: 'deal' }, 200, 'sampled', 'linked preflop to river, ICM 8 places'],
];
const seeds = [1, 2, 3], threads = Math.min(4, os.cpus().length);
const tq = { 2: 12.706, 3: 4.303, 4: 3.182, 5: 2.776 };
const stats = v => { const m = v.reduce((a, b) => a + b, 0) / v.length, sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1)) : 0; return { median: [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)], mean: m, ci95: v.length > 1 ? tq[v.length] * sd / Math.sqrt(v.length) : null, n: v.length }; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em39-scen-'));
const body = b => crypto.createHash('sha256').update(b.subarray(12 + b.readUInt32LE(8))).digest('hex');
const run = (cli, args) => JSON.parse(execFileSync(cli, args.map(String), { encoding: 'utf8', maxBuffer: 64 << 20 }));
const results = [];
for (const [name, cfg0, updates0, kind, abstraction] of scenarios) {
  const updates = quick ? Math.max(10, Math.round(updates0 / 10)) : updates0, rows = [];
  for (const seed of seeds) {
    const cfg = { ...base, ...cfg0, privateSeed: seed }, spec = path.join(dir, 'spec.json');
    fs.writeFileSync(spec, JSON.stringify(E.MultiwayGame(cfg).nativeSpec()));
    const pair = {};
    for (const [label, cli] of seed % 2 ? [['3.8', cli38], ['3.9', cli39]] : [['3.9', cli39], ['3.8', cli38]]) {
      const state = path.join(dir, label + '.state'), info = run(cli, [spec, updates, threads, state, 2048]);
      pair[label] = { wallSeconds: info.wallSeconds, peakRssMiB: info.processPeakRssMiB, trainingDeals: info.trainingDeals, stateVisits: info.stateVisits, states: info.states, rows: info.rows, gpuPeakBytes: info.gpuBufferPeakBytes || 0, device: info.devicePath || info.route || 'cpu', sha256: body(fs.readFileSync(state)) };
    }
    const identical = pair['3.8'].sha256 === pair['3.9'].sha256;
    let quality;
    const req = path.join(dir, 'q.json'), st = path.join(dir, '3.9.state');
    if (kind === 'exact') { fs.writeFileSync(req, JSON.stringify({ method: 'exact', maxVisits: 2000000000 })); const g = run(cli39, ['--gain', spec, st, req]); quality = { kind: 'exact best-response gain per seat', seats: g.seats.map(s => s.gain), exploitability: g.exploitability, nashConv: g.nashConv }; }
    else { fs.writeFileSync(req, JSON.stringify({ method: 'sampled', samples: quick ? 200 : 2000, selectionSamples: quick ? 16 : 64, reachSamples: quick ? 500 : 5000, seed: 1, futureActions: 'sample', timeLimitMs: 600000 })); const g = run(cli39, ['--gain', spec, st, req]); quality = { kind: 'sampled one-shot response gain per seat (lower bound, not exploitability)', seats: g.seats.map(s => s.available ? { gain: s.gain.mean, stdErr: s.gain.stdErr } : null), maxSeatGain: g.summary ? g.summary.maxSeatGain : null }; }
    rows.push({ seed, updates, identicalState: identical, ...pair, quality });
    console.log(name.padEnd(46), 'seed', seed, '3.8', pair['3.8'].wallSeconds.toFixed(3), 's  3.9', pair['3.9'].wallSeconds.toFixed(3), 's  identical', identical);
  }
  const t38 = stats(rows.map(r => r['3.8'].wallSeconds)), t39 = stats(rows.map(r => r['3.9'].wallSeconds));
  results.push({ name, abstraction, algorithm: 'external-sampling MCCFR (linear weighting)', players: (cfg0.stacks || []).length, street: cfg0.preflop ? 'preflop' : cfg0.board.length === 10 ? 'river' : cfg0.board.length === 8 ? 'turn' : 'flop', utility: cfg0.icm ? 'ICM' : 'chip EV', threads, updates, runs: rows,
    summary: { wall38: t38, wall39: t39, medianChangePercent: 100 * (t39.median - t38.median) / t38.median, allIdentical: rows.every(r => r.identicalState), peakRss38: Math.max(...rows.map(r => r['3.8'].peakRssMiB)), peakRss39: Math.max(...rows.map(r => r['3.9'].peakRssMiB)) } });
}
fs.writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), cpu: os.cpus()[0].model, logicalProcessors: os.cpus().length, platform: os.platform() + ' ' + os.release(), quick, physicalGpuTested: false,
  note: 'Training code paths are unchanged between 3.8 and 3.9, so equal-update states are expected to be byte-identical; time differences are measurement noise unless the confidence intervals separate.', scenarios: results }, null, 1));
fs.rmSync(dir, { recursive: true, force: true });
