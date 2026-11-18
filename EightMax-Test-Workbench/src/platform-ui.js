/* Platform workspace (0.25): profiles, capture backends and health, calibration editor, solver view, execution modes, performance.
 * Everything shown is produced by the same modules the automated tests exercise (platform-profile, calibration, capture-manager,
 * execution-adapters, resource-monitor, full-hand). Only this application's own controlled test table is ever operated. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  if (!$('pf-panel')) return;
  const PP = window.WorkbenchPlatformProfile, CAL = window.WorkbenchCalibration, CM = window.WorkbenchCaptureManager, XA = window.WorkbenchExecutionAdapters, RM = window.WorkbenchResourceMonitor;
  const FH = window.WorkbenchFullHand, CAP = window.WorkbenchCapture, ST = window.WorkbenchSolverTree, SIM = window.WorkbenchSimDisplay, A = window.WorkbenchStudy, E = window.EightMax, O = window.WorkbenchVisionOcr, M = window.WorkbenchVisionMetrics;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bb = (n) => (n / 100).toFixed(2).replace(/\.00$/, '');
  const tag = (kind, t) => '<span class="pf-tag ' + kind + '">' + esc(t) + '</span>';
  const say = (id, t, kind) => { const n = $(id); n.textContent = t; n.dataset.kind = kind || ''; };

  const store = new PP.ProfileStore(); let profile = store.get('eightmax-controlled-8max-v2'), manager = null, tbl = null, client = null, cal = null, calImage = null, learned = null;
  let pipe = null, running = false, paused = false, last = { decision: null, state: null, via: null, executions: [], acks: 0, errors: 0 }, perf = null, decisions = { exact: 0, translated: 0, unavailable: 0, scripted: 0, byCode: {} };

  /* ---------- tabs ---------- */
  function tab(name) { for (const b of document.querySelectorAll('[data-pf-tab]')) { b.classList.toggle('quiet', b.dataset.pfTab !== name); } for (const n of ['capture', 'calibration', 'solver', 'execution', 'performance']) $('pf-' + n).hidden = n !== name; if (name === 'performance') renderPerf(); if (name === 'solver') renderSolver(); }
  for (const b of document.querySelectorAll('[data-pf-tab]')) b.onclick = () => tab(b.dataset.pfTab);
  const show = (on) => { $('pf-panel').hidden = !on; if (on) { fillProfiles(); renderCatalog(); fillRegions(); $('pf-panel').scrollIntoView(); } };
  $('pf-nav').onclick = () => show($('pf-panel').hidden); $('pf-close').onclick = () => show(false);

  /* ---------- drawing ---------- */
  function drawImage(canvas, img, overlay) {
    const g = canvas.getContext('2d'); if (!img) { g.fillStyle = '#202020'; g.fillRect(0, 0, canvas.width, canvas.height); return; }
    const tmp = document.createElement('canvas'); tmp.width = img.width; tmp.height = img.height; tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    canvas.height = Math.round(canvas.width * img.height / img.width); g.drawImage(tmp, 0, 0, canvas.width, canvas.height);
    if (overlay) { g.lineWidth = 1; for (const r of overlay) { g.strokeStyle = r.path === $('pf-region').value ? 'rgba(255,200,80,1)' : 'rgba(106,169,255,.8)'; g.strokeRect(r.box.x * canvas.width, r.box.y * canvas.height, r.box.w * canvas.width, r.box.h * canvas.height); } }
  }

  /* ---------- profiles + catalogue ---------- */
  function fillProfiles() { $('pf-profile').innerHTML = store.list().map((p) => '<option value="' + esc(p.id) + '"' + (p.id === profile.id ? ' selected' : '') + '>' + esc(p.name) + ' [' + p.status + ']</option>').join(''); const optical = profile.capture.methods.filter((m) => CM.CATALOG[m] && CM.CATALOG[m].opticalRecognition), first = (profile.capture.preferred || []).find((m) => optical.includes(m)) || optical[0]; $('pf-backend').innerHTML = optical.map((m) => { const c = CM.CATALOG[m]; return '<option value="' + m + '"' + (!c || !c.implemented ? ' disabled' : '') + (m === first ? ' selected' : '') + '>' + esc(c ? c.label : m) + (c && !c.implemented ? ' (not implemented)' : '') + '</option>'; }).join(''); }
  $('pf-profile').onchange = () => { profile = store.get($('pf-profile').value); cal = null; learned = null; fillProfiles(); fillRegions(); renderCatalog(); };
  function renderCatalog() {
    const rows = Object.entries(CM.CATALOG).map(([id, c]) => '<tr><td style="text-align:left">' + esc(c.label) + '</td><td>' + tag(c.verification === 'tested-linux' ? 'ok' : c.verification === 'windows-unrun' ? 'warn' : 'bad', c.verification) + '</td><td>' + (c.opticalRecognition ? 'image' : 'data feed') + '</td><td style="text-align:left">' + esc(c.note || '') + '</td></tr>').join('');
    $('pf-catalog').innerHTML = '<table><tr><th style="text-align:left">Backend</th><th>Verification</th><th>Input</th><th style="text-align:left">Note</th></tr>' + rows + '</table><div class="cap-small">tested-linux = automated tests here, no real window. windows-unrun = code exists, never executed on Windows. Windows Graphics Capture is not implemented.</div>';
  }

  /* ---------- capture (controlled client only) ---------- */
  function newClient(seed) { tbl = new E.Table(1, seed || 25); tbl.startHand(); client = new FH.OfflineClient(tbl); return client; }
  $('pf-cap-start').onclick = async () => {
    if (manager) return; newClient(Number($('pf-seed').value) || 25);
    const factory = async (id) => { if (id === 'structured-feed') throw new Error('structured feed carries no pixels'); return client.source; };
    manager = new CM.CaptureManager({ profile, factory, sessionOptions: { intervalMs: 300, maxFrameAgeMs: 1500 }, queueSize: 4 });
    const cl = FH.makeVision(1), gate = new CM.ObservationGate({ table: 1, maxAgeMs: 1500, health: () => manager && manager.health() });
    manager.on((f) => { if (f.valid) { drawImage($('pf-canvas'), f.image, profile.layout && $('pf-region').value ? PP.allRegions(profile) : null); const r = cl.observe(f.image, { heroSeat: f.viewSeat }); const a = gate.admit(f, r); $('pf-recog').innerHTML = a.admit ? tag('ok', 'admitted') + ' confidence ' + r.observation.confidence.overall.toFixed(2) + ' · image-based' : tag('bad', 'rejected') + ' ' + esc(a.reasons.join(', ')); } renderHealth(); });
    const r = await manager.start($('pf-backend').value || undefined);
    if (!r.ok) { manager = null; say('pf-cap-status', 'Capture did not start: ' + r.reason, 'error'); return; }
    $('pf-cap-start').disabled = true; $('pf-cap-stop').disabled = false; say('pf-cap-status', 'Capturing the controlled client via ' + r.backend + '. Frames that fail validation are never passed on.', 'ok'); renderHealth();
  };
  $('pf-cap-stop').onclick = async () => { if (!manager) return; await manager.stop(); manager = null; $('pf-cap-start').disabled = false; $('pf-cap-stop').disabled = true; say('pf-cap-status', 'Capture stopped.', ''); drawImage($('pf-canvas'), null); };
  function renderHealth() {
    if (!manager) { $('pf-health').textContent = 'Not started.'; return; } const h = manager.health();
    $('pf-health').innerHTML = (h.healthy ? tag('ok', 'healthy') : tag('bad', 'unhealthy')) + ' backend ' + esc(h.backend) + ' · state ' + esc(h.state) + '<br>invalid ratio ' + (h.invalidRatio === null ? '—' : (100 * h.invalidRatio).toFixed(0) + '%') + ' · frames queued ' + h.queue.length + ' dropped ' + h.queue.dropped + ' · interruptions ' + h.interruptions + ' · recoveries ' + h.recoveries + ' · resolution changes ' + h.resolutionChanges + '<br>grab mean ' + (h.grabMsMean === null ? '—' : h.grabMsMean.toFixed(1) + ' ms') + (h.reasons.length ? '<br>' + esc(h.reasons.join('; ')) : '');
  }

  /* ---------- calibration ---------- */
  function fillRegions() { $('pf-region').innerHTML = PP.allRegions(profile).map((r) => '<option value="' + esc(r.path) + '">' + esc(r.path) + '</option>').join(''); loadRegion(); }
  function loadRegion() { const r = PP.allRegions(profile).find((x) => x.path === $('pf-region').value); if (!r) return; $('pf-rx').value = r.box.x; $('pf-ry').value = r.box.y; $('pf-rw').value = r.box.w; $('pf-rh').value = r.box.h; redrawCal(); }
  $('pf-region').onchange = loadRegion;
  function redrawCal() { if (calImage) drawImage($('pf-cal-canvas'), calImage, PP.allRegions(profile)); }
  $('pf-apply').onclick = () => {
    try { profile = PP.setRegion(profile, $('pf-region').value, { x: +$('pf-rx').value, y: +$('pf-ry').value, w: +$('pf-rw').value, h: +$('pf-rh').value }); cal = null; learned = null; store.add(profile); say('pf-cal-status', 'Region updated. Profile is now "unverified"; learn templates again.', 'ok'); fillProfiles(); redrawCal(); }
    catch (e) { say('pf-cal-status', 'Rejected: ' + e.message, 'error'); }
  };
  async function decodeFile(file) { const bmp = await createImageBitmap(file), c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); const d = g.getImageData(0, 0, c.width, c.height); return { width: d.width, height: d.height, data: d.data }; }
  $('pf-shot').onchange = async () => { const f = $('pf-shot').files[0]; if (!f) return; try { calImage = await decodeFile(f); redrawCal(); say('pf-cal-status', 'Screenshot loaded (' + calImage.width + '×' + calImage.height + ').', 'ok'); } catch (e) { say('pf-cal-status', 'Cannot read that image: ' + e.message, 'error'); } };
  $('pf-suggest').onclick = () => {
    if (!calImage) { newClient(Number($('pf-seed').value) || 25); calImage = client.source.render(960, 1); }
    const s = CAL.suggest(calImage, profile); if (!s.ok) { say('pf-cal-status', 'No suggestion: ' + s.reason, 'warn'); return; }
    $('pf-cal-out').innerHTML = tag('warn', 'advisory') + ' table boundary ' + esc(JSON.stringify(s.tableBounds.box, (k, v) => (typeof v === 'number' ? +v.toFixed(3) : v))) + ' · confidence ' + s.confidence.toFixed(2) + '<br>' + s.cardCandidates.length + ' card-like rectangles<br>' + s.notes.map(esc).join('<br>') + '<br><button id="pf-use-suggest" class="quiet small">Use suggested layout as the working profile</button>';
    $('pf-use-suggest').onclick = () => { profile = s.profile; store.add(profile); cal = null; learned = null; fillProfiles(); fillRegions(); say('pf-cal-status', 'Suggested layout is now the working profile (unverified, no execution).', 'ok'); };
  };
  $('pf-sample').onclick = () => {
    try {
      const t = new E.Table(1, Number($('pf-seed').value) || 25); cal = new CAL.CalibrationSession(profile); let n = 0;
      for (let h = 0; h < 4; h++) { t.startHand(); for (let g = 0; g < 80 && t.status === 'playing'; g++) { const hero = t.actor, tr = M.truthFromTable(t, hero); cal.addSample(SIM.renderTable(t, 960, { v2: true, layout: profile.layout, heroSeat: hero }), { ...tr, heroSeat: hero, callAmount: tr.callAmount === null ? undefined : tr.callAmount, minRaise: tr.minRaise === null ? undefined : tr.minRaise }); n++; const a = E.policy(t); t.execute(t.request(a.type, a.amount, 0), 0); } }
      say('pf-cal-status', n + ' labelled samples cut from the controlled client (truth from its own simulator). For a screenshot of another table you must supply the truth yourself.', 'ok');
    } catch (e) { cal = null; say('pf-cal-status', e.message, 'error'); }
  };
  $('pf-learn').onclick = () => {
    if (!cal) { say('pf-cal-status', 'Add labelled samples first.', 'warn'); return; }
    try { learned = cal.learn(); $('pf-cal-out').innerHTML = tag(learned.complete ? 'ok' : 'warn', learned.complete ? 'templates complete' : 'templates incomplete') + ' ' + learned.templatesGlyphs + ' digit templates, ' + learned.templatesCards + ' card templates<br>' + esc(learned.advice) + (learned.stats.skipped.length ? '<br>' + learned.stats.skipped.length + ' labels skipped (label disagreed with the pixels)' : ''); say('pf-cal-status', 'Learned. Now preview on a frame that was not used for learning.', 'ok'); }
    catch (e) { say('pf-cal-status', e.message, 'error'); }
  };
  $('pf-preview').onclick = () => {
    if (!cal || !learned) { say('pf-cal-status', 'Learn templates first.', 'warn'); return; }
    try {
      let img = calImage; if (!img) { const t = new E.Table(1, 4242); t.startHand(); img = SIM.renderTable(t, 960, { v2: true, layout: profile.layout, heroSeat: t.actor }); calImage = img; }
      const heroSeat = Number.isInteger(calImage.heroSeat) ? calImage.heroSeat : 0; const p = cal.preview(img, { heroSeat }); redrawCal();
      $('pf-cal-out').innerHTML = (p.ok ? tag('ok', 'read') + ' confidence ' + p.confidence.toFixed(2) + ' · pot ' + p.observation.pot + ' · street ' + p.observation.street : tag('bad', 'rejected') + '<br>' + p.reasons.map(esc).join('<br>')) + '<br><span class="cap-small">Previews on frames used for learning prove nothing. Use the held-out evaluation in the calibration tests / reports.</span>';
    } catch (e) { say('pf-cal-status', e.message, 'error'); }
  };
  function download(name, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  $('pf-save').onclick = () => { try { if (!cal || !learned) { download(profile.id + '.profile.json', PP.saveProfile(profile)); say('pf-cal-status', 'Profile saved (no templates yet).', 'ok'); return; } const b = cal.export(); download(profile.id + '.calibration.json', JSON.stringify(b)); say('pf-cal-status', 'Profile and templates saved. The profile stays "unverified" until you record evidence.', 'ok'); } catch (e) { say('pf-cal-status', 'Not saved: ' + e.message, 'error'); } };
  $('pf-load').onchange = async () => {
    const f = $('pf-load').files[0]; if (!f) return;
    try { const o = JSON.parse(await f.text()); if (o.profile && o.templates) { cal = CAL.CalibrationSession.import(o); profile = cal.profile; learned = { complete: true }; } else { const r = PP.loadProfile(o); if (!r.ok) throw new Error(r.problems.join('; ')); profile = r.profile; cal = null; learned = null; } store.add(profile); fillProfiles(); fillRegions(); say('pf-cal-status', 'Loaded ' + profile.id + ' (integrity verified).', 'ok'); }
    catch (e) { say('pf-cal-status', 'Rejected: ' + e.message, 'error'); }
  };

  /* ---------- solver + execution ---------- */
  function renderSolver() {
    const d = last.decision; let h = '<b>Engine</b> EightMax ' + esc(ST.ENGINE.version) + ' build ' + esc(ST.ENGINE.build) + ' · certification none · convergence unproven unless a check is attached<br>';
    h += '<b>Decisions</b> exact ' + decisions.exact + ' · translated (approximate) ' + decisions.translated + ' · unavailable ' + decisions.unavailable + ' · scripted fallback ' + decisions.scripted + (Object.keys(decisions.byCode).length ? '<br><b>Missing capabilities</b> ' + esc(Object.entries(decisions.byCode).map(([k, v]) => k + '×' + v).join(', ')) : '') + '<hr>';
    if (!d) h += 'No decision yet. Run hands in the Execution tab.';
    else if (last.via === 'scripted') h += tag('warn', 'SCRIPTED FALLBACK') + ' not a solver decision: ' + esc(d.recommended);
    else { h += tag(d.exactState === false ? 'warn' : 'ok', d.exactState === false ? 'approximate state' : 'exact tree state') + ' study ' + esc(d.studyId) + ' · ' + d.trainingUpdates + ' updates · ' + esc(d.convergence.verdict) + '<br><table><tr><th style="text-align:left">Action</th><th>Probability</th><th>EV (bb)</th></tr>' + d.labels.map((l, i) => '<tr><td style="text-align:left">' + esc(l) + (i === d.recommendedSlot ? ' ◀' : '') + '</td><td>' + (100 * d.probabilities[i]).toFixed(1) + '% <span class="cap-bar" style="width:' + Math.round(60 * d.probabilities[i]) + 'px"></span></td><td>' + (d.evByAction ? d.evByAction[i].toFixed(2) : '—') + '</td></tr>').join('') + '</table>' + (d.warnings && d.warnings.length ? '<br>' + d.warnings.map((w) => tag('warn', 'warning') + ' ' + esc(w)).join('<br>') : '') + '<br>decided at ' + new Date(d.decidedAt).toISOString() + ' · fingerprint ' + esc(String(d.inputFingerprint).slice(0, 24)); }
    if (last.latency) h += '<br>latency: solver p50 ' + last.latency.solve + ' ms'; $('pf-solver-out').innerHTML = h;
  }
  function renderExec() {
    const x = last.executions.slice(-12).map((e) => '<tr><td>' + e.seat + '</td><td style="text-align:left">' + esc(e.label) + (e.amount ? ' ' + bb(e.amount) : '') + '</td><td>' + tag(e.source === 'solver' ? 'ok' : 'warn', e.source) + (e.translated ? ' ' + tag('warn', 'approx') : '') + '</td></tr>').join('');
    $('pf-exec-out').innerHTML = 'Acknowledged by the next screen reading: <b>' + last.acks + '</b> · errors: <b>' + last.errors + '</b>' + (x ? '<table><tr><th>Seat</th><th style="text-align:left">Action</th><th>Source</th></tr>' + x + '</table>' : '<br>Nothing executed.');
  }
  $('pf-run').onclick = async () => {
    if (running) return; const mode = $('pf-mode').value; if (mode === 'qa') { say('pf-exec-status', 'Authorized external QA is disabled: no authorised environment is configured.', 'warn'); return; }
    const t = new E.Table(1, Number($('pf-seed').value) || 25); client = new FH.OfflineClient(t); tbl = t;
    const post = new ST.PostflopStudySource({ EM: window.EM, adapter: A, iterations: Math.max(200, Math.min(20000, Number($('pf-updates').value) || 800)), translateOffTree: true });
    const src = new ST.CompositeDecisionSource([post]); last = { decision: null, state: null, via: null, executions: [], acks: 0, errors: 0 }; decisions = { exact: 0, translated: 0, unavailable: 0, scripted: 0, byCode: {} };
    const mon = new RM.RunMonitor({ intervalMs: 250 }).start(), t0 = performance.now();
    pipe = new FH.SingleTablePipeline({ client, vision: FH.makeVision(1), decisionSource: src, mode, allowScripted: mode === 'simulation', stepDelayMs: 60, stopOnSuspend: true, seed: 3, onEvent: (kind, d) => {
      if (kind === 'decision') { last.decision = d.decision; last.via = d.via; if (d.via === 'scripted') decisions.scripted++; else if (d.decision.exactState === false) decisions.translated++; else decisions.exact++; renderSolver(); }
      else if (kind === 'executed') { last.executions.push(d.entry); last.acks++; renderExec(); } else if (kind === 'rejected') { last.errors++; } }, });
    running = true; paused = false; $('pf-run').disabled = true; $('pf-pause').disabled = $('pf-estop').disabled = false; say('pf-exec-status', 'Running ' + $('pf-hands').value + ' hand(s) in ' + mode + ' mode…', '');
    try { const rep = await pipe.run(Math.max(1, Math.min(50, Number($('pf-hands').value) || 3))); for (const [k, v] of Object.entries(rep.unavailableCodes || {})) { decisions.byCode[k] = v; decisions.unavailable += v; }
      perf = { report: mon.stop(), wallMs: performance.now() - t0, latency: rep.latencyMs, totals: rep.totals, capture: rep.capture, solver: rep.solver, hands: rep.completed }; say('pf-exec-status', 'Finished: ' + rep.completed + ' hand(s) complete, solver actions ' + rep.totals.solverActions + ', scripted ' + rep.totals.scriptedActions + ', errors ' + last.errors + '.', 'ok'); }
    catch (e) { last.errors++; say('pf-exec-status', 'Stopped: ' + e.message, 'error'); } finally { running = false; $('pf-run').disabled = false; $('pf-pause').disabled = $('pf-estop').disabled = true; renderExec(); renderSolver(); }
  };
  $('pf-pause').onclick = () => { if (!pipe) return; paused = !paused; if (paused) { pipe.executor.pauseTable(1, 'Operator pause'); } else { pipe.executor.resumeTable(1); } $('pf-pause').textContent = paused ? 'Resume table 1' : 'Pause table 1'; say('pf-exec-status', paused ? 'Table 1 paused: no action will be submitted.' : 'Table 1 resumed.', paused ? 'warn' : 'ok'); };
  $('pf-estop').onclick = () => { if (pipe) { pipe.stop ? pipe.stop('Emergency stop') : pipe.executor.emergencyStop('Emergency stop'); } say('pf-exec-status', 'Emergency stop latched: nothing further is submitted until reset.', 'warn'); };

  /* ---------- performance ---------- */
  function renderPerf() {
    const mem = performance && performance.memory ? performance.memory : null, cores = navigator.hardwareConcurrency || null;
    let h = '<b>Active tables</b> ' + (running ? 1 : 0) + ' · <b>Logical CPUs</b> ' + (cores === null ? 'unknown' : cores) + '<br><b>Page JS heap</b> ' + (mem ? (mem.usedJSHeapSize / 1048576).toFixed(0) + ' MiB used of ' + (mem.jsHeapSizeLimit / 1048576).toFixed(0) + ' MiB limit (source: performance.memory, this tab only)' : 'not exposed by this browser') + '<br><b>Process CPU / RSS</b> not measurable from a web page; the desktop host and the Node benchmark tools measure them once per process (reports/*benchmark*).<br><b>GPU</b> ' + tag('bad', 'not used') + ' no verified GPU execution path exists in this build.<hr>';
    if (!perf) h += 'Run hands in the Execution tab to see latencies.';
    else { const l = perf.latency || {}, f = (k) => (l[k] && l[k].n ? 'p50 ' + l[k].p50.toFixed(1) + ' / p95 ' + l[k].p95.toFixed(1) + ' ms (n=' + l[k].n + ')' : '—'); h += '<b>Last run</b> ' + perf.hands + ' hands in ' + (perf.wallMs / 1000).toFixed(1) + ' s<br>capture ' + f('capture') + '<br>recognition ' + f('recognise') + '<br>solver ' + f('solve') + '<br>execution ' + f('execute') + '<br>cycle ' + f('cycle') + '<br>worker health: cooperative table loop, ' + (perf.totals.suspended ? tag('bad', perf.totals.suspended + ' suspended') : tag('ok', 'no suspended hands')) + ' · error counters: rejected frames ' + perf.totals.rejectedFrames + ', ack mismatches ' + perf.totals.ackMismatches + ', duplicates blocked ' + perf.totals.duplicateBlocked + '<br>resource report validation: ' + (perf.report.validation.ok ? tag('ok', 'valid') : tag('bad', perf.report.validation.problems.map((p) => p.code).join(','))) + ' (units: ' + esc(perf.report.units.memory) + '; ' + esc(perf.report.sources.processRss) + ')'; }
    $('pf-perf-out').innerHTML = h;
  }
  window.WorkbenchPlatformUI = { get profile() { return profile; }, tab, decisions: () => decisions };
  tab('capture');
})();
