'use strict';
/* 0.25 calibration generalisation report. Every row is a SYNTHETIC / controlled-renderer dataset (kept apart from browser-render and real-client domains).
 * For each condition: calibrate (labelled frames) -> evaluate on frames NOT used for calibration. Rows:
 *   same layout; three UNSEEN layouts (shifted/scaled); other resolutions with and without recalibration; a profile calibrated for another layout.
 * usage: node tools/calibration-report.cjs reports/0.25-recognition-calibration.json [trainHands=6] [testHands=3] */
const fs = require('node:fs'), path = require('node:path');
const CAL = require('../src/calibration.js'), PP = require('../src/platform-profile.js'), SIM = require('../src/sim-display.js'), EM = require('../src/engine.js'), M = require('../src/vision-metrics.js');
const out = process.argv[2], TRAIN = +(process.argv[3] || 6), TEST = +(process.argv[4] || 3);
function frames(layout, width, seed, hands, noise = 0) {
  const res = [], t = new EM.Table(1, seed);
  for (let h = 0; h < hands; h++) { t.startHand(); for (let g = 0; g < 80 && t.status === 'playing'; g++) { const hero = t.actor, tr = M.truthFromTable(t, hero); res.push({ image: SIM.renderTable(t, width, { v2: true, layout, heroSeat: hero, seed: res.length + 3, noise }), truth: { ...tr, heroSeat: hero, callAmount: tr.callAmount === null ? undefined : tr.callAmount, minRaise: tr.minRaise === null ? undefined : tr.minRaise } }); const a = EM.policy(t); t.execute(t.request(a.type, a.amount, 0), 0); } }
  return res;
}
const base = PP.controlledProfile(2), rows = [];
function mk(layout, id) { return { ...base, id, name: id, layout, verification: { status: 'unverified', externalClient: null, evidence: [] } }; }
function row(name, trainLayout, trainWidth, testLayout, testWidth, o = {}) {
  const t0 = Date.now(), cs = new CAL.CalibrationSession(mk(trainLayout, 'cal-' + rows.length + '-profile'));
  for (const f of frames(trainLayout, trainWidth, 100 + rows.length, TRAIN)) cs.addSample(f.image, f.truth);
  const l = cs.learn(), ev = cs.evaluate(frames(testLayout, testWidth, 900 + rows.length, TEST, o.noise || 0), { dataset: name });
  rows.push({ name, trainFrames: cs.samples.length, learned: { glyphTemplates: l.templatesGlyphs, cardTemplates: l.templatesCards, complete: l.complete }, testWidth, frames: ev.frames, accepted: ev.accepted, rejected: ev.rejected, rejectionRate: ev.rejectionRate, falseAcceptances: ev.falseAcceptances, acceptedStateAccuracy: ev.acceptedStateAccuracy, categories: Object.fromEntries(Object.entries(ev.categories).map(([k, [c, w]]) => [k, { correct: c, wrong: w }])), domain: 'synthetic (controlled renderer)', realClient: false, ms: Date.now() - t0 });
  process.stderr.write(name + ': ' + ev.accepted + '/' + ev.frames + ' accepted, false acceptances ' + ev.falseAcceptances + '\n');
}
const L = base.layout, unseen = [CAL.variantLayout(L, { dx: 0.02, dy: -0.01, sx: 0.96, sy: 0.97, id: 'unseen-A' }), CAL.variantLayout(L, { dx: -0.015, dy: 0.02, sx: 0.97, sy: 0.95, id: 'unseen-B' }), CAL.variantLayout(L, { dx: 0.0, dy: 0.0, sx: 0.94, sy: 0.94, id: 'unseen-C' })];
row('same layout, held-out frames, 960 px', L, 960, L, 960);
unseen.forEach((u) => row('unseen layout ' + u.id + ' (calibrated on it), 960 px', u, 960, u, 960));
unseen.forEach((u) => row('profile calibrated for the original layout, tested on ' + u.id, L, 960, u, 960));
for (const w of [800, 1440, 1920]) { row('resolution ' + w + ' px, calibrated at ' + w, L, w, L, w); row('resolution ' + w + ' px, templates from 960 px only', L, 960, L, w); }
row('noise ±12, calibrated clean', L, 960, L, 960, { noise: 12 }); row('noise ±40, calibrated clean', L, 960, L, 960, { noise: 40 });
const doc = { format: 'eightmax-calibration-report', version: 1, appVersion: EM.VERSION, generatedAt: new Date().toISOString(), trainHandsPerRow: TRAIN, testHandsPerRow: TEST, domainNote: 'All rows are controlled-renderer images. No external client was measured; real-client accuracy is NOT measured.', realClient: { frames: 0, measured: false }, rows, totals: { frames: rows.reduce((n, r) => n + r.frames, 0), falseAcceptances: rows.reduce((n, r) => n + r.falseAcceptances, 0) } };
fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(doc, null, 2)); process.stderr.write('TOTAL frames ' + doc.totals.frames + ' false acceptances ' + doc.totals.falseAcceptances + '\n');
