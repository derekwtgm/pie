'use strict';
// EightMax 4.4: checks of the Windows executables run through Wine on Linux.
// WINE IS NOT WINDOWS: this exercises the cross-compiled x64 code (MinGW-w64
// runtime, winpthreads, VirtualAlloc-backed coverage set) with Wine's
// implementation of the Windows API. It is evidence that the Windows build
// computes the same numbers as the Linux build and honours deadlines; it says
// nothing about Windows PowerShell, a physical Windows kernel or a GPU.
// Checks
//   1. mwcli.exe --build-id equals BUILD-INFO / the Linux build id
//   2. mwcli.exe --ieee is byte-identical to the Linux mwcli --ieee (modulo CRLF);
//      --ieee-verify of that document: 0 mismatches (C runtime print + strtod)
//   3. exact EV and eight-seat exact gains on the 4.0 fixture: evBits / gainBits
//      equal the 4.2 reference patterns, for 1, 2, 4 and 8 threads
//   4. coverage counts of the fixture (371 / 159 / 212) with the concurrent set
//   5. sampled-EV deadline (the 4.3 audit's request shape on the fixture's
//      eight-handed linked study): status partial, overrun recorded for 100,
//      250, 600 and 1000 ms, 3 runs each
//   6. cancellation latency; a completed sampled run equals the Linux result
//      bit for bit (same seed)
// usage: node tools/wine44.js <mwcli.exe> <linux mwcli> <expected build id> <out.json>
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
const [exe, linuxCli, buildId, out] = process.argv.slice(2);
const E = require('./loadlib'); for (const l of ['lib_runouts', 'lib_wide', 'lib_river', 'lib_pushfold', 'lib_explorer']) require('../web/' + l);
const fixtures = path.join(__dirname, '..', '..', 'validation', '4.0', 'fixtures'), fxSpec = path.join(fixtures, 'push8-icm.spec.json'), fxState = path.join(fixtures, 'push8-icm.state');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em44-wine-')), env = { ...process.env, WINEDEBUG: '-all', EM_QUERY_TIMING: '1' };
const wine = (args, extra = {}) => cp.spawnSync('wine', [exe, ...args], { encoding: 'utf8', maxBuffer: 1 << 28, env: { ...env, ...extra }, timeout: 600000 });
const lin = (args, extra = {}) => cp.spawnSync(linuxCli, args, { encoding: 'utf8', maxBuffer: 1 << 28, env: { ...env, ...extra }, timeout: 600000 });
const checks = [], report = { tool: 'wine44', runtime: 'wine (not Windows)', wineVersion: cp.spawnSync('wine', ['--version'], { encoding: 'utf8' }).stdout.trim(), executable: path.basename(exe), generated: new Date().toISOString(), cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, checks };
const check = (name, ok, detail) => { checks.push({ check: name, passed: !!ok, ...(detail || {}) }); console.log((ok ? 'PASS  ' : 'FAIL  ') + name); };
const q = (name, o) => { const f = path.join(dir, name + '.json'); fs.writeFileSync(f, JSON.stringify(o)); return f; };
const parse = r => { let timing = null, json = null; try { timing = JSON.parse(r.stderr.trim().split('\n')[0]); } catch { } try { json = JSON.parse(r.stdout); } catch { } return { timing, json, status: r.status, err: r.stderr }; };
try {
  const id = wine(['--build-id']).stdout.trim(); check('build identifier ' + id, id === 'EightMaxBuild=' + buildId, { reported: id, expected: buildId });
  const pw = wine(['--ieee']).stdout.replace(/\r\n/g, '\n'), pl = lin(['--ieee']).stdout;
  check('IEEE 754 probe document identical to the Linux build (' + JSON.parse(pw).probes.length + ' probes)', pw === pl);
  const pf = path.join(dir, 'probe.json'); fs.writeFileSync(pf, pw);
  const v = wine(['--ieee-verify', pf]), vr = JSON.parse(v.stdout); report.ieeeVerify = { probeCount: vr.probeCount, mismatches: vr.mismatches, textMismatches: vr.textMismatches, worstUlpDistance: vr.worstUlpDistance };
  check('print with 17 digits then parse: identical bit patterns for every probe (C runtime of the Windows build)', v.status === 0 && vr.mismatches === 0 && vr.textMismatches === 0);
  const EV = ['402e0a51470d8f36', '402f57218439052d'], GAIN = ['3fe15d3f18fd8430', '3fadfb44a17da100', '3f7e93e0e23e9000', '3fa28aad598de200', '3fc1d3a932e4eb40', '3facf6d893a40500', '3fbb34236bb44e80', '3fc12dd7abd36dc0'];
  report.exactEv = [];
  for (const threads of [1, 2, 4, 8]) {
    const r = parse(wine(['--ev', fxSpec, fxState, q('ev', { path: [], hands: [0], method: 'exact', device: 'cpu', maxVisits: 2000000000, threads })], { EM_COVERAGE_AUDIT: '1' }));
    const c = r.json && r.json.coverage; report.exactEv.push({ threads, queryMs: r.timing && r.timing.queryMs, evBits: r.json && r.json.hands[0].evBits, boardsScored: r.json && r.json.execution.boardsScored, distinct: c && c.distinctInformationSets });
    check('exact EV, ' + threads + ' threads: bits equal the 4.2 reference, 376,992 boards, coverage 371/159/212 equal to the audit', r.json && JSON.stringify(r.json.hands[0].evBits) === JSON.stringify(EV) && r.json.execution.boardsScored === 376992 &&
      c.distinctInformationSets === 371 && c.distinctStoredInformationSets === 159 && c.distinctFallbackInformationSets === 212 && c.audit.distinctInformationSets === 371 && /concurrent set/.test(c.structure));
  }
  for (const threads of [1, 8]) {
    const r = parse(wine(['--gain', fxSpec, fxState, q('gain', { method: 'exact', seats: [0, 1, 2, 3, 4, 5, 6, 7], threads })]));
    check('exact response gains, eight seats, ' + threads + ' threads: bits equal the 4.2 reference', r.json && JSON.stringify(r.json.seats.map(s => s.gainBits)) === JSON.stringify(GAIN), { queryMs: r.timing && r.timing.queryMs });
  }
  // eight-handed linked preflop-to-river ICM study (the audit's deadline case); trained by the Linux build, read by both
  const base = { privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128 };
  const spec = path.join(dir, 'spec.json'), state = path.join(dir, 'state');
  fs.writeFileSync(spec, JSON.stringify(E.MultiwayGame({ ...base, preflop: { mode: 'linked', opens: '2.2,a', raises: 'a', maxBets: 2 }, board: '', dealt: 8, common: 0, stacks: [30, 22, 15, 40, 9, 18, 25, 12], ranges: Array(8).fill('random'), icm: { payouts: [30, 20, 14, 11, 9, 7, 5, 4] },
    streets: { flop: { bets: '50', raises: '', maxBets: 1 }, turn: { bets: 'a', raises: '', maxBets: 1 }, river: { bets: 'a', raises: '', maxBets: 1 } }, batchDeals: 4, actionStreams: 'deal', privateSeed: 4 }).nativeSpec()));
  cp.execFileSync(linuxCli, [spec, 20, 2, state, 512].map(String));
  // training under Wine gives the same state bytes as the Linux build
  const st2 = path.join(dir, 'state-wine'); cp.spawnSync('wine', [exe, spec, '20', '2', st2, '512'], { env });
  check('training 20 updates: the Windows build writes the same state bytes as the Linux build', fs.existsSync(st2) && fs.readFileSync(st2).equals(fs.readFileSync(state)));
  report.deadline = [];
  for (const ms of [100, 250, 600, 1000]) for (let i = 0; i < 3; i++) {
    const r = parse(wine(['--ev', spec, state, q('dl', { path: [], hands: [3], range: true, method: 'sampled', samples: 2000000, timeLimitMs: ms, threads: 4 })]));
    report.deadline.push({ limitMs: ms, queryMs: r.timing && r.timing.queryMs, overrunMs: r.timing && +(r.timing.queryMs - ms).toFixed(2), status: r.json && r.json.status, samples: r.json && r.json.hands[0].samples, phasesMs: r.json && r.json.deadline.phasesMs });
  }
  const worst = Math.max(...report.deadline.map(d => d.overrunMs)); report.worstOverrunMs = worst;
  check('sampled EV under Wine: 12 runs at 100/250/600/1000 ms all partial, worst overrun ' + worst.toFixed(1) + ' ms (documented tolerance 50 ms idle / 150 ms loaded; Wine adds its own process overhead)', report.deadline.every(d => d.status === 'partial') && worst < 150);
  const c = parse(wine(['--ev', spec, state, q('cancel', { path: [], hands: [3], range: true, method: 'sampled', samples: 2000000, timeLimitMs: 600000, threads: 4 })], { EM_CANCEL_AFTER_MS: '200' }));
  report.cancelLatencyMs = c.timing && c.timing.cancelLatencyMs; check('cancellation under Wine: HTTP 409, latency ' + (c.timing && c.timing.cancelLatencyMs) + ' ms', c.timing && c.timing.status === 409 && c.timing.cancelLatencyMs < 100);
  const sq = q('same', { path: [], hands: [3], method: 'sampled', samples: 1500, seed: 9, threads: 3, timeLimitMs: 600000 });
  const a = parse(wine(['--ev', spec, state, sq])), b = parse(lin(['--ev', spec, state, sq]));
  check('completed sampled EV (seed 9, 1,500 samples, 3 threads): Windows build equals the Linux build bit for bit', a.json && b.json && JSON.stringify(a.json.hands[0].evBits) === JSON.stringify(b.json.hands[0].evBits) && a.json.coverage.distinctInformationSets === b.json.coverage.distinctInformationSets, { evBits: a.json && a.json.hands[0].evBits, distinctInformationSets: a.json && a.json.coverage.distinctInformationSets });
} catch (e) { check('stopped by an error: ' + e.message, false); }
report.passed = checks.every(c => c.passed); report.failed = checks.filter(c => !c.passed).length;
fs.writeFileSync(out, JSON.stringify(report, null, 1)); fs.rmSync(dir, { recursive: true, force: true });
console.log(report.passed ? 'wine44: all ' + checks.length + ' checks passed (Wine, not Windows)' : 'wine44: ' + report.failed + ' FAILED');
process.exit(report.passed ? 0 : 1);
