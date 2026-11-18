/* EightMax Test Workbench 0.25: PLATFORM PROFILES.
 *
 * A profile is data, not code: it says where things are on a table image, which capture methods may be used,
 * what the game structure is and which AUTHORISED execution interface (if any) the table offers. Profiles can be
 * loaded, validated, edited and saved without touching the solver, the simulator or any source file.
 *
 * Shipped profiles describe ONLY this application's own controlled test-table renderer. There is no profile for
 * any external poker client: none has been inspected or authorised, and `verification.externalClient` is always
 * null unless an operator records evidence for a client they are permitted to test.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./vision-ocr.js'));
  else root.WorkbenchPlatformProfile = factory(root.WorkbenchVisionOcr);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (O) {
  'use strict';

  const FORMAT = 'eightmax-platform-profile', VERSION = 1;
  const CAPTURE_METHODS = Object.freeze(['windows-graphics-capture', 'printwindow', 'bitblt', 'window', 'desktop-region', 'screenshot-file', 'video-replay', 'structured-feed']);
  const EXECUTION_INTERFACES = Object.freeze(['none', 'internal-simulation', 'test-server-api', 'approved-ui-automation']);
  const VERIFICATION = Object.freeze(['controlled-renderer', 'unverified', 'verified-by-operator']);
  const BETTING = Object.freeze(['no-limit']);

  /* ---------- SHA-256 (pure JS, so the browser dashboard and Node agree) ---------- */
  const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function utf8(str) { const out = []; for (const ch of str) { let c = ch.codePointAt(0); if (c < 0x80) out.push(c); else if (c < 0x800) out.push(0xc0 | c >> 6, 0x80 | c & 63); else if (c < 0x10000) out.push(0xe0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63); else out.push(0xf0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63); } return out; }
  function sha256(text) {
    const m = utf8(text), l = m.length, withPad = m.concat([0x80]); while (withPad.length % 64 !== 56) withPad.push(0);
    const hi = Math.floor(l * 8 / 0x100000000), lo = (l * 8) >>> 0; withPad.push(hi >>> 24 & 255, hi >>> 16 & 255, hi >>> 8 & 255, hi & 255, lo >>> 24 & 255, lo >>> 16 & 255, lo >>> 8 & 255, lo & 255);
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]), w = new Uint32Array(64), rr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < withPad.length; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = (withPad[o + i * 4] << 24) | (withPad[o + i * 4 + 1] << 16) | (withPad[o + i * 4 + 2] << 8) | withPad[o + i * 4 + 3];
      for (let i = 16; i < 64; i++) { const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0; }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) { const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + K[i] + w[i]) | 0, S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22), mj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + mj) | 0; h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0; }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('');
  }
  /** Canonical JSON: sorted keys, so the checksum does not depend on key order. */
  function canonical(v) { if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'; if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}'; return JSON.stringify(v); }
  const clone = (x) => JSON.parse(JSON.stringify(x));

  /* ---------- validation ---------- */
  /** Returns {valid, issues[], warnings[]}. Never throws on bad input. */
  function validateProfile(p) {
    const issues = [], warnings = [], bad = (m) => issues.push(m);
    if (!p || typeof p !== 'object') return { valid: false, issues: ['Profile is not an object'], warnings };
    if (p.format !== FORMAT) bad('format must be ' + FORMAT);
    if (p.version !== VERSION) bad('unsupported profile version ' + p.version);
    if (typeof p.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,62}$/.test(p.id)) bad('id must be 3-63 chars of a-z 0-9 . _ -');
    if (typeof p.name !== 'string' || !p.name.trim()) bad('name required');
    const v = p.verification || {};
    if (!VERIFICATION.includes(v.status)) bad('verification.status must be one of ' + VERIFICATION.join(', '));
    if (v.status === 'verified-by-operator' && !(Array.isArray(v.evidence) && v.evidence.length)) bad('verified-by-operator needs verification.evidence (what was tested, when, with permission from whom)');
    if (v.status !== 'verified-by-operator' && v.externalClient) bad('an external client may be named only after operator verification with evidence');
    if (v.status === 'controlled-renderer' && v.externalClient) bad('controlled-renderer profiles cannot name an external client');
    const c = p.capture || {};
    if (!Array.isArray(c.methods) || !c.methods.length) bad('capture.methods needs at least one method'); else for (const m of c.methods) if (!CAPTURE_METHODS.includes(m)) bad('unknown capture method ' + m);
    if (c.preferred !== undefined) { if (!Array.isArray(c.preferred) || c.preferred.some((m) => !(c.methods || []).includes(m))) bad('capture.preferred must list only methods named in capture.methods'); }
    const sc = c.scaling || {}; if (!(sc.referenceWidth >= 320 && sc.referenceWidth <= 8192)) bad('capture.scaling.referenceWidth must be 320..8192'); if (sc.minWidth !== undefined && !(sc.minWidth >= 160 && sc.minWidth <= sc.referenceWidth * 2)) bad('capture.scaling.minWidth out of range');
    const lay = p.layout; if (!lay) bad('layout missing'); else { const r = O.validateLayout(lay); for (const i of r.issues) bad('layout: ' + i); if (!Number.isFinite(lay.aspectTolerance) || lay.aspectTolerance < 0 || lay.aspectTolerance > 0.2) bad('layout.aspectTolerance must be 0..0.2'); if (!lay.controls) warnings.push('layout has no action controls: legal actions cannot be read from the image'); if (!lay.handId) warnings.push('layout has no hand id region: hand changes are inferred, not read'); }
    const s = p.structure || {};
    if (!Number.isInteger(s.players) || s.players < 2 || s.players > 8) bad('structure.players must be 2..8');
    else if (lay && s.players !== 8) warnings.push('structure.players=' + s.players + ': the 0.25 image reader still has eight seat slots; unused seats must be blank');
    if (!BETTING.includes(s.betting)) bad('structure.betting must be one of ' + BETTING.join(', '));
    const b = s.blinds || {}; if (!(b.bb > 0 && b.sb > 0 && b.sb <= b.bb && b.ante >= 0)) bad('structure.blinds needs sb>0, bb>=sb, ante>=0'); if (!(b.unit > 0)) bad('structure.blinds.unit (chips per BB) must be positive');
    if (!(s.startingStackBb > 0 && s.startingStackBb <= 5000)) bad('structure.startingStackBb must be in (0,5000]');
    const e = p.execution || {}; if (!EXECUTION_INTERFACES.includes(e.interface)) bad('execution.interface must be one of ' + EXECUTION_INTERFACES.join(', '));
    if (e.interface === 'approved-ui-automation' || e.interface === 'test-server-api') { if (e.requiresAuthorization !== true) bad('external execution interfaces require requiresAuthorization=true'); if (e.interface === 'approved-ui-automation' && !(e.controls && typeof e.controls === 'object')) warnings.push('approved-ui-automation without action-control geometry: the adapter must supply it'); }
    if (p.ocr && !(p.ocr.minConfidence >= 0.5 && p.ocr.minConfidence <= 1)) bad('ocr.minConfidence must be 0.5..1');
    return { valid: issues.length === 0, issues, warnings };
  }

  /* ---------- save / load ---------- */
  /** Serialise with an integrity checksum over the canonical body. */
  function saveProfile(profile) {
    const v = validateProfile(profile); if (!v.valid) throw new Error('Refusing to save an invalid profile: ' + v.issues.join('; '));
    const body = clone(profile); delete body.integrity; return JSON.stringify({ ...body, integrity: { sha256: sha256(canonical(body)), savedBy: 'EightMax Test Workbench 0.25' } }, null, 2);
  }
  /** Parse + verify checksum + validate. Returns {ok, profile?, problems[]}; never trusts an edited file silently. */
  function loadProfile(text, opt = {}) {
    let o; try { o = typeof text === 'string' ? JSON.parse(text) : clone(text); } catch (e) { return { ok: false, problems: ['Not valid JSON: ' + e.message] }; }
    const problems = [], integ = o && o.integrity; if (o) delete o.integrity;
    if (!integ || typeof integ.sha256 !== 'string') { if (!opt.allowUnsigned) problems.push('No integrity checksum; save the profile from the workbench or pass allowUnsigned'); }
    else if (integ.sha256 !== sha256(canonical(o))) problems.push('Checksum mismatch: the profile was changed after saving');
    const v = validateProfile(o); problems.push(...v.issues);
    return problems.length ? { ok: false, problems, warnings: v.warnings } : { ok: true, profile: o, warnings: v.warnings };
  }

  /* ---------- editing ---------- */
  const REGION_PATHS = /^(pot|handId|handOver|callAmount|minRaise|board\.[0-4]|hero\.[01]|controls\.(fold|check|call|raise)|seats\.[0-7]\.(stack|bet|folded|button|active|allin))$/;
  /** Move or resize one named region (normalised 0..1 box). Returns a NEW profile; the old one is untouched. Rejects an edit that makes the layout invalid. */
  function setRegion(profile, path, box) {
    if (!REGION_PATHS.test(path)) throw new Error('Unknown region ' + path);
    if (!box || !['x', 'y', 'w', 'h'].every((k) => Number.isFinite(box[k]))) throw new Error('Region needs numeric x,y,w,h');
    const p = clone(profile), parts = path.split('.'); let o = p.layout; for (let i = 0; i < parts.length - 1; i++) { o = o[parts[i]]; if (o === undefined) throw new Error('Layout has no ' + path); }
    o[parts[parts.length - 1]] = { x: +box.x.toFixed(5), y: +box.y.toFixed(5), w: +box.w.toFixed(5), h: +box.h.toFixed(5) };
    const v = validateProfile(p); if (!v.valid) throw new Error('Edit rejected: ' + v.issues.join('; '));
    p.verification = { status: 'unverified', externalClient: null, note: 'Edited after creation: re-verify before use' };
    return p;
  }
  function allRegions(profile) {
    const L = profile.layout, out = [];
    for (const k of ['pot', 'handId', 'handOver', 'callAmount', 'minRaise']) if (L[k]) out.push({ path: k, box: L[k] });
    L.board.forEach((b, i) => out.push({ path: 'board.' + i, box: b })); L.hero.forEach((b, i) => out.push({ path: 'hero.' + i, box: b }));
    if (L.controls) for (const k of Object.keys(L.controls)) out.push({ path: 'controls.' + k, box: L.controls[k] });
    L.seats.forEach((s, i) => { for (const k of ['stack', 'bet', 'folded', 'button', 'active', 'allin']) if (s[k]) out.push({ path: 'seats.' + i + '.' + k, box: s[k] }); });
    return out;
  }

  /* ---------- shipped samples: the application's OWN controlled renderer only ---------- */
  function controlledProfile(version) {
    const layout = clone(version === 1 ? O.defaultLayout() : O.defaultLayoutV2()); layout.aspectTolerance = layout.aspectTolerance === undefined ? 0.03 : layout.aspectTolerance;
    return {
      format: FORMAT, version: VERSION, id: 'eightmax-controlled-8max-v' + version, name: 'EightMax controlled test table (layout v' + version + ')',
      description: 'The workbench\'s own offline test-table renderer. Synthetic: accuracy measured with this profile says nothing about any external client.',
      verification: { status: 'controlled-renderer', externalClient: null, evidence: [] },
      capture: { methods: ['structured-feed', 'screenshot-file', 'video-replay', 'window', 'desktop-region', 'printwindow', 'bitblt'], preferred: ['structured-feed', 'window', 'printwindow'], scaling: { referenceWidth: 960, minWidth: layout.minWidth || 800, dpiAware: true }, windowMatch: { titleContains: 'EightMax controlled client' } },
      layout,
      ocr: { minConfidence: 0.8, digitsOnly: true, glyphSource: 'calibrated-templates' },
      structure: { players: 8, betting: 'no-limit', blinds: { sb: 50, bb: 100, ante: 10, unit: 100 }, startingStackBb: 25, tournament: { stage: 'configurable', note: 'SB 0.5 / BB 1 / ante 0.1 BB; starting pot 2.3 BB' } },
      execution: { interface: 'internal-simulation', requiresAuthorization: false },
    };
  }
  /** Blank starting point for a NEW platform: copies the controlled geometry only so the editor has something to move; marked unverified and not executable. */
  function templateProfile(id, name) {
    const p = controlledProfile(2); p.id = id; p.name = name || id; p.description = 'Template created from the controlled geometry. Every region must be calibrated against an authorised screenshot before use.';
    p.verification = { status: 'unverified', externalClient: null, evidence: [] }; p.capture.methods = ['screenshot-file', 'window', 'desktop-region']; p.capture.preferred = ['screenshot-file']; delete p.capture.windowMatch;
    p.execution = { interface: 'none', requiresAuthorization: true }; return p;
  }
  const SAMPLES = () => [controlledProfile(1), controlledProfile(2)];

  /** In-memory registry with save/load through any text store {get(id), put(id,text), list()}. */
  class ProfileStore {
    constructor(store) { this.store = store || new Map(); this.profiles = new Map(); for (const p of SAMPLES()) this.profiles.set(p.id, p); }
    list() { return [...this.profiles.values()].map((p) => ({ id: p.id, name: p.name, status: p.verification.status, execution: p.execution.interface })); }
    get(id) { const p = this.profiles.get(id); if (!p) throw new Error('No profile ' + id); return clone(p); }
    add(profile) { const v = validateProfile(profile); if (!v.valid) throw new Error('Invalid profile: ' + v.issues.join('; ')); this.profiles.set(profile.id, clone(profile)); return profile.id; }
    save(id) { const t = saveProfile(this.get(id)); if (this.store.set) this.store.set(id, t); else this.store.put(id, t); return t; }
    load(id) { const t = this.store.get ? this.store.get(id) : this.store.getText(id); if (t === undefined) throw new Error('Nothing stored for ' + id); const r = loadProfile(t); if (!r.ok) throw new Error('Profile ' + id + ' rejected: ' + r.problems.join('; ')); this.profiles.set(r.profile.id, r.profile); return r.profile; }
  }

  return { FORMAT, VERSION, CAPTURE_METHODS, EXECUTION_INTERFACES, sha256, canonical, validateProfile, saveProfile, loadProfile, setRegion, allRegions, controlledProfile, templateProfile, SAMPLES, ProfileStore, REGION_PATHS };
});
