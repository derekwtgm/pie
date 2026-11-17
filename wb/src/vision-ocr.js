/* EightMax Test Workbench 0.20: glyph OCR, layout profiles and image observation.
 *
 * Reads user-supplied screenshots or frames from a controlled simulator display. No screen capture,
 * no process access, no client interaction. Recognition is template based: every value carries a
 * score and margin, anything below threshold is returned as unreadable and never guessed.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./vision.js'), require('./hand-state.js'));
  else root.WorkbenchVisionOcr = factory(root.WorkbenchVision, root.WorkbenchHandState);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (V, HS) {
  'use strict';

  const ok = (x, m) => { if (!x) throw new Error(m); };
  const lum = (img, x, y) => { const i = (y * img.width + x) * 4; return (0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2]) / 255; };

  /** Layout profile: named normalised regions. Scale-independent, so any resolution with the same aspect ratio reads. */
  function defaultLayout() {
    const seats = [], cx = 0.5, cy = 0.5;
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 2 + i * Math.PI / 4, x = cx + 0.38 * Math.cos(a), y = cy + 0.36 * Math.sin(a);
      seats.push({ seat: i, stack: { x: x - 0.06, y: y - 0.025, w: 0.12, h: 0.05 }, bet: { x: x - 0.045 + (cx - x) * 0.35, y: y - 0.025 + (cy - y) * 0.35, w: 0.09, h: 0.05 },
        folded: { x: x - 0.06, y: y - 0.055, w: 0.012, h: 0.02 }, button: { x: x - 0.04, y: y - 0.055, w: 0.012, h: 0.02 }, active: { x: x - 0.02, y: y - 0.055, w: 0.012, h: 0.02 } });
    }
    const board = Array.from({ length: 5 }, (_, i) => ({ x: 0.31 + i * 0.075, y: 0.44, w: 0.06, h: 0.12 }));
    return { id: 'eightmax-8max-v1', aspect: 1.6, aspectTolerance: 0.03, minWidth: 800, seats, board, hero: [{ x: 0.26, y: 0.80, w: 0.06, h: 0.12 }, { x: 0.33, y: 0.80, w: 0.06, h: 0.12 }], pot: { x: 0.44, y: 0.36, w: 0.12, h: 0.05 } };
  }

  /** Split a region into glyph boxes by column ink projection. Polarity: ink is the minority luminance class. */
  function segmentGlyphs(img, box, opt = {}) {
    const x0 = Math.floor(box.x * img.width), x1 = Math.min(img.width, Math.ceil((box.x + box.w) * img.width));
    const y0 = Math.floor(box.y * img.height), y1 = Math.min(img.height, Math.ceil((box.y + box.h) * img.height));
    ok(x1 > x0 && y1 > y0, 'Empty region');
    let lo = 1, hi = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const v = lum(img, x, y); lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (hi - lo < (opt.minContrast || 0.2)) return { glyphs: [], contrast: hi - lo };
    const mid = (hi + lo) / 2; let dark = 0, total = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { total++; if (lum(img, x, y) < mid) dark++; }
    const inkIsDark = dark < total / 2, isInk = (v) => (inkIsDark ? v < mid : v >= mid);
    const cols = []; for (let x = x0; x < x1; x++) { let n = 0; for (let y = y0; y < y1; y++) if (isInk(lum(img, x, y))) n++; cols.push(n > 0); }
    const glyphs = []; let start = -1;
    for (let i = 0; i <= cols.length; i++) {
      if (i < cols.length && cols[i]) { if (start < 0) start = i; }
      else if (start >= 0) {
        const gx0 = x0 + start, gx1 = x0 + i; let top = y1, bottom = y0;
        for (let y = y0; y < y1; y++) for (let x = gx0; x < gx1; x++) if (isInk(lum(img, x, y))) { top = Math.min(top, y); bottom = Math.max(bottom, y + 1); }
        glyphs.push({ x: gx0 / img.width, y: top / img.height, w: (gx1 - gx0) / img.width, h: (bottom - top) / img.height, pxW: gx1 - gx0, pxH: bottom - top });
        start = -1;
      }
    }
    return { glyphs, contrast: hi - lo, inkIsDark };
  }

  /** Correlation template set (glyphs or cards). Score is Pearson correlation; accepted only with an absolute floor and a margin over the runner-up. */
  class TemplateSet {
    constructor(labelPattern, minScore, minMargin) { this.pattern = labelPattern; this.minScore = minScore; this.minMargin = minMargin; this.t = []; }
    add(label, normalized) { ok(this.pattern.test(label), 'Invalid template label ' + label); ok(normalized.contrast > 0.05, 'Template has too little contrast'); this.t.push({ label, pixels: normalized.pixels }); }
    classify(normalized) {
      if (normalized.contrast <= 0.05) return { accepted: false, label: null, score: 0, margin: 0 };
      const by = new Map(), n = normalized.pixels.length, mb = normalized.pixels.reduce((a, b) => a + b, 0) / n;
      for (const t of this.t) {
        // Pearson correlation: invariant to brightness offset and gain, so scaled renders of the same glyph agree.
        const mt = t.pixels.reduce((a, b) => a + b, 0) / n; let sxy = 0, sxx = 0, syy = 0;
        for (let i = 0; i < n; i++) { const a = t.pixels[i] - mt, b = normalized.pixels[i] - mb; sxy += a * b; sxx += a * a; syy += b * b; }
        const score = sxx > 0 && syy > 0 ? Math.max(0, sxy / Math.sqrt(sxx * syy)) : 0;
        by.set(t.label, Math.max(by.get(t.label) || 0, score));
      }
      const r = [...by].map(([label, score]) => ({ label, score })).sort((a, b) => b.score - a.score);
      if (r.length < 2) return { accepted: false, label: null, score: 0, margin: 0 };
      const margin = r[0].score - r[1].score;
      return { ...r[0], margin, accepted: r[0].score >= this.minScore && margin >= this.minMargin };
    }
  }
  const GlyphTemplates = class extends TemplateSet { constructor() { super(/^[0-9.]$/, 0.75, 0.05); } };
  const CardTemplates = class extends TemplateSet { constructor() { super(/^[2-9TJQKA][cdhs]$/, 0.85, 0.05); } };
  /** Normalise a glyph box with the shared 24x32 sampler; polarity is fixed so light-on-dark and dark-on-light agree. */
  function glyphPixels(img, g, inkIsDark) {
    const n = V.normalize(img, { x: g.x, y: g.y, w: Math.min(g.w, 1 - g.x), h: Math.min(g.h, 1 - g.y) });
    return inkIsDark ? { pixels: n.pixels.map((p) => 1 - p), contrast: n.contrast } : n;
  }
  /** Read an integer chip amount (digits only). Returns {value, confidence, accepted, reason}. */
  function readAmount(img, box, templates, opt = {}) {
    const seg = segmentGlyphs(img, box, opt);
    if (!seg.glyphs.length) return { accepted: false, value: null, confidence: 0, reason: 'No ink found (blank or low contrast)' };
    if (seg.glyphs.length > (opt.maxDigits || 8)) return { accepted: false, value: null, confidence: 0, reason: 'Too many glyphs' };
    let text = '', conf = 1;
    for (const g of seg.glyphs) {
      const c = templates.classify(glyphPixels(img, g, seg.inkIsDark));
      if (!c.accepted) return { accepted: false, value: null, confidence: Math.min(conf, c.score), reason: 'Unreadable glyph (score ' + c.score.toFixed(2) + ', margin ' + c.margin.toFixed(3) + ')' };
      text += c.label; conf = Math.min(conf, c.score);
    }
    if (!/^\d{1,8}$/.test(text)) return { accepted: false, value: null, confidence: conf, reason: 'Not an integer: ' + text };
    return { accepted: true, value: Number(text), confidence: conf, text };
  }
  /** Presence marker: mean luminance of the region against a threshold, confidence from distance to it. */
  function readMarker(img, box, opt = {}) {
    const x0 = Math.floor(box.x * img.width), x1 = Math.max(x0 + 1, Math.ceil((box.x + box.w) * img.width)), y0 = Math.floor(box.y * img.height), y1 = Math.max(y0 + 1, Math.ceil((box.y + box.h) * img.height));
    let s = 0, n = 0; for (let y = y0; y < y1 && y < img.height; y++) for (let x = x0; x < x1 && x < img.width; x++) { s += lum(img, x, y); n++; }
    const mean = s / n, thr = opt.threshold || 0.5;
    return { present: mean >= thr, confidence: Math.min(1, 0.5 + Math.abs(mean - thr) * 1.5) };
  }

  /** Layout registry: select the profile by aspect ratio; unknown aspect is rejected, never stretched. */
  class ProfileSet {
    constructor() { this.profiles = new Map(); }
    add(layout) { ok(layout && layout.id && layout.seats && layout.seats.length === 8, 'Layout needs an id and eight seats'); this.profiles.set(layout.id, layout); return this; }
    select(img) {
      const a = img.width / img.height;
      for (const p of this.profiles.values()) if (Math.abs(a / p.aspect - 1) <= p.aspectTolerance) return { profile: p, scale: img.width / 960, exactScale: img.width === 960, tooSmall: img.width < (p.minWidth || 800) };
      return null;
    }
  }

  /** Reads one table image into an eightmax-observation, or explains exactly why it cannot. */
  class ImageObserver {
    constructor({ table, profiles, cards, glyphs, bankroll = 20000 }) {
      this.table = table; this.profiles = profiles; this.cards = cards; this.glyphs = glyphs; this.seq = 0; this.bankroll = bankroll;
    }
    observe(img, meta = {}) {
      const sel = this.profiles.select(img);
      if (!sel) return { ok: false, reasons: ['unrecognized-layout: image aspect ' + (img.width / img.height).toFixed(3) + ' matches no calibrated profile'] };
      if (sel.tooSmall) return { ok: false, reasons: ['resolution-too-low: ' + img.width + ' px wide; at least ' + (sel.profile.minWidth || 800) + ' px is needed for reliable digit reading'] };
      const L = sel.profile, reasons = [], conf = {}, readCard = (box) => this.cards.classify(V.normalize(img, box));
      const seats = [];
      const board = []; let boardConf = 1;
      for (const b of L.board) {
        const seg = segmentGlyphs(img, b, { minContrast: 0.15 });
        if (!seg.glyphs.length) break; // empty slot
        const c = readCard(b);
        if (!c.accepted) { reasons.push('board card unreadable (score ' + c.score.toFixed(2) + ')'); boardConf = 0; break; }
        board.push(HS.cardFromString(c.label)); boardConf = Math.min(boardConf, c.score);
      }
      const hero = []; let heroConf = 1;
      for (const b of L.hero) { const c = readCard(b); if (!c.accepted) { hero.length = 0; heroConf = 0; reasons.push('hero cards unreadable'); break; } hero.push(HS.cardFromString(c.label)); heroConf = Math.min(heroConf, c.score); }
      const pot = readAmount(img, L.pot, this.glyphs); if (!pot.accepted) reasons.push('pot: ' + pot.reason);
      let stackConf = 1, button = -1, actor = -1, buttonConf = 0, actorConf = 0, buttons = 0, actives = 0;
      for (const s of L.seats) {
        const st = readAmount(img, s.stack, this.glyphs), bt = readAmount(img, s.bet, this.glyphs, { maxDigits: 8 });
        const folded = readMarker(img, s.folded), btn = readMarker(img, s.button), act = readMarker(img, s.active);
        if (!st.accepted) reasons.push('seat ' + s.seat + ' stack: ' + st.reason);
        // A blank bet field means "no wager"; only an unreadable non-blank field is an error.
        const betBlank = segmentGlyphs(img, s.bet).glyphs.length === 0;
        if (!bt.accepted && !betBlank) reasons.push('seat ' + s.seat + ' bet: ' + bt.reason);
        stackConf = Math.min(stackConf, st.confidence || 0);
        if (btn.present) { button = s.seat; buttons++; buttonConf = btn.confidence; }
        if (act.present) { actor = s.seat; actives++; actorConf = act.confidence; }
        seats.push({ seat: s.seat, stack: st.value, bet: betBlank ? 0 : bt.value, folded: folded.present, cards: s.seat === 0 && hero.length === 2 ? hero.slice() : null });
      }
      if (buttons !== 1) reasons.push('dealer button: found ' + buttons + ' markers');
      const complete = meta.status === 'complete';
      if (!complete && actives !== 1) reasons.push('active player: found ' + actives + ' markers');
      if (reasons.length) return { ok: false, reasons };
      const street = ['preflop', 'flop', 'turn', 'river'][{ 0: 0, 3: 1, 4: 2, 5: 3 }[board.length]];
      if (street === undefined) return { ok: false, reasons: ['board shows ' + board.length + ' cards, not 0, 3, 4 or 5'] };
      const overall = Math.min(boardConf, pot.confidence, stackConf, buttonConf, complete ? 1 : actorConf);
      return {
        ok: true,
        observation: {
          format: 'eightmax-observation', version: 1, table: this.table, seq: meta.seq === undefined ? this.seq++ : meta.seq, source: 'image', capturedAt: meta.capturedAt || 0,
          layout: { id: L.id, seats: 8 }, hand: meta.hand, status: complete ? 'complete' : 'playing', street, board, button, actor: complete ? -1 : actor, pot: pot.value, seats,
          actions: meta.actions, confidence: { overall, fields: { board: boardConf, pot: pot.confidence, stacks: stackConf, button: buttonConf, actor: complete ? 1 : actorConf, street: boardConf } },
          scale: sel.scale,
        },
      };
    }
  }

  /** Per-field precision / recall / error rate against labelled truth. Unreadable outputs count as misses, not errors. */
  function scoreReads(truth, predicted) {
    let tp = 0, fp = 0, fn = 0, wrong = 0, rejected = 0;
    for (const k of Object.keys(truth)) {
      const p = predicted[k], t = truth[k];
      if (p === undefined || p === null) { fn++; rejected++; } else if (p === t) tp++; else { fp++; fn++; wrong++; }
    }
    const n = Object.keys(truth).length;
    return { fields: n, correct: tp, wrong, rejected, precision: tp + fp ? tp / (tp + fp) : null, recall: n ? tp / n : null, errorRate: n ? wrong / n : null, rejectionRate: n ? rejected / n : null };
  }

  /** Replay a recorded sequence of observations through a fresh engine; reports every rejection and the pause points. */
  function replayObservations(frames, engineOptions) {
    const e = new HS.HandStateEngine(frames[0] && frames[0].table || 1, engineOptions);
    const out = { frames: frames.length, accepted: 0, rejected: 0, pausedFrames: [], issues: [] };
    for (const f of frames) {
      const r = e.ingest(f);
      if (r.accepted) out.accepted++; else { out.rejected++; out.issues.push({ seq: f.seq, issues: r.issues }); }
      if (r.paused) out.pausedFrames.push(f.seq);
    }
    out.finalRevision = e.revision; out.finalState = e.state;
    return out;
  }

  return { defaultLayout, segmentGlyphs, TemplateSet, GlyphTemplates, CardTemplates, glyphPixels, readAmount, readMarker, ProfileSet, ImageObserver, scoreReads, replayObservations };
});
