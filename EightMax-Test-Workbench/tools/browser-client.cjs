'use strict';
/* The offline controlled poker client drawn by a REAL browser engine (Chromium via Playwright, when available).
 * Same table, same calibrated layout as src/sim-display.js, but pixels come from genuine font rasterisation, anti-aliasing and
 * device-pixel-ratio scaling, so the recognition path is tested on something other than its own pixel renderer.
 * This is still OUR client: results are labelled 'browser-render', never 'real-client'. */
const IC = require('../src/image-codec.js'), SIM = require('../src/sim-display.js'), HS = require('../src/hand-state.js');
const L = SIM.L2, SUIT = { c: '♣', d: '♦', h: '♥', s: '♠' }, RED = { d: 1, h: 1 };
const pct = (b) => 'left:' + b.x * 100 + '%;top:' + b.y * 100 + '%;width:' + b.w * 100 + '%;height:' + b.h * 100 + '%';

function renderHtml(t, opt = {}) {
  const hero = opt.heroSeat || 0, snap = t.snapshot(), at = (p) => (p + hero) % 8, vh = opt.viewportHeight || 600, parts = [];
  const num = (b, v) => parts.push('<div class="n" style="' + pct(b) + ';font-size:' + Math.round(b.h * vh * 0.62) + 'px">' + v + '</div>');
  const rect = (b, c) => parts.push('<div class="r" style="' + pct(b) + ';background:' + c + '"></div>');
  const card = (b, id) => { const s = HS.cardToString(id), rank = s[0] === 'T' ? '10' : s[0], red = RED[s[1]]; parts.push('<div class="c" style="' + pct(b) + ';color:' + (red ? '#c01818' : '#111') + '"><span style="font-size:' + Math.round(b.h * vh * 0.42) + 'px">' + rank + '</span><span style="font-size:' + Math.round(b.h * vh * 0.4) + 'px">' + SUIT[s[1]] + '</span></div>'); };
  num(L.pot, snap.pot); snap.board.forEach((c, i) => card(L.board[i], c));
  L.seats.forEach((s, p) => { const q = at(p), pl = snap.players[q]; num(s.stack, pl.stack); if (pl.bet > 0) num(s.bet, pl.bet); if (pl.folded) rect(s.folded, '#fff'); if (t.dealer === q) rect(s.button, '#fff'); if (t.actor === q && t.status === 'playing') rect(s.active, '#fff'); if (pl.stack === 0 && !pl.folded) rect(s.allin, '#fff'); });
  snap.players[at(0)].cards.forEach((c, i) => card(L.hero[i], c));
  num(L.handId, snap.hand); if (t.status === 'complete') rect(L.handOver, '#fff');
  const lg = t.status === 'playing' && t.actor === hero ? t.legal() : null;
  const on = lg ? { fold: lg.toCall > 0, check: lg.canCheck, call: lg.toCall > 0, raise: lg.canRaise } : {};
  for (const k of ['fold', 'check', 'call', 'raise']) rect(L.controls[k], on[k] ? '#fff' : '#323232');
  if (lg && lg.toCall > 0) num(L.callAmount, lg.callAmount); if (lg && lg.canRaise) num(L.minRaise, Math.min(lg.minRaiseTo, lg.maxRaiseTo));
  return '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#282828;overflow:hidden}.n{position:absolute;display:flex;align-items:center;color:#ebebeb;font-family:"DejaVu Sans Mono",monospace;font-weight:bold;letter-spacing:.12em;white-space:nowrap}.r{position:absolute}.c{position:absolute;background:#f0f0f0;border-radius:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:"DejaVu Sans",sans-serif;font-weight:bold;line-height:1}</style><body>' + parts.join('') + '</body>';
}

class BrowserClient {
  constructor(options = {}) { this.vw = options.width || 960; this.vh = Math.round(this.vw / 1.6); this.contexts = new Map(); this.browser = null; }
  async open() { const { chromium } = require('playwright'); this.browser = await chromium.launch(); return this; }
  async _page(dpr) {
    if (!this.contexts.has(dpr)) { const ctx = await this.browser.newContext({ viewport: { width: this.vw, height: this.vh }, deviceScaleFactor: dpr }); this.contexts.set(dpr, { ctx, page: await ctx.newPage() }); }
    return this.contexts.get(dpr).page;
  }
  /** Screenshot of the table at a device pixel ratio; returns a decoded RGBA image. Goes through PNG, like a real capture file. */
  async shot(t, opt = {}) {
    const page = await this._page(opt.dpr || 1); await page.setContent(renderHtml(t, { heroSeat: opt.heroSeat || 0, viewportHeight: this.vh }));
    return IC.decodePng(await page.screenshot({ type: 'png' }));
  }
  async close() { if (this.browser) await this.browser.close(); this.browser = null; }
}
let available = null;
function browserAvailable() { if (available === null) { try { require.resolve('playwright'); available = true; } catch (e) { available = false; } } return available; }
module.exports = { renderHtml, BrowserClient, browserAvailable };
