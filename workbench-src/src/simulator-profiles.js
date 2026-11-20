/* EightMax Test Workbench 0.35.0: SIMULATOR CONTROL PROFILES and the control-calibration model.
 *
 * Stored in the existing platform-profile format (src/platform-profile.js, version 1, SHA-256 integrity), with the 0.35 input
 * fields in `execution`: amountField, amountConvention (raise-to | raise-by), chipUnit, controls.allin, and the simulator binding
 * (exeFileName + exeSha256) - input is only ever sent to a window of THAT executable.
 *   fixtureProfile()      the bundled controlled test table (EightMaxTestTable.exe)
 *   fromCalibration()     a profile for the operator's own simulator, from regions marked on a screenshot
 *   calibrationReport()   what the regions become on the CURRENT window: pixel boxes, click points, sizes, overlaps, confidence
 * Nothing here names or targets any third-party poker client.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./platform-profile.js'), require('./input-geometry.js'), require('./status-strip.js'), require('./fixture-dealer.js'));
  else root.WorkbenchSimulatorProfiles = factory(root.WorkbenchPlatformProfile, root.WorkbenchInputGeometry, root.WorkbenchStatusStrip, root.WorkbenchFixtureDealer);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (PP, G, STRIP, FD) {
  'use strict';
  const CONTROL_KEYS = Object.freeze(['fold', 'check', 'call', 'raise', 'allin']), REQUIRED = Object.freeze(['fold', 'check', 'call', 'raise']);
  function fixtureProfile(o = {}) {
    const p = PP.controlledProfile(2);
    p.id = 'eightmax-controlled-windows-table'; p.name = 'EightMax controlled Windows test table (input validation fixture)';
    p.description = 'desktop/bin/EightMaxTestTable.exe: real Win32 buttons and wager field showing the controlled renderer. Accuracy measured here is fixture accuracy, not that of any other program.';
    p.capture = { ...p.capture, methods: [...new Set([...p.capture.methods, 'windows-graphics-capture'])], windowMatch: { titleContains: 'EightMax Test Table' } };
    p.layout.statusStrip = { ...STRIP.REGION };
    p.execution = { interface: 'approved-ui-automation', requiresAuthorization: true, controls: { allin: { ...FD.CONTROLS.allin } }, amountField: { ...FD.WAGER_FIELD }, amountConvention: o.convention || 'raise-to', chipUnit: 1, controlledFixture: true, simulator: { exeFileName: 'EightMaxTestTable.exe', exeSha256: o.exeSha256 || null } };
    const v = PP.validateProfile(p); if (!v.valid) throw new Error('fixture profile invalid: ' + v.issues.join('; ')); return p;
  }
  /**
   * regions: { fold, check, call, raise, allin?, wager } normalised to the client area (from the calibration wizard);
   * simulator: { exeFileName, exeSha256 }; convention; chipUnit; heroSeat (the seat the simulator shows at the bottom).
   * The recognition layout starts from the controlled geometry and must be calibrated separately (docs/SIMULATOR-CONTROLS.md).
   */
  function fromCalibration({ id, name, regions, simulator, convention = 'raise-to', chipUnit = 1, heroSeat = 0, evidence }) {
    for (const k of REQUIRED) if (!G.validNormalized(regions && regions[k])) throw new Error('Mark the ' + k + ' button before saving');
    if (!G.validNormalized(regions.wager)) throw new Error('Mark the wager-entry field before saving');
    const p = PP.templateProfile(id, name);
    for (const k of REQUIRED) p.layout.controls[k] = round(regions[k]);
    p.layout.heroSeat = heroSeat;
    p.execution = { interface: 'approved-ui-automation', requiresAuthorization: true, controls: regions.allin ? { allin: round(regions.allin) } : {}, amountField: round(regions.wager), amountConvention: convention, chipUnit, simulator: { exeFileName: simulator.exeFileName, exeSha256: simulator.exeSha256 } };
    p.verification = { status: evidence ? 'verified-by-operator' : 'unverified', externalClient: null, evidence: evidence ? [evidence] : [] };
    p.capture = { ...p.capture, methods: ['window', 'printwindow', 'windows-graphics-capture', 'screenshot-file'], preferred: ['window'] };
    const v = PP.validateProfile(p); if (!v.valid) throw new Error('Calibration invalid: ' + v.issues.join('; ')); return p;
  }
  const round = (b) => ({ x: +b.x.toFixed(5), y: +b.y.toFixed(5), w: +b.w.toFixed(5), h: +b.h.toFixed(5) });
  function controlsOf(p) { return { ...(p.layout && p.layout.controls || {}), ...(p.execution && p.execution.controls || {}) }; }
  /** client: physical client rectangle now; dpiScale; monitors. Returns everything the preview shows. */
  function calibrationReport(p, client, o = {}) {
    const ctl = controlsOf(p), out = { client, dpiScale: o.dpiScale || 1, resolution: o.resolution || null, controls: {}, problems: [], warnings: [] };
    const all = Object.entries(ctl).filter(([k]) => CONTROL_KEYS.includes(k)); if (p.execution && p.execution.amountField) all.push(['wager', p.execution.amountField]);
    for (const [k, b] of all) { const r = G.regionToScreen(b, client, { insetFraction: k === 'wager' ? 0.2 : 0.18 }); out.controls[k] = r.ok ? { box: b, pixels: r.full, clickRect: r.rect, point: r.point, sizePx: [r.full.w, r.full.h] } : { box: b, error: r.reason }; if (!r.ok) out.problems.push(k + ': ' + r.reason); }
    for (const k of REQUIRED) if (!ctl[k]) out.problems.push(k + ' button not calibrated');
    if (!(p.execution && p.execution.amountField)) out.problems.push('wager field not calibrated: bets and raises cannot be entered');
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (G.overlaps(all[i][1], all[j][1])) out.problems.push(all[i][0] + ' and ' + all[j][0] + ' overlap');
    for (const [k, c] of Object.entries(out.controls)) if (c.sizePx && (c.sizePx[0] < 24 || c.sizePx[1] < 12)) out.warnings.push(k + ' is small at this window size (' + c.sizePx.join('x') + ' px)');
    if (!(p.execution && p.execution.simulator && p.execution.simulator.exeSha256)) out.problems.push('the profile is not bound to a simulator executable hash yet');
    // Confidence: share of required items present and clickable, minus penalties for warnings. A number for the preview, not a probability.
    const need = REQUIRED.length + 2, have = REQUIRED.filter((k) => out.controls[k] && out.controls[k].point).length + (out.controls.wager && out.controls.wager.point ? 1 : 0) + (p.execution && p.execution.simulator && p.execution.simulator.exeSha256 ? 1 : 0);
    out.confidence = +Math.max(0, have / need - 0.05 * out.warnings.length - (out.problems.length ? 0.25 : 0)).toFixed(2); out.ready = out.problems.length === 0;
    return out;
  }
  /** Dry run: the points the cursor will visit, in order (the dashboard asks the driver to MOVE there without clicking). */
  function dryRunPlan(p, client) { const r = calibrationReport(p, client); return Object.entries(r.controls).filter(([, c]) => c.point).map(([k, c]) => ({ control: k, point: c.point, rect: c.clickRect })); }
  /** Suggest regions from Windows UI Automation (standard Button/Edit controls of the window), normalised to the client. */
  function suggestFromUia(list, client) {
    const out = {}, norm = (b) => ({ x: (b.x - client.x) / client.w, y: (b.y - client.y) / client.h, w: b.w / client.w, h: b.h / client.h });
    const names = { fold: /^fold$/i, check: /^check$/i, call: /^call/i, raise: /^(raise|bet)/i, allin: /^all.?in/i };
    for (const c of list || []) { if (c.type === 'Edit' && !out.wager) out.wager = norm(c.box); else for (const [k, re] of Object.entries(names)) if (c.type === 'Button' && re.test(c.name || '') && !out[k]) out[k] = norm(c.box); }
    for (const k of Object.keys(out)) if (!G.validNormalized(out[k])) delete out[k]; return out;
  }
  return { CONTROL_KEYS, REQUIRED, fixtureProfile, fromCalibration, calibrationReport, dryRunPlan, suggestFromUia, controlsOf };
});
