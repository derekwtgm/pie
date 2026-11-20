#!/usr/bin/env node
'use strict';
/* EightMax Test Workbench 0.35.0: END-TO-END MULTI-TABLE BENCHMARK with REAL screen capture and REAL visible input.
 *
 *   node tools/simulator-benchmark-035.cjs [--tables 1,2,5,8,10] [--seconds 75] [--turn-delay 2500] [--window 10000]
 *        [--width 800] [--out reports/0.35-simulator-benchmark.json] [--work DIR]
 *
 * Starts a private desktop host (headless), the controlled test tables and the full loop for every table count:
 *   capture (host) -> recognition -> state -> decision -> executor -> scheduler lease -> input driver -> capture -> confirmation
 * Decisions are the labelled SCRIPTED test policy (no EightMax strategy covers these random 8-handed spots in a fresh install;
 * this measures CONTROL reliability, not strategy). Afterwards every confirmed action is matched against the table's oracle.
 * Physical input is serialised (one cursor); the report says how many tables met the decision deadline - nothing is assumed.
 */
const path = require('path'), fs = require('fs'), cp = require('child_process'), crypto = require('crypto'), os = require('os');
const ROOT = path.join(__dirname, '..'), src = (m) => require(path.join(ROOT, 'src', m));
const SC = src('simulator-controls.js'), SP = src('simulator-profiles.js'), SCH = src('input-scheduler.js'), XA = src('execution-adapters.js'), M = src('input-motion.js');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : d; };
const COUNTS = arg('tables', '1,2,5,8,10').split(',').map(Number), SECONDS = Number(arg('seconds', '75')), TURN = Number(arg('turn-delay', '2500')), WINDOW = Number(arg('window', '10000')), WIDTH = Number(arg('width', '800'));
const OUT = arg('out', path.join(ROOT, 'reports', '0.35-simulator-benchmark.json')), WORK = arg('work', path.join(os.tmpdir(), 'em035-bench-' + Date.now()));
const BIN = path.join(ROOT, 'desktop', 'bin'), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), mono = () => performance.now();
fs.mkdirSync(WORK, { recursive: true });
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

