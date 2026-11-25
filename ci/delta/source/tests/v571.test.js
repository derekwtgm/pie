'use strict';
// EightMax 5.7.1 regression tests.
//   The physical Windows run of the 5.7 validation found two checks that did not test what they claimed:
//   "damaged manifest refused" changed white space only (the manifest checksum covers the canonical form of the
//   body, so that is not damage), and the memory check accepted a study that completed without ever reaching its
//   budget. 5.7.1 replaces both by mwcli --selftest571 and repairs one engine defect found on the way: after a
//   recovery from manifest.prev.json, the first commit copied the damaged manifest.json over the only intact manifest.
//   These tests cover
//     - the self-test itself: every check, its evidence fields, its exit status;
//     - the same behaviour reached independently from JavaScript (formatting, altered data, altered checksum,
//       damaged, truncated and missing files, previous-generation recovery, the kill during the first commit after
//       a recovery, the memory stop and its resume);
//     - failure reporting: the self-test reports failed or untested, never passed, when the engine cannot do its
//       work or when the workload does not reach the memory budget (the 5.7 false positive);
//     - the Windows validation script and its launchers, statically (no PowerShell is needed to run these tests).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto');
const build = require('./native_build');
const src = path.resolve(__dirname, '..'), root = path.resolve(src, '..'), studies = path.join(src, 'studies');
const cli = () => process.env.EM_TEST_MWCLI || build.cli().cli;
const tmp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'em571-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const run = (args, env = {}) => cp.spawnSync(cli(), args.map(String), { encoding: 'utf8', timeout: 1200000, maxBuffer: 256 << 20, env: { ...process.env, ...env } });
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const doc = f => JSON.parse(fs.readFileSync(f, 'utf8'));
// the measurements of a study: everything a resumed study must reproduce (timings and memory readings excluded)
const points = d => d.variants.flatMap(v => v.perSeed.flatMap(s => s.budgets.map(p => [v.name, s.seed, p.budgetDeals, p.status, p.deals, p.ev, p.frequency, p.quality])));
const AKQ = path.join(studies, 'known-akq-river.emfix.json'), DETAILED = path.join(studies, 'flop3-kings-detailed.emfix.json');
const OPT = ['seeds=2', 'budgets=20000,400000,6000000', 'threads=2', 'quiet=1', 'processingMode=cpu'];
const IDS = ['checkpoint P', 'checkpoint A', 'checkpoint B1', 'checkpoint B2', 'checkpoint C1', 'checkpoint C2', 'checkpoint D1', 'checkpoint D2', 'checkpoint E1', 'checkpoint E2', 'checkpoint F1', 'checkpoint F2', 'checkpoint F3', 'checkpoint S',
  'memory E', 'memory A', 'memory B', 'memory C', 'memory D1', 'memory D2', 'controls N1', 'controls N2', 'controls N3', 'controls N4'];

// One uninterrupted reference and one interrupted checkpoint, made once and copied by every test that damages one.
let shared = null;
function source(t) {
  if (shared) return shared;
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'em571s-')); process.on('exit', () => fs.rmSync(d, { recursive: true, force: true }));
  const ref = path.join(d, 'ref.json'), t0 = Date.now(); let r = run(['--study', AKQ, ref, ...OPT, 'checkpoint=off']); assert.equal(r.status, 0, r.stderr); const seconds = (Date.now() - t0) / 1000;
  const dir = path.join(d, 'ck'), out = path.join(d, 'stopped.json'); let made = null;
  for (const fraction of [0.35, 0.2, 0.1, 0.05]) {   // the stop must fall inside the study on a fast and on a slow machine
    fs.rmSync(dir, { recursive: true, force: true });
    r = run(['--study', AKQ, out, ...OPT, 'checkpoint=' + dir, 'timeLimitSeconds=' + Math.max(0.02, seconds * fraction).toFixed(3), 'checkpointSeconds=0.05']); assert.equal(r.status, 0, r.stderr);
    const x = doc(out); if (x.completion.complete || !fs.existsSync(path.join(dir, 'manifest.prev.json'))) continue;
    const m = doc(path.join(dir, 'manifest.json')), p = doc(path.join(dir, 'manifest.prev.json'));
    if (m.body.jobs.some(j => j.state) && m.body.sequence === p.body.sequence + 1 && x.completion.pointsCompleted >= 1) { made = { completed: x.completion.pointsCompleted, sequence: m.body.sequence, states: m.body.jobs.filter(j => j.state).map(j => j.state) }; break; }
  }
  assert.ok(made, 'an interrupted checkpoint with two manifest generations, a state and a completed measurement');
  return shared = { dir, want: points(doc(ref)), ...made };
}
const copyOf = (t, s) => { const d = path.join(tmp(t), 'ck'); fs.cpSync(s.dir, d, { recursive: true }); return d; };
const resume = (dir, env = {}) => { const out = dir + '.result.json'; fs.rmSync(out, { force: true }); const r = run(['--study', AKQ, out, ...OPT, 'checkpoint=' + dir, 'resume=1'], env); return { r, out, x: fs.existsSync(out) ? doc(out) : null }; };
const snapshot = dir => fs.readdirSync(dir).filter(n => n !== 'study.lock').sort().map(n => n + ':' + sha(path.join(dir, n))).join(';');

