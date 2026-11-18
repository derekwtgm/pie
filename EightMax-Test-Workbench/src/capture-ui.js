/* Capture & one-table run panel (0.24): source selector, capture start/stop, live preview with calibration overlay,
 * recognition confidence, reconstructed hand, EightMax decision, execution status, emergency stop, hand history + replay,
 * diagnostic export. Everything shown is computed from pixels by the same modules the tests exercise. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  if (!$('cap-panel')) return;
  const HS = window.WorkbenchHandState, FH = window.WorkbenchFullHand, CAP = window.WorkbenchCapture, ST = window.WorkbenchSolverTree, SIM = window.WorkbenchSimDisplay, A = window.WorkbenchStudy, E = window.EightMax, IC = window.WorkbenchImageCodec;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bb = (n) => (n / 100).toFixed(2).replace(/\.00$/, '');
  const POS = ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'HJ', 'CO'];
  const say = (t, kind) => { const n = $('cap-status'); n.textContent = t; n.dataset.kind = kind || ''; };
  let session = null, pipe = null, running = false, steps = [], hands = [], events = [], lastFrame = null, lastObs = null, lastReject = null, lastState = null, lastDecision = null, lastExec = null, windows = [], hostApi = null, cancel = false;

  const show = (on) => { $('cap-panel').hidden = !on; if (on) { $('cap-panel').scrollIntoView(); render(); } };
  $('cap-nav').onclick = () => show($('cap-panel').hidden); $('cap-close').onclick = () => show(false);
  const log = (kind, detail) => { events.push({ at: new Date().toISOString(), kind, detail }); if (events.length > 500) events.shift(); };

  // ---- source selection ------------------------------------------------------------------------
  function sourceUi() {
    const v = $('cap-source').value;
    $('cap-win-wrap').hidden = $('cap-refresh').hidden = v !== 'window'; $('cap-region-wrap').hidden = v !== 'region'; $('cap-consent-wrap').hidden = v === 'offline';
    $('cap-run').disabled = v !== 'offline'; $('cap-run').title = v !== 'offline' ? 'Hand automation runs only against the offline controlled client. External windows are observed, never operated.' : '';
  }
  $('cap-source').onchange = () => { sourceUi(); if ($('cap-source').value === 'window') refreshWindows(); };
  function host() { if (hostApi) return hostApi; const d = window.WorkbenchDesktop && window.WorkbenchDesktop.fromPage && window.WorkbenchDesktop.fromPage(window); if (!d || !d.secret) return null; hostApi = { async request(method, path, body) { const r = await fetch('http://127.0.0.1:48713' + path, { method, headers: { 'X-EightMax-Session': d.secret, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'omit', cache: 'no-store' }); const j = await r.json(); if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; } }; return hostApi; }
  async function refreshWindows() {
    const h = host(); if (!h) { say('The Windows desktop host is not connected (start START-DESKTOP.cmd). Window and region capture need it.', 'warn'); return; }
    try { const r = await h.request('GET', '/api/capture/windows'); windows = r.windows; $('cap-window').innerHTML = windows.map((w, i) => '<option value="' + i + '">' + esc(w.title.slice(0, 60)) + ' — pid ' + w.pid + ' — ' + w.clientWidth + '×' + w.clientHeight + (w.minimized ? ' (minimised)' : '') + '</option>').join(''); say(windows.length + ' windows found. Choose one, tick the consent box, then Start capture.', ''); } catch (e) { say('Window list failed: ' + e.message, 'error'); }
  }
  $('cap-refresh').onclick = refreshWindows;

  // ---- drawing ---------------------------------------------------------------------------------
  function draw(img) {
    const c = $('cap-canvas'), g = c.getContext('2d'); if (!img) { g.fillStyle = '#202020'; g.fillRect(0, 0, c.width, c.height); return; }
    const tmp = document.createElement('canvas'); tmp.width = img.width; tmp.height = img.height; tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    c.height = Math.round(c.width * img.height / img.width); g.drawImage(tmp, 0, 0, c.width, c.height);
    if ($('cap-overlay').checked) { const L = SIM.L2, boxes = [L.pot, L.handId, L.callAmount, L.minRaise, ...L.board, ...L.hero, ...Object.values(L.controls), ...L.seats.flatMap((s) => [s.stack, s.bet, s.folded, s.button, s.active, s.allin])]; g.strokeStyle = 'rgba(106,169,255,.85)'; g.lineWidth = 1; for (const b of boxes) g.strokeRect(b.x * c.width, b.y * c.height, b.w * c.width, b.h * c.height); }
  }
  function render() {
    if ($('cap-panel').hidden) return;
    const st = session ? session.status() : null;
    $('cap-capstats').textContent = st ? 'Capture ' + st.state + ' · frames ' + st.valid + ' valid / ' + st.invalid + ' invalid' + (st.effectiveFps ? ' · ' + st.effectiveFps.toFixed(1) + ' fps' : '') + (st.lastCode && st.lastCode !== 'ok' ? ' · last: ' + st.lastCode + ' — ' + esc(st.lastReason || '') : '') + (lastFrame ? ' · frame ' + lastFrame.width + '×' + lastFrame.height + ' @' + (lastFrame.dpiScale || 1) + 'x' : '') : 'Capture not started.';
    if (lastObs) { const f = lastObs.confidence.fields; $('cap-conf').innerHTML = 'Confidence overall <b>' + lastObs.confidence.overall.toFixed(3) + '</b> · ' + Object.entries(f).map(([k, v]) => k + ' ' + v.toFixed(2)).join(' · ') + (lastReject ? '<br><span class="mt-warn">Table paused: ' + esc(lastReject) + '</span>' : ''); }
    else $('cap-conf').innerHTML = lastReject ? '<span class="mt-warn">Not accepted: ' + esc(lastReject) + '</span>' : 'No reading yet.';
    if (lastState) {
      const s = lastState, rows = s.seats.map((p, i) => '<tr><td>' + POS[(i - s.button + 8) % 8] + '</td><td>' + i + '</td><td>' + bb(p.stack) + '</td><td>' + bb(p.bet) + '</td><td>' + (p.folded ? 'fold' : p.allIn ? 'all-in' : i === s.actor ? '◀ to act' : '') + '</td><td>' + (p.cards ? p.cards.map(HS.cardToString).join(' ') : '') + '</td></tr>').join('');
      $('cap-hand').innerHTML = '<b>Hand ' + s.hand + ' · ' + s.street + (s.status === 'complete' ? ' · complete' : '') + '</b> · board ' + (s.board.map(HS.cardToString).join(' ') || '—') + ' · pot ' + bb(s.pot) + ' bb · bet to match ' + bb(s.currentBet) + ' bb · revision ' + s.revision + '<table><tr><th>pos</th><th>seat</th><th>stack</th><th>bet</th><th></th><th>cards</th></tr>' + rows + '</table>' +
        (s.legal ? '<div>Legal: ' + [s.legal.canFold && 'fold', s.legal.canCheck && 'check', s.legal.canCall && 'call ' + bb(s.legal.callAmount), s.legal.canRaise && 'raise ' + bb(s.legal.minRaiseTo) + '–' + bb(s.legal.maxRaiseTo)].filter(Boolean).join(' · ') + '</div>' : '') +
        (s.sidePots && s.sidePots.length > 1 ? '<div>Side pots: ' + s.sidePots.map((p) => bb(p.amount) + ' (' + p.eligible.join(',') + ')').join(' · ') + '</div>' : '') + (s.actions ? '<div>History: ' + s.actions.map((a) => a.seat + ':' + a.type + (a.amount ? ' ' + bb(a.amount) : '')).join(', ') + '</div>' : '');
    } else $('cap-hand').textContent = 'No hand read yet.';
    if (lastDecision) { const d = lastDecision.decision; $('cap-decision').innerHTML = lastDecision.via === 'solver' ? '<span class="cap-tag solver">EIGHTMAX STUDY</span> ' + esc(d.studyKind || '') + ' · ' + esc(d.studyId || '') + ' · ' + (d.trainingUpdates || 0).toLocaleString() + ' updates · convergence ' + esc(d.convergence ? d.convergence.verdict : 'unproven') + ' · not certified' + '<br>' + d.labels.map((l, i) => esc(l) + ' <span class="cap-bar" style="width:' + Math.round(d.probabilities[i] * 120) + 'px"></span> ' + (d.probabilities[i] * 100).toFixed(1) + '%').join('<br>') + '<br>Recommended: <b>' + esc(d.recommended) + '</b>' + (d.evByAction ? '<br>EV (bb, sampled): ' + d.evByAction.map((x) => x.toFixed(2)).join(' / ') : '') + (d.pooled ? '<br>Pooled over ' + d.pooled.combosUsed + ' suit-equivalent ' + d.pooled.handClass + ' combos' : '') + (d.warnings && d.warnings.length ? '<br><span class="mt-warn">' + d.warnings.map(esc).join('<br>') + '</span>' : '') + '<br>' + (d.assumptions || []).map((a) => '· ' + esc(a)).join('<br>') : '<span class="cap-tag scripted">SCRIPTED FALLBACK</span> not a solver decision: ' + esc(d.recommended); }
    else $('cap-decision').textContent = 'No decision yet.';
    $('cap-exec').innerHTML = lastExec ? esc(lastExec) : 'Nothing executed.';
    const done = hands.filter((h) => h.status === 'complete').length; $('cap-history').innerHTML = hands.length ? hands.map((h) => '<div>Hand ' + h.hand + ' — ' + esc(h.status) + (h.reason ? ' (' + esc(h.reason) + ')' : '') + ' · solver ' + h.solverActions + ' / scripted ' + h.scriptedActions + (h.final ? ' · final stacks ' + h.final.map(bb).join(' ') : '') + '</div>').join('') : '<span class="muted">No hands played.</span>';
    $('cap-replay').max = Math.max(0, steps.length - 1);
    $('cap-start').disabled = !!session || running; $('cap-stop').disabled = !session; $('cap-run').disabled = running || $('cap-source').value !== 'offline'; $('cap-estop').disabled = !running;
  }
  $('cap-overlay').onchange = () => draw(lastFrame && lastFrame.image);
  $('cap-replay').oninput = () => { const s = steps[+$('cap-replay').value]; if (!s) return; lastState = s.state; lastDecision = s.decision || null; $('cap-replay-caption').textContent = 'step ' + (+$('cap-replay').value + 1) + ' / ' + steps.length + ' (read-only; replay never executes)'; render(); };

  // ---- capture sessions ------------------------------------------------------------------------
  async function makeSource() {
    const v = $('cap-source').value;
    if (v === 'offline') { const t = new E.Table(1, Number($('cap-seed').value) || 24), client = new FH.OfflineClient(t); return { source: client.source, client, table: t }; }
    if (!$('cap-consent').checked) throw new Error('Tick the consent box: capture is only ever started for a window or region you own or are authorised to capture.');
    const h = host(); if (!h) throw new Error('The Windows desktop host is not connected.');
    let target; if (v === 'window') { const w = windows[Number($('cap-window').value)]; if (!w) throw new Error('Choose a window first.'); target = { kind: 'window', hwnd: w.hwnd, pid: w.pid, title: w.title }; }
    else { const p = $('cap-region').value.split(',').map(Number); if (p.length !== 4 || p.some((x) => !Number.isFinite(x))) throw new Error('Region must be x,y,w,h in physical pixels.'); target = { kind: 'region', x: p[0], y: p[1], width: p[2], height: p[3] }; }
    const decode = (b64) => new Promise((res, rej) => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const g = c.getContext('2d'); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, c.width, c.height); res({ width: c.width, height: c.height, data: d.data }); }; im.onerror = () => rej(new Error('PNG did not decode')); im.src = 'data:image/png;base64,' + b64; });
    const o = await h.request('POST', '/api/capture/open', { target, consent: true }); if (!o.ok) throw new Error(o.code + ': ' + o.reason);
    return { source: new CAP.HostCaptureSource({ request: (m, p, b) => h.request(m, p, b), decode, target: { ...target, ...(o.target || {}) } }) };
  }
  $('cap-start').onclick = async () => {
    if (session) return;
    try {
      const made = await makeSource(); session = new CAP.CaptureSession(made.source, { intervalMs: Number($('cap-interval').value), settleFrames: 2 });
      session.on((f) => { if (f.valid) { lastFrame = f; draw(f.image); } else { lastReject = f.code + ': ' + f.reason; } log('frame', { seq: f.seq, code: f.code }); render(); });
      const r = await session.start(); if (!r.ok) { session = null; say('Capture did not start: ' + r.reason, 'error'); return; }
      say('Capturing ' + $('cap-source').selectedOptions[0].text + '. Observation preview only; nothing is executed from a capture session.', 'ok'); log('capture-start', $('cap-source').value);
    } catch (e) { session = null; say(e.message, 'error'); } render();
  };
  $('cap-stop').onclick = async () => { if (!session) return; await session.stop(); session = null; lastFrame = null; draw(null); say('Capture stopped.', ''); log('capture-stop'); render(); };

  // ---- one-table run ---------------------------------------------------------------------------
  $('cap-run').onclick = async () => {
    if (running) return; if (session) { say('Stop the capture session first; Play hands drives its own offline client.', 'warn'); return; }
    const mode = $('cap-mode').value; if (mode === 'qa') { say('Authorized QA mode cannot be configured here.', 'warn'); return; }
    try {
      const t = new E.Table(1, Number($('cap-seed').value) || 24), client = new FH.OfflineClient(t), post = new ST.PostflopStudySource({ EM: window.EM, adapter: A, iterations: Math.max(200, Math.min(20000, Number($('cap-updates').value) || 800)) });
      const src = new ST.CompositeDecisionSource([post]);
      pipe = new FH.SingleTablePipeline({ client, vision: FH.makeVision(1), decisionSource: src, mode, allowScripted: $('cap-fallback').checked && mode === 'simulation', stepDelayMs: 120, stopOnSuspend: true, seed: 3, onEvent: (kind, d) => {
        if (kind === 'frame') { lastFrame = d.frame; draw(d.frame.image); } else if (kind === 'observation') { lastObs = d.observation; lastReject = d.accepted ? null : d.issues.map((i) => i.code + ': ' + i.detail).join('; '); } else if (kind === 'rejected') { lastReject = d.reasons.join('; '); }
        else if (kind === 'state') { lastState = d.state; steps.push({ state: d.state, decision: null }); } else if (kind === 'decision') { lastDecision = d; if (steps.length) steps[steps.length - 1].decision = d; }
        else if (kind === 'executed') { const e = d.entry; lastExec = 'Executed: seat ' + e.seat + ' ' + e.label + (e.amount ? ' to ' + bb(e.amount) + ' bb' : '') + ' [' + e.source + '] · acknowledged by the next screen reading'; }
        else if (kind === 'hand-end') { hands.push(d.record); }
        log(kind); if (kind !== 'frame') render();
      } });
    } catch (e) { say('Cannot start: ' + e.message, 'error'); return; }
    running = true; cancel = false; steps = []; hands = []; lastExec = null; lastReject = null; say('Playing ' + $('cap-hands').value + ' hand(s) in ' + mode + ' mode…', ''); render();
    try { await pipe.run(Number($('cap-hands').value) || 1); say(pipe.stopped ? 'Emergency stop latched. Start a new run to continue.' : 'Run finished: ' + hands.filter((h) => h.status === 'complete').length + ' complete, ' + hands.filter((h) => h.status === 'suspended').length + ' suspended, ' + hands.filter((h) => h.status === 'observed').length + ' observed (study).', pipe.stopped ? 'warn' : 'ok'); }
    catch (e) { say('Run failed: ' + e.message, 'error'); log('error', e.message); }
    running = false; render();
  };
  $('cap-estop').onclick = () => { if (pipe) { pipe.emergencyStop('Operator emergency stop'); log('estop'); say('Emergency stop pressed: executor and solver are stopped.', 'warn'); } render(); };

  // ---- exports ---------------------------------------------------------------------------------
  function download(name, obj) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  $('cap-diag').onclick = () => download('eightmax-capture-diagnostics.json', { format: 'eightmax-capture-diagnostics', version: 1, appVersion: E.VERSION, generatedAt: new Date().toISOString(), source: $('cap-source').value, mode: $('cap-mode').value, capture: session ? session.status() : null, pipeline: pipe ? pipe.report() : null, lastReject, events, note: 'Diagnostics contain no screenshots. Real-client accuracy is not measured by this release.' });
  $('cap-replay-save').onclick = () => download('eightmax-hand-history.json', { format: 'eightmax-hand-history', version: 1, appVersion: E.VERSION, hands: hands.map((h) => ({ ...h })), steps: steps.map((s) => ({ revision: s.state.revision, hand: s.state.hand, street: s.state.street, board: s.state.board, pot: s.state.pot, actor: s.state.actor, actions: s.state.actions, decision: s.decision && s.decision.decision ? { source: s.decision.via, recommended: s.decision.decision.recommended, labels: s.decision.decision.labels, probabilities: s.decision.decision.probabilities } : null })) });
  sourceUi(); render();
})();
