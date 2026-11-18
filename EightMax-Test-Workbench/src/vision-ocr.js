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

  /**
   * Layout v2 (0.24): v1 plus hand id, per-seat all-in markers, the hand-over banner, the action-control strip
   * and the call / minimum-raise numerals. Controls are recognised by calibrated position and lit/dim state,
   * not by reading their text labels (the glyph set is digits only).
   */
  function defaultLayoutV2() {
    const L = defaultLayout();
    L.id = 'eightmax-8max-v2';
    L.seats = L.seats.map((s) => ({ ...s, allin: { x: s.stack.x + 0.06, y: s.stack.y - 0.03, w: 0.012, h: 0.02 } }));
    L.handId = { x: 0.02, y: 0.02, w: 0.12, h: 0.05 };
    L.handOver = { x: 0.40, y: 0.30, w: 0.20, h: 0.03 };
    L.controls = { fold: { x: 0.60, y: 0.93, w: 0.10, h: 0.05 }, check: { x: 0.72, y: 0.93, w: 0.10, h: 0.05 }, call: { x: 0.84, y: 0.93, w: 0.07, h: 0.05 }, raise: { x: 0.92, y: 0.93, w: 0.07, h: 0.05 } };
    L.callAmount = { x: 0.72, y: 0.87, w: 0.10, h: 0.05 };
    L.minRaise = { x: 0.84, y: 0.87, w: 0.12, h: 0.05 };
    return L;
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
    add(label, normalized) {
      ok(this.pattern.test(label), 'Invalid template label ' + label); ok(normalized.contrast > 0.05, 'Template has too little contrast');
      // Centre and normalise once: classification is then a single dot product per template (Pearson correlation).
      const n = normalized.pixels.length, mean = normalized.pixels.reduce((a, b) => a + b, 0) / n, c = new Float64Array(n); let ss = 0;
      for (let i = 0; i < n; i++) { c[i] = normalized.pixels[i] - mean; ss += c[i] * c[i]; }
      this.t.push({ label, pixels: normalized.pixels, centred: c, norm: Math.sqrt(ss) });
    }
    classify(normalized) {
      if (normalized.contrast <= 0.05) return { accepted: false, label: null, score: 0, margin: 0 };
      const by = new Map(), n = normalized.pixels.length; let mb = 0; for (let i = 0; i < n; i++) mb += normalized.pixels[i]; mb /= n;
      const q = new Float64Array(n); let syy = 0; for (let i = 0; i < n; i++) { q[i] = normalized.pixels[i] - mb; syy += q[i] * q[i]; }
      const qn = Math.sqrt(syy);
      for (const t of this.t) {
        // Pearson correlation: invariant to brightness offset and gain, so scaled renders of the same glyph agree.
        let score = 0;
        if (t.norm > 0 && qn > 0) { let sxy = 0; const c = t.centred; for (let i = 0; i < n; i++) sxy += c[i] * q[i]; score = Math.max(0, sxy / (t.norm * qn)); }
        if (score > (by.get(t.label) || 0)) by.set(t.label, score); else if (!by.has(t.label)) by.set(t.label, score);
      }
      const r = [...by].map(([label, score]) => ({ label, score })).sort((a, b) => b.score - a.score);
      if (r.length < 2) return { accepted: false, label: null, score: 0, margin: 0 };
      const margin = r[0].score - r[1].score;
      return { ...r[0], margin, accepted: r[0].score >= this.minScore && margin >= this.minMargin };
    }
  }
  const GlyphTemplates = class extends TemplateSet { constructor() { super(/^[0-9.]$/, 0.75, 0.05); } };
  const CardTemplates = class extends TemplateSet { constructor() { super(/^[2-9TJQKA][cdhs]$/, 0.85, 0.05); } };
  const RankTemplates = class extends TemplateSet { constructor() { super(/^[2-9TJQKA]$/, 0.8, 0.04); } };
  const SuitTemplates = class extends TemplateSet { constructor() { super(/^[cdhs]$/, 0.8, 0.04); } };

  /** Tight ink bounding box (normalised image coordinates) of everything inside `box`; null when blank. Makes shape reading independent of small shifts. */
  function inkBox(img, box, opt = {}) {
    const seg = segmentGlyphs(img, box, { minContrast: opt.minContrast || 0.12 }); if (!seg.glyphs.length) return null;
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0; for (const g of seg.glyphs) { x0 = Math.min(x0, g.x); y0 = Math.min(y0, g.y); x1 = Math.max(x1, g.x + g.w); y1 = Math.max(y1, g.y + g.h); }
    return { x: x0, y: y0, w: Math.min(1 - x0, x1 - x0), h: Math.min(1 - y0, y1 - y0), inkIsDark: seg.inkIsDark };
  }
  /** Mean colour of the ink pixels in a normalised box: 'red' or 'black' (or null when unclear). */
  function inkColour(img, b) {
    const x0 = Math.floor(b.x * img.width), x1 = Math.max(x0 + 1, Math.ceil((b.x + b.w) * img.width)), y0 = Math.floor(b.y * img.height), y1 = Math.max(y0 + 1, Math.ceil((b.y + b.h) * img.height));
    let r = 0, g = 0, bl = 0, n = 0, lo = 1, hi = 0; for (let y = y0; y < y1 && y < img.height; y++) for (let x = x0; x < x1 && x < img.width; x++) { const L = lum(img, x, y); lo = Math.min(lo, L); hi = Math.max(hi, L); }
    const mid = (lo + hi) / 2; for (let y = y0; y < y1 && y < img.height; y++) for (let x = x0; x < x1 && x < img.width; x++) if (lum(img, x, y) < mid) { const i = (y * img.width + x) * 4; r += img.data[i]; g += img.data[i + 1]; bl += img.data[i + 2]; n++; }
    if (!n) return null; r /= n; g /= n; bl /= n; return r > 1.35 * Math.max(g, bl) && r - Math.max(g, bl) > 25 ? 'red' : (r - Math.max(g, bl) < 18 ? 'black' : null);
  };
  /**
   * Card reader that reads RANK and SUIT separately (corner rank, suit pip) instead of the whole card face, which is how
   * real clients differ from the built-in renderer. A card is accepted only if both parts pass their own score and margin
   * AND the suit's colour (red/black) agrees with the ink. Rank and suit regions are tight-cropped to their ink first.
   */
  class SplitCardReader {
    constructor(opt = {}) { this.split = true; this.ranks = new RankTemplates(); this.suits = new SuitTemplates(); this.rankFrac = opt.rankFrac || 0.55; }
    parts(img, box) {
      const rankBox = { x: box.x, y: box.y, w: box.w, h: box.h * this.rankFrac }, suitBox = { x: box.x, y: box.y + box.h * this.rankFrac, w: box.w, h: box.h * (1 - this.rankFrac) };
      const rb = inkBox(img, rankBox), sb = inkBox(img, suitBox); if (!rb || !sb) return null;
      return { rb, sb, rank: V.normalize(img, rb), suit: V.normalize(img, sb) };
    }
    add(label, img, box) { const p = this.parts(img, box); ok(p, 'Card region has no readable ink'); this.ranks.add(label[0], p.rank); this.suits.add(label[1], p.suit); }
    classify(img, box) {
      const p = this.parts(img, box); if (!p) return { accepted: false, label: null, score: 0, margin: 0 };
      const r = this.ranks.classify(p.rank), s = this.suits.classify(p.suit);
      if (!r.accepted || !s.accepted) return { accepted: false, label: null, score: Math.min(r.score, s.score), margin: Math.min(r.margin, s.margin), rank: r, suit: s };
      const col = inkColour(img, p.sb), want = (s.label === 'h' || s.label === 'd') ? 'red' : 'black';
      if (col && col !== want) return { accepted: false, label: null, score: 0, margin: 0, reason: 'suit shape and colour disagree' };
      return { accepted: true, label: r.label + s.label, score: Math.min(r.score, s.score), margin: Math.min(r.margin, s.margin), rank: r, suit: s };
    }
  }

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

  /**
   * Operator calibration from LABELLED screenshots: each sample is {image, truth:{board, hero, pot, hand, stacks[8], bets[8], callAmount, minRaise, heroSeat}} in the
   * client's own rendering. Card and digit templates are cut from the labelled regions, so the reader learns the client's actual fonts and anti-aliasing.
   * Returns {profiles, cards, glyphs, stats}. A sample whose glyph count disagrees with its label is skipped and reported, never forced.
   */
  function calibrateFromLabeled(layout, samples, opt = {}) {
    const profiles = new ProfileSet().add(layout), cards = opt.splitCards ? new SplitCardReader() : new CardTemplates(), glyphs = new GlyphTemplates(), stats = { samples: samples.length, cards: 0, glyphs: 0, skipped: [] };
    const addNumber = (img, box, value, where) => {
      if (value === undefined || value === null || value === 0 && where.startsWith('bet')) return;
      const text = String(value), seg = segmentGlyphs(img, box);
      if (seg.glyphs.length !== text.length) { stats.skipped.push(where + ' (' + seg.glyphs.length + ' glyphs for "' + text + '")'); return; }
      seg.glyphs.forEach((g, i) => { glyphs.add(text[i], glyphPixels(img, g, seg.inkIsDark)); stats.glyphs++; });
    };
    for (const smp of samples) {
      const img = smp.image, t = smp.truth, rot = t.heroSeat || 0;
      const addCard = (c, box) => { try { if (cards.split) cards.add(HS.cardToString(c), img, box); else cards.add(HS.cardToString(c), V.normalize(img, box)); stats.cards++; } catch (e) { stats.skipped.push('card ' + HS.cardToString(c) + ': ' + e.message); } };
      (t.board || []).forEach((c, i) => { if (layout.board[i]) addCard(c, layout.board[i]); });
      (t.hero || []).forEach((c, i) => { if (layout.hero[i]) addCard(c, layout.hero[i]); });
      addNumber(img, layout.pot, t.pot, 'pot'); if (layout.handId) addNumber(img, layout.handId, t.hand, 'hand');
      layout.seats.forEach((s, p) => { const q = (p + rot) % 8; addNumber(img, s.stack, t.stacks && t.stacks[q], 'stack ' + q); addNumber(img, s.bet, t.bets && t.bets[q], 'bet ' + q); });
      if (layout.callAmount) { addNumber(img, layout.callAmount, t.callAmount, 'call'); addNumber(img, layout.minRaise, t.minRaise, 'minraise'); }
    }
    return { profiles, cards, glyphs, stats };
  }

  /** Configurable OCR regions: a custom layout must name every region, keep each inside the image and not overlap another numeral box. Returns {valid, issues}. */
  function validateLayout(L) {
    const issues = [], inside = (b, n) => { if (!b || !['x', 'y', 'w', 'h'].every((k) => Number.isFinite(b[k])) || b.x < 0 || b.y < 0 || b.w <= 0 || b.h <= 0 || b.x + b.w > 1.0000001 || b.y + b.h > 1.0000001) issues.push(n + ' is missing or outside the image'); };
    if (!L || typeof L.id !== 'string') return { valid: false, issues: ['Layout needs an id'] };
    if (!Number.isFinite(L.aspect) || L.aspect <= 0) issues.push('aspect missing'); if (!Array.isArray(L.seats) || L.seats.length !== 8) issues.push('eight seats required');
    const named = [['pot', L.pot]]; (L.board || []).forEach((b, i) => named.push(['board ' + i, b])); (L.hero || []).forEach((b, i) => named.push(['hero ' + i, b])); if (!Array.isArray(L.board) || L.board.length !== 5) issues.push('five board slots required'); if (!Array.isArray(L.hero) || L.hero.length !== 2) issues.push('two hero slots required');
    (L.seats || []).forEach((s, i) => { for (const k of ['stack', 'bet', 'folded', 'button', 'active']) named.push(['seat ' + i + ' ' + k, s && s[k]]); }); if (L.handId) named.push(['handId', L.handId]); if (L.controls) { for (const k of ['fold', 'check', 'call', 'raise']) named.push(['control ' + k, L.controls[k]]); named.push(['callAmount', L.callAmount], ['minRaise', L.minRaise]); }
    for (const [n, b] of named) inside(b, n);
    const numeric = named.filter(([n]) => /stack|bet|pot|handId|callAmount|minRaise/.test(n)).filter(([, b]) => b), ov = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (let i = 0; i < numeric.length; i++) for (let j = i + 1; j < numeric.length; j++) if (numeric[i][1] && numeric[j][1] && ov(numeric[i][1], numeric[j][1])) issues.push(numeric[i][0] + ' overlaps ' + numeric[j][0]);
    return { valid: issues.length === 0, issues };
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
    _readSplit(img, box, jitter) {
      let best = this.cards.classify(img, box); if (best.accepted) return best;
      for (let dy = -jitter; dy <= jitter; dy++) for (let dx = -jitter; dx <= jitter; dx++) {
        if (!dx && !dy) continue; const nb = { x: box.x + dx / img.width, y: box.y + dy / img.height, w: box.w, h: box.h }; if (nb.x < 0 || nb.y < 0 || nb.x + nb.w > 1 || nb.y + nb.h > 1) continue;
        const c = this.cards.classify(img, nb); if (c.accepted) return c; if (c.score > best.score) best = c;
      }
      return best;
    }
    /** Best correlation of a card region over small pixel shifts (tolerates a window that moved a pixel or two). */
    _readCard(img, box, jitter) {
      let best = this.cards.classify(V.normalize(img, box));
      if (best.accepted && best.score > 0.97) return best;
      for (let dy = -jitter; dy <= jitter; dy++) for (let dx = -jitter; dx <= jitter; dx++) {
        if (!dx && !dy) continue;
        const nb = { x: box.x + dx / img.width, y: box.y + dy / img.height, w: box.w, h: box.h };
        if (nb.x < 0 || nb.y < 0 || nb.x + nb.w > 1 || nb.y + nb.h > 1) continue;
        const c = this.cards.classify(V.normalize(img, nb));
        if (c.score > best.score) best = c;
      }
      return best;
    }
    observe(img, meta = {}) {
      const sel = this.profiles.select(img);
      if (!sel) return { ok: false, reasons: ['unrecognized-layout: image aspect ' + (img.width / img.height).toFixed(3) + ' matches no calibrated profile'] };
      if (sel.tooSmall) return { ok: false, reasons: ['resolution-too-low: ' + img.width + ' px wide; at least ' + (sel.profile.minWidth || 800) + ' px is needed for reliable digit reading'] };
      const L = sel.profile, v2 = !!L.controls, reasons = [], jitter = meta.jitter === undefined ? (v2 ? 2 : 0) : meta.jitter;
      const readCard = (box) => (this.cards.split ? this._readSplit(img, box, jitter) : jitter ? this._readCard(img, box, jitter) : this.cards.classify(V.normalize(img, box)));
      const rot = Number.isInteger(meta.heroSeat) ? meta.heroSeat : 0; if (rot < 0 || rot > 7) return { ok: false, reasons: ['hero seat ' + rot + ' out of range'] };
      const reads = { cards: [], amounts: [], markers: [] }, abs = (p) => (p + rot) % 8;
      const board = []; let boardConf = 1;
      for (const b of L.board) {
        const seg = segmentGlyphs(img, b, { minContrast: 0.15 });
        if (!seg.glyphs.length) break; // empty slot
        const c = readCard(b);
        if (!c.accepted) { reasons.push('board card unreadable (score ' + c.score.toFixed(2) + ')'); boardConf = 0; reads.cards.push({ field: 'board', accepted: false, score: c.score }); break; }
        board.push(HS.cardFromString(c.label)); boardConf = Math.min(boardConf, c.score); reads.cards.push({ field: 'board', accepted: true, label: c.label, score: c.score, margin: c.margin });
      }
      const hero = []; let heroConf = 1;
      for (const b of L.hero) { const c = readCard(b); if (!c.accepted) { hero.length = 0; heroConf = 0; reasons.push('hero cards unreadable'); reads.cards.push({ field: 'hero', accepted: false, score: c.score }); break; } hero.push(HS.cardFromString(c.label)); heroConf = Math.min(heroConf, c.score); reads.cards.push({ field: 'hero', accepted: true, label: c.label, score: c.score, margin: c.margin }); }
      const pot = readAmount(img, L.pot, this.glyphs); if (!pot.accepted) reasons.push('pot: ' + pot.reason); reads.amounts.push({ field: 'pot', ...pot });
      let handId = null, handConf = 1;
      if (L.handId) { const h = readAmount(img, L.handId, this.glyphs); reads.amounts.push({ field: 'hand', ...h }); if (h.accepted) { handId = h.value; handConf = h.confidence; } else reasons.push('hand id: ' + h.reason); }
      const over = L.handOver ? readMarker(img, L.handOver) : null; const complete = over ? over.present : meta.status === 'complete';
      let stackConf = 1, betConf = 1, button = -1, actor = -1, buttonConf = 0, actorConf = 0, buttons = 0, actives = 0, markerConf = 1;
      const seatsByPos = [];
      for (const s of L.seats) {
        const st = readAmount(img, s.stack, this.glyphs), bt = readAmount(img, s.bet, this.glyphs, { maxDigits: 8 });
        const folded = readMarker(img, s.folded), btn = readMarker(img, s.button), act = readMarker(img, s.active), all = s.allin ? readMarker(img, s.allin) : null;
        reads.amounts.push({ field: 'stack', seat: abs(s.seat), ...st }); reads.markers.push({ field: 'folded', seat: abs(s.seat), present: folded.present, confidence: folded.confidence });
        if (!st.accepted) reasons.push('seat ' + abs(s.seat) + ' stack: ' + st.reason);
        // A blank bet field means "no wager"; only an unreadable non-blank field is an error.
        const betBlank = segmentGlyphs(img, s.bet).glyphs.length === 0;
        if (!bt.accepted && !betBlank) reasons.push('seat ' + abs(s.seat) + ' bet: ' + bt.reason);
        if (!betBlank) reads.amounts.push({ field: 'bet', seat: abs(s.seat), ...bt });
        stackConf = Math.min(stackConf, st.confidence || 0); if (!betBlank) betConf = Math.min(betConf, bt.confidence || 0);
        markerConf = Math.min(markerConf, folded.confidence, btn.confidence);
        if (btn.present) { button = abs(s.seat); buttons++; buttonConf = btn.confidence; }
        if (act.present) { actor = abs(s.seat); actives++; actorConf = act.confidence; }
        seatsByPos[abs(s.seat)] = { seat: abs(s.seat), stack: st.value, bet: betBlank ? 0 : bt.value, folded: folded.present, allInMarker: all ? all.present : undefined, cards: s.seat === 0 && hero.length === 2 ? hero.slice() : null };
      }
      const seats = seatsByPos;
      if (buttons !== 1) reasons.push('dealer button: found ' + buttons + ' markers');
      if (!complete && actives !== 1) reasons.push('active player: found ' + actives + ' markers');
      let controls = null, callAmount = null, minRaiseTo = null, ctlConf = 1;
      if (v2 && !complete) {
        controls = {}; for (const k of ['fold', 'check', 'call', 'raise']) { const m = readMarker(img, L.controls[k]); controls[k] = m.present; ctlConf = Math.min(ctlConf, m.confidence); reads.markers.push({ field: 'control-' + k, present: m.present, confidence: m.confidence }); }
        if (controls.call) { const c = readAmount(img, L.callAmount, this.glyphs); reads.amounts.push({ field: 'callAmount', ...c }); if (c.accepted) callAmount = c.value; else reasons.push('call amount: ' + c.reason); }
        if (controls.raise) { const c = readAmount(img, L.minRaise, this.glyphs); reads.amounts.push({ field: 'minRaise', ...c }); if (c.accepted) minRaiseTo = c.value; else reasons.push('minimum raise: ' + c.reason); }
      }
      if (reasons.length) return { ok: false, reasons, reads };
      const street = ['preflop', 'flop', 'turn', 'river'][{ 0: 0, 3: 1, 4: 2, 5: 3 }[board.length]];
      if (street === undefined) return { ok: false, reasons: ['board shows ' + board.length + ' cards, not 0, 3, 4 or 5'], reads };
      const overall = v2 ? Math.min(boardConf, pot.confidence, stackConf, buttonConf, complete ? 1 : actorConf, handConf, betConf, markerConf, ctlConf) : Math.min(boardConf, pot.confidence, stackConf, buttonConf, complete ? 1 : actorConf);
      // Hero seat in absolute numbering is the rotation offset; hole cards are only ever visible there.
      if (hero.length === 2) { for (const q of seats) q.cards = null; seats[abs(0)].cards = hero.slice(); }
      return {
        ok: true, reads,
        observation: {
          format: 'eightmax-observation', version: 1, table: this.table, seq: meta.seq === undefined ? this.seq++ : meta.seq, source: 'image', capturedAt: meta.capturedAt || 0,
          layout: { id: L.id, seats: 8 }, hand: v2 ? handId : meta.hand, status: complete ? 'complete' : 'playing', street, board, button, actor: complete ? -1 : actor, pot: pot.value, seats,
          actions: meta.actions, heroSeat: rot, controls: controls || undefined, callAmount: callAmount === null ? undefined : callAmount, minRaiseTo: minRaiseTo === null ? undefined : minRaiseTo,
          confidence: { overall, fields: { board: boardConf, pot: pot.confidence, stacks: stackConf, button: buttonConf, actor: complete ? 1 : actorConf, street: boardConf, hand: handConf, bets: betConf, controls: ctlConf } },
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

  return { defaultLayout, defaultLayoutV2, validateLayout, calibrateFromLabeled, SplitCardReader, inkBox, inkColour, segmentGlyphs, TemplateSet, GlyphTemplates, CardTemplates, glyphPixels, readAmount, readMarker, ProfileSet, ImageObserver, scoreReads, replayObservations };
});
