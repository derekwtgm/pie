/* EightMax Test Workbench 0.25: table-layout calibration (platform independent).
 *
 * Workflow the operator follows in the dashboard (all of it is data, no source editing):
 *   1. pick a screenshot or window frame            2. optionally let `suggest()` propose the table boundary and card slots
 *   3. move/resize regions (platform-profile.setRegion)   4. add labelled samples (what the screenshot really shows)
 *   5. learn() cuts card and digit templates from those labelled samples       6. preview()/evaluate() on screenshots NOT used for learning
 *   7. export() the profile + templates; the profile stays "unverified" until the operator records evidence.
 * Automatic suggestions are advisory and carry their own confidence; they are never applied silently.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./vision-ocr.js'), require('./platform-profile.js'), require('./hand-state.js'));
  else root.WorkbenchCalibration = factory(root.WorkbenchVisionOcr, root.WorkbenchPlatformProfile, root.WorkbenchHandState);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (O, PP, HS) {
  'use strict';

  const ok = (x, m) => { if (!x) throw new Error(m); };
  const lum = (img, x, y) => { const i = (y * img.width + x) * 4; return (0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2]) / 255; };
  const clone = (x) => JSON.parse(JSON.stringify(x));

  /* ---------- advisory auto-detection ---------- */
  /** Bounding box (normalised) of everything that differs from the border colour. Confidence falls when the box touches the image edge (nothing to separate from). */
  function detectTableBounds(img, opt = {}) {
    const step = Math.max(1, Math.floor(Math.min(img.width, img.height) / 240)), tol = opt.tolerance || 0.06;
    const edge = []; for (let x = 0; x < img.width; x += step) { edge.push(lum(img, x, 0), lum(img, x, img.height - 1)); } for (let y = 0; y < img.height; y += step) { edge.push(lum(img, 0, y), lum(img, img.width - 1, y)); }
    edge.sort((a, b) => a - b); const bg = edge[edge.length >> 1];
    let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
    for (let y = 0; y < img.height; y += step) for (let x = 0; x < img.width; x += step) if (Math.abs(lum(img, x, y) - bg) > tol) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return { found: false, confidence: 0, reason: 'image is uniform' };
    const box = { x: x0 / img.width, y: y0 / img.height, w: (x1 - x0 + step) / img.width, h: (y1 - y0 + step) / img.height };
    const touches = x0 <= step || y0 <= step || x1 >= img.width - step || y1 >= img.height - step;
    return { found: true, box, backgroundLuminance: bg, confidence: touches ? 0.4 : 0.8, aspect: (box.w * img.width) / (box.h * img.height), note: touches ? 'content reaches the image edge: the table may fill the whole window' : undefined };
  }

  /** Card-like light rectangles: 4-connected components of bright pixels on a coarse grid with a card aspect ratio. */
  function detectCardCandidates(img, opt = {}) {
    const cell = Math.max(2, Math.floor(img.width / 320)), gw = Math.floor(img.width / cell), gh = Math.floor(img.height / cell), thr = opt.brightness || 0.78, g = new Uint8Array(gw * gh);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) g[y * gw + x] = lum(img, x * cell, y * cell) >= thr ? 1 : 0;
    // Card faces carry dark pips and glyphs, so close small holes first (dilate then erode, 2 cells) before looking for rectangles.
    const morph = (src, grow) => { const r = new Uint8Array(src.length); for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { let hit = grow ? 0 : 1; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx, yy = y + dy, v = xx >= 0 && yy >= 0 && xx < gw && yy < gh ? src[yy * gw + xx] : 0; if (grow ? v : !v) { hit = grow ? 1 : 0; } } r[y * gw + x] = hit; } return r; };
    g.set(morph(morph(g, true), false));
    const seen = new Uint8Array(gw * gh), out = [];
    for (let s = 0; s < g.length; s++) {
      if (!g[s] || seen[s]) continue; const st = [s]; seen[s] = 1; let x0 = gw, y0 = gh, x1 = 0, y1 = 0, n = 0;
      while (st.length) { const i = st.pop(), x = i % gw, y = (i / gw) | 0; n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); for (const j of [i - 1, i + 1, i - gw, i + gw]) if (j >= 0 && j < g.length && g[j] && !seen[j] && !(Math.abs((j % gw) - x) > 1)) { seen[j] = 1; st.push(j); } }
      const w = x1 - x0 + 1, h = y1 - y0 + 1, fill = n / (w * h), aspect = w / h;
      if (w * cell >= img.width * 0.03 && h * cell >= img.height * 0.05 && aspect > 0.4 && aspect < 1.3 && fill > 0.5) out.push({ box: { x: x0 * cell / img.width, y: y0 * cell / img.height, w: w * cell / img.width, h: h * cell / img.height }, fill, aspect, confidence: Math.max(0.2, Math.min(0.85, 0.3 + fill * 0.4 - Math.abs(aspect - 0.72) * 0.4)) });
    }
    return out.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  }

  /** Map every region of a layout from the unit square into `bounds` (a detected table box), for a quick first guess on a screenshot with margins. */
  function fitLayoutToBounds(layout, bounds) {
    const L = clone(layout), map = (b) => b && ({ x: bounds.x + b.x * bounds.w, y: bounds.y + b.y * bounds.h, w: b.w * bounds.w, h: b.h * bounds.h });
    for (const k of ['pot', 'handId', 'handOver', 'callAmount', 'minRaise']) if (L[k]) L[k] = map(L[k]);
    L.board = L.board.map(map); L.hero = L.hero.map(map); if (L.controls) for (const k of Object.keys(L.controls)) L.controls[k] = map(L.controls[k]);
    L.seats = L.seats.map((s) => { const o = { ...s }; for (const k of ['stack', 'bet', 'folded', 'button', 'active', 'allin']) if (s[k]) o[k] = map(s[k]); return o; });
    return L;
  }

  /** Advisory suggestion for a new screenshot: boundary, aspect, card candidates, and a template profile whose layout is fitted to the boundary. Never marks anything verified. */
  function suggest(img, baseProfile) {
    const b = detectTableBounds(img), cards = detectCardCandidates(img), notes = [];
    if (!b.found) return { ok: false, reason: b.reason };
    const prof = PP.templateProfile('suggested-' + img.width + 'x' + img.height, 'Suggested from screenshot ' + img.width + 'x' + img.height); const base = baseProfile ? clone(baseProfile.layout) : prof.layout;
    const tableAspect = (b.box.w * img.width) / (b.box.h * img.height); const L = fitLayoutToBounds(base, b.box); L.id = prof.id + '-layout'; L.aspect = img.width / img.height; L.aspectTolerance = 0.03; prof.layout = L;
    if (b.confidence < 0.8) notes.push('table boundary is uncertain'); if (!cards.length) notes.push('no card-like rectangles found'); notes.push('regions are a starting template only: move each to match the real table before learning templates');
    return { ok: true, tableBounds: b, tableAspect, cardCandidates: cards.slice(0, 12), profile: prof, confidence: Math.min(b.confidence, cards.length ? 0.8 : 0.5), advisory: true, notes };
  }

  /* ---------- template (de)serialisation: so a profile's recognition templates can be saved and reloaded ---------- */
  const b64 = (typeof Buffer !== 'undefined') ? { enc: (arr) => Buffer.from(Uint8Array.from(arr, (v) => Math.max(0, Math.min(255, Math.round(v * 255))))).toString('base64'), dec: (s) => Array.from(Buffer.from(s, 'base64'), (v) => v / 255) } : { enc: (arr) => btoa(String.fromCharCode(...Array.from(arr, (v) => Math.max(0, Math.min(255, Math.round(v * 255)))))), dec: (s) => Array.from(atob(s), (c) => c.charCodeAt(0) / 255) };
  const dumpSet = (set) => set.t.map((t) => [t.label, b64.enc(t.pixels)]);
  const fillSet = (set, rows) => { for (const [label, data] of rows) set.add(label, { pixels: b64.dec(data), contrast: 1 }); return set; };
  function exportTemplates(cal) {
    const split = !!cal.cards.split; return { format: 'eightmax-templates', version: 1, split, glyphs: dumpSet(cal.glyphs), cards: split ? { ranks: dumpSet(cal.cards.ranks), suits: dumpSet(cal.cards.suits) } : dumpSet(cal.cards) };
  }
  function importTemplates(data) {
    ok(data && data.format === 'eightmax-templates' && data.version === 1, 'Not an EightMax template file');
    const glyphs = fillSet(new O.GlyphTemplates(), data.glyphs); let cards;
    if (data.split) { cards = new O.SplitCardReader(); fillSet(cards.ranks, data.cards.ranks); fillSet(cards.suits, data.cards.suits); } else cards = fillSet(new O.CardTemplates(), data.cards);
    return { glyphs, cards };
  }

  /* ---------- the calibration session ---------- */
  /** Compare an observation with operator truth. Returns per-category {correct, wrong}. */
  function compare(observation, truth) {
    const c = { card: [0, 0], stack: [0, 0], bet: [0, 0], pot: [0, 0], seat: [0, 0], action: [0, 0] }, hit = (k, good) => { c[k][good ? 0 : 1]++; };
    const cs = (a) => (a || []).map((x) => HS.cardToString(x)).join(',');
    hit('card', cs(observation.board) === cs(truth.board)); const hs = observation.seats[observation.heroSeat]; if (truth.hero) hit('card', cs(hs && hs.cards) === cs(truth.hero));
    hit('pot', observation.pot === truth.pot); if (truth.stacks) truth.stacks.forEach((v, i) => hit('stack', observation.seats[i].stack === v)); if (truth.bets) truth.bets.forEach((v, i) => hit('bet', observation.seats[i].bet === (v || 0)));
    if (truth.button !== undefined) hit('seat', observation.button === truth.button); if (truth.actor !== undefined) hit('seat', observation.actor === truth.actor);
    if (observation.controls && truth.callAmount !== undefined) hit('action', observation.callAmount === truth.callAmount);
    return c;
  }

  class CalibrationSession {
    constructor(profile) { const v = PP.validateProfile(profile); ok(v.valid, 'Invalid profile: ' + v.issues.join('; ')); this.profile = clone(profile); this.samples = []; this.cal = null; this.splitCards = false; }
    get layout() { return this.profile.layout; }
    /** Edit one region (returns validation errors rather than corrupting the profile). */
    setRegion(path, box) { this.profile = PP.setRegion(this.profile, path, box); this.cal = null; return this.profile; }
    addSample(image, truth) {
      ok(image && image.width && image.data, 'image required'); ok(truth && Array.isArray(truth.board) && truth.pot !== undefined, 'truth needs board[] and pot');
      this.samples.push({ image, truth }); this.cal = null; return this.samples.length;
    }
    learn(opt = {}) {
      ok(this.samples.length >= 1, 'Add at least one labelled sample'); this.splitCards = !!opt.splitCards; this.cal = O.calibrateFromLabeled(this.layout, this.samples, { splitCards: this.splitCards });
      const missing = []; for (const r of '23456789TJQKA') for (const s of 'cdhs') if (!this.splitCards && !this.cal.cards.t.some((t) => t.label === r + s)) missing.push(r + s);
      const digits = new Set(this.cal.glyphs.t.map((t) => t.label)); const missingDigits = [...'0123456789'].filter((d) => !digits.has(d));
      return { stats: this.cal.stats, templatesCards: this.splitCards ? this.cal.cards.ranks.t.length : this.cal.cards.t.length, templatesGlyphs: this.cal.glyphs.t.length, missingDigits, missingCardsCount: missing.length, complete: !missing.length && !missingDigits.length, advice: missingDigits.length || missing.length ? 'Add samples showing the missing digits/cards; unknown symbols are rejected, never guessed.' : 'Templates cover every digit' + (this.splitCards ? '' : ' and card') + '.' };
    }
    observer(table = 1) { ok(this.cal, 'Run learn() first'); return new O.ImageObserver({ table, profiles: this.cal.profiles, cards: this.cal.cards, glyphs: this.cal.glyphs }); }
    /** Read one image and return the observation plus an overlay list (region -> what was read) for the preview UI. */
    preview(image, meta = {}) {
      const r = this.observer().observe(image, meta); const overlay = PP.allRegions(this.profile).map((x) => ({ path: x.path, box: x.box }));
      return { ok: r.ok, reasons: r.reasons || [], observation: r.ok ? r.observation : null, reads: r.reads || null, overlay, confidence: r.ok ? r.observation.confidence.overall : 0 };
    }
    /** Accuracy on samples that were NOT used for learning. A frame the reader refuses counts as rejected, not wrong. */
    evaluate(samples, opt = {}) {
      const obs = this.observer(), tot = { frames: 0, accepted: 0, rejected: 0, exact: 0, falseAcceptances: 0, categories: { card: [0, 0], stack: [0, 0], bet: [0, 0], pot: [0, 0], seat: [0, 0], action: [0, 0] } };
      for (const s of samples) {
        tot.frames++; const r = obs.observe(s.image, { heroSeat: s.truth.heroSeat || 0 }); if (!r.ok) { tot.rejected++; continue; }
        tot.accepted++; const c = compare(r.observation, s.truth); let wrong = 0; for (const k of Object.keys(c)) { tot.categories[k][0] += c[k][0]; tot.categories[k][1] += c[k][1]; wrong += c[k][1]; }
        if (wrong) tot.falseAcceptances++; else tot.exact++;
      }
      return { ...tot, rejectionRate: tot.frames ? tot.rejected / tot.frames : null, acceptedStateAccuracy: tot.accepted ? tot.exact / tot.accepted : null, dataset: opt.dataset || 'unspecified', realClient: false };
    }
    /** Profile + templates bundle for saving. Profile stays unverified: only the operator can attach evidence. */
    export() { ok(this.cal, 'Run learn() first'); const p = clone(this.profile); p.verification = { status: 'unverified', externalClient: null, evidence: [], note: 'Calibrated by the operator; not yet verified against frames held out from calibration' }; return { profile: PP.saveProfile(p), templates: exportTemplates(this.cal) }; }
    static import(bundle) { const r = PP.loadProfile(bundle.profile); ok(r.ok, 'Profile rejected: ' + (r.problems || []).join('; ')); const s = new CalibrationSession(r.profile); const t = importTemplates(bundle.templates); s.cal = { profiles: new O.ProfileSet().add(r.profile.layout), cards: t.cards, glyphs: t.glyphs, stats: {} }; s.splitCards = !!t.cards.split; return s; }
  }

  /** Programmatically derive an UNSEEN layout from an existing one (shift + scale of the whole table), for generalisation tests and as a worked example of "a different table". */
  function variantLayout(layout, { dx = 0, dy = 0, sx = 1, sy = 1, id } = {}) {
    const L = clone(layout), mv = (b) => b && ({ x: b.x * sx + dx, y: b.y * sy + dy, w: b.w * sx, h: b.h * sy });
    for (const k of ['pot', 'handId', 'handOver', 'callAmount', 'minRaise']) if (L[k]) L[k] = mv(L[k]);
    L.board = L.board.map(mv); L.hero = L.hero.map(mv); if (L.controls) for (const k of Object.keys(L.controls)) L.controls[k] = mv(L.controls[k]);
    L.seats = L.seats.map((s) => { const o = { ...s }; for (const k of ['stack', 'bet', 'folded', 'button', 'active', 'allin']) if (s[k]) o[k] = mv(s[k]); return o; }); L.id = id || layout.id + '-variant'; return L;
  }

  return { detectTableBounds, detectCardCandidates, fitLayoutToBounds, suggest, exportTemplates, importTemplates, compare, CalibrationSession, variantLayout };
});
