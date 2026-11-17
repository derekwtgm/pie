'use strict';
// Deterministic synthetic renderer of a controlled-simulator table view (NOT a real poker client). Used to exercise
// the image path end to end at several resolutions. Nearest-neighbour scaling, optional pixel noise.
const V = require('../src/vision.js'), O = require('../src/vision-ocr.js'), HS = require('../src/hand-state.js');
const FONT = { 0: '01110100011001110101110011000101110', 1: '00100011000010000100001000010001110', 2: '01110100010000100010001000100011111', 3: '11110000010000101110000010000111110', 4: '00010001100101010010111110001000010', 5: '11111100001111000001000011000101110', 6: '00110010001000011110100011000101110', 7: '11111000010001000100010000100001000', 8: '01110100011000101110100011000101110', 9: '01110100011000101111000010001001100' };
const L = O.defaultLayout();
function makeImage(w, noise, seed) {
  const h = Math.round(w / 1.6), d = new Uint8ClampedArray(w * h * 4); let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  for (let i = 0; i < w * h; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 40; d[i * 4 + 3] = 255; }
  const px = (x, y, v) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; };
  const rect = (b, v) => { for (let y = Math.floor(b.y * h); y < Math.ceil((b.y + b.h) * h); y++) for (let x = Math.floor(b.x * w); x < Math.ceil((b.x + b.w) * w); x++) px(x, y, v); };
  const text = (b, str) => {
    const bx = Math.floor(b.x * w), by = Math.floor(b.y * h), bw = Math.ceil(b.w * w), bh = Math.ceil(b.h * h), cw = Math.max(5, Math.floor(bw / 8)), ch = Math.max(7, Math.floor(bh * 0.9));
    for (let k = 0; k < str.length; k++) for (let y = 0; y < ch; y++) for (let x = 0; x < cw - 1; x++) { const fx = Math.floor(x * 5 / (cw - 1)), fy = Math.floor(y * 7 / ch); if (FONT[str[k]][fy * 5 + fx] === '1') px(bx + k * cw + x, by + y, 235); }
  };
  const card = (b, id) => {
    rect(b, 225); let bits = (BigInt(id + 1) * 0x9E3779B97F4A7C15n) & ((1n << 48n) - 1n);
    const bx = b.x * w, by = b.y * h, bw = b.w * w, bh = b.h * h;
    for (let gy = 0; gy < 8; gy++) for (let gx = 0; gx < 6; gx++) { if ((bits >> BigInt(gy * 6 + gx)) & 1n) { const x0 = Math.floor(bx + (gx + 0.5) * bw / 7), x1 = Math.floor(bx + (gx + 1.5) * bw / 7), y0 = Math.floor(by + (gy + 0.5) * bh / 9), y1 = Math.floor(by + (gy + 1.5) * bh / 9); for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px(x, y, 20); } }
    // guaranteed ink in every card so every pattern is non-blank and distinct per id
    rect({ x: b.x + b.w * 0.05, y: b.y + b.h * 0.02, w: b.w * 0.9, h: b.h * 0.03 }, 20);
  };
  const finish = () => { if (noise) for (let i = 0; i < w * h; i++) { const n = Math.round((rnd() - 0.5) * 2 * noise); for (let c = 0; c < 3; c++) d[i * 4 + c] = Math.max(0, Math.min(255, d[i * 4 + c] + n)); } return { width: w, height: h, data: d }; };
  return { rect, text, card, finish };
}
/** Render a simulator snapshot (+ table internals) as a screenshot. */
function renderTable(t, w = 960, opt = {}) {
  const im = makeImage(w, opt.noise || 0, opt.seed || 7), snap = t.snapshot();
  im.text(L.pot, String(snap.pot));
  snap.board.forEach((c, i) => im.card(L.board[i], c));
  L.seats.forEach((s, i) => {
    const p = snap.players[i]; im.text(s.stack, String(p.stack)); if (p.bet > 0) im.text(s.bet, String(p.bet));
    if (p.folded) im.rect(s.folded, 255); if (t.dealer === i) im.rect(s.button, 255); if (t.actor === i && t.status === 'playing') im.rect(s.active, 255);
  });
  if (!opt.hideHero) snap.players[0].cards.forEach((c, i) => im.card(L.hero[i], c));
  return im.finish();
}
/** Calibrate templates from clean base-size renders. */
function calibrate(widths = [800, 960, 1440, 1920]) {
  const profiles = new O.ProfileSet().add(L), cards = new O.CardTemplates(), glyphs = new O.GlyphTemplates();
  // One calibration profile per supported resolution (templates from clean renders at each width).
  for (const w of widths) {
    for (let c = 0; c < 52; c++) { const m = makeImage(w, 0, 1); m.card(L.board[0], c); cards.add(HS.cardToString(c), V.normalize(m.finish(), L.board[0])); }
    for (let dgt = 0; dgt < 10; dgt++) { const m = makeImage(w, 0, 1); m.text(L.pot, String(dgt) + String((dgt + 1) % 10)); const img = m.finish(); const seg = O.segmentGlyphs(img, L.pot); glyphs.add(String(dgt), O.glyphPixels(img, seg.glyphs[0], seg.inkIsDark)); }
  }
  return { profiles, cards, glyphs };
}
module.exports = { renderTable, calibrate, makeImage, L };
