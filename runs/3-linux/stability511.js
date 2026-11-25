// EightMax 5.5: long-running study stability against the desktop host (Linux build, or EightMax.exe with --wine).
//   node tools/stability55.js <host executable> <release root> <out-dir> [--minutes=6] [--wine]
// One host process for the whole run:
//   A. repeated pause (Stop) and resume of ONE study until it completes, compared with an uninterrupted study;
//   B. many sequential studies (start, finish, export, reload the export through the interface library, re-export);
//   C. status polled from four concurrent clients every few milliseconds throughout (concurrent progress updates);
//      every response must be a complete JSON document;
//   D. cancellation during evaluation (exact quality) and resume;
//   E. a long CPU training study with checkpoints every 5 s, for the remaining minutes;
//   F. host resident memory sampled throughout (Linux /proc): reported, with the first and last readings.
// Writes stability59.json. Exit code 1 if any check failed.
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net'), cp = require('node:child_process');
const args = process.argv.slice(2), [exeArg, relArg, outArg] = args.filter(a => !a.startsWith('--')), wine = args.includes('--wine'), minutes = Number((args.find(a => a.startsWith('--minutes=')) || '--minutes=6').slice(10));
if (!exeArg || !relArg || !outArg) { console.error('usage: node tools/stability55.js <host executable> <release root> <out-dir> [--minutes=6] [--wine]'); process.exit(2); }
const exe = path.resolve(exeArg), rel = path.resolve(relArg), out = path.resolve(outArg); fs.mkdirSync(out, { recursive: true });
const E = require(path.join(rel, 'source/tools/loadlib')); for (const l of ['lib_runouts', 'lib_wide', 'lib_river', 'lib_river_ui', 'lib_study_ui']) require(path.join(rel, 'source/web', l));
const checks = [], check = (name, ok, detail) => { checks.push({ name, passed: !!ok, ...(detail !== undefined ? { detail } : {}) }); if (!ok) console.error('FAILED: ' + name + ' ' + JSON.stringify(detail || '').slice(0, 400)); };
const sleep = ms => new Promise(r => setTimeout(r, ms)), fixture = id => JSON.parse(fs.readFileSync(path.join(rel, 'studies', id + '.emfix.json'), 'utf8'));
const numbers = d => JSON.stringify(d.variants.map(v => [v.budgets.map(b => [b.verdict, b.gap, b.meetsTolerance]), v.perSeed.map(s => s.budgets.map(p => [p.status, p.ev, p.frequency, p.evStdErr, p.quality, p.qualityStdErr, p.deals, p.rows]))]));
(async () => {
  const t0 = Date.now(), homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'em55-stab-'));
  const port = await new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const env = { ...process.env, HOME: wine ? process.env.HOME : homeDir, USERPROFILE: homeDir, EIGHTMAX_GPU: 'off', WINEDEBUG: '-all' };
  const proc = wine ? cp.spawn('wine', [exe, '--no-browser', '--port=' + port], { env, stdio: 'ignore' }) : cp.spawn(exe, ['--no-browser', '--port=' + port], { env, stdio: 'ignore' });
  const url = 'http://127.0.0.1:' + port, raw = (p, body) => fetch(url + '/api/' + p, body === undefined ? {} : { method: 'POST', headers: { 'X-EightMax': '1' }, body: JSON.stringify(body) }), api = async (p, body) => (await raw(p, body)).json();
  let info = null; for (let i = 0; i < 600 && !info; i++) { try { info = await api('info'); } catch { await sleep(50); } }
  if (!info) { proc.kill('SIGKILL'); throw new Error('the host did not start'); }
  const report = { tool: 'stability59 (stability55.js with the largest supported budget in step E and the refusal check E0)', generated: new Date().toISOString(), host: wine ? 'Windows executable under Wine' : 'Linux build', build: info.build, version: info.version, minutesRequested: minutes, checks };
  // C: concurrent pollers
  let polling = true, polls = 0, badPolls = 0, maxPhaseSeen = new Set(); const rss = [];
  const poller = async () => { while (polling) { try { const r = await raw('study/status'); const t = await r.text(); polls++; const j = JSON.parse(t); if (j.progress && j.progress.phase) maxPhaseSeen.add(j.progress.phase); if (j.progress && typeof j.progress.pointsRequested !== 'number') badPolls++; } catch { badPolls++; } await sleep(3); } };
  const pollers = [poller(), poller(), poller(), poller()];
  const sampler = (async () => { while (polling) { if (!wine) { try { const m = /VmRSS:\s+(\d+) kB/.exec(fs.readFileSync('/proc/' + proc.pid + '/status', 'utf8')); if (m) rss.push([Math.round((Date.now() - t0) / 1000), Math.round(m[1] / 1024)]); } catch {} } await sleep(2000); } })();
  const wait = async () => { for (;;) { const s = await api('study/status'); if (!s.running) return s; await sleep(25); } };
  try {
    // A
    const f6 = fixture('flop6-jack'), optA = { variants: 'baseline', seeds: [101, 102, 103], budgets: [10000, 40000, 120000], threads: 3, evaluationSamples: 1000, qualitySamples: 128, checkpointSeconds: 0.2 };
    await api('study/start', { fixture: f6, options: optA, checkpointId: 'reference', checkpoint: false }); await wait(); const refA = await api('study/result');
    let { checkpointId: id } = await api('study/start', { fixture: f6, options: optA }), cycles = 0, last = null;
    for (;;) { await sleep(700 + 150 * (cycles % 5)); const s = await api('study/status'); if (!s.running) break; await api('study/stop', {}); await wait(); last = await api('study/result'); if (last.completion.complete) break; cycles++; const r = await api('study/resume', { checkpointId: id }); if (!r.ok) { check('resume accepted in cycle ' + cycles, false, r); break; } if (cycles > 200) break; }
    await wait(); const doneA = await api('study/result');
    check('A: a study paused and resumed ' + cycles + ' times completes', doneA.completion.complete === true && cycles >= 3, { cycles, completion: doneA.completion });
    check('A: its numbers equal an uninterrupted study and no checkpoint warning was raised', numbers(doneA) === numbers(refA) && doneA.run.checkpoint.warnings.length === 0, { warnings: doneA.run.checkpoint.warnings, resumeCount: doneA.run.checkpoint.resumeCount });
    check('A: an interrupted document never claims completion or tolerance', !last || last.completion.complete || (last.completion.complete === false && last.variants.every(v => v.budgets.every(b => b.complete || (!b.meetsTolerance && !['ranked', 'nearTie', 'smallEdge'].includes(b.verdict))))));
    // B
    const fa = fixture('known-akq-river'); let seq = 0, okSeq = 0, first = null;
    for (; seq < 25; seq++) {
      await api('study/start', { fixture: fa, options: { seeds: 3, budgets: [500, 5000], threads: 2 } }); const s = await wait(); const d = await api('study/result'); if (!first) first = numbers(d);
      const text = JSON.stringify(d, null, 1), re = E.study.validateResult(JSON.parse(text)), again = E.study.validateResult(JSON.parse(JSON.stringify(re)));
      const csv = E.study.toCSV(re);
      if (!s.error && d.completion.complete && numbers(d) === first && JSON.stringify(re) === JSON.stringify(JSON.parse(text)) && JSON.stringify(again) === JSON.stringify(re) && csv.split('\n').length > 10) okSeq++;
    }
    check('B: 25 sequential studies complete with identical numbers; export, reload and re-export are stable', okSeq === 25, { okSeq });
    const saved = (await api('study/checkpoints')).checkpoints; check('B: every study left a complete saved record and none is resumable', saved.length >= 26 && saved.every(c => c.status === 'complete' && !c.resumable), { saved: saved.length });
    for (const c of saved) await api('study/discard', { checkpointId: c.id });
    check('B: discarding every saved study empties the list', (await api('study/checkpoints')).checkpoints.length === 0);
    // D: cancel during an exact quality evaluation
    const fs6 = fixture('flop6-jack-small'), optD = { variants: 'baseline', seeds: [101, 102], budgets: [2000], threads: 2 };
    const d1 = await api('study/start', { fixture: fs6, options: optD }); let sawEval = false;
    for (let i = 0; i < 2000 && !sawEval; i++) { const s = await api('study/status'); if (!s.running) break; if (s.progress && (s.progress.phase === 'evaluating' || s.progress.phase === 'actionEvaluated')) sawEval = true; else await sleep(5); }
    await sleep(300); await api('study/stop', {}); const tStop = Date.now(); await wait(); const lat = Date.now() - tStop; const dPart = await api('study/result');
    check('D: cancellation during evaluation stops the study and marks it incomplete', sawEval && dPart.run.stoppedByUser === true && dPart.completion.complete === false, { sawEval, latencyMs: lat, statuses: dPart.variants[0].perSeed.map(s => s.budgets.map(b => b.status)) });
    await api('study/resume', { checkpointId: d1.checkpointId }); await wait(); const dDone = await api('study/result');
    check('D: the cancelled evaluation is repeated on resume and the study completes', dDone.completion.complete === true && dDone.run.checkpoint.resumed === true, dDone.completion);
    report.cancelDuringEvaluationLatencyMs = lat;
    // E: long CPU training with periodic checkpoints
    const remaining = Math.max(20, minutes * 60 - (Date.now() - t0) / 1000 - 15), fb = fixture('flop6-jack');
    // E0 (5.8): the budget the 5.5 tool used here, 20,000,000 deals per seed, is above the limit of one engine state. 5.8 must
    // refuse it at once through the desktop host and write nothing (through 5.7.1 it trained up to the limit and then failed).
    { const before = fs.existsSync(path.join(homeDir, 'EightMax', 'studies')) ? fs.readdirSync(path.join(homeDir, 'EightMax', 'studies')).length : 0, tE0 = Date.now();
      const r0 = await raw('study/start', { fixture: fb, options: { variants: 'baseline', seeds: [201, 202], budgets: [100000, 20000000], trainingStreams: '5.10', threads: 2, evaluationSamples: 1000, qualitySamples: 128, checkpointSeconds: 5, timeLimitSeconds: 30 } });
      const startText = await r0.text(), s0 = await wait(), ms = Date.now() - tE0; let res0 = ''; try { res0 = await (await raw('study/result')).text(); } catch (e) { res0 = String(e); }
      const after = fs.existsSync(path.join(homeDir, 'EightMax', 'studies')) ? fs.readdirSync(path.join(homeDir, 'EightMax', 'studies')).length : 0, all = startText + JSON.stringify(s0) + res0.slice(0, 4000);
      check('E0: a study of 20,000,000 deals per seed is refused at once by the desktop host, with the limit in the message, and nothing is saved', /study budget too large/.test(all) && /Nothing was trained/.test(all) && after === before && ms < 5000,
        { httpStatusOfStart: r0.status, start: startText.slice(0, 200), statusAfter: JSON.stringify(s0).slice(0, 500), milliseconds: ms, savedStudiesBefore: before, after }); }
    const e1 = await api('study/start', { fixture: fb, options: { variants: 'baseline', seeds: [201, 202, 203, 204], budgets: [100000, 10000000], threads: 4, evaluationSamples: 1000, qualitySamples: 128, checkpointSeconds: 5, timeLimitSeconds: remaining } });
    let commits = 0, lastErr = '', deals = 0; for (;;) { const s = await api('study/status'); if (!s.running) break; if (s.progress && s.progress.checkpoint) { commits = Math.max(commits, s.progress.checkpoint.commits); lastErr = s.progress.checkpoint.lastError || lastErr; } if (s.progress && s.progress.sampledDeals) deals = Math.max(deals, s.progress.sampledDeals); await sleep(500); }
    const eDoc = await api('study/result');
    check('E: a ' + Math.round(remaining) + ' s training study stops at its time limit with periodic checkpoints and no write error', eDoc.run.stoppedByTimeLimit === true && eDoc.run.checkpoint.commits >= Math.floor(remaining / 5) && lastErr === '' && eDoc.run.checkpoint.warnings.length === 0 && eDoc.completion.resumable === true, { commits: eDoc.run.checkpoint.commits, engineStateWrites: eDoc.run.checkpoint.engineStateWrites, MiB: eDoc.run.checkpoint.engineStateMiBWritten, secondsWriting: eDoc.run.checkpoint.secondsWriting, deals, peakRssMiB: eDoc.run.processPeakRssMiB });
    const man = JSON.parse(fs.readFileSync(path.join(homeDir, 'EightMax', 'studies', e1.checkpointId, 'manifest.json'), 'utf8')), crypto = require('node:crypto');
    check('E: every engine state named by the final manifest matches its SHA-256', man.body.jobs.filter(j => j.state).length > 0 && man.body.jobs.every(j => !j.state || crypto.createHash('sha256').update(fs.readFileSync(path.join(homeDir, 'EightMax', 'studies', e1.checkpointId, j.state.file))).digest('hex') === j.state.sha256), { states: man.body.jobs.filter(j => j.state).length });
    report.longTraining = { seconds: remaining, commits: eDoc.run.checkpoint.commits, engineStateWrites: eDoc.run.checkpoint.engineStateWrites, engineStateMiBWritten: eDoc.run.checkpoint.engineStateMiBWritten, secondsWriting: eDoc.run.checkpoint.secondsWriting, largestSampledDeals: deals, processPeakRssMiB: eDoc.run.processPeakRssMiB };
  } catch (e) { check('the session completed', false, String(e && e.stack || e).slice(0, 800)); }
  polling = false; await Promise.all(pollers); await sampler;
  check('C: ' + polls + ' concurrent status polls each returned a complete, well-formed document', polls > 1000 && badPolls === 0, { polls, badPolls, phases: [...maxPhaseSeen] });
  report.hostResidentMiB = { samples: rss.length, first: rss[0], last: rss[rss.length - 1], max: rss.reduce((m, x) => Math.max(m, x[1]), 0), series: rss.filter((_, i) => i % 10 === 0) };
  report.elapsedSeconds = (Date.now() - t0) / 1000; proc.kill('SIGKILL'); fs.rmSync(homeDir, { recursive: true, force: true });
  report.passed = checks.every(c => c.passed); fs.writeFileSync(path.join(out, 'stability59.json'), JSON.stringify(report, null, 1) + '\n');
  console.log(checks.filter(c => c.passed).length + ' of ' + checks.length + ' checks passed'); process.exit(report.passed ? 0 : 1);
})();
