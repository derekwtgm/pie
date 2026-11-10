// EightMax 3.9: Windows mwcli.exe (under Wine) vs Linux mwcli parity for the
// new request handlers. Same spec and state file; identical JSON answers
// required except elapsedMs. usage: node wine-parity.js <linux mwcli> <wine wrapper> <out.json>
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const src = path.join(__dirname, '../../source'), E = require(src + '/tools/loadlib'); for (const l of ['lib_runouts', 'lib_wide', 'lib_river']) require(src + '/web/' + l);
const [lin, win, out] = process.argv.slice(2), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em39-wp-'));
const base = { privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128 };
const studies = [
  ['heads-up river chip', { ...base, board: 'Ks8d5h2c2s', common: 10, stacks: [20, 20], ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd'], streets: { river: { bets: '50,a', raises: 'a', maxBets: 2 } }, privateSeed: 3 }, 2000,
    [['--ev', { path: [], hands: [0, 1, 2], range: true, method: 'exact' }], ['--ev', { path: [1], hands: [0, 3], method: 'sampled', samples: 2000, seed: 7 }], ['--gain', { method: 'exact' }], ['--gain', { method: 'sampled', samples: 1000, seed: 2 }]]],
  ['three-way side pots ICM', { ...base, board: 'Ks8d5h2c2s', common: 6, stacks: [4, 12, 30], ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd', 'Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc'], icm: { payouts: [50, 30, 20], others: [10] }, streets: { river: { bets: '75,a', raises: 'a', maxBets: 2 } }, privateSeed: 5 }, 800,
    [['--ev', { path: [], hands: [0, 1], range: true, method: 'exact' }], ['--ev', { path: [1], hands: [0], method: 'sampled', samples: 3000 }], ['--gain', { method: 'exact' }]]],
  ['heads-up turn', { ...base, board: 'Ks8d5h2c', common: 8, stacks: [12, 12], ranges: ['AhKh,KdQd,8s8h,JsTs', 'AsKd,5d5c,8h7h,JdTd'], streets: { turn: { bets: 'a', raises: '', maxBets: 1 }, river: { bets: '50', raises: '', maxBets: 1 } }, privateSeed: 7 }, 1000,
    [['--ev', { path: [], hands: [0, 1, 2, 3], method: 'exact' }], ['--gain', { method: 'exact' }]]],
  ['eight-player final-table ICM', { ...base, preflop: { mode: 'linked', opens: '2.2,a', raises: 'a', maxBets: 2 }, board: '', dealt: 8, common: 0, stacks: [30, 22, 15, 40, 9, 18, 25, 12], ranges: Array(8).fill('random'), icm: { payouts: [30, 20, 14, 11, 9, 7, 5, 4] }, streets: { flop: { bets: '50', raises: '', maxBets: 1 }, turn: { bets: 'a', raises: '', maxBets: 1 }, river: { bets: 'a', raises: '', maxBets: 1 } }, batchDeals: 4, actionStreams: 'deal', privateSeed: 4 }, 40,
    [['--ev', { path: [], hands: [0, 100, 600], range: true, samples: 300, seed: 3 }], ['--gain', { method: 'sampled', samples: 200, selectionSamples: 16, reachSamples: 1000, seed: 5, futureActions: 'sample' }], ['--node', { path: [], rangeSeat: 'nonsense' }], ['--node', { offset: -1 }], ['--ev', { hands: ['0'] }]]],
];
const strip = s => s.replace(/"elapsedMs":[0-9.e+-]+/g, '"elapsedMs":0');
const run = (cli, args) => { const r = cp.spawnSync(cli, args, { encoding: 'utf8', maxBuffer: 64 << 20, env: { ...process.env, WINEDEBUG: '-all' } }); return { status: r.status, out: strip(r.stdout.trim()), err: r.stderr.trim().replace(/\r/g, '') }; };
const report = { generated: new Date().toISOString(), runner: 'Wine (not physical Windows)', checks: [] };
for (const [name, cfg, iters, reqs] of studies) {
  const spec = path.join(dir, 'spec.json'), sl = path.join(dir, 'lin.state'), sw = path.join(dir, 'win.state');
  fs.writeFileSync(spec, JSON.stringify(E.MultiwayGame(cfg).nativeSpec()));
  run(lin, [spec, String(iters), '2', sl, '512']); run(win, [spec, String(iters), '2', sw, '512']);
  const sameState = fs.readFileSync(sl).equals(fs.readFileSync(sw));
  report.checks.push({ study: name, check: 'trained state byte-identical (Linux vs Windows build)', ok: sameState });
  for (const [mode, q] of reqs) {
    const f = path.join(dir, 'q.json'); fs.writeFileSync(f, JSON.stringify(q));
    const a = run(lin, [mode, spec, sl, f]), b = run(win, [mode, spec, sl, f]);
    const ok = a.status === b.status && a.out === b.out && a.err === b.err;
    report.checks.push({ study: name, check: mode + ' ' + JSON.stringify(q), ok, status: a.status, error: a.err || undefined });
    console.log(ok ? 'PASS' : 'FAIL', name, mode, JSON.stringify(q).slice(0, 80), a.status ? a.err : '');
  }
}
report.passed = report.checks.filter(c => c.ok).length; report.failed = report.checks.length - report.passed;
fs.writeFileSync(out, JSON.stringify(report, null, 1)); fs.rmSync(dir, { recursive: true, force: true });
console.log('passed', report.passed, 'failed', report.failed);