// ---------------------------------------------------------------- the self-test
test('5.7.1 mwcli --selftest571: every checkpoint, memory and control check passes, with its evidence, and the exit status is 0', { timeout: 1200000 }, t => {
  const d = tmp(t), r = run(['--selftest571', studies, d, 'all']); assert.equal(r.status, 0, r.stderr.slice(-4000));
  const x = doc(path.join(d, 'selftest571.json'));
  assert.equal(x.tool, 'mwcli selftest571'); assert.equal(x.failed, 0); assert.equal(x.untested, 0); assert.equal(x.passed, IDS.length);
  assert.deepEqual(x.checks.map(c => c.section + ' ' + c.id), IDS, 'the checks of the release, in order');
  for (const c of x.checks) { assert.equal(c.status, 'passed', c.id + ': ' + c.detail); assert.equal(c.passed, true); assert.equal(c.exercised, true, c.id + ' produced the condition it is about'); assert.ok(c.detail.length > 10); }
  const ck = Object.fromEntries(x.checks.filter(c => c.section === 'checkpoint').map(c => [c.id, c.evidence])), mem = Object.fromEntries(x.checks.filter(c => c.section === 'memory').map(c => [c.id, c.evidence]));
  // the fields the 5.7.1 acceptance criteria name, for every check that resumes a damaged copy
  for (const id of ['P', 'A', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2', 'E1', 'E2', 'F1', 'F2', 'F3']) for (const k of ['corruptionMethod', 'originalSha256', 'engineExitCode', 'errorClassification', 'fallbackGenerationUsed', 'recoveredStudyCompleted', 'finalStateEqualsReference', 'resultFileWritten'])
    assert.ok(k in ck[id], id + ' reports ' + k);
  for (const id of ['A', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2', 'E1', 'E2']) { assert.match(ck[id].modifiedSha256, /^[0-9a-f]{64}$/); assert.notEqual(ck[id].modifiedSha256, ck[id].originalSha256, id + ': the file really changed'); }
  assert.equal(ck.A.fallbackGenerationUsed, false); assert.equal(ck.A.onlyWhiteSpaceDiffers, true); assert.equal(ck.A.manifestUsed, 'manifest.json');
  for (const id of ['B1', 'C1', 'E1', 'E2', 'F2']) { assert.equal(ck[id].fallbackGenerationUsed, true, id); assert.equal(ck[id].manifestUsed, 'manifest.prev.json'); assert.equal(ck[id].finalStateEqualsReference, true); assert.ok(ck[id].manifestSequenceUsed >= 1, id + ' names the generation it used'); }
  for (const id of ['B2', 'C2']) { assert.equal(ck[id].engineExitCode, 5); assert.equal(ck[id].resultFileWritten, false); assert.equal(ck[id].recoveredStudyCompleted, false); assert.equal(ck[id].checkpointDirectoryUnchangedByTheRefusal, true); assert.match(ck[id].errorClassification, /refused/); }
  for (const id of ['D1', 'D2', 'F1']) { assert.equal(ck[id].fallbackGenerationUsed, false); assert.equal(ck[id].finalStateEqualsReference, true); assert.ok(ck[id].warnings.length >= 1); }
  assert.equal(ck.E2.killedProcessExitCode, 86); assert.equal(ck.E2.previousGenerationKeptIntact, true); assert.equal(ck.E2.previousManifestSha256Before, ck.E2.previousManifestSha256AfterTheKill);
  assert.equal(ck.F3.checkpointReportedAsResumed, false); assert.equal(ck.F3.pointsRestored, 0);
  assert.equal(ck.S.digestBefore, ck.S.digestAfter);
  // memory: the stop is real, and the control is a different observation
  assert.equal(mem.E.stoppedByProcessMemory, false); assert.equal(mem.E.studyCompleted, true);
  const a = mem.A; assert.equal(a.memoryLimitReached, true); assert.equal(a.stoppedByProcessMemory, true); assert.equal(a.studyCompleted, false); assert.equal(a.completionStatus, 'processMemoryLimit'); assert.equal(a.resumable, true);
  assert.ok(a.processPeakRssMiB > a.processMemoryBudgetMiB && a.processMemoryBudgetMiB === 48); assert.ok(a.pointsCompleted < a.pointsRequested); assert.equal(a.everyCheckpointStateMatchesItsSha256, true); assert.equal(a.trainingDoneBeforeTheStopIsSaved, true); assert.equal(a.checkpointSavedDeals, a.dealsTrainedWhenStopped); assert.ok(a.workloadTableMiBAtTheLastBudget >= 72, 'the workload is known to exceed the budget');
  assert.equal(mem.B.recoveredStudyCompleted, true); assert.equal(mem.B.finalStateEqualsReference, true); assert.equal(mem.B.savedEngineStateContinued, true); assert.equal(mem.B.pointsRestored, mem.B.measurementsSavedBeforeTheStop);
  assert.deepEqual(mem.C.notSatisfied, []); assert.ok(mem.C.overshootMiB > 0);
  assert.equal(mem.D2.recoveredStudyCompleted, true); assert.equal(mem.D2.finalStateEqualsReference, true);
  // every process is recorded with its command, exit status and output
  assert.ok(x.steps.length >= 24); for (const s of x.steps) for (const k of ['label', 'command', 'exitCode', 'timedOut', 'resultFileWritten', 'errorClassification', 'stdout', 'stderr']) assert.ok(k in s, k);
  for (const c of x.checks) for (const l of c.steps) assert.ok(x.steps.some(s => s.label === l), 'step ' + l + ' of check ' + c.id + ' is recorded');
  assert.deepEqual(fs.readdirSync(d).sort(), ['selftest571.json'], 'the work directory is left with the report only');
  assert.equal(JSON.parse(r.stdout).passed, IDS.length);
});
test('5.7.1 selftest571 modes and usage: checkpoint and memory run alone; a wrong mode or a missing fixture is refused', { timeout: 900000 }, t => {
  const d = tmp(t);
  let r = run(['--selftest571', studies, path.join(d, 'c'), 'checkpoint']); assert.equal(r.status, 0, r.stderr.slice(-2000)); let x = doc(path.join(d, 'c', 'selftest571.json'));
  assert.deepEqual(x.checks.map(c => c.section + ' ' + c.id), IDS.filter(i => i.startsWith('checkpoint') || ['controls N1', 'controls N2', 'controls N3'].includes(i)));
  r = run(['--selftest571', studies, path.join(d, 'm'), 'memory']); assert.equal(r.status, 0, r.stderr.slice(-2000)); x = doc(path.join(d, 'm', 'selftest571.json'));
  assert.deepEqual(x.checks.map(c => c.section + ' ' + c.id), IDS.filter(i => i.startsWith('memory') || i === 'controls N4'));
  assert.equal(run(['--selftest571', studies, path.join(d, 'x'), 'everything']).status, 2); assert.equal(run(['--selftest571', studies]).status, 2);
  r = run(['--selftest571', d, path.join(d, 'y')]); assert.equal(r.status, 2); assert.match(r.stderr, /study fixture/); assert.ok(!fs.existsSync(path.join(d, 'y', 'selftest571.json')));
});

// ---------------------------------------------------------------- failure reporting (negative controls of the self-test)
test('5.7.1 failure reporting: when every save fails the self-test reports failed and untested checks, none passed, and exits with 1', { timeout: 900000 }, t => {
  // EM_TEST_SAVE_FAULT=create makes every transactional save fail: no result file, no checkpoint. Nothing can be
  // verified, so nothing may be reported as passed.
  const d = tmp(t), r = run(['--selftest571', studies, d, 'all'], { EM_TEST_SAVE_FAULT: 'create' }); assert.equal(r.status, 1, 'exit status 1');
  const x = doc(path.join(d, 'selftest571.json')); assert.equal(x.passed, 0, 'no check passes when the engine cannot write anything'); assert.ok(x.untested >= 18 && x.failed >= 1); assert.equal(x.passed + x.failed + x.untested, x.checks.length);
  for (const c of x.checks) { assert.notEqual(c.status, 'passed', c.id); assert.equal(c.passed, false); if (c.status === 'untested') assert.match(c.detail, /did not complete|was not produced|could not/); }
  assert.match(x.checks.find(c => c.id === 'E' && c.section === 'memory').detail, /exit 4|error/); assert.ok(x.steps.some(s => s.exitCode === 4 && /cannot write/.test(s.stderr)), 'the failing process is recorded with its exit status and standard error');
  assert.equal(JSON.parse(r.stdout).failed + JSON.parse(r.stdout).untested, x.checks.length);
});
test('5.7.1 failure reporting: a workload that never reaches the memory budget is not a pass (the 5.7 false positive)', { timeout: 900000 }, t => {
  // The 5.7 script used flop3-kings-small, which needs about 8 MiB, and accepted its normal completion. Given that
  // fixture in place of the large one, the self-test must refuse to call the memory stop tested.
  const d = tmp(t), fake = path.join(d, 'studies'); fs.mkdirSync(fake); fs.copyFileSync(AKQ, path.join(fake, 'known-akq-river.emfix.json')); fs.copyFileSync(path.join(studies, 'flop3-kings-small.emfix.json'), path.join(fake, 'flop3-kings-detailed.emfix.json'));
  const r = run(['--selftest571', fake, path.join(d, 'w'), 'memory']); assert.equal(r.status, 1, r.stderr.slice(-2000));
  const x = doc(path.join(d, 'w', 'selftest571.json')), by = Object.fromEntries(x.checks.map(c => [c.id, c]));
  assert.equal(by.E.status, 'passed', 'the control (a normal completion) is a separate, passing observation');
  for (const id of ['A', 'B', 'C', 'D1', 'D2']) { assert.equal(by[id].status, 'untested', id); assert.equal(by[id].exercised, false); assert.match(by[id].detail, /no longer grows past the budget/); }
  assert.equal(by.N4.status, 'passed', 'and the completed control is rejected by the memory-stop verdict');
  // the same small fixture given the 5.7 script's budget directly: the engine completes, flags nothing, and that is what 5.7 accepted
  const o = path.join(d, 'small.json'); const s = run(['--study', path.join(studies, 'flop3-kings-small.emfix.json'), o, 'seeds=2', 'budgets=20000,200000', 'threads=2', 'quiet=1', 'processingMode=cpu', 'checkpoint=' + path.join(d, 'cs'), 'processMemoryMiB=24']);
  if (s.status === 0 && doc(o).completion.complete) assert.equal(doc(o).run.stoppedByProcessMemory, false, 'a completed study never reports a memory stop');
});

// ---------------------------------------------------------------- the same behaviour, reached from JavaScript
test('5.7.1 formatting is not corruption: white space, and a re-serialisation by another JSON library, resume from manifest.json with the same result', { timeout: 600000 }, t => {
  const s = source(t);
  for (const [name, rewrite] of [['indented', text => JSON.stringify(JSON.parse(text), null, 2)], ['spaces after colons', text => text.replace(/"resumeCount":/, '"resumeCount" :   ')]]) {
    const dir = copyOf(t, s), before = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'), after = rewrite(before); assert.notEqual(after, before, name); assert.deepEqual(JSON.parse(after), JSON.parse(before), 'no value changed');
    fs.writeFileSync(path.join(dir, 'manifest.json'), after);
    const { r, x } = resume(dir); assert.equal(r.status, 0, name + ': ' + r.stderr); assert.equal(x.run.checkpoint.resumedFrom, 'manifest.json', name + ': the newest manifest is used, there is no fall-back'); assert.equal(x.run.checkpoint.resumeNote, ''); assert.deepEqual(x.run.checkpoint.warnings, []);
    assert.equal(x.run.checkpoint.pointsRestored, s.completed); assert.equal(x.completion.complete, true); assert.deepEqual(points(x), s.want, name + ': identical measurements');
  }
});
test('5.7.1 altered data and altered checksums are detected: one damaged manifest falls back to the verified previous one, two are refused and nothing is touched', { timeout: 600000 }, t => {
  const s = source(t), text = fs.readFileSync(path.join(s.dir, 'manifest.json'), 'utf8'), prev = fs.readFileSync(path.join(s.dir, 'manifest.prev.json'), 'utf8');
  const edits = {
    'a recorded frequency': x => x.replace(/"frequency":\[0\.(\d)/, (m, d) => '"frequency":[0.' + (d === '9' ? '8' : String(+d + 1))),
    'the deal count of a saved state': x => x.replace(/"deals":(\d)/, (m, d) => '"deals":' + (d === '9' ? '8' : String(+d + 1))),
    'the stored checksum': x => x.replace(/"bodySha256":"(.)/, (m, d) => '"bodySha256":"' + (d === '0' ? '1' : '0')),
    'a state checksum inside the body': x => x.replace(/"sha256":"(.)/, (m, d) => '"sha256":"' + (d === '0' ? '1' : '0')),
  };
  for (const [name, edit] of Object.entries(edits)) {
    assert.notEqual(edit(text), text, name + ' changes the manifest');
    let dir = copyOf(t, s); fs.writeFileSync(path.join(dir, 'manifest.json'), edit(text));
    let { r, x } = resume(dir); assert.equal(r.status, 0, name + ': ' + r.stderr); assert.equal(x.run.checkpoint.resumedFrom, 'manifest.prev.json', name); assert.match(x.run.checkpoint.resumeNote, /does not match its SHA-256.*previous committed manifest/); assert.equal(x.completion.complete, true); assert.deepEqual(points(x), s.want, name);
    dir = copyOf(t, s); fs.writeFileSync(path.join(dir, 'manifest.json'), edit(text)); fs.writeFileSync(path.join(dir, 'manifest.prev.json'), edit(prev)); const before = snapshot(dir);
    ({ r, x } = resume(dir)); assert.equal(r.status, 5, name + ': both manifests damaged'); assert.match(r.stderr, /no usable manifest/); assert.match(r.stderr, /SHA-256/); assert.equal(x, null, 'no result is written'); assert.equal(snapshot(dir), before, 'the refused directory is unchanged');
  }
  assert.equal(snapshot(s.dir).length > 0, true);
});
test('5.7.1 damaged, truncated and missing files: a state is discarded by its checksum, a missing manifest falls back, and the result never changes', { timeout: 600000 }, t => {
  const s = source(t), st = s.states[0];
  for (const [name, damage] of [['flipped byte', b => { b[b.length >> 1] ^= 0x40; return b; }], ['truncated', b => b.subarray(0, b.length >> 1)], ['emptied', () => Buffer.alloc(0)]]) {
    const dir = copyOf(t, s), f = path.join(dir, st.file); assert.equal(sha(f), st.sha256, 'the copy starts intact'); fs.writeFileSync(f, damage(Buffer.from(fs.readFileSync(f))));
    const { r, x } = resume(dir); assert.equal(r.status, 0, name + ': ' + r.stderr); assert.equal(x.run.checkpoint.resumedFrom, 'manifest.json');
    assert.ok(x.run.checkpoint.warnings.some(w => w.includes(st.file) && /does not match its recorded SHA-256 or length|missing or unreadable/.test(w)), name + ': ' + JSON.stringify(x.run.checkpoint.warnings));
    assert.equal(x.run.checkpoint.pointsRestored, s.completed, 'recorded measurements are kept'); assert.deepEqual(points(x), s.want, name);
  }
  let dir = copyOf(t, s); for (const x of s.states) fs.rmSync(path.join(dir, x.file));
  let { r, x } = resume(dir); assert.equal(r.status, 0, r.stderr); assert.equal(x.run.checkpoint.warnings.filter(w => /missing or unreadable/.test(w)).length, s.states.length); assert.deepEqual(points(x), s.want);
  dir = copyOf(t, s); fs.rmSync(path.join(dir, 'manifest.json')); ({ r, x } = resume(dir)); assert.equal(r.status, 0, r.stderr); assert.equal(x.run.checkpoint.resumedFrom, 'manifest.prev.json'); assert.match(x.run.checkpoint.resumeNote, /absent or empty/); assert.deepEqual(points(x), s.want);
  dir = copyOf(t, s); fs.rmSync(path.join(dir, 'manifest.json')); fs.rmSync(path.join(dir, 'manifest.prev.json')); ({ r, x } = resume(dir)); assert.equal(r.status, 0, r.stderr);
  assert.equal(x.run.checkpoint.resumed, false, 'a directory without a manifest is not a checkpoint'); assert.equal(x.run.checkpoint.pointsRestored, 0); assert.deepEqual(x.run.checkpoint.warnings, []); assert.deepEqual(points(x), s.want);
});
test('5.7.1 engine repair: a kill during the first commit after a recovery from the previous manifest leaves that manifest intact, and the study still resumes', { timeout: 600000 }, t => {
  const s = source(t), dir = copyOf(t, s), man = path.join(dir, 'manifest.json'), prev = path.join(dir, 'manifest.prev.json'), prevSha = sha(prev);
  fs.writeFileSync(man, fs.readFileSync(man, 'utf8').replace(/"sequence":(\d)/, (m, d) => '"sequence":' + (d === '9' ? '8' : String(+d + 1))));   // manifest.json no longer verifies
  const damaged = sha(man);
  // the resuming process recovers from manifest.prev.json and is ended at the moment it would replace manifest.json
  let { r, x } = resume(dir, { EM_TEST_SAVE_FAULT: 'crash', EM_TEST_SAVE_FAULT_FILE: 'manifest.json' }); assert.equal(r.status, 86, 'the injected kill'); assert.equal(x, null);
  assert.equal(sha(prev), prevSha, 'the intact previous manifest was not replaced by the damaged one (5.5 to 5.7 replaced it here)'); assert.equal(sha(man), damaged, 'manifest.json is still the damaged file');
  ({ r, x } = resume(dir)); assert.equal(r.status, 0, r.stderr); assert.equal(x.run.checkpoint.resumedFrom, 'manifest.prev.json'); assert.equal(x.completion.complete, true); assert.deepEqual(points(x), s.want);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['manifest.json', 'manifest.prev.json'], 'the killed writer\'s temporary file is swept');
  // a failed (not killed) first commit: the same guarantee, and the error is reported
  const dir2 = copyOf(t, s); fs.writeFileSync(path.join(dir2, 'manifest.json'), 'not a manifest'); const prev2 = sha(path.join(dir2, 'manifest.prev.json'));
  ({ r } = resume(dir2, { EM_TEST_SAVE_FAULT: 'rename', EM_TEST_SAVE_FAULT_FILE: 'manifest.json' })); assert.notEqual(r.status, 0); assert.match(r.stderr, /cannot write/); assert.equal(sha(path.join(dir2, 'manifest.prev.json')), prev2);
  ({ r, x } = resume(dir2)); assert.equal(r.status, 0, r.stderr); assert.deepEqual(points(x), s.want);
  // in normal operation the previous manifest is still the commit before the newest one
  const dir3 = copyOf(t, s); ({ r, x } = resume(dir3)); assert.equal(r.status, 0); const a = doc(path.join(dir3, 'manifest.json')), b = doc(path.join(dir3, 'manifest.prev.json')); assert.equal(a.body.sequence, b.body.sequence + 1); assert.equal(a.body.status, 'complete');
});
test('5.7.1 EM_TEST_SAVE_FAULT_FILE limits the injected fault to one destination and changes nothing when it is not set', { timeout: 300000 }, t => {
  const d = tmp(t), o = path.join(d, 'o.json'), small = ['seeds=1', 'budgets=2000', 'threads=1', 'quiet=1', 'processingMode=cpu'];
  let r = run(['--study', AKQ, o, ...small, 'checkpoint=' + path.join(d, 'a')], { EM_TEST_SAVE_FAULT: 'create', EM_TEST_SAVE_FAULT_FILE: 'no-such-file.json' }); assert.equal(r.status, 0, 'a fault limited to a file that is never written does nothing: ' + r.stderr); assert.equal(doc(o).completion.complete, true); assert.deepEqual(doc(o).run.checkpoint.warnings, []);
  r = run(['--study', AKQ, o, ...small, 'checkpoint=' + path.join(d, 'b')], { EM_TEST_SAVE_FAULT: 'create', EM_TEST_SAVE_FAULT_FILE: '.state' }); assert.equal(r.status, 0, r.stderr); assert.ok(doc(o).run.checkpoint.warnings.some(w => /checkpoint not written.*injected-create/.test(w)), 'only the state files fail; the manifest and the result are written');
  fs.rmSync(o); r = run(['--study', AKQ, o, ...small, 'checkpoint=off'], { EM_TEST_SAVE_FAULT: 'create' }); assert.equal(r.status, 4, 'without the file filter every save fails, as before 5.7.1'); assert.ok(!fs.existsSync(o));
});
test('5.7.1 process memory budget: a budget the workload exceeds stops the study, the checkpoint verifies, the resume completes with the measurements of an uninterrupted run', { timeout: 900000 }, t => {
  const d = tmp(t), opt = ['seeds=2', 'budgets=2000,60000', 'threads=2', 'quiet=1', 'processingMode=cpu', 'evaluationSamples=2000'], ref = path.join(d, 'ref.json'), o = path.join(d, 'o.json'), dir = path.join(d, 'ck');
  let r = run(['--study', DETAILED, ref, ...opt, 'checkpoint=off']); assert.equal(r.status, 0, r.stderr); const control = doc(ref);
  assert.equal(control.completion.complete, true); assert.equal(control.run.stoppedByProcessMemory, false, 'the control completes and reports no memory stop'); assert.equal(control.run.processMemoryBudgetAutomatic, true);
  const table = control.variants[0].perSeed[0].budgets.at(-1).tableMiB; assert.ok(table >= 72, 'one seed\'s tables (' + table + ' MiB) are at least 1.5 times the 48 MiB budget');
  r = run(['--study', DETAILED, o, ...opt, 'checkpoint=' + dir, 'processMemoryMiB=48']); assert.equal(r.status, 0, r.stderr); const x = doc(o);
  assert.equal(x.run.stoppedByProcessMemory, true, 'the limit was reached'); assert.equal(x.completion.complete, false); assert.equal(x.completion.status, 'processMemoryLimit'); assert.equal(x.completion.resumable, true); assert.ok(x.completion.pointsCompleted < x.completion.pointsRequested);
  assert.equal(x.run.processMemoryBudgetMiB, 48); assert.equal(x.run.processMemoryBudgetAutomatic, false); assert.ok(x.run.processPeakRssMiB > 48, 'the peak resident set (' + x.run.processPeakRssMiB + ' MiB) is above the budget'); assert.ok(x.run.processPeakRssMiB < 48 + table / 2, 'and the stop followed closely'); assert.equal(x.run.parallelSeeds, 1);
  const stoppedPoint = x.variants[0].perSeed.flatMap(s => s.budgets).find(p => p.status === 'processMemoryLimit'); if (stoppedPoint) { assert.ok(stoppedPoint.deals < stoppedPoint.budgetDeals); assert.match(stoppedPoint.stopReason, /process memory budget/); }
  const m = doc(path.join(dir, 'manifest.json')); assert.equal(m.body.status, 'processMemoryLimit'); assert.ok(m.body.jobs.some(j => j.state));
  for (const j of m.body.jobs) { for (const p of j.points) assert.equal(p.complete, true, 'only completed measurements are committed'); if (j.state) { assert.equal(sha(path.join(dir, j.state.file)), j.state.sha256); assert.equal(fs.statSync(path.join(dir, j.state.file)).size, j.state.bytes); } }
  assert.equal(m.body.jobs.reduce((n, j) => n + j.points.length, 0), x.completion.pointsCompleted);
  r = run(['--study', DETAILED, o, ...opt, 'checkpoint=' + dir, 'resume=1']); assert.equal(r.status, 0, r.stderr); const y = doc(o);
  assert.equal(y.completion.complete, true); assert.equal(y.run.stoppedByProcessMemory, false); assert.equal(y.run.checkpoint.pointsRestored, x.completion.pointsCompleted); assert.deepEqual(y.run.checkpoint.warnings, [], 'the saved engine state was continued, not retrained'); assert.deepEqual(points(y), points(control));
  for (const bad of ['-1', 'nan', 'inf', 'abc']) { const dd = path.join(d, 'bad'); r = run(['--study', DETAILED, path.join(d, 'bad.json'), ...opt, 'checkpoint=' + dd, 'processMemoryMiB=' + bad]); assert.ok(r.status === 1 || r.status === 2, bad); assert.match(r.stderr, /processMemoryMiB/); assert.ok(!fs.existsSync(path.join(d, 'bad.json')) && !fs.existsSync(dd), bad + ': nothing written'); }
});

// ---------------------------------------------------------------- the Windows validation script and its launchers (static)
const ps1 = path.join(src, 'tools', 'validate_windows571.ps1'), python = process.platform === 'win32' ? 'python' : 'python3';
const noPython = cp.spawnSync(python, ['--version']).status === 0 ? false : 'Python 3 is not available';
test('5.7.1 validate_windows571.ps1: static checks pass, and the checker finds seeded mistakes', { skip: noPython }, t => {
  const lint = f => cp.spawnSync(python, ['-I', path.join(src, 'tools', 'ps_lint571.py'), '--json', f], { encoding: 'utf8' });
  let r = lint(ps1); assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(JSON.parse(r.stdout).findings, 0);
  for (const f of ['validate_windows57.ps1', 'validate_hardware.ps1']) assert.equal(lint(path.join(src, 'tools', f)).status, 0, f + ' (a script that ran on Windows) has no finding');
  const text = fs.readFileSync(ps1, 'utf8'), d = tmp(t);
  const seeded = { 'a misspelt variable': text.replace('$missing.Count -eq 0', '$mising.Count -eq 0'), 'an undefined function': text.replace("Run-Evidence $r 'mwcli --selftest571'", "Run-Evidense $r 'mwcli --selftest571'"), 'a missing brace': text.replace("$report.selftest571 = $doc\n", "$report.selftest571 = $doc }\n"),
    'a PowerShell 7 operator': text.replace("$missingText = 'none'", "$missingText = $null ?? 'none'"), 'an unterminated string': text.replace("'verdict controls' }", "'verdict controls }") };
  for (const [name, bad] of Object.entries(seeded)) { assert.notEqual(bad, text, name + ' was seeded'); const f = path.join(d, 'seeded.ps1'); fs.writeFileSync(f, bad); r = lint(f); assert.equal(r.status, 1, name + ' is found'); assert.ok(JSON.parse(r.stdout).findings >= 1); }
});
test('5.7.1 validate_windows571.ps1: the defective 5.7 checks are gone, the self-test is imported check by check, failures and missing checks cannot pass', () => {
  const text = fs.readFileSync(ps1, 'utf8'), code = text.split('\n').filter(l => !l.trim().startsWith('#')).join('\n');
  assert.ok(!/resumeCount/.test(code), 'no white-space "damage"'); assert.ok(!/processMemoryMiB=24/.test(code), 'no 24 MiB budget on a fixture that needs 8 MiB'); assert.ok(!/\$stopped -or \(Study-Complete/.test(code), 'normal completion is not accepted as a memory stop');
  assert.match(code, /\$Release = '5\.7\.1'/); assert.match(code, /\[switch\]\$Focused/); assert.match(code, /'--selftest571', \$studies, \$dir, 'all'/);
  // the list of expected checks is the list the program reports
  const expected = /\$expected = @\(([^)]*)\)/.exec(code)[1].split(',').map(x => x.trim().replace(/^'|'$/g, '')); assert.deepEqual(expected, IDS);
  assert.match(code, /if \(@\('passed', 'failed', 'untested'\) -notcontains \$status\) \{ \$status = 'failed' \}/, 'an unknown status counts as failed');
  assert.match(code, /Add-Check 'self-test 5\.7\.1' \('expected check ' \+ \$m\) 'untested'/); assert.match(code, /if \(-not \$ran\) \{ return \}/);
  // every planned check is recorded somewhere, and gate failures decide the exit status
  for (const m of code.matchAll(/^Plan '(recovery|self-test 5\.7\.1)' '([^']+)'/gm)) assert.ok(code.includes("'" + m[1] + "' '" + m[2] + "'", code.indexOf('$exitCode = 2')), 'planned check "' + m[2] + '" is recorded');
  assert.equal([...code.matchAll(/^Plan '(recovery|self-test 5\.7\.1)'/gm)].length, 7);
  assert.match(code, /if \(-not \$report\.scriptCompleted\) \{ \$exitCode = 2 \} elseif \(\$gateBad\.Count\) \{ \$exitCode = 1 \} else \{ \$exitCode = 0 \}\s*exit \$exitCode/);
  assert.match(code, /\$gateBad = @\(\$records \| Where-Object \{ \$_\.class -eq 'gate' -and \(\$_\.status -eq 'failed' -or \$_\.status -eq 'untested'\) \}\)/);
  // focused mode: only the three sections, and its own report names
  assert.match(code, /\$focusSections = @\('environment', 'integrity', 'self-test 5\.7\.1'\)/); assert.match(code, /if \(\$Focused\) \{ \$reportName = 'Windows-focused-validation-' \}/);
  // evidence: exit status, standard output and standard error of failed checks
  assert.match(code, /exitCode = \$r\.exit; timedOut = \[bool\]\$r\.timedOut; seconds = \$r\.seconds; standardOutput = \(Clip \(\[string\]\$r\.out\)\); standardError = \(Clip \(\[string\]\$r\.err\)\)/);
  // everything but the named repairs is the script that ran on Windows: sections 3 to 7 and 10 to 13 are identical to 5.7
  const old = fs.readFileSync(path.join(src, 'tools', 'validate_windows57.ps1'), 'utf8'); const section = (s, a, b) => s.slice(s.indexOf("Run-Section '" + a + "'"), s.indexOf("Run-Section '" + b + "'"));
  assert.equal(section(text, 'self-test 5.7', 'recovery'), section(old, 'self-test 5.7', 'recovery'), 'self-test 5.7, golden states, threads, evaluator, study');
  assert.equal(text.slice(text.indexOf("Run-Section 'configuration'"), text.indexOf('$report.scriptCompleted = $true')), old.slice(old.indexOf("Run-Section 'configuration'"), old.indexOf('$report.scriptCompleted = $true')), 'configuration, throughput, desktop host, GPU');
  assert.ok(![...text].some(c => c.charCodeAt(0) > 126 || c === '\r'), 'plain ASCII with LF line ends, as the 5.7 script');
});
test('5.7.1 launchers: the focused and the full validation batch files run the self-test first, then the script, and return a non-zero status on failure', () => {
  for (const [name, flag, reports] of [['Run 5.7.1 focused validation.bat', ' -Focused %*', ['Windows-selftest571-5.7.1.json', 'Windows-focused-validation-5.7.1.json', 'Windows-focused-validation-5.7.1.txt']],
    ['Run 5.7.1 Windows validation.bat', ' %*', ['Windows-selftest-5.7.1.json', 'Windows-selftest571-5.7.1.json', 'Windows-validation-5.7.1.json', 'Windows-validation-5.7.1.txt']]]) {
    const f = path.join(root, name); if (!fs.existsSync(f)) { assert.ok(!fs.existsSync(path.join(root, 'SHA256SUMS.txt')), name + ' must be in a release folder'); continue; }   // a bare source tree has no launchers
    const raw = fs.readFileSync(f, 'latin1'); assert.ok(!/[^\r]\n/.test(raw) && raw.includes('\r\n'), name + ': CRLF line ends'); assert.ok(![...raw].some(c => c.charCodeAt(0) > 126), 'ASCII');
    const b = raw.replace(/\r/g, ''); assert.match(b, /^@echo off\nsetlocal\ncd \/d "%~dp0"\n/);
    assert.ok(b.includes('mwcli.exe --selftest571 "studies" "%em_st') && b.includes('all\n'), 'the self-test runs without PowerShell');
    assert.ok(b.includes('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "source\\tools\\validate_windows571.ps1"' + flag + '\n'), name + ': the script call');
    assert.ok(b.indexOf('--selftest571') < b.indexOf('powershell.exe'), 'self-test first'); for (const rname of reports) assert.ok(b.includes(rname), name + ' names ' + rname);
    assert.match(b, /if not "%selftest(571)?_result%"=="0" if "%eightmax_result%"=="0" set "eightmax_result=1"/); assert.match(b, /exit \/b %eightmax_result%\n$/); assert.ok(b.includes('if not defined EIGHTMAX_NO_PAUSE pause'));
    assert.ok(fs.existsSync(path.join(root, 'studies', 'flop3-kings-detailed.emfix.json')) && fs.existsSync(path.join(root, 'source', 'tools', 'validate_windows571.ps1')));
  }
});
// The archived 5.7 Linux binary (validation/5.7/linux-bin/mwcli), as v57.test.js uses the archived 5.6 one.
const old57 = path.resolve(root, 'validation/5.7/linux-bin/mwcli');
const oldSkip = process.platform !== 'linux' || process.arch !== 'x64' ? 'the archived 5.7 binary is a Linux x86-64 program' : !fs.existsSync(old57) ? 'validation/5.7/linux-bin/mwcli is not present' : false;
test('5.7.1 against the unchanged 5.7 binary: studies give the same measurements; a 5.7 study checkpoint is refused with the reason and left untouched', { skip: oldSkip, timeout: 900000 }, t => {
  // 5.8: this comparison holds for 5.7.1 and every later release that leaves training and evaluation unchanged; the line used to
  // require the version to BE 5.7.1, which made the test fail for the next release without anything being wrong.
  { const v = fs.readFileSync(path.join(src, 'VERSION'), 'utf8').trim().split('.').map(Number); assert.ok(v[0] > 5 || (v[0] === 5 && (v[1] > 7 || (v[1] === 7 && (v[2] || 0) >= 1))), 'release 5.7.1 or later'); }
  const d = tmp(t), exe = path.join(d, 'mwcli57'); fs.copyFileSync(old57, exe); fs.chmodSync(exe, 0o755);
  const old = args => cp.spawnSync(exe, args.map(String), { encoding: 'utf8', timeout: 900000, maxBuffer: 256 << 20 });
  assert.equal(old(['--build-id']).stdout.trim(), 'EightMaxBuild=e4668abe7903f8b0');
  // the same studies, complete, by both binaries: nothing mathematical changed in 5.7.1
  for (const [name, fixture, opt] of [['known game', AKQ, ['seeds=3', 'budgets=1000,100000', 'threads=2', 'quiet=1', 'processingMode=cpu', 'checkpoint=off']],
    ['three-way flop, exact evaluation', path.join(studies, 'flop3-kings-small.emfix.json'), ['seeds=2', 'budgets=2000,20000', 'threads=2', 'quiet=1', 'processingMode=cpu', 'checkpoint=off']],
    ['eight-handed ICM, exact evaluation', path.join(studies, 'icm8-bb-call-small.emfix.json'), ['seeds=2', 'budgets=2000,8000', 'threads=2', 'quiet=1', 'processingMode=cpu', 'checkpoint=off']],
    ['three-way flop, sampled evaluation', DETAILED, ['seeds=1', 'budgets=2000,12000', 'threads=2', 'quiet=1', 'processingMode=cpu', 'evaluationSamples=2000', 'checkpoint=off']]]) {
    const a = path.join(d, 'a.json'), b = path.join(d, 'b.json'); let r = old(['--study', fixture, a, ...opt]); assert.equal(r.status, 0, name + ' (5.7): ' + r.stderr); r = run(['--study', fixture, b, ...opt, 'trainingStreams=5.10']); assert.equal(r.status, 0, name + ': ' + r.stderr);   // 5.11: the 5.7 program trains with the 32-bit streams; this build is asked for them by name
   
    const x = doc(a), y = doc(b); assert.equal(x.version, '5.7'); if (process.env.EM_TEST_MWCLI) assert.equal(y.version, fs.readFileSync(path.join(src, 'VERSION'), 'utf8').trim());   // 5.8: was the literal '5.7.1' assert.equal(y.completion.complete, true); assert.deepEqual(points(y), points(x), name + ': identical measurements');
    assert.equal(y.calculationVersion, x.calculationVersion); assert.equal(y.replicationCalculation, x.replicationCalculation);
  }
  // a study checkpoint written by 5.7 is tied to its build: 5.7.1 refuses it, says why, and changes nothing
  const dir = path.join(d, 'ck57'), o = path.join(d, 'o.json'); let r = old(['--study', AKQ, o, ...OPT, 'checkpoint=' + dir, 'timeLimitSeconds=0.3', 'checkpointSeconds=0.05']); assert.equal(r.status, 0, r.stderr);
  const before = snapshot(dir); fs.rmSync(o, { force: true });
  r = run(['--study', AKQ, o, ...OPT, 'checkpoint=' + dir, 'resume=1']); assert.equal(r.status, 5, r.stderr); assert.match(r.stderr, /resume refused: the checkpoint was written by build e4668abe7903f8b0; this is build/); assert.ok(!fs.existsSync(o)); assert.equal(snapshot(dir), before, 'the 5.7 checkpoint is untouched');
  r = old(['--study', AKQ, o, ...OPT, 'checkpoint=' + dir, 'resume=1']); assert.equal(r.status, 0, 'and 5.7 itself still resumes it: ' + r.stderr); assert.equal(doc(o).completion.complete, true);
});
