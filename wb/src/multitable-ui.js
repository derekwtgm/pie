/* Ten-table solver run panel (0.23). Uses the real hand-state engine, solver service, guarded executor and
 * multi-table scheduler in the page. Heavy training stays opt-in; nothing starts until the operator presses Start. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  if (!$('mt-panel')) return;
  const HS = window.WorkbenchHandState, SS = window.WorkbenchSolverService, MT = window.WorkbenchMultiTable, HR = window.WorkbenchHardwareReport, A = window.WorkbenchStudy, E = window.EightMax;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bb = (n) => (n / 100).toFixed(2).replace(/\.00$/, '');
  const POS = ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'HJ', 'CO'];
  let prepared = null, source = null, sched = null, runPromise = null, lastResult = null, lastCheckpoint = null, training = null, timer = null;
  const say = (t, kind) => { const n = $('mt-status'); n.textContent = t; n.dataset.kind = kind || ''; };

  function show(on) { $('mt-panel').hidden = !on; if (on) { render(); $('mt-panel').scrollIntoView(); } }
  $('mt-nav').onclick = () => show($('mt-panel').hidden);
  $('mt-close').onclick = () => show(false);

  function studyInfo() { return source ? source.id + ' · ' + source.updates.toLocaleString() + ' updates · convergence ' + source.convergence.verdict : 'No study loaded'; }

  // ---- study sources -------------------------------------------------------------------------
  function newPrepared() { return A.prepare(window.EM, { config: A.EXAMPLES.preflop8, iterations: Math.max(1, Math.min(10000000, Number($('mt-updates').value) || 20000)), timeMs: 600000 }); }
  $('mt-train').onclick = () => {
    if (training) { training.cancel = true; return; }
    if (running()) { say('Stop the run before training a study.', 'warn'); return; }
    let target = Math.max(1000, Math.min(2000000, Number($('mt-updates').value) || 20000)), p;
    try { p = newPrepared(); } catch (e) { say('Cannot prepare study: ' + e.message, 'error'); return; }
    training = { cancel: false }; $('mt-train').textContent = 'Cancel training';
    const step = () => {
      if (training.cancel) { training = null; $('mt-train').textContent = 'Train quick study'; say('Training cancelled; previous study kept.', 'warn'); return; }
      try { p.game.iterate(Math.min(500, target - p.game.iterations)); } catch (e) { training = null; $('mt-train').textContent = 'Train quick study'; say('Training failed: ' + e.message, 'error'); return; }
      say('Training in this page: ' + p.game.iterations.toLocaleString() + ' / ' + target.toLocaleString() + ' updates', '');
      if (p.game.iterations >= target) { prepared = p; source = new SS.StudyDecisionSource(window.EM, p, { studyId: 'preflop8-js-' + p.game.iterations }); training = null; $('mt-train').textContent = 'Train quick study'; say('Quick study ready: ' + studyInfo() + '. Coverage of rare nodes is partial.', 'ok'); render(); }
      else setTimeout(step, 0);
    };
    setTimeout(step, 0);
  };
  $('mt-state').onclick = () => $('mt-state-file').click();
  $('mt-state-file').onchange = async () => {
    const f = $('mt-state-file').files[0]; $('mt-state-file').value = ''; if (!f) return;
    try {
      if (f.size > 64 * 1024 * 1024) throw new Error('State file exceeds 64 MB');
      const p = newPrepared(); p.game.importNative(new Uint8Array(await f.arrayBuffer()));
      prepared = p; source = new SS.StudyDecisionSource(window.EM, p, { studyId: 'preflop8-native-' + p.game.iterations }); say('Imported native-trained state: ' + studyInfo() + '. Study must have been trained from the preflop8 example.', 'ok'); render();
    } catch (e) { say('State import refused: ' + e.message, 'error'); }
  };

  // ---- run control ---------------------------------------------------------------------------
  const running = () => !!(sched && runPromise);
  function start() {
    if (running()) return;
    if (window.workbench && window.workbench.coordinator.running) { say('Pause the simulator tab before starting a solver run.', 'warn'); return; }
    if (!source) { say('Load or train a study first. Without a solver study there is nothing to decide with.', 'warn'); return; }
    if ($('mt-mode').value === 'qa') { say('Authorized QA mode needs an authorization record and an approved test client; it cannot be configured in this dashboard.', 'warn'); return; }
    try {
      sched = new MT.MultiTableScheduler({ tables: Number($('mt-tables').value), handsPerTable: Number($('mt-hands').value) || 5, decisionSource: source, allowFallback: $('mt-fallback').checked, mode: $('mt-mode').value, seed: Number($('mt-seed').value) || 4127 });
    } catch (e) { say('Cannot start: ' + e.message, 'error'); return; }
    lastResult = null; $('mt-report').textContent = '';
    say('Running in ' + $('mt-mode').value + ' mode…', '');
    runPromise = sched.run().then((r) => { lastResult = r; runPromise = null; say(sched.estopped ? 'Emergency stop latched. Reset by starting a new run.' : 'Run finished.', sched.estopped ? 'warn' : 'ok'); report(); render(); }, (e) => { runPromise = null; say('Run failed: ' + e.message, 'error'); render(); });
    if (!timer) timer = setInterval(render, 250);
    render();
  }
  $('mt-start').onclick = start;
  $('mt-stop').onclick = () => { if (sched) { sched.stopping = true; say('Stopping after current steps…', ''); } };
  $('mt-estop').onclick = () => { if (sched) { sched.emergencyStop('Operator emergency stop'); say('Emergency stop: every table paused, solver queue cancelled, executor latched.', 'warn'); render(); } };
  $('mt-grid').onclick = (e) => {
    const b = e.target.closest('[data-mt-pause]'); if (!b || !sched) return; const id = Number(b.dataset.mtPause), w = sched.workers[id - 1];
    if (w.manualPause) { if (!sched.resumeTable(id)) say('Table ' + id + ' cannot resume: ' + w.status + (w.reason ? ' (' + w.reason + ')' : ''), 'warn'); } else sched.pauseTable(id, 'Paused by operator'); render();
  };
  $('mt-save').onclick = () => {
    if (!sched) { say('Nothing to save: no run has been started.', 'warn'); return; }
    lastCheckpoint = sched.checkpoint(); download('eightmax-multitable-checkpoint.json', JSON.stringify(lastCheckpoint)); say('Checkpoint saved with ' + lastCheckpoint.tables.length + ' tables.', 'ok'); render();
  };
  $('mt-load').onclick = () => $('mt-load-file').click();
  $('mt-load-file').onchange = async () => {
    const f = $('mt-load-file').files[0]; $('mt-load-file').value = ''; if (!f) return;
    try {
      if (running()) throw new Error('Stop the current run first');
      if (!source) throw new Error('Load the study first');
      if (f.size > 20 * 1024 * 1024) throw new Error('Checkpoint exceeds 20 MB');
      const cp = JSON.parse(await f.text());
      const s = new MT.MultiTableScheduler({ tables: cp.tables.length, handsPerTable: Number($('mt-hands').value) || 5, decisionSource: source, allowFallback: $('mt-fallback').checked, mode: $('mt-mode').value });
      MT.restoreCheckpoint(s, cp); sched = s; lastResult = null; $('mt-tables').value = String(cp.tables.length);
      say('Checkpoint restored for ' + cp.tables.length + ' tables. Press Start to continue.', 'ok'); render();
    } catch (e) { say('Checkpoint refused: ' + e.message, 'error'); }
  };
  function download(name, text) { const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  $('mt-diag').onclick = () => {
    const d = { format: 'eightmax-diagnostics', version: 1, appVersion: E.VERSION, generatedAt: new Date().toISOString(), userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency || null, deviceMemoryGiB: navigator.deviceMemory || null,
      engine: source ? source.engine : null, study: source ? { id: source.id, updates: source.updates, convergence: source.convergence } : null, capabilities: SS.CAPABILITIES,
      scheduler: sched ? { mode: sched.mode, tables: sched.workers.map((w) => w.summary()), solver: sched.solver.info(), executor: sched.executor.exportLog().counts, estop: sched.executor.estop, rejections: sched.workers.map((w) => ({ table: w.id, recent: w.engine.rejections.slice(-5) })) } : null,
      executorLogTail: sched ? sched.executor.log.slice(-200) : [], lastResult: lastResult && { ...lastResult, perTable: undefined } };
    download('eightmax-diagnostics.json', JSON.stringify(d, null, 2)); say('Diagnostics exported.', 'ok');
  };

  // ---- self-test and hardware ----------------------------------------------------------------
  $('mt-selftest').onclick = async () => {
    const out = [], check = (name, fn) => { try { const r = fn(); out.push((r === false ? 'FAIL ' : 'PASS ') + name); } catch (e) { out.push('FAIL ' + name + ': ' + e.message); } };
    check('simulator hand completes and conserves chips', () => { const t = new E.Table(1, 7); t.startHand(); let n = 0; while (t.status === 'playing' && n++ < 500) { const a = E.policy(t); t.execute(t.request(a.type, a.amount, 0), 0); } return t.status === 'complete' && t.players.reduce((s, p) => s + p.stack, 0) === 20000; });
    check('opening pot is 2.3 BB', () => HS.START_POT === 230);
    check('hand-state engine reconstructs simulator state', () => { const t = new E.Table(1, 3); t.startHand(); return new HS.HandStateEngine(1).ingest(HS.observeSimulator(t, 1, { actions: [] })).accepted; });
    check('hand-state engine rejects a wrong pot', () => { const t = new E.Table(1, 3); t.startHand(); const o = HS.observeSimulator(t, 1, { actions: [] }); o.pot += 1; return !new HS.HandStateEngine(1).ingest(o).accepted; });
    check('unknown engine build is refused', () => !SS.identifyEngine({ version: '9', build: '0123456789abcdef' }).compatible);
    check('executor defaults to Study Mode', () => new window.WorkbenchExecutor.TestExecutor({ stateOf: () => null }).mode === 'study');
    let s2 = null; try { const t = MT.MultiTableScheduler; const p = newPrepared(); p.game.iterate(300); const src = new SS.StudyDecisionSource(window.EM, p, { studyId: 'selftest' }); s2 = new t({ tables: 2, handsPerTable: 1, decisionSource: src, allowFallback: true }); const r = await s2.run(); out.push((r.handsCompleted === 2 && r.crashes === 0 ? 'PASS ' : 'FAIL ') + 'two-table scheduler run (' + r.solverActions + ' solver, ' + r.fallbackActions + ' labelled fallback actions)'); } catch (e) { out.push('FAIL two-table scheduler run: ' + e.message); }
    $('mt-report').textContent = 'Application self-test\n' + out.join('\n') + '\n\n' + (out.some((l) => l.startsWith('FAIL')) ? 'RESULT: FAILED' : 'RESULT: all checks passed (in-page, simulated tables only)');
    say('Self-test finished.', out.some((l) => l.startsWith('FAIL')) ? 'error' : 'ok');
  };
  function gpuName() { try { const c = document.createElement('canvas'), gl = c.getContext('webgl'); if (!gl) return null; const x = gl.getExtension('WEBGL_debug_renderer_info'); return x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : null; } catch (e) { return null; } }
  function renderHardware(report, note) {
    if (!report.valid) { $('mt-report').textContent = 'Hardware facts invalid: ' + report.issues.join('; '); return; }
    const sec = (t, l) => t + '\n' + (l.length ? l.map((x) => '  • ' + x).join('\n') : '  (none)') + '\n';
    $('mt-report').textContent = 'Hardware validation report\n' + note + '\n\n' + sec('Successfully tested', report.successfullyTested) + sec('Tested only in simulation', report.testedOnlyInSimulation) + sec('Unsupported / not verified', report.unsupportedOrNotVerified) + sec('Awaiting Windows testing', report.awaitingWindowsTesting)
      + 'Target comparison\n' + report.targetComparison.map((t) => '  ' + (t.meets ? '✓' : '✗') + ' ' + t.item + ': found ' + t.found + ' (target ' + t.target + ')').join('\n') + '\n\nGPU acceleration verified: ' + (report.gpuAcceleration.verified ? 'yes' : 'NO') + '\nEstimated minimum RAM: ' + report.estimatedRequirements.suggestedMinimumRamGiB + ' GiB';
  }
  $('mt-hw').onclick = () => {
    const gpu = gpuName(), ua = navigator.userAgent, facts = { format: 'eightmax-hardware-facts', version: 1, collector: 'browser', collectedAt: new Date().toISOString(), os: { name: /Windows/.test(ua) ? 'Windows (from browser)' : navigator.platform || 'unknown', version: '', arch: /x64|Win64|x86_64|AMD64/i.test(ua) ? 'x64' : 'unknown' }, cpu: { model: null, logical: navigator.hardwareConcurrency || 1 }, memory: { totalBytes: (navigator.deviceMemory || 0) * 1073741824 || 1, availableBytes: null }, gpus: gpu ? [{ name: gpu, vramBytes: null }] : [], nvidiaSmi: { present: false }, nativeSolver: null, gpuAcceleration: { executed: false, evidence: null } };
    renderHardware(HR.build(facts), 'Browser-limited view (CPU model, VRAM and exact RAM are hidden by browsers; deviceMemory is capped at 8 GiB). For the full report run RUN-HARDWARE-CHECK.cmd and load hardware-facts.json with "Load hardware facts".');
    say('Hardware view shown.', 'ok');
  };
  $('mt-hw-file').onchange = async () => { const f = $('mt-hw-file').files[0]; $('mt-hw-file').value = ''; if (!f) return; try { if (f.size > 1000000) throw new Error('File too large'); renderHardware(HR.build(JSON.parse(await f.text())), 'From ' + f.name); say('Hardware facts loaded.', 'ok'); } catch (e) { say('Cannot read facts: ' + e.message, 'error'); } };
  $('mt-hw-load').onclick = () => $('mt-hw-file').click();

  // ---- rendering -----------------------------------------------------------------------------
  function report() {
    if (!lastResult) return; const r = lastResult, f = (s) => (s.n ? s.p50.toFixed(1) + ' / ' + s.p95.toFixed(1) + ' / ' + s.p99.toFixed(1) + ' ms' : 'n/a');
    $('mt-report').textContent = ['Run summary (simulated tables in this page; single thread; no GPU used)', 'Tables: ' + r.tables + '   Hands completed: ' + r.handsCompleted + '   Actions: ' + r.actions + ' (' + r.solverActions + ' solver, ' + r.fallbackActions + ' labelled scripted fallback)',
      'Wall: ' + Math.round(r.wallMs) + ' ms   Deadline misses: ' + r.deadlineMisses + '   Invalid observations: ' + r.invalidObservations + '   Worker crashes: ' + r.crashes + '   Recoveries: ' + r.recoveries,
      'End-to-end p50/p95/p99: ' + f(r.latency.endToEnd), 'Solver p50/p95/p99: ' + f(r.latency.solver), 'Queue wait p50/p95/p99: ' + f(r.latency.queueWait),
      'Max concurrent solver decisions: ' + r.solver.maxConcurrentDecisions + ' of ' + r.solver.workers + ' workers'].join('\n');
  }
  function card(w) {
    const v = w.view, t = w.table, hot = w.status === 'failed' || w.status === 'suspended', paused = w.manualPause || w.status === 'paused';
    const pos = v && v.actor >= 0 ? POS[(v.actor - v.button + 8) % 8] : '–';
    let eff = '–'; if (v) { const live = w.engine.state ? w.engine.state.seats.filter((p) => !p.folded) : []; if (live.length > 1 && v.actor >= 0) { const me = w.engine.state.seats[v.actor], other = Math.max(...live.filter((p) => p.seat !== v.actor).map((p) => p.stack + p.bet)); eff = bb(Math.min(me.stack + me.bet, other)) + ' BB'; } }
    const legal = v && v.legal ? [v.legal.canFold ? 'fold' : null, v.legal.canCheck ? 'check' : null, v.legal.toCall > 0 ? 'call ' + bb(v.legal.callAmount) : null, v.legal.canRaise ? 'raise ' + bb(v.legal.minRaiseTo || 0) + '–' + bb(v.legal.maxRaiseTo) : null].filter(Boolean).join(' · ') : '–';
    let rec = '<span class="muted">no decision yet</span>';
    if (v && v.decision) rec = '<strong>' + esc(v.decision.recommended) + '</strong>' + v.decision.labels.map((l, i) => '<div class="mt-bar" title="' + esc(l) + '"><i style="width:' + Math.round(v.decision.probabilities[i] * 100) + '%"></i><span>' + esc(l) + ' ' + (v.decision.probabilities[i] * 100).toFixed(1) + '%</span></div>').join('');
    else if (v && v.result && v.result !== 'ok') rec = '<span class="mt-warn">' + esc(v.result) + (v.reason ? ': ' + esc(v.reason) : '') + '</span>';
    const warn = hot ? w.reason : (w.engine.paused ? w.engine.pauseReason : (v && v.decision && v.decision.warnings.length ? v.decision.warnings[0] : ''));
    const stateName = w.status + (w.engine.paused ? ' · state paused' : '');
    return '<article class="mt-card' + (hot ? ' mt-bad' : '') + '" data-status="' + esc(w.status) + '"><header><h3>Table ' + String(w.id).padStart(2, '0') + '</h3><span class="mt-pill">' + esc(stateName) + '</span></header>'
      + '<dl><dt>Hand</dt><dd>' + w.hands + (t.hand ? ' (#' + t.hand + ')' : '') + ' · ' + esc(t.street) + '</dd><dt>Acting</dt><dd>' + (v && v.actor >= 0 ? 'Seat ' + (v.actor + 1) + ' ' + pos : '–') + '</dd><dt>Pot</dt><dd>' + (v ? bb(v.pot) + ' BB' : '–') + '</dd><dt>Effective</dt><dd>' + eff + '</dd><dt>Legal</dt><dd>' + esc(legal) + '</dd>'
      + '<dt>Observation</dt><dd>' + (v ? (v.confidence * 100).toFixed(0) + '% confidence' : '–') + '</dd><dt>Convergence</dt><dd>' + esc(source ? source.convergence.verdict : '–') + '</dd><dt>Decision time</dt><dd>' + (v && v.decisionMs !== null ? v.decisionMs.toFixed(1) + ' ms' : '–') + '</dd></dl>'
      + '<div class="mt-rec">' + rec + '</div>' + (warn ? '<p class="mt-warn">' + esc(warn) + '</p>' : '') + '<button class="small quiet" data-mt-pause="' + w.id + '"' + (hot ? ' disabled' : '') + '>' + (paused ? 'Resume table' : 'Pause table') + '</button></article>';
  }
  function render() {
    if (!$('mt-panel') || $('mt-panel').hidden) return;
    const ws = sched ? sched.workers : [];
    $('mt-grid').innerHTML = ws.length ? ws.map(card).join('') : '<p class="muted">No run yet. Load or train a study, choose a mode and press Start. Study Mode shows recommendations without acting.</p>';
    const info = sched ? sched.solver.info() : null, active = ws.filter((w) => ['running', 'paused'].includes(w.status)).length;
    const mem = performance && performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(0) + ' MiB JS heap' : 'n/a';
    $('mt-monitor').innerHTML = [['Application', 'EightMax Test Workbench ' + E.VERSION], ['Engine', source ? source.engine.version + ' build ' + source.engine.build : '5.1 build 7d08acc7eb4577ee (bundled)'], ['Study', studyInfo()], ['Mode', sched ? sched.mode : $('mt-mode').value],
      ['Active tables', active + ' / ' + ws.length], ['Pending solver jobs', info ? info.queued + ' queued, ' + info.active + ' running' : '0'], ['Per-table errors', ws.filter((w) => w.status === 'failed' || w.status === 'suspended').length + ' tables suspended/failed'],
      ['CPU / memory', (navigator.hardwareConcurrency || '?') + ' logical CPUs · ' + mem], ['GPU', 'not used (bundled solver is CPU-only)'], ['Last checkpoint', lastCheckpoint ? 'saved this session (' + lastCheckpoint.tables.length + ' tables)' : 'none this session'],
      ['Emergency stop', sched && sched.estopped ? 'LATCHED' : 'clear']].map((r) => '<div><span>' + r[0] + '</span><strong>' + esc(r[1]) + '</strong></div>').join('');
    $('mt-start').disabled = running() || !source; $('mt-stop').disabled = !running(); $('mt-estop').disabled = !running();
    if (!running() && timer) { clearInterval(timer); timer = null; }
  }
  $('mt-mode').onchange = () => { if ($('mt-mode').value === 'qa') { say('Authorized QA mode is not available in the dashboard: it requires an explicit authorization record and an approved test client.', 'warn'); $('mt-mode').value = 'simulation'; } render(); };
  window.multitablePanel = { show, get scheduler() { return sched; }, get source() { return source; }, useStudy(p, id) { prepared = p; source = new SS.StudyDecisionSource(window.EM, p, { studyId: id || 'preflop8' }); render(); }, start, render };
})();
