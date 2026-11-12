'use strict';
// EightMax 4.5: checks of the Windows executables run through Wine on Linux (the 4.4 checks 1-6
// below, then the 4.5 checks 7-10 listed after them). WINE=<path> selects the Wine binary (default: wine).
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
//   7. mwcli.exe --ieee-sweep 200000 45: no parser or JSON-reader mismatch, digest equal to the
//      Linux build; the C runtime's own strtod mismatches are recorded (informational)
//   8. coverage memory budget (1, 2, 8 MiB; 1, 4, 8 threads) on the eight-handed linked study:
//      coverage.memory.peakBytes <= budget (the tiers are VirtualAlloc pages in this build)
//   9. training 300 updates with 4 threads: state bytes equal the recorded 4.4/4.5 hash
//      (bit-identical ICM kernel in the MinGW build); 150 + evaluation + 150 == 300
//  10. tests/coverage45.cpp and tests/icm45.cpp cross-compiled and run under Wine (if a MinGW
//      compiler is available): the Windows page allocator path of the ledger
// usage: node tools/wine45.js <mwcli.exe> <linux mwcli> <expected build id> <out.json>
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
const [exe, linuxCli, buildId, out] = process.argv.slice(2);
const E = require('./loadlib'); for (const l of ['lib_runouts', 'lib_wide', 'lib_river', 'lib_pushfold', 'lib_explorer']) require('../web/' + l);
const fixtures = path.join(__dirname, '..', '..', 'validation', '4.0', 'fixtures'), fxSpec = path.join(fixtures, 'push8-icm.spec.json'), fxState = path.join(fixtures, 'push8-icm.state');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em45-wine-')), env = { ...process.env, WINEDEBUG: '-all', EM_QUERY_TIMING: '1' };
const WINE = process.env.WINE || 'wine';
const wine = (args, extra = {}) => cp.spawnSync(WINE, [exe, ...args], { encoding: 'utf8', maxBuffer: 1 << 28, env: { ...env, ...extra }, timeout: 600000 });
const lin = (args, extra = {}) => cp.spawnSync(linuxCli, args, { encoding: 'utf8', maxBuffer: 1 << 28, env: { ...env, ...extra }, timeout: 600000 });
const checks = [], report = { tool: 'wine45', runtime: 'wine (not Windows)', wineVersion: cp.spawnSync(WINE, ['--version'], { encoding: 'utf8' }).stdout.trim(), executable: path.basename(exe), generated: new Date().toISOString(), cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, checks };
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
  const st2 = path.join(dir, 'state-wine'); cp.spawnSync(WINE, [exe, spec, '20', '2', st2, '512'], { env });
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
  // ---------------- 4.5 ----------------
  const sw = wine(['--ieee-sweep', '200000', '45']), sl = lin(['--ieee-sweep', '200000', '45']); let dw = null, dl = null; try { dw = JSON.parse(sw.stdout); dl = JSON.parse(sl.stdout); } catch { }
  report.ieeeSweep = { windowsBuild: dw, linuxBuild: dl };
  check('IEEE 754 sweep, 200,000 doubles: the Windows build parses every printed value back to identical bits (engine parser and JSON reader), neighbours distinct', sw.status === 0 && dw && dw.passed && dw.parserMismatches === 0 && dw.jsonReaderMismatches === 0 && dw.neighbourTextCollisions === 0);
  check('IEEE 754 sweep digest equal to the Linux build (' + (dw && dw.digest) + '): both printed the same characters for all 200,000 doubles', dw && dl && dw.digest === dl.digest && dl.digest === '94fc3f6ed8426909');
  check('informational: C runtime strtod of the Windows build differs from the correctly rounded value for ' + (dw && dw.crtStrtodMismatches) + ' of 200,000 swept doubles (Linux build: ' + (dl && dl.crtStrtodMismatches) + '); the engine does not use it since 4.5', dw && Number.isInteger(dw.crtStrtodMismatches), { windows: dw && dw.crtStrtodMismatches, linux: dl && dl.crtStrtodMismatches });
  report.coverageBudgets = []; let covOk = true; const evBits = new Set();
  for (const mib of [1, 2, 8]) for (const threads of [1, 4, 8]) {
    const body = { path: [], hands: [3], range: true, method: 'sampled', samples: 30000, seed: 5, timeLimitMs: 600000, threads, coverageMiB: mib };
    const r = parse(wine(['--ev', spec, state, q('cov', body)])), m = r.json && r.json.coverage.memory;
    report.coverageBudgets.push({ coverageMiB: mib, threads, memory: m && { budgetBytes: m.budgetBytes, peakBytes: m.peakBytes, tableBytes: m.tableBytes, retiredGenerationBytes: m.retiredGenerationBytes, workerFilterBytes: m.workerFilterBytes, status: m.status }, kind: r.json && r.json.coverage.distinctCountKind, distinct: r.json && r.json.coverage.distinctInformationSets });
    covOk = covOk && !!m && m.budgetBytes === mib << 20 && m.peakBytes <= m.budgetBytes && m.withinBudget === true && (m.status === 'ok') === (r.json.coverage.distinctCountKind === 'exact');
    if (r.json) evBits.add(JSON.stringify(r.json.range.evBits));
  }
  check('coverage memory budget under the Windows build: peak live bytes <= coverageMiB for 1, 2, 8 MiB and 1, 4, 8 threads; capped sets labelled; EVs bit-identical for every budget', covOk && evBits.size === 1);
  const lb = parse(lin(['--ev', spec, state, q('covl', { path: [], hands: [3], range: true, method: 'sampled', samples: 30000, seed: 5, timeLimitMs: 600000, threads: 4, coverageMiB: 8 })]));
  check('the same sampled range EV from the Linux build: identical bits', lb.json && evBits.has(JSON.stringify(lb.json.range.evBits)));
  const sha = f => require('node:crypto').createHash('sha256').update(fs.readFileSync(f)).digest('hex'), GOLD = 'aa80974199182afa91d5a47166d32af0eb00ecff3ba334593eb5a359cc2e22b8';
  const w300 = path.join(dir, 'w300'), wa = path.join(dir, 'wa'), wb = path.join(dir, 'wb');
  cp.spawnSync(WINE, [exe, spec, '300', '4', w300, '512'], { env });
  check('training 300 updates, 4 threads, Windows build: state SHA-256 equals the recorded hash of the 4.4 and 4.5 Linux builds', fs.existsSync(w300) && sha(w300) === GOLD, { sha256: fs.existsSync(w300) && sha(w300) });
  cp.spawnSync(WINE, [exe, spec, '150', '4', wa, '512'], { env });
  wine(['--ev', spec, wa, q('mid', { path: [], hands: [3], range: true, method: 'sampled', samples: 2000000, timeLimitMs: 250, threads: 4, coverageMiB: 1 })]);
  cp.spawnSync(WINE, [exe, spec, '150', '4', wb, '512', wa], { env });
  check('Windows build: 150 updates, a deadline-limited evaluation with a capped coverage table, 150 more updates == 300 uninterrupted updates (state bytes)', fs.existsSync(wb) && sha(wb) === GOLD);
  const gxx = ['x86_64-w64-mingw32-g++-posix', 'x86_64-w64-mingw32-g++'].find(c => cp.spawnSync(c, ['--version']).status === 0);
  if (gxx) {
    const native = path.join(__dirname, '..', 'native'), tests = path.join(__dirname, '..', 'tests');
    for (const [name, args, runArgs] of [['coverage45', ['-O2'], ['quick']], ['icm45', ['-O2', '-ffp-contract=off', '-march=x86-64'], ['20000']]]) {
      const x = path.join(dir, name + '.exe'), b = cp.spawnSync(gxx, ['-std=c++20', ...args, '-static', '-pthread', '-I' + native, '-I' + tests, path.join(tests, name + '.cpp'), '-o', x], { encoding: 'utf8' });
      const r = b.status === 0 ? cp.spawnSync(WINE, [x, ...runArgs], { encoding: 'utf8', maxBuffer: 1 << 27, env, timeout: 900000 }) : null; let j = null; try { j = JSON.parse(r.stdout); } catch { }
      if (name === 'coverage45') { const ref = j && j.checks.find(c => /^REFERENCE 4\.4 \(archived header\)/.test(c.check)); report.coverage45 = j && { checks: j.checks.length, failures: j.failures, reference44Bytes: ref && ref.allocatedBytes44 };
        check('tests/coverage45.cpp built for Windows (VirtualAlloc tiers) and run under Wine: ' + (j ? j.checks.length : 0) + ' checks, 0 failures; the archived 4.4 table allocates 1,425,408 bytes for 1 MiB there as well', r && r.status === 0 && j && j.failures === 0 && ref && ref.allocatedBytes44 === 1425408);
      } else { report.icm45 = j; check('tests/icm45.cpp built for Windows and run under Wine: two-lane ICM kernel bit-identical to the 4.4 routine (' + (j && j.evaluations) + ' evaluations)', r && r.status === 0 && j && j.passed && j.bitMismatchesAgainst44 === 0); }
    }
  } else check('MinGW compiler not found: tests/coverage45.cpp and tests/icm45.cpp were not built for Windows (NOT RUN)', true, { skipped: true });
} catch (e) { check('stopped by an error: ' + e.message, false); }
report.passed = checks.every(c => c.passed); report.failed = checks.filter(c => !c.passed).length;
fs.writeFileSync(out, JSON.stringify(report, null, 1)); fs.rmSync(dir, { recursive: true, force: true });
console.log(report.passed ? 'wine45: all ' + checks.length + ' checks passed (Wine, not Windows)' : 'wine45: ' + report.failed + ' FAILED');
process.exit(report.passed ? 0 : 1);