function startHost() {
  const ready = path.join(WORK, 'host-ready.json'); try { fs.unlinkSync(ready); } catch (e) { /* none */ }
  const child = cp.spawn(path.join(BIN, 'EightMaxWorkbench.exe'), ['--root', ROOT, '--ready', ready, '--headless'], { stdio: 'ignore', detached: false });
  return { child, ready };
}
async function waitReady(file, ms = 60000) { const t = Date.now(); while (Date.now() - t < ms) { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j.token) return j; } catch (e) { /* not yet */ } await sleep(250); } throw new Error('desktop host did not become ready'); }
function fixture(n, dir) {
  const child = cp.spawn(process.execPath, [path.join(ROOT, 'tools', 'test-table-035.cjs'), '--tables', String(n), '--width', String(WIDTH), '--layout', 'cascade', '--oracle-dir', dir, '--hand-gap', '1500', '--turn-delay', String(TURN), '--seed', String(n), '--exe', path.join(BIN, 'EightMaxTestTable.exe')], { stdio: ['pipe', 'pipe', 'inherit'] });
  const msgs = [], waiters = []; let buf = ''; let seq = 0;
  child.stdout.setEncoding('utf8'); child.stdout.on('data', (d) => { buf += d; let k; while ((k = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, k); buf = buf.slice(k + 1); try { const m = JSON.parse(l); const w = waiters.find((x) => x.f(m)); if (w) { waiters.splice(waiters.indexOf(w), 1); w.r(m); } else msgs.push(m); } catch (e) { /* skip */ } } });
  const wait = (f, ms = 40000) => { const hit = msgs.find(f); if (hit) { msgs.splice(msgs.indexOf(hit), 1); return Promise.resolve(hit); } return new Promise((r, j) => { const w = { f, r }; waiters.push(w); setTimeout(() => { if (waiters.includes(w)) { waiters.splice(waiters.indexOf(w), 1); j(new Error('fixture timeout')); } }, ms); }); };
  return { child, wait, cmd: async (c) => { const id = ++seq; child.stdin.write(JSON.stringify({ id, ...c }) + '\n'); return wait((m) => m.id === id); }, stop: async () => { try { child.stdin.write('{"cmd":"stop"}\n'); } catch (e) { /* gone */ } await sleep(2000); try { child.kill(); } catch (e) { /* gone */ } } };
}
/** Working set + CPU time of the processes in this test (tasklist / Get-Process; Windows only). */
function processSample() {
  const r = cp.spawnSync('powershell.exe', ['-NoProfile', '-Command', "Get-Process -Name node,EightMaxWorkbench,EightMaxInput,EightMaxTestTable -ErrorAction SilentlyContinue | ForEach-Object { $_.ProcessName + ',' + $_.Id + ',' + $_.WorkingSet64 + ',' + [math]::Round($_.TotalProcessorTime.TotalSeconds,3) }"], { encoding: 'utf8', timeout: 20000 });
  const rows = (r.stdout || '').trim().split(/\r?\n/).filter(Boolean).map((l) => { const [name, id, ws, cpu] = l.split(','); return { name, id: +id, ws: +ws, cpu: +cpu }; });
  const by = {}; for (const x of rows) { const b = by[x.name] || (by[x.name] = { count: 0, workingSetMiB: 0, cpuSeconds: 0 }); b.count++; b.workingSetMiB += x.ws / 1048576; b.cpuSeconds += x.cpu; } for (const k of Object.keys(by)) { by[k].workingSetMiB = +by[k].workingSetMiB.toFixed(1); by[k].cpuSeconds = +by[k].cpuSeconds.toFixed(2); }
  return { at: Date.now(), byName: by, totalMiB: +rows.reduce((a, x) => a + x.ws / 1048576, 0).toFixed(1), totalCpuSeconds: +rows.reduce((a, x) => a + x.cpu, 0).toFixed(2) };
}
const ORACLE_TYPE = { fold: 'fold', check: 'check', call: 'call', raise: 'raise', allin: 'raise' };

