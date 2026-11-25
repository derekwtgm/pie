// EightMax 5.9: what the DESKTOP HOST leaves behind when a study is refused.
//   node source/tools/host_refusal59.js <host executable> <release root> <out.json>
// Through 5.8 a refused study left <Documents>/EightMax/studies/<id>/ behind, holding only request.json and not listed
// anywhere (FINAL-REPORT-5.8.md, section 12). 5.9 removes what the refused request created and nothing else
// (native/study_jobs.h). Each check starts the host with a private save folder and looks at the folder afterwards.
//
//   A  a budget above the update limit: refused in under a second, the message unchanged, no folder left
//   B  an invalid configuration (an unknown variant, seeds that are not numbers, a budget of zero): refused, no folder left
//   C  a folder that existed before, with a file of the user's in it: the folder and the file stay, byte for byte;
//      the request the host wrote into it is removed
//   D  a folder that existed before and holds only an old request.json (what 5.8 left behind): untouched
//   E  an existing checkpoint with that id: the request is refused (409) and no file of the checkpoint changes
//   F  eight over-limit requests at once: each is refused or turned away because one is running; nothing is left
//   G  a valid study running while refused requests arrive: its folder is not touched and it completes
//   H  a removal that fails (simulated): the refusal message is unchanged, the failure is reported, the files stay
//   I  an ordinary study started after all this completes, is listed, and can be discarded
// Exports run(exe, releaseRoot) -> {checks:[{name, passed, detail}], ...} for tests/v59.test.js.
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net'), cp = require('node:child_process'), crypto = require('node:crypto');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function freePort() { return new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); }); }
async function startHost(exe, env = {}) {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'em59-refusal-')), port = await freePort();
  const proc = cp.spawn(exe, ['--no-browser', '--port=' + port], { env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir, EIGHTMAX_GPU: 'off', ...env }, stdio: 'ignore' });
  const url = 'http://127.0.0.1:' + port, raw = (p, body) => fetch(url + '/api/' + p, body === undefined ? {} : { method: 'POST', headers: { 'X-EightMax': '1' }, body: JSON.stringify(body) }), api = async (p, body) => (await raw(p, body)).json();
  let info = null; for (let i = 0; i < 600 && !info; i++) { try { info = await api('info'); } catch { await sleep(50); } }
  if (!info) { proc.kill('SIGKILL'); throw new Error('the host did not answer'); }
  // The study folder is where the HOST says it is (Linux: <home>/EightMax/studies; Windows: <profile>\Documents\EightMax\studies).
  // Under Wine the host answers with a Windows path of the Z: drive, which is the Unix root.
  const reported = (await api('study/checkpoints')).directory;
  let root = process.platform !== 'win32' && /^[A-Za-z]:\\/.test(reported) ? reported.slice(2).replace(/\\/g, '/') : reported;
  // These checks create and remove study folders, so they run only in a folder that is theirs: inside the private home
  // given to the host. Where the host ignores that home (Wine sets USERPROFILE itself), the caller must name the
  // host's study folder on this system in EM_TEST_HOST_STUDIES_ROOT, and it must be empty: a disposable Wine prefix.
  const isPrivate = path.resolve(root).startsWith(path.resolve(homeDir) + path.sep);
  if (!isPrivate) {
    const given = process.env.EM_TEST_HOST_STUDIES_ROOT;
    const refuse = why => { try { proc.kill('SIGKILL'); } catch { } try { fs.rmSync(homeDir, { recursive: true, force: true }); } catch { } throw new Error(why); };
    if (!given) refuse('the host does not use the private home folder (it reports ' + reported + '); set EM_TEST_HOST_STUDIES_ROOT to that folder on this system if it is disposable');
    if (fs.existsSync(given) && fs.readdirSync(given).length) refuse('EM_TEST_HOST_STUDIES_ROOT is not empty: ' + given);
    root = given;
  }
  const wait = async () => { for (;;) { const s = await api('study/status'); if (!s.running) return s; await sleep(15); } };
  const tree = () => fs.existsSync(root) ? fs.readdirSync(root).sort().map(d => ({ folder: d, files: fs.readdirSync(path.join(root, d)).sort() })) : [];
  const stop = () => { try { proc.kill('SIGKILL'); } catch { } try { fs.rmSync(homeDir, { recursive: true, force: true }); } catch { } };
  return { info, raw, api, root, reported, isPrivate, wait, tree, stop, homeDir };
}
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const hashes = dir => Object.fromEntries(fs.readdirSync(dir).sort().map(f => [f, sha(path.join(dir, f))]));
async function run(exe, rel) {
  const fx = JSON.parse(fs.readFileSync(path.join(rel, 'studies', 'flop6-jack-small.emfix.json'), 'utf8'));
  const over = { variants: 'baseline', seeds: [1, 2], budgets: [1000, 20000000], threads: 2, trainingStreams: '5.10' },   // 5.11: the limit of the 5.10 streams, selected by name
  small = { variants: 'baseline', seeds: [1, 2], budgets: [1000, 4000], threads: 2, evaluationSamples: 256, qualitySamples: 64 };
  const out = { tool: 'host_refusal59', checks: [] }, check = (name, passed, detail) => { out.checks.push({ name, passed: !!passed, detail }); };
  let H = await startHost(exe); out.build = H.info.build; out.version = H.info.version; out.studyFolderReportedByTheHost = H.reported; out.studyFolderInsideThePrivateHome = H.isPrivate;
  try {
    { // A
      const t = Date.now(), r = await H.raw('study/start', { fixture: fx, options: over }), start = await r.json(), s = await H.wait(), ms = Date.now() - t, left = H.tree(), list = await H.api('study/checkpoints');
      check('A: a study of 20,000,000 deals per seed is refused within a second with the limit in the message, and its folder is gone',
        /study budget too large/.test(s.error || '') && /Nothing was trained/.test(s.error || '') && ms < 1000 && left.length === 0 && s.refusedStudyFolder === 'removed' && s.checkpointId === null && list.checkpoints.length === 0,
        { httpStatusOfStart: r.status, checkpointIdGiven: start.checkpointId, statusError: s.error, refusedStudyFolder: s.refusedStudyFolder, checkpointIdAfterwards: s.checkpointId, milliseconds: ms, foldersLeft: left });
    }
    { // B
      const cases = [['an unknown variant', { ...small, variants: 'no-such-variant' }], ['seeds that are not numbers', { ...small, seeds: ['one'] }], ['a budget of zero deals', { ...small, budgets: [0] }]]; const rows = [];
      for (const [what, options] of cases) { const r = await H.raw('study/start', { fixture: fx, options }), body = await r.text(), s = r.status === 200 ? await H.wait() : null; rows.push({ what, httpStatusOfStart: r.status, start: body.slice(0, 160), error: s && s.error, refusedStudyFolder: s && s.refusedStudyFolder, foldersLeft: H.tree() }); }
      check('B: invalid configurations are refused with their reason and leave no folder', rows.every(x => x.httpStatusOfStart === 200 && x.error && x.refusedStudyFolder === 'removed' && x.foldersLeft.length === 0), rows);
    }
    { // C
      const id = 'my-own-folder', dir = path.join(H.root, id); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'notes.txt'), 'my notes, not EightMax data\n'); const before = hashes(dir);
      const r = await H.raw('study/start', { fixture: fx, options: over, checkpointId: id }), s = r.status === 200 ? await H.wait() : null, after = fs.existsSync(dir) ? hashes(dir) : null;
      check('C: a folder that existed before, with a file of the user\'s: the folder and the file stay unchanged; the request written into it is removed',
        r.status === 200 && s && /study budget too large/.test(s.error || '') && JSON.stringify(after) === JSON.stringify(before) && /^kept: the folder existed before/.test(s.refusedStudyFolder || ''),
        { httpStatusOfStart: r.status, error: s && s.error, refusedStudyFolder: s && s.refusedStudyFolder, filesBefore: before, filesAfter: after });
      fs.rmSync(dir, { recursive: true, force: true });
    }
    { // D
      const id = 'left-by-5-8', dir = path.join(H.root, id); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'request.json'), '{"format":"EightMax study request","formatVersion":1,"note":"an older request"}');
      const r = await H.raw('study/start', { fixture: fx, options: over, checkpointId: id }), s = r.status === 200 ? await H.wait() : null, files = fs.existsSync(dir) ? fs.readdirSync(dir) : null;
      // neither the folder nor request.json was created by this request, so there is nothing of it to undo (reported as null)
      check('D: a folder that existed before and holds only a request.json is not removed', r.status === 200 && s && /study budget too large/.test(s.error || '') && files && files.length === 1 && files[0] === 'request.json' && s.refusedStudyFolder === null,
        { httpStatusOfStart: r.status, refusedStudyFolder: s && s.refusedStudyFolder, files });
      fs.rmSync(dir, { recursive: true, force: true });
    }
    { // E
      const id = 'kept-checkpoint', r1 = await H.raw('study/start', { fixture: fx, options: small, checkpointId: id }), s1 = await H.wait(), dir = path.join(H.root, id), before = fs.existsSync(dir) ? hashes(dir) : null;
      const r2 = await H.raw('study/start', { fixture: fx, options: over, checkpointId: id }), text2 = await r2.text(), s2 = await H.api('study/status'), after = fs.existsSync(dir) ? hashes(dir) : null;
      const r3 = await H.raw('study/start', { fixture: fx, options: small, checkpointId: id }), after3 = fs.existsSync(dir) ? hashes(dir) : null, list = await H.api('study/checkpoints');
      check('E: an existing checkpoint with that id: the request is refused with 409 and no file of the checkpoint changes',
        r1.status === 200 && !s1.error && before && before['manifest.json'] && r2.status === 409 && r3.status === 409 && JSON.stringify(before) === JSON.stringify(after) && JSON.stringify(before) === JSON.stringify(after3) && list.checkpoints.some(c => c.id === id),
        { firstStudyError: s1.error || null, files: before && Object.keys(before), secondStart: r2.status, secondBody: text2.slice(0, 160), thirdStart: r3.status, unchanged: JSON.stringify(before) === JSON.stringify(after3), statusErrorAfterwards: s2.error || null });
      await H.api('study/discard', { checkpointId: id });
    }
    { // F
      const N = 8, rs = await Promise.all(Array.from({ length: N }, () => H.raw('study/start', { fixture: fx, options: over }).then(async r => ({ status: r.status, body: (await r.text()).slice(0, 120) })))); await H.wait(); await sleep(50); await H.wait();
      const left = H.tree(), accepted = rs.filter(r => r.status === 200).length, busy = rs.filter(r => r.status === 409).length;
      check('F: eight over-limit requests at once: each is accepted and then refused by the engine, or turned away because one is running; no folder is left', accepted >= 1 && accepted + busy === N && left.length === 0, { accepted, turnedAwayBecauseOneWasRunning: busy, other: rs.filter(r => r.status !== 200 && r.status !== 409), foldersLeft: left });
    }
    { // G
      const longer = { ...small, budgets: [20000, 60000], evaluationSamples: 4096 }, r1 = await H.raw('study/start', { fixture: fx, options: longer }), id = (await r1.json()).checkpointId, dir = path.join(H.root, id);
      const during = []; for (let i = 0; i < 6; i++) { const r = await H.raw('study/start', { fixture: fx, options: i % 2 ? over : { ...small, variants: 'no-such-variant' } }); during.push(r.status); await r.text(); await sleep(10); }
      const mid = H.tree(), s = await H.wait(), doc = await H.api('study/result'), files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
      check('G: refused requests arriving while a valid study runs are turned away; the running study\'s folder is not touched and the study completes',
        r1.status === 200 && during.every(x => x === 409) && mid.length === 1 && mid[0].folder === id && !s.error && doc.completion && doc.completion.complete === true && files.includes('manifest.json') && files.includes('request.json') && H.tree().length === 1,
        { runningStudy: id, statusesOfRequestsDuringTheRun: during, foldersDuringTheRun: mid, error: s.error || null, complete: doc.completion && doc.completion.complete, files });
      await H.api('study/discard', { checkpointId: id });
    }
  } finally { H.stop(); }
  H = await startHost(exe, { EIGHTMAX_TEST_UNDO_FAILS: '1' });
  try { // H
    const r = await H.raw('study/start', { fixture: fx, options: over }), start = await r.json(), s = await H.wait(), left = H.tree();
    check('H: when the removal fails (simulated) the refusal message is unchanged, the failure is reported, and the files stay',
      /study budget too large/.test(s.error || '') && /Nothing was trained/.test(s.error || '') && /^kept: request\.json could not be removed/.test(s.refusedStudyFolder || '') && left.length === 1 && left[0].files.length === 1 && left[0].files[0] === 'request.json' && s.checkpointId === start.checkpointId,
      { statusError: s.error, refusedStudyFolder: s.refusedStudyFolder, foldersLeft: left, checkpointId: s.checkpointId });
    for (const d of left) fs.rmSync(path.join(H.root, d.folder), { recursive: true, force: true });   // the folder this check left behind on purpose
  } finally { H.stop(); }
  H = await startHost(exe);
  try { // I
    const r0 = await H.raw('study/start', { fixture: fx, options: over }); await r0.text(); const s0 = await H.wait();
    const r = await H.raw('study/start', { fixture: fx, options: small }), id = (await r.json()).checkpointId, s = await H.wait(), doc = await H.api('study/result'), list = await H.api('study/checkpoints'), files = fs.readdirSync(path.join(H.root, id));
    const d = await H.raw('study/discard', { checkpointId: id }); await d.text();
    check('I: an ordinary study started after a refusal completes, is listed with its request, and can be discarded', s0.refusedStudyFolder === 'removed' && !s.error && s.refusedStudyFolder === null && doc.completion && doc.completion.complete === true && list.checkpoints.length === 1 && list.checkpoints[0].id === id && list.checkpoints[0].hasRequest === true && files.includes('request.json') && d.status === 200 && H.tree().length === 0,
      { error: s.error || null, refusedStudyFolderOfTheValidStudy: s.refusedStudyFolder, complete: doc.completion && doc.completion.complete, listed: list.checkpoints.map(c => c.id), files, discard: d.status, foldersAfterDiscard: H.tree() });
  } finally { H.stop(); }
  out.passed = out.checks.every(c => c.passed); out.checksPassed = out.checks.filter(c => c.passed).length; out.checksTotal = out.checks.length;
  return out;
}
module.exports = { run };
if (require.main === module) {
  const [exeArg, relArg, outArg] = process.argv.slice(2);
  if (!exeArg || !relArg || !outArg) { console.error('usage: node source/tools/host_refusal59.js <host executable> <release root> <out.json>'); process.exit(2); }
  run(path.resolve(exeArg), path.resolve(relArg)).then(out => { out.generated = new Date().toISOString(); fs.writeFileSync(outArg, JSON.stringify(out, null, 1)); for (const c of out.checks) if (!c.passed) console.error('FAILED: ' + c.name);
    console.log(out.checksPassed + ' of ' + out.checksTotal + ' checks passed'); process.exit(out.passed ? 0 : 1); }, e => { console.error(e); process.exit(1); });
}
