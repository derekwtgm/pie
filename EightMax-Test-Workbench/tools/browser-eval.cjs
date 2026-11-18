'use strict';
/* Calibrate the recogniser on labelled browser-rendered screenshots, then measure it on held-out ones.
 * Domain: 'browser-render' (a real browser's rasterisation of OUR controlled client). Not a real poker client. */
const EM = require('../src/engine.js'), O = require('../src/vision-ocr.js'), SIM = require('../src/sim-display.js'), M = require('../src/vision-metrics.js'), HS = require('../src/hand-state.js');
const { BrowserClient } = require('./browser-client.cjs'), CAP = require('../src/screen-capture.js');

/** Tables staged so that every card and every digit appears in every box type (operator-style calibration deck). */
function* calibrationTables() {
  const digitsA = [1234, 5678, 9012, 3456, 7890, 2468, 1357, 9080];
  for (let f = 0; f < 9; f++) {
    const t = new EM.Table(1, 100 + f); t.startHand(); const cards = Array.from({ length: 52 }, (_, i) => i);
    const base = (f * 7) % 52, pick = (k) => cards[(base + k) % 52];
    t.board = [pick(0), pick(1), pick(2), pick(3), pick(4)]; t.players[0].cards = [pick(5), pick(6)];
    t.players.forEach((p, i) => { p.stack = digitsA[(i + f) % 8] + (f % 3) * 1; p.bet = (i * 111 + f * 37 + 90) % 999 + 10; p.total = p.bet; });
    t.hand = 1000000 + f * 1111111 % 9000000; t.actor = (f % 7) + 1; yield t;
  }
}
async function calibrate(bc, dpr, splitCards = true) {
  const samples = [];
  for (const t of calibrationTables()) { const heroSeat = 0, img = await bc.shot(t, { heroSeat, dpr }), snap = t.snapshot(); samples.push({ image: img, truth: { board: t.board.slice(), hero: t.players[0].cards.slice(), pot: snap.pot, hand: t.hand, stacks: snap.players.map((p) => p.stack), bets: snap.players.map((p) => p.bet), heroSeat } }); }
  // second pass: realistic game states (control numerals: call amount and minimum raise)
  const g = new EM.Table(1, 4242), r = new EM.RNG(9);
  for (let h = 0; h < 6; h++) { g.startHand(); let n = 0; while (g.status === 'playing' && n++ < 40) { const hero = g.actor, l = g.legal(), truth = M.truthFromTable(g, hero); samples.push({ image: await bc.shot(g, { heroSeat: hero, dpr }), truth: { ...truth, callAmount: truth.callAmount === null ? undefined : truth.callAmount, minRaise: truth.minRaise === null ? undefined : truth.minRaise } }); const a = EM.policy(g); g.execute(g.request(a.type, a.amount, 0), 0); } }
  const cal = O.calibrateFromLabeled(SIM.L2, samples, { splitCards });
  return cal;
}
/** Random held-out play: every decision frame is read and scored. */
async function evaluate(bc, cal, dpr, hands, seed = 777) {
  const obs = new O.ImageObserver({ table: 1, profiles: cal.profiles, cards: cal.cards, glyphs: cal.glyphs }), mc = new M.MetricsCollector(), t = new EM.Table(1, seed);
  const engine = new HS.HandStateEngine(1, { track: true, expectedLayout: 'eightmax-8max-v2' }); let seq = 0, n = 0;
  for (let h = 0; h < hands; h++) {
    t.startHand();
    for (let g = 0; g < 80; g++) {
      const hero = t.status === 'playing' ? t.actor : 0, truth = M.truthFromTable(t, hero), img = await bc.shot(t, { heroSeat: hero, dpr }), res = obs.observe(img, { heroSeat: hero, seq: seq++ });
      let eng = null; if (res.ok) eng = engine.ingest(res.observation);
      mc.add('browser-render', truth, res, eng); n++;
      if (t.status !== 'playing') break; const a = EM.policy(t); t.execute(t.request(a.type, a.amount, 0), 0);
    }
  }
  return { frames: n, report: mc.report().domains['browser-render'] };
}
module.exports = { calibrate, evaluate, calibrationTables };
if (require.main === module) {
  (async () => {
    const out = process.argv[2], hands = +(process.argv[3] || 8), results = {}, bc = await new BrowserClient().open();
    for (const dpr of [1, 1.25, 1.5, 2]) { const t0 = Date.now(), cal = await calibrate(bc, dpr), ev = await evaluate(bc, cal, dpr, hands); results['dpr ' + dpr] = { imageWidth: Math.round(960 * dpr), calibration: cal.stats && { cardTemplates: cal.stats.cards, glyphTemplates: cal.stats.glyphs, skipped: cal.stats.skipped.length }, frames: ev.frames, ...ev.report, seconds: (Date.now() - t0) / 1000 }; console.error('dpr', dpr, 'readable', ev.report.readable + '/' + ev.report.frames, 'accepted', ev.report.accepted, 'false acceptances', ev.report.falseAcceptances); }
    await bc.close(); const doc = { format: 'eightmax-browser-render-recognition', version: 1, domain: 'browser-render', note: 'Chromium-rendered controlled client; real font rasterisation; NOT an external poker client', generatedAt: new Date().toISOString(), results };
    if (out) require('node:fs').writeFileSync(out, JSON.stringify(doc, null, 2)); else console.log(JSON.stringify(doc, null, 2));
  })().catch((e) => { console.error(e); process.exit(1); });
}