async function runCount(n, api, session, host) {
  const dir = path.join(WORK, 'tables-' + n); fs.mkdirSync(dir, { recursive: true });
  const fx = fixture(n, dir), ready = await fx.wait((m) => m.type === 'ready'), exeSha = sha(path.join(BIN, 'EightMaxTestTable.exe'));
  const auth = SC.authorizations({ environment: 'controlled-test-table', approvedBy: 'Workbench acceptance (bundled fixture)', exeFileName: 'EightMaxTestTable.exe', exeSha256: exeSha, hours: 1 });
  const profile = SP.fixtureProfile({ exeSha256: exeSha }), recorder = new XA.DiagnosticsRecorder({ max: 20000 });
  const sched = new SCH.InputScheduler({ maxQueue: 16, onCancel: () => session.request('cancel-all') });
  const tables = [];
  for (const w of ready.tables) {
    const reg = await session.request('register-target', { hwnd: w.hwnd, authorization: auth.simulator, label: 'table ' + w.table }); if (!reg.ok) throw new Error('registration refused: ' + reg.error);
    const t = new SC.SimulatorTable({ id: w.table, window: { hwnd: w.hwnd, pid: w.pid, title: 'EightMax Test Table ' + String(w.table).padStart(2, '0'), client: w.client }, profile, api, session, scheduler: sched, qaAuthorization: auth.qa, recorder, allowScripted: true, seed: n, options: { decisionWindowMs: WINDOW, stopOnPause: true } });
    const o = await t.capture.open(); if (!o || o.ok !== true) throw new Error('capture refused for ' + w.hwnd + ': ' + JSON.stringify(o));
    tables.push(t);
  }
  await session.request('arm'); const samples = [processSample()], t0 = mono(), until = t0 + SECONDS * 1000;
  const sampler = setInterval(() => { try { samples.push(processSample()); } catch (e) { /* skip */ } }, 10000);
  await Promise.all(tables.map((t) => t.run(until)));
  clearInterval(sampler); samples.push(processSample()); const elapsed = (mono() - t0) / 1000;
  await session.request('disarm'); const drv = await session.request('status');
  const oracle = (await fx.cmd({ cmd: 'summary' })).tables;
  // ---- grade every confirmed action against what the table actually received ----
  let incorrectClicks = 0, incorrectWagers = 0, matched = 0, unmatchedOracle = 0; const perTable = [];
  for (const t of tables) {
    const o = oracle.find((x) => x.table === t.id), accepted = o ? o.accepted : [], confirmed = t.log.filter((e) => e.status === 'confirmed');
    const ev = fs.existsSync(path.join(dir, 'oracle-table-' + String(t.id).padStart(2, '0') + '.jsonl')) ? fs.readFileSync(path.join(dir, 'oracle-table-' + String(t.id).padStart(2, '0') + '.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const accEv = ev.filter((e) => e.kind === 'action' && e.result === 'accepted').map((e) => e.applied);
    let i = 0; for (const c of confirmed) { const want = c.action; const a = accEv[i++]; if (!a) { incorrectClicks++; continue; } const sameType = a.type === (want.type === 'raise' ? 'raise' : want.type) || (want.type === 'call' && a.control === 'allin'); if (!sameType || a.seat !== c.seat || a.hand !== c.hand) incorrectClicks++; else if (want.type === 'raise' && a.amount !== want.amount) incorrectWagers++; else matched++; }
    unmatchedOracle += Math.max(0, accEv.length - confirmed.length);
    const c = o ? o.counts : {}; incorrectClicks += (c.downOutsideControls || 0) + (c.downOnDisabled || 0) + (c.doubleClicks || 0) + (c.staleClicks || 0) + (c.illegal || 0);
    incorrectWagers += c.wagerRejected || 0;
    perTable.push({ ...t.report(), oracle: c, oracleAccepted: accEv.length });
  }
  const sum = (k) => perTable.reduce((a, r) => a + (r.counts[k] || 0), 0), all = (k) => perTable.flatMap((r) => r.latencyMs[k] && r.latencyMs[k].n ? [r.latencyMs[k]] : []);
  const mergeStats = (k) => { const xs = tables.flatMap((t) => (k === 'e2e' ? t.m.e2e : k === 'cursor' ? t.m.cursor : k === 'input' ? t.m.input : t.m.confirmMs)); return SCH.stats(xs); };
  const peak = samples.reduce((m, s) => Math.max(m, s.totalMiB), 0), cpu0 = samples[0].totalCpuSeconds, cpu1 = samples[samples.length - 1].totalCpuSeconds;
  const res = { tables: n, seconds: +elapsed.toFixed(1), turnDelayMs: TURN, decisionWindowMs: WINDOW, windowWidth: WIDTH,
    actions: { attempted: sum('attempted'), confirmed: sum('confirmed'), rejected: sum('rejected'), ambiguous: sum('ambiguous'), timedOut: sum('timedOut'), cancelled: sum('cancelled'), blocked: sum('blocked'), perMinute: +(sum('confirmed') / elapsed * 60).toFixed(1) },
    correctness: { matchedToOracle: matched, incorrectClicks, incorrectWagers, oracleActionsWithoutConfirmation: unmatchedOracle },
    deadlines: { missed: sum('deadlineMisses'), schedulerRejected: sched.metrics().rejected },
    latencyMs: { queueWait: sched.metrics().queueWaitMs, cursorTravel: mergeStats('cursor'), inputOperation: mergeStats('input'), endToEnd: mergeStats('e2e'), confirmation: mergeStats('confirm'), slackAtStart: sched.metrics().slackAtStartMs },
    errors: { driver: sum('driverErrors'), focus: sum('focusErrors'), recognitionRejectedFrames: sum('rejectedFrames'), loop: sum('errors'), pausedTables: perTable.filter((r) => r.paused).map((r) => ({ table: r.table, reason: r.paused })) },
    resources: { peakWorkingSetMiB: peak, cpuSecondsAllProcesses: +(cpu1 - cpu0).toFixed(2), cpuPercentOfOneCore: +(100 * (cpu1 - cpu0) / elapsed).toFixed(1), logicalCpus: os.cpus().length, samples: samples.slice(-3) },
    driver: drv && drv.stats, scheduler: sched.metrics(), perTable };
  res.reliable = res.actions.confirmed > 0 && res.actions.ambiguous === 0 && res.actions.timedOut === 0 && incorrectClicks === 0 && incorrectWagers === 0 && res.deadlines.missed === 0 && res.errors.driver === 0 && res.errors.focus === 0 && res.errors.pausedTables.length === 0;
  for (const t of tables) { await t.capture.close(); await session.request('unregister-target', { hwnd: t.win.hwnd }); }
  fs.writeFileSync(path.join(dir, 'diagnostics.json'), JSON.stringify(recorder.export()));
  await fx.stop(); await sleep(1500); return res;
}

async function main() {
  if (process.platform !== 'win32') { console.error('This benchmark drives real Windows windows; run it on Windows.'); process.exitCode = 2; return; }
  const env = { node: process.version, cpus: os.cpus().length, cpu: os.cpus()[0] && os.cpus()[0].model, ramGiB: +(os.totalmem() / 2 ** 30).toFixed(1) };
  const host = startHost(), info = await waitReady(host.ready), api = new SC.HostApi({ token: info.token, fetch, maxConcurrent: 6 }), session = SC.hostSession(api);
  const health = await api.request('/api/desktop/health'); env.host = { appVersion: health.appVersion, inputDriver: health.inputDriver };
  const st = await session.request('status'); env.driver = st && st.capabilities; const mon = await session.request('monitors'); env.monitors = mon.monitors;
  const runs = [];
  for (const n of COUNTS) { console.log('--- ' + n + ' table(s), ' + SECONDS + ' s'); let r; try { r = await runCount(n, api, session, host); } catch (e) { r = { tables: n, error: e.stack }; } runs.push(r); console.log(JSON.stringify({ tables: n, actions: r.actions, correctness: r.correctness, deadlines: r.deadlines && r.deadlines.missed, reliable: r.reliable, error: r.error && r.error.slice(0, 300) })); }
  const reliableCounts = runs.filter((r) => r.reliable).map((r) => r.tables), sustainable = COUNTS.filter((n) => runs.find((r) => r.tables === n && r.reliable)).reduce((a, n) => (COUNTS.slice(0, COUNTS.indexOf(n) + 1).every((m) => reliableCounts.includes(m)) ? n : a), 0);
  const doc = { format: 'eightmax-simulator-benchmark', version: 1, app: '0.35.0', at: new Date().toISOString(), environment: env, workload: { decisions: 'SCRIPTED test policy (labelled; measures control, not strategy)', turnDelayMs: TURN, decisionWindowMs: WINDOW, secondsPerCount: SECONDS, windowWidth: WIDTH, layout: 'cascade (overlapping windows; the driver brings each to the front before clicking)', capture: 'desktop host PrintWindow' },
    sustainableTables: sustainable, note: 'sustainable = the largest count for which this and every smaller count had zero ambiguous/timed-out actions, zero incorrect clicks or wagers, zero missed deadlines, zero driver/focus errors and no paused table', runs };
  try { await api.request('/api/input/stop', {}); } catch (e) { /* host may already stop */ }
  try { await fetch('http://127.0.0.1:48713/api/desktop/shutdown', { method: 'POST', headers: { 'X-EightMax-Session': info.token } }); } catch (e) { /* closing */ }
  await sleep(3000); try { host.child.kill(); } catch (e) { /* gone */ }
  fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(doc, null, 2)); console.log('sustainable tables: ' + sustainable + ' -> ' + OUT);
  process.exitCode = runs.every((r) => !r.error) ? 0 : 1;
}
main().catch((e) => { console.error(e.stack); process.exitCode = 1; });
