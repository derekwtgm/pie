// EightMax 4.7 convergence dashboard (Priorities 6, 7, 8).
//
// EM.analytics: pure functions shared with the tests. They mirror native/analytics.hpp so
// that the dashboard and `mwcli --monitor/--compare/--verify` agree bit for bit:
//   parseEMMW4(bytes)      canonical rows (betting path | hand | cards) of an EMMW4 checkpoint
//   strategyHash(study)    SHA-256 of the normalised average strategies (async, WebCrypto)
//   distance(A, B, n)      total-variation distances of average strategies, row overlap
//   gameHash(spec)         identity of the game (rules, ranges, board, utility, abstraction)
// EM.Monitor: live training with periodic strategy-quality evaluations through the native
// host (POST /api/mw/init, /train, /response-gain; GET /status, /state, /memory). Training
// runs in the host's own thread; the page only polls (bounded, nonblocking). Evaluations run
// between training segments and use their own seeds (evaluations only read the strategy),
// so a monitored run ends in exactly the state of uninterrupted training.
// EM.dashboardPanel(root, deps): the "Quality" tab.
// Data format: schema "eightmax-analytics/1" (identical to mwcli --monitor analytics.json).
(function () {
'use strict';
const EM = globalThis.EM = globalThis.EM || {};
const A = {};
const IDENTITY_KEYS = ['protocol', 'algorithm', 'n', 'board', 'anteOf', 'hands', 'rules', 'icm', 'groupKeys', 'turnGroups', 'riverGroups', 'abstraction'];
const TRAINER_KEYS = ['weighting', 'regretMatching', 'dcfrAlpha', 'dcfrBeta', 'dcfrGamma', 'dcfrEager', 'batchDeals', 'actionStreams', 'terminalBaseline', 'terminalExpectation', 'chanceSampling', 'opponentExploration', 'ownHandEnumeration', 'stratified', 'updates'];
A.IDENTITY_KEYS = IDENTITY_KEYS; A.TRAINER_KEYS = TRAINER_KEYS;

// ---------- EMMW4 ----------
A.parseEMMW4 = function (buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), n = u8.length;
  const bad = e => ({ ok: false, error: e, rows: [] });
  const magic = [69, 77, 77, 87, 52, 0, 0, 0];
  if (n < 20 || magic.some((c, i) => u8[i] !== c)) return bad('not an EMMW4 external-sampling checkpoint');
  const hl = dv.getUint32(8, true); if (hl + 16 > n) return bad('truncated header');
  let h; try { h = JSON.parse(new TextDecoder().decode(u8.subarray(12, 12 + hl))); } catch (e) { return bad('unreadable header'); }
  let o = 12 + hl; const sc = dv.getUint32(o, true); o += 4; if (sc * 9 > n - o) return bad('truncated state table');
  const parent = new Uint32Array(sc), slot = new Uint8Array(sc), actor = new Uint8Array(sc), length = new Uint8Array(sc);
  for (let i = 0; i < sc; i++) { parent[i] = dv.getUint32(o, true); slot[i] = u8[o + 4]; actor[i] = u8[o + 6]; length[i] = u8[o + 7]; o += 9; }
  const path = new Array(sc).fill('');
  for (let i = 1; i < sc; i++) { const p = parent[i]; if (p === 0xffffffff) continue; if (p >= i) return bad('state table is not in parent-first order'); path[i] = path[p] + (path[p] ? '.' : '') + slot[i]; }
  if (n - o < 4) return bad('truncated row count');
  const rc = dv.getUint32(o, true); o += 4; const rows = []; let total = 0;
  for (let r = 0; r < rc; r++) {
    if (n - o < 6) return bad('truncated row');
    const st = dv.getUint32(o, true); o += 4; if (st >= sc) return bad('row refers to an unknown state');
    let key;
    if (h.rowKeys) { const kl = dv.getUint16(o, true); o += 2; if (n - o < kl + 1) return bad('truncated row key'); key = path[st] + '|g:' + new TextDecoder('latin1').decode(u8.subarray(o, o + kl)); o += kl; }
    else { if (n - o < 8) return bad('truncated row'); const hand = dv.getUint16(o, true); o += 2; key = path[st] + '|' + hand + '|' + [u8[o], u8[o + 1], u8[o + 2], u8[o + 3], u8[o + 4]].join(','); o += 5; }
    const k = u8[o]; o += 1; if (k < 1 || k > 16 || n - o < 16 * k + (h.rowSync ? 4 : 0)) return bad('truncated row values');
    const regret = new Float64Array(k), average = new Float64Array(k);
    for (let a = 0; a < k; a++) { regret[a] = dv.getFloat64(o + 8 * a, true); average[a] = dv.getFloat64(o + 8 * (k + a), true); }
    o += 16 * k; if (h.rowSync) o += 4;
    let mass = 0; for (const x of average) mass += x > 0 ? x : 0; total += mass;
    rows.push({ key, seat: actor[st], length: length[st], k, regret, average, mass });
  }
  if (o !== n) return bad('trailing bytes after the last row');
  rows.sort((x, y) => x.key < y.key ? -1 : x.key > y.key ? 1 : 0);
  for (let i = 1; i < rows.length; i++) if (rows[i].key === rows[i - 1].key) return bad('duplicate canonical row key');
  return { ok: true, iterations: h.iterations, trainingDeals: h.trainingDeals, stateVisits: h.stateVisits, studyId: h.studyId, rng: h.rng, actionRng: h.actionRng, states: sc, rows, totalMass: total, bytes: n };
};
A.normalised = function (acc) {
  let t = 0; for (const x of acc) t += x > 0 ? x : 0;
  const out = new Float64Array(acc.length); for (let a = 0; a < acc.length; a++) out[a] = t > 0 ? (acc[a] > 0 ? acc[a] : 0) / t : 1 / acc.length; return out;
};
const subtle = () => (globalThis.crypto && globalThis.crypto.subtle) || null;
const hex = b => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');
A.sha256 = async function (bytes) { const s = subtle(); if (!s) return null; return hex(await s.digest('SHA-256', bytes)); };
A.strategyHash = async function (study) {
  const parts = []; let len = 0; const enc = new TextEncoder();
  for (const r of study.rows) { const kb = enc.encode(r.key), p = A.normalised(r.average); parts.push(kb, Uint8Array.of(r.k), new Uint8Array(p.buffer.slice(0))); len += kb.length + 1 + 8 * r.k; }
  const all = new Uint8Array(len); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  return A.sha256(all);
};
const tv = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); return 0.5 * d; };
A.distance = function (Sa, Sb, seats) {
  const d = { rowsA: Sa.rows.length, rowsB: Sb.rows.length, common: 0, onlyA: 0, onlyB: 0, kMismatch: 0, meanTv: 0, maxTv: 0, weightedTv: 0, unionWeightedTv: 0, currentMeanTv: 0, maxTvKey: '', seatWeightedTv: new Array(Math.max(1, seats)).fill(0), seatCommon: new Array(Math.max(1, seats)).fill(0) };
  const sw = new Array(Math.max(1, seats)).fill(0); let wsum = 0, uw = 0, i = 0, j = 0;
  const share = (s, r) => s.totalMass > 0 ? r.mass / s.totalMass : 0, uni = k => new Float64Array(k).fill(1 / k);
  while (i < Sa.rows.length || j < Sb.rows.length) {
    const ra = Sa.rows[i], rb = Sb.rows[j];
    if (!rb || (ra && ra.key < rb.key)) { d.onlyA++; const w = 0.5 * share(Sa, ra); d.unionWeightedTv += w * tv(A.normalised(ra.average), uni(ra.k)); uw += w; i++; continue; }
    if (!ra || rb.key < ra.key) { d.onlyB++; const w = 0.5 * share(Sb, rb); d.unionWeightedTv += w * tv(A.normalised(rb.average), uni(rb.k)); uw += w; j++; continue; }
    i++; j++;
    if (ra.k !== rb.k) { d.kMismatch++; continue; }
    d.common++; const t = tv(A.normalised(ra.average), A.normalised(rb.average)), w = 0.5 * (share(Sa, ra) + share(Sb, rb));
    d.meanTv += t; d.weightedTv += w * t; wsum += w; d.unionWeightedTv += w * t; uw += w;
    if (t > d.maxTv || !d.maxTvKey) { d.maxTv = t; d.maxTvKey = ra.key; }
    if (ra.seat < seats) { d.seatWeightedTv[ra.seat] += w * t; sw[ra.seat] += w; d.seatCommon[ra.seat]++; }
    d.currentMeanTv += tv(A.normalised(ra.regret), A.normalised(rb.regret));
  }
  if (d.common) { d.meanTv /= d.common; d.currentMeanTv /= d.common; }
  if (wsum > 0) d.weightedTv /= wsum; if (uw > 0) d.unionWeightedTv /= uw;
  for (let s = 0; s < sw.length; s++) if (sw[s] > 0) d.seatWeightedTv[s] /= sw[s];
  const u = d.common + d.onlyA + d.onlyB + d.kMismatch; d.jaccard = u ? d.common / u : 1;
  return d;
};
// C printf("%.17g") for finite doubles (native/analytics.hpp canon()).
A.g17 = function (x) {
  if (x === 0) return Object.is(x, -0) ? '-0' : '0';
  let [m, e] = x.toExponential(16).split('e'); const exp = +e;
  if (exp < -4 || exp >= 17) return m.replace(/\.?0+$/, '') + 'e' + (exp < 0 ? '-' : '+') + String(Math.abs(exp)).padStart(2, '0');
  const s = x.toFixed(Math.max(0, 16 - exp));
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
};
A.canon = function canon(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return A.g17(v);
  if (typeof v === 'string') return '"' + v + '"';
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => '"' + k + '":' + canon(v[k])).join(',') + '}';
};
A.gameHash = async function (spec) { const t = IDENTITY_KEYS.map(k => k + '=' + A.canon(spec[k]) + ';').join(''); const h = await A.sha256(new TextEncoder().encode(t)); return h && h.slice(0, 16); };
A.compatibility = function (a, b) {
  const differing = IDENTITY_KEYS.filter(k => A.canon(a[k]) !== A.canon(b[k])), trainer = TRAINER_KEYS.filter(k => A.canon(a[k]) !== A.canon(b[k]));
  if (A.canon(a.actionSeed) !== A.canon(b.actionSeed)) trainer.push('actionSeed (random seed)');
  return { compatible: !differing.length, differing, trainerDiffering: trainer };
};
// ---------- statistics ----------
A.qnorm = function (p) {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00], b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01], c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00], d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
  if (p < 0.02425) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - 0.02425) return -A.qnorm(1 - p);
  const q = p - 0.5, r = q * q; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
};
A.seatLabel = function (seat, n, preflop) {
  const names = ['UTG', 'UTG+1', 'MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
  if (preflop && n >= 2 && n <= 8) return n === 2 ? (seat === 0 ? 'SB (button)' : 'BB') : names[8 - n + seat];
  return 'seat ' + (seat + 1);
};
A.MODE_CLASS = {
  exactBestResponse: 'exact unilateral best-response gain inside the study abstraction',
  restrictedBestResponse: 'restricted best-response gain: a LOWER BOUND on the unrestricted gain inside the abstraction',
  sampledOneDecisionDeviation: 'sampled one-decision deviation gain: a statistical ESTIMATE of a LOWER BOUND on the best-response gain'
};
A.LIMITATIONS = ["All values are measured inside the study's abstraction (ranges, bet menu, streets); nothing here measures unrestricted No-Limit Hold'em.",
  'With more than two players or ICM utilities NashConv is not exploitability, and a small NashConv does not prove that a Nash equilibrium is near in strategy space.',
  'Restricted gains are lower bounds; sampled gains estimate lower bounds and carry sampling error; neither verifies equilibrium.',
  'Rows never visited by training are evaluated with the uniform fallback policy; see coverage.'];
// Summarises one response-gain answer (same fields as mwcli --monitor).
A.summariseGain = function (g, n, preflop) {
  const z = A.qnorm(0.975), zs = A.qnorm(1 - 0.05 / (2 * Math.max(1, n))); let sum = 0, v = 0, lk = 0, fb = 0, sets = 0, fsets = 0;
  const seats = (g.seats || []).map((s, i) => {
    const gain = typeof s.gain === 'number' ? s.gain : s.gain && s.gain.mean, se = typeof s.gain === 'object' && s.gain ? s.gain.stdErr || 0 : 0;
    if (Number.isFinite(gain)) { sum += gain; v += se * se; }
    lk += s.policyLookups || 0; fb += s.fallbackLookups || 0; sets += s.distinctInformationSets || 0; fsets += s.distinctFallbackInformationSets || 0;
    return { seat: s.seat ?? i, position: A.seatLabel(s.seat ?? i, n, preflop), gain, stdErr: se, ci95: se > 0 ? [gain - z * se, gain + z * se] : null, simultaneousCi: se > 0 ? [gain - zs * se, gain + zs * se] : null, policyValue: s.policyValue ?? null };
  });
  const se = Math.sqrt(v);
  return { method: g.method, mode: g.mode, class: A.MODE_CLASS[g.mode] || g.mode, seed: g.seed, samples: g.method === 'exact' ? 0 : (g.budgets && g.budgets.samples) || 0, nashConv: sum, nashConvCi95: se > 0 ? [sum - z * se, sum + z * se] : null, nashSe: se, exploitability: g.exploitability ?? null, seats,
    coverage: { policyLookups: lk, fallbackLookups: fb, fallbackShare: lk > 0 ? fb / lk : null, distinctInformationSetsSum: sets, distinctFallbackInformationSetsSum: fsets } };
};
// Stopping rule for a quality target (mwcli --monitor uses the same rule).
A.targetMet = function (ev, target, index) {
  if (!(target >= 0) || !ev) return null;
  if (ev.mode === 'exactBestResponse') return ev.nashConv <= target ? { certified: true, detail: 'exact NashConv inside the abstraction is at or below the target (exact for this abstraction, not for unrestricted poker)' } : null;
  if (ev.mode === 'sampledOneDecisionDeviation') { const alpha = 0.05 / Math.pow(2, index), ucb = ev.nashConv + A.qnorm(1 - alpha) * ev.nashSe; return ucb <= target ? { certified: false, detail: 'the one-sided upper confidence bound (alpha spending 0.05/2^k) of the summed sampled one-decision deviation gains is at or below the target; this bounds an ESTIMATED LOWER BOUND of NashConv and does not verify equilibrium' } : null; }
  return null;
};
A.nextEvaluation = function (updates, growth, segUpdates, segSeconds, evalSeconds, share) {
  let next = Math.ceil(updates * growth); if (next <= updates) next = updates + 1;
  const rate = segSeconds > 0 ? segUpdates / segSeconds : 0;
  if (rate > 0 && evalSeconds > 0) next = Math.max(next, updates + Math.ceil(rate * evalSeconds / share));
  return next;
};
A.trend = function (rows) {
  const pts = rows.filter(r => r.evaluation && r.evaluation.nashConv > 0).map(r => [Math.log(Math.max(1, r.trainingDeals)), Math.log(r.evaluation.nashConv)]).slice(-6);
  if (pts.length < 3) return null; let sx = 0, sy = 0, sxx = 0, sxy = 0; const k = pts.length;
  for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  return { logLogSlope: (k * sxy - sx * sy) / (k * sxx - sx * sx), points: k, note: 'least-squares slope of log NashConv (or its lower-bound estimate) on log sampled deals over the last evaluations; descriptive only, not a convergence guarantee' };
};
A.toCSV = function (doc) {
  const n = (doc.game && doc.game.players) || 0, cols = ['index', 'updates', 'trainingDeals', 'trainSeconds', 'evalSeconds', 'dealsPerSecond', 'rssMiB', 'peakRssMiB', 'tableMiB', 'rows', 'bettingStates', 'strategyHash', 'weightedStrategyChange', 'method', 'class', 'nashConv', 'nashConvLow', 'nashConvHigh', 'fallbackShare'];
  for (let s = 0; s < n; s++) cols.push('gain_' + s, 'gainLow_' + s, 'gainHigh_' + s);
  const f = x => x === null || x === undefined || (typeof x === 'number' && !Number.isFinite(x)) ? '' : typeof x === 'string' && /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : String(x);
  const lines = [cols.join(',')];
  for (const r of doc.evaluations || []) {
    const e = r.evaluation || {}, ci = e.nashConvCi95 || [];
    const row = [r.index, r.updates, r.trainingDeals, r.trainSeconds, r.evalSeconds, r.dealsPerSecond, r.rssMiB, r.peakRssMiB, r.tableMiB, r.rows, r.bettingStates, r.checkpoint && r.checkpoint.strategyHash, r.strategyChange && r.strategyChange.weightedTv, e.method, e.mode, e.nashConv, ci[0], ci[1], r.coverage && r.coverage.fallbackShare];
    for (let s = 0; s < n; s++) { const x = (e.seats || [])[s] || {}; const c = x.ci95 || []; row.push(x.gain, c[0], c[1]); }
    lines.push(row.map(f).join(','));
  }
  return lines.join('\n') + '\n';
};
A.validateDoc = function (doc) {
  if (!doc || doc.schema !== 'eightmax-analytics/1' || !Array.isArray(doc.evaluations)) throw new Error('Not an EightMax analytics file (schema eightmax-analytics/1)');
  for (const r of doc.evaluations) if (!Number.isFinite(r.updates) || !Number.isFinite(r.trainingDeals)) throw new Error('Analytics file has an evaluation without counters');
  return doc;
};
// Measurement comparison of two recorded checkpoints (same game required).
A.compareRows = function (docA, rowA, docB, rowB) {
  if (docA.game && docB.game && docA.game.gameHash && docB.game.gameHash && docA.game.gameHash !== docB.game.gameHash) return { compatible: false, verdict: 'The two checkpoints belong to different games; their gains are not comparable.' };
  const ea = rowA.evaluation, eb = rowB.evaluation; if (!ea || !eb) return { compatible: true, verdict: 'One checkpoint has no evaluation.' };
  const n = Math.min(ea.seats.length, eb.seats.length), zs = A.qnorm(1 - 0.05 / (2 * Math.max(1, n)));
  const exact = ea.mode === 'exactBestResponse' && eb.mode === 'exactBestResponse', restricted = ea.mode === 'restrictedBestResponse' || eb.mode === 'restrictedBestResponse';
  const seats = [];
  for (let s = 0; s < n; s++) {
    const x = ea.seats[s], y = eb.seats[s], diff = y.gain - x.gain, se = Math.hypot(x.stdErr || 0, y.stdErr || 0), lo = diff - zs * se, hi = diff + zs * se;
    const verdict = ea.mode !== eb.mode ? 'different evaluation classes: not comparable' : exact ? (diff < 0 ? 'B has the smaller exact gain' : diff > 0 ? 'A has the smaller exact gain' : 'equal exact gains') : restricted ? 'both are lower bounds: no ordering' : hi < 0 ? 'B smaller (supported, simultaneous 95%)' : lo > 0 ? 'A smaller (supported, simultaneous 95%)' : 'difference not established';
    seats.push({ seat: s, position: x.position, gainA: x.gain, gainB: y.gain, difference: diff, simultaneousCi: exact ? null : [lo, hi], verdict });
  }
  return { compatible: true, sameStrategy: !!(rowA.checkpoint && rowB.checkpoint && rowA.checkpoint.strategyHash && rowA.checkpoint.strategyHash === rowB.checkpoint.strategyHash), updatesA: rowA.updates, updatesB: rowB.updates, seats,
    note: 'Evaluations use independent seeds, so sampled difference intervals use sqrt(seA^2 + seB^2) with a Bonferroni adjustment over seats. A later checkpoint is not automatically stronger.' };
};
EM.analytics = A;

// ---------- live monitor ----------
EM.Monitor = class Monitor {
  // api: {get(path) -> json, post(path, body) -> json, bytes(path) -> ArrayBuffer}; sleep(ms) -> Promise
  constructor(api, opts, onUpdate, sleep) {
    this.api = api; this.o = Object.assign({ threads: 2, tableMiB: 512, evaluation: 'auto', samples: 20000, evalSeed: 7, first: 100, growth: 2, share: 0.25, maxUpdates: 10000, maxDeals: Infinity, maxSeconds: Infinity, rssMiB: Infinity, target: NaN, timeLimitMs: 120000, pollMs: 250 }, opts);
    this.onUpdate = onUpdate || (() => {}); this.sleep = sleep || (ms => new Promise(r => setTimeout(r, ms))); this.stopped = false; this.prev = null;
  }
  stop() { this.stopped = true; this.api.post('/api/mw/stop', {}).catch(() => {}); }
  async evaluate(index) {
    const o = this.o, order = o.evaluation === 'auto' ? ['exact', 'restricted', 'sampled'] : [o.evaluation], attempts = [];
    for (const method of order) {
      const req = { method, timeLimitMs: o.timeLimitMs, seed: (o.evalSeed + 7919 * index) >>> 0 };
      if (method !== 'exact') req.samples = o.samples;
      const t0 = Date.now();
      try { const g = await this.api.post('/api/mw/response-gain', req); attempts.push({ method, status: 200, seconds: (Date.now() - t0) / 1000 }); const s = A.summariseGain(g, this.n, this.pre); s.attempts = attempts; return s; }
      catch (e) { attempts.push({ method, status: 'error', error: String(e.message || e), seconds: (Date.now() - t0) / 1000 }); }
    }
    return { error: 'every evaluation method failed', attempts };
  }
  async run(spec) {
    const o = this.o; this.n = spec.n; this.pre = !!(spec.rules && spec.rules.pre);
    const started = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const init = await this.api.post('/api/mw/init', Object.assign({}, spec, { tableLimitMiB: o.tableMiB }));
    const engine = init.engine || {};
    const doc = this.doc = { schema: 'eightmax-analytics/1', tool: 'EightMax dashboard 4.7', version: (EM.BUILD && EM.BUILD.version) || '', build: (EM.BUILD && EM.BUILD.build) || '', started, status: 'running',
      game: { players: spec.n, stage: !spec.board || !spec.board.length ? 'preflop' : spec.board.length === 3 ? 'flop' : spec.board.length === 4 ? 'turn' : 'river', utility: spec.icm ? 'icm' : 'chip', gameHash: await A.gameHash(spec), studyId: spec.studyId || null, actionSeed: spec.actionSeed ?? null, specSha256: await A.sha256(new TextEncoder().encode(JSON.stringify(spec))) },
      trainer: engine.trainer || null,
      config: { threads: o.threads, tableBudgetMiB: init.budgetMiB ?? o.tableMiB, evaluation: o.evaluation, samples: o.samples, evalSeed: o.evalSeed, evalSeedRule: 'evaluation k uses seed evalSeed + 7919 k; evaluation streams never share state with the training streams (evaluations only read the strategy)', firstEvaluationAtUpdates: o.first, growth: o.growth, maxEvaluationShare: o.share,
        stops: { updates: o.maxUpdates, deals: Number.isFinite(o.maxDeals) ? o.maxDeals : null, seconds: Number.isFinite(o.maxSeconds) ? o.maxSeconds : null, rssMiB: Number.isFinite(o.rssMiB) ? o.rssMiB : null, target: Number.isFinite(o.target) ? o.target : null } },
      evaluations: [], stop: { reason: 'running', detail: '', targetCertified: false }, limitations: A.LIMITATIONS, live: { phase: 'starting' } };
    let trainSeconds = 0, next = o.first, index = 0, updates = engine.iterations || 0, deals = engine.trainingDeals || 0;
    const finish = (reason, detail, certified) => { doc.stop = { reason, detail: detail || '', targetCertified: !!certified }; doc.status = reason === 'error' ? 'failed' : 'finished'; doc.trend = A.trend(doc.evaluations); doc.live.phase = 'finished'; this.onUpdate(doc); return doc; };
    for (;;) {
      if (this.stopped) return finish('user cancellation', 'stopped from the dashboard; committed updates are kept');
      if (updates >= o.maxUpdates) return finish('maximum updates');
      let goal = Math.min(Math.max(next, updates + 1), o.maxUpdates);
      if (Number.isFinite(o.maxDeals)) { const per = updates > 0 ? deals / updates : 1; goal = Math.min(goal, updates + Math.max(1, Math.floor((o.maxDeals - deals) / Math.max(1, per)))); }
      doc.live = { phase: 'training', from: updates, to: goal }; this.onUpdate(doc);
      await this.api.post('/api/mw/train', { iterations: goal - updates, threads: o.threads });
      let st, why = 0;
      for (;;) {
        await this.sleep(o.pollMs);
        st = await this.api.get('/api/mw/status');
        doc.live = { phase: 'training', from: updates, to: goal, iterations: st.iterations, trainingDeals: st.trainingDeals, elapsed: st.elapsed }; this.onUpdate(doc);
        if (!st.running) break;
        if (this.stopped) { await this.api.post('/api/mw/stop', {}); continue; }
        if (trainSeconds + (st.elapsed || 0) >= o.maxSeconds && !why) { why = 1; await this.api.post('/api/mw/stop', {}); }
        if (Number.isFinite(o.rssMiB) && !why) { const m = await this.api.get('/api/memory'); if (m.residentMiB > o.rssMiB) { why = 2; await this.api.post('/api/mw/stop', {}); } }
      }
      if (st.error) return finish('error', st.error);
      const segSeconds = st.elapsed || 0; trainSeconds += segSeconds;
      const info = st.engine || {}, segUpdates = st.iterations - updates, segDeals = st.trainingDeals - deals; updates = st.iterations; deals = st.trainingDeals;
      doc.live = { phase: 'evaluating', iterations: updates }; this.onUpdate(doc);
      const mem = await this.api.get('/api/memory');
      const bytes = await this.api.bytes('/api/mw/state'); const cur = A.parseEMMW4(bytes);
      const sha = await A.sha256(new Uint8Array(bytes)), shash = cur.ok ? await A.strategyHash(cur) : null;
      const t0 = Date.now(); const ev = o.evaluation === 'none' ? null : await this.evaluate(index); const evalSeconds = (Date.now() - t0) / 1000;
      const change = this.prev && cur.ok ? A.distance(this.prev, cur, spec.n) : null;
      const row = { index, updates, trainingDeals: deals, stateVisits: info.stateVisits ?? null, trainSeconds, evalSeconds, dealsPerSecond: segSeconds > 0 ? segDeals / segSeconds : null, updatesPerSecond: segSeconds > 0 ? segUpdates / segSeconds : null,
        rssMiB: mem.residentMiB ?? null, peakRssMiB: mem.peakResidentMiB ?? null, tableMiB: info.tableMiB ?? null, rows: info.rows ?? (cur.ok ? cur.rows.length : null), bettingStates: info.states ?? null, limitReached: !!info.limitReached,
        checkpoint: { file: '', saved: false, location: 'held by the desktop host (save it from the Multiway tab)', sha256: sha, strategyHash: shash },
        strategyChange: change ? { weightedTv: change.weightedTv, meanTv: change.meanTv, maxTv: change.maxTv, newRows: change.onlyB, commonRows: change.common, metric: 'total variation of the normalised average strategy against the previous evaluation, weighted by average-strategy mass' } : null,
        coverage: Object.assign({ storedRows: cur.ok ? cur.rows.length : null, kind: "exact counts of the evaluation's policy lookups (per-seat sums); storedRows is the exact number of trained information-set rows" }, ev && !ev.error ? ev.coverage : {}),
        evaluation: ev };
      if (ev && ev.coverage) delete ev.coverage;
      doc.evaluations.push(row); doc.trend = A.trend(doc.evaluations); if (cur.ok) this.prev = cur;
      this.onUpdate(doc);
      if (row.limitReached) return finish('memory budget', 'the table budget was reached (limitReached); the last committed update is kept');
      if (why === 1) return finish('maximum elapsed training time');
      if (why === 2) return finish('process memory limit', 'resident memory exceeded the limit; the update in progress was discarded and the committed state kept');
      if (this.stopped) return finish('user cancellation', 'stopped from the dashboard; committed updates are kept');
      if (deals >= o.maxDeals) return finish('maximum sampled deals');
      if (updates >= o.maxUpdates) return finish('maximum updates');
      const met = ev && !ev.error ? A.targetMet(ev, o.target, index) : null;
      if (met) return finish(met.certified ? 'quality target' : 'quality target (sampled)', met.detail, met.certified);
      next = A.nextEvaluation(updates, o.growth, segUpdates, segSeconds, evalSeconds, o.share); index++;
    }
  }
};

// ---------- charts (inline SVG, one y-axis each) ----------
const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];   // validated on #111827 (dark), fixed order
A.SERIES = SERIES;
function escX(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function ticks(lo, hi, log) {
  if (log) { const a = Math.floor(Math.log10(lo)), b = Math.ceil(Math.log10(hi)), t = []; for (let e = a; e <= b; e++) t.push(Math.pow(10, e)); return t; }
  const span = hi - lo || 1, step = Math.pow(10, Math.floor(Math.log10(span / 4))), m = [1, 2, 5, 10].find(x => span / (x * step) <= 5) * step, t = [];
  for (let v = Math.ceil(lo / m) * m; v <= hi + 1e-12; v += m) t.push(+v.toPrecision(12)); return t;
}
const fmtN = v => { if (!Number.isFinite(v)) return '–'; const a = Math.abs(v); return a !== 0 && (a < 1e-3 || a >= 1e6) ? v.toExponential(1) : +v.toPrecision(3) + ''; };
A.lineChart = function (c) {
  const W = 560, H = 230, L = 58, R = 12, T = 12, B = 34, pts = c.series.flatMap(s => s.points).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && (!c.yLog || p.y > 0) && (!c.xLog || p.x > 0));
  // 4.9: an empty chart still shows its note (chart 7 explains that it needs a second, imported run)
  if (!pts.length) return `<figure class="qd-chart"><figcaption>${escX(c.title)}</figcaption><p class="small muted">No data yet.</p>${c.note ? `<p class="small muted">${escX(c.note)}</p>` : ''}</figure>`;
  let x0 = Math.min(...pts.map(p => p.x)), x1 = Math.max(...pts.map(p => p.x)), y0 = Math.min(...pts.map(p => Number.isFinite(p.lo) && (!c.yLog || p.lo > 0) ? p.lo : p.y)), y1 = Math.max(...pts.map(p => Number.isFinite(p.hi) ? p.hi : p.y));
  if (!c.yLog && c.zero) y0 = Math.min(0, y0);
  if (x0 === x1) { x0 = c.xLog ? x0 / 2 : x0 - 1; x1 = c.xLog ? x1 * 2 : x1 + 1; } if (y0 === y1) { y0 = c.yLog ? y0 / 2 : y0 - 1; y1 = c.yLog ? y1 * 2 : y1 + 1; }
  const sx = v => L + (c.xLog ? Math.log(v / x0) / Math.log(x1 / x0) : (v - x0) / (x1 - x0)) * (W - L - R);
  const sy = v => T + (1 - (c.yLog ? Math.log(Math.max(v, y0) / y0) / Math.log(y1 / y0) : (v - y0) / (y1 - y0))) * (H - T - B);
  let g = '';
  for (const t of ticks(y0, y1, c.yLog).filter(t => t >= y0 * (c.yLog ? 0.999 : 1) - 1e-12 && t <= y1 * 1.001 + 1e-12)) g += `<line x1="${L}" x2="${W - R}" y1="${sy(t)}" y2="${sy(t)}" class="qd-grid"/><text x="${L - 6}" y="${sy(t) + 4}" text-anchor="end" class="qd-tick">${fmtN(t)}</text>`;
  for (const t of ticks(x0, x1, c.xLog).filter(t => t >= x0 * 0.999 - 1e-12 && t <= x1 * 1.001 + 1e-12)) g += `<text x="${sx(t)}" y="${H - B + 16}" text-anchor="middle" class="qd-tick">${fmtN(t)}</text>`;
  g += `<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" class="qd-axis"/>`;
  let marks = '';
  c.series.forEach((s) => {
    const p = s.points.filter(q => Number.isFinite(q.x) && Number.isFinite(q.y) && (!c.yLog || q.y > 0) && (!c.xLog || q.x > 0));
    if (!p.length) return;
    for (const q of p) if (Number.isFinite(q.lo) && Number.isFinite(q.hi)) marks += `<line x1="${sx(q.x)}" x2="${sx(q.x)}" y1="${sy(Math.max(q.lo, c.yLog ? y0 : -Infinity))}" y2="${sy(q.hi)}" stroke="${s.color}" stroke-width="2" opacity=".55"/>`;
    marks += `<polyline fill="none" stroke="${s.color}" stroke-width="2" ${s.dash ? 'stroke-dasharray="5 4"' : ''} points="${p.map(q => sx(q.x) + ',' + sy(q.y)).join(' ')}"/>`;
    for (const q of p) marks += `<circle cx="${sx(q.x)}" cy="${sy(q.y)}" r="4" fill="${s.color}" stroke="var(--panel)" stroke-width="2"><title>${escX(s.name)}: ${escX(c.xLabel)} ${fmtN(q.x)}, ${escX(c.yLabel)} ${fmtN(q.y)}${Number.isFinite(q.lo) ? ' (95% ' + fmtN(q.lo) + ' to ' + fmtN(q.hi) + ')' : ''}${q.note ? ' · ' + escX(q.note) : ''}</title></circle>`;
  });
  const legend = c.series.length > 1 ? `<div class="qd-legend">${c.series.map(s => `<span><i style="background:${s.color}"></i>${escX(s.name)}</span>`).join('')}</div>` : '';
  return `<figure class="qd-chart"><figcaption>${escX(c.title)}</figcaption>${legend}<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escX(c.title)}">${g}${marks}<text x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle" class="qd-label">${escX(c.xLabel)}${c.xLog ? ' (log)' : ''}</text><text x="12" y="${T + (H - T - B) / 2}" transform="rotate(-90 12 ${T + (H - T - B) / 2})" text-anchor="middle" class="qd-label">${escX(c.yLabel)}${c.yLog ? ' (log)' : ''}</text></svg>${c.note ? `<p class="small muted">${escX(c.note)}</p>` : ''}</figure>`;
};
// 4.8: short trainer description for legends ("linear ES-MCCFR, exploration 0.1", ...).
A.trainerLabel = function (t) {
  if (!t) return 'trainer unknown';
  const parts = [(t.weighting || 'linear') + (t.regretMatching === 'plus' ? ' RM+' : ''), 'exploration ' + (t.opponentExploration ?? 0.1)];
  if (t.ownHandEnumeration) parts.push('own hands'); if (t.terminalBaseline) parts.push('baseline'); if (t.terminalExpectation) parts.push('terminal expectation'); if (t.chanceSampling && t.chanceSampling !== 'independent') parts.push(t.chanceSampling);
  return parts.join(', ') + (t.validatedDefault ? ' (default)' : t.experimental ? ' (experimental)' : '');
};
// 4.8: runs[k] = evaluation rows (trainSeconds, evaluation.nashConv) of run k; returns, for k >= 1,
// points {x: time of run 0, y: NashConv_k(x) / NashConv_0(x)} for run-0 times inside run k's range
// (log-log interpolation, never extrapolated).
A.equalTimeComparison = function (runs) {
  const at = (rows, T) => { const p = rows.map(r => [Math.log(r.trainSeconds), Math.log(r.evaluation.nashConv)]), lt = Math.log(T);
    if (!p.length || lt < p[0][0] || lt > p[p.length - 1][0]) return NaN;
    for (let i = 1; i < p.length; i++) if (lt <= p[i][0]) { const f = p[i][0] === p[i - 1][0] ? 0 : (lt - p[i - 1][0]) / (p[i][0] - p[i - 1][0]); return Math.exp(p[i - 1][1] + f * (p[i][1] - p[i - 1][1])); }
    return Math.exp(p[0][1]); };
  const base = runs[0] || [];
  return runs.map((rows, k) => k === 0 ? [] : base.map(r => ({ x: r.trainSeconds, y: at(rows, r.trainSeconds) / r.evaluation.nashConv })).filter(q => Number.isFinite(q.y)));
};
A.chartsHTML = function (docs) {
  const live = docs[0], rowsOf = d => (d && d.evaluations) || [], n = (live && live.game && live.game.players) || 0, pre = live && live.game && live.game.stage === 'preflop';
  const runName = (d, i) => i === 0 ? 'this run' : (d.label || 'run ' + (i + 1));
  const sameGame = d => !live || !live.game || !d.game || d.game.gameHash === live.game.gameHash;
  const qSeries = docs.filter(sameGame).slice(0, 8).map((d, i) => ({ name: runName(d, docs.indexOf(d)) + (d.trainer && d.trainer.experimental ? ' (experimental)' : ''), color: SERIES[i], points: rowsOf(d).filter(r => r.evaluation && !r.evaluation.error).map(r => ({ x: r.trainingDeals, y: r.evaluation.nashConv, lo: r.evaluation.nashConvCi95 ? r.evaluation.nashConvCi95[0] : NaN, hi: r.evaluation.nashConvCi95 ? r.evaluation.nashConvCi95[1] : NaN, note: r.evaluation.mode === 'exactBestResponse' ? 'exact' : r.evaluation.mode === 'restrictedBestResponse' ? 'lower bound' : 'sampled estimate of a lower bound' })) }));
  const rows = rowsOf(live), ev = rows.filter(r => r.evaluation && !r.evaluation.error);
  const seatSeries = Array.from({ length: Math.min(n, 8) }, (_, s) => ({ name: A.seatLabel(s, n, pre), color: SERIES[s], points: ev.map(r => { const x = r.evaluation.seats[s] || {}; return { x: r.trainingDeals, y: x.gain, lo: x.ci95 ? x.ci95[0] : NaN, hi: x.ci95 ? x.ci95[1] : NaN }; }) }));
  const nonPositive = ev.some(r => r.evaluation.seats.some(s => !(s.gain > 0)));
  const classes = [...new Set(ev.map(r => r.evaluation.mode))];
  const qNote = (classes.includes('exactBestResponse') ? 'Exact NashConv inside the abstraction. ' : '') + (classes.some(c => c !== 'exactBestResponse') ? 'Restricted / sampled points are lower bounds or estimates of lower bounds (95% bars) and are not equilibrium distances. ' : '') + 'More updates do not guarantee a stronger strategy.';
  // 4.8: quality against training time, algorithm comparison at equal time, training efficiency.
  // Every point comes from a run document (live monitor or an imported analytics export).
  const same = docs.filter(sameGame).slice(0, 8);
  const evRows = d => rowsOf(d).filter(r => r.evaluation && !r.evaluation.error && Number.isFinite(r.evaluation.nashConv) && r.evaluation.nashConv > 0 && r.trainSeconds > 0);
  const tSeries = same.map((d, i) => ({ name: runName(d, docs.indexOf(d)) + ' · ' + A.trainerLabel(d.trainer), color: SERIES[i], points: evRows(d).map(r => ({ x: r.trainSeconds, y: r.evaluation.nashConv, lo: r.evaluation.nashConvCi95 ? r.evaluation.nashConvCi95[0] : NaN, hi: r.evaluation.nashConvCi95 ? r.evaluation.nashConvCi95[1] : NaN })) }));
  const cmp = A.equalTimeComparison(same.map(evRows));
  const cmpSeries = same.slice(1).map((d, j) => ({ name: runName(d, docs.indexOf(d)) + ' · ' + A.trainerLabel(d.trainer) + ' vs this run', color: SERIES[j + 1], points: cmp[j + 1] || [] }));
  const live0 = evRows(live)[0];
  const effSeries = [{ name: 'improvement factor (first NashConv / current)', color: SERIES[0], points: live0 ? evRows(live).map(r => ({ x: r.trainSeconds, y: live0.evaluation.nashConv / r.evaluation.nashConv, note: 'peak memory ' + fmtN(r.peakRssMiB) + ' MiB, ' + fmtN(r.trainingDeals) + ' deals' })) : [] }];
  const exactOnly = ev.length && ev.every(r => r.evaluation.mode === 'exactBestResponse');
  return '<div class="qd-charts">' +
    A.lineChart({ title: '1 · Strategy quality: NashConv against sampled deals', series: qSeries, xLog: true, yLog: true, xLabel: 'sampled deals', yLabel: 'NashConv', note: qNote }) +
    A.lineChart({ title: '1b · Strategy quality: NashConv against training time', series: tSeries, xLog: true, yLog: true, xLabel: 'training seconds', yLabel: 'NashConv', note: 'Training wall time only (evaluation time excluded). ' + qNote }) +
    A.lineChart({ title: '2 · Convergence by player: response gain per seat', series: seatSeries, xLog: true, yLog: true, xLabel: 'sampled deals', yLabel: 'gain', note: nonPositive ? 'Gains at or below zero (possible for sampled estimates) cannot be drawn on a log scale; see the table.' : '' }) +
    A.lineChart({ title: '3 · Strategy stability: average-strategy change between evaluations', series: [{ name: 'weighted total variation', color: SERIES[0], points: rows.filter(r => r.strategyChange).map(r => ({ x: r.trainingDeals, y: r.strategyChange.weightedTv })) }], xLog: true, yLog: true, xLabel: 'sampled deals', yLabel: 'TV distance' }) +
    A.lineChart({ title: '4 · Training throughput', series: [{ name: 'deals per second', color: SERIES[0], points: rows.map(r => ({ x: r.trainSeconds, y: r.dealsPerSecond })) }], xLabel: 'training seconds', yLabel: 'deals / s', zero: true }) +
    A.lineChart({ title: '5 · Memory: process resident memory', series: [{ name: 'current', color: SERIES[0], points: rows.map(r => ({ x: r.trainSeconds, y: r.rssMiB })) }, { name: 'peak', color: SERIES[1], dash: true, points: rows.map(r => ({ x: r.trainSeconds, y: r.peakRssMiB })) }], xLabel: 'training seconds', yLabel: 'MiB', zero: true }) +
    A.lineChart({ title: '6a · Coverage: stored information-set rows (exact count)', series: [{ name: 'rows', color: SERIES[0], points: rows.map(r => ({ x: r.trainingDeals, y: r.coverage && r.coverage.storedRows })) }], xLog: true, xLabel: 'sampled deals', yLabel: 'rows', zero: true }) +
    A.lineChart({ title: '7 · Algorithm comparison at equal training time (ratio to this run)', series: cmpSeries, xLog: true, yLog: true, xLabel: 'training seconds', yLabel: 'NashConv ratio', note: cmpSeries.length ? 'Each imported run of the same game is interpolated (log-log) at this run\'s evaluation times inside the overlapping time range; below 1 = lower NashConv than this run at the same training time. One run per configuration is a single observation: use tools/convergence48.js (ten seeds, Holm) before calling a difference real.' + (exactOnly ? '' : ' Sampled or restricted values are lower bounds or their estimates.') : 'Import the analytics export of another run of the same game (for example another trainer) to compare it here.' }) +
    A.lineChart({ title: '8 · Training efficiency: quality improvement against training time', series: effSeries, xLog: true, yLog: true, xLabel: 'training seconds', yLabel: 'improvement factor', note: 'First evaluated NashConv divided by the current one (above 1 = improved). Hover a point for peak resident memory and sampled deals.' + (exactOnly ? '' : ' With sampled evaluations the factor carries the noise of both estimates.') }) +
    A.lineChart({ title: '6b · Coverage: fallback share of evaluation lookups (exact counts)', series: [{ name: 'fallback share', color: SERIES[0], points: rows.map(r => ({ x: r.trainingDeals, y: r.coverage && r.coverage.fallbackShare })) }], xLog: true, xLabel: 'sampled deals', yLabel: 'share', zero: true, note: 'Lookups of information sets that training never stored (the uniform fallback policy is used there). Counts are exact for each evaluation, not estimates.' }) +
    '</div>';
};

// ---------- panel ----------
EM.dashboardPanel = function (root, deps) {
  const { napi, NATIVE, esc } = deps;
  const st = { docs: [], monitor: null, pick: [], specText: '', preset: 'hu-river', trainer: 'default', o: { threads: 2, tableMiB: 512, evaluation: 'auto', samples: 20000, evalSeed: 7, first: 200, growth: 2, share: 0.25, maxUpdates: 20000, maxSeconds: 120, target: '' }, error: '' };
  const PRESETS = {
    'hu-river': ['Heads-up river (chip EV)', { board: 'Ks8d5h2c2s', common: 10, stacks: [20, 20], ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd'], streets: { river: { bets: '50,a', raises: 'a', maxBets: 2 } } }],
    'river3': ['Three-player river, side pots (chip EV)', { board: 'Ks8d5h2c2s', common: 6, stacks: [4, 12, 30], ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd', 'Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc'], streets: { river: { bets: '75,a', raises: 'a', maxBets: 2 } } }],
    'bubble4': ['Four-player bubble push/fold (ICM)', { preflop: { mode: 'shove' }, dealt: 4, common: 0, board: '', stacks: [12, 7, 20, 4], ranges: ['AsAh,7c2d:0.5', 'KsKh:0.75,8c3d', 'QsQh,6d5d', 'JsJh:0.5,9s8s'], icm: { payouts: [50, 30, 20] }, batchDeals: 4, actionStreams: 'deal' }],
    'flop6': ['Six-player flop, 3-50 bb stacks (chip EV)', { board: 'Td7c2h', dealt: 8, common: 1.5, stacks: [20, 35, 8, 50, 14, 3], prior: Array(6).fill(2.5), folded: [1, 2.5], ranges: ['AhTh,7s7d', 'KdTs,9c8c', 'QsQd,Ac7h', 'JhTc,6s5s', 'AdKc,2s2d', '8h8d,As2c'], streets: { flop: { bets: 'a', raises: '', maxBets: 1 } } }],
    'final8': ['Eight-player final table push/fold (ICM)', { preflop: { mode: 'shove' }, board: '', dealt: 8, common: 0, stacks: [30, 22, 15, 40, 9, 18, 25, 12], ranges: ['AsAh', 'KsKh', 'QsQh', 'JsJh', 'TsTh', '9s9h', '8s8h', '7s7h'], icm: { payouts: [30, 20, 14, 11, 9, 7, 5, 4] }, batchDeals: 4, actionStreams: 'deal' }],
  };
  const TRAINERS = { default: ['Validated default (linear ES-MCCFR)', {}], own: ['Experimental: own-hand enumeration', { ownHandEnumeration: true }], ownBase: ['Experimental: own-hand enumeration + terminal baseline', { ownHandEnumeration: true, terminalBaseline: true }] };
  function buildSpec() {
    if (st.preset === 'custom') { const s = JSON.parse(st.specText); if (!s || s.protocol !== 4) throw new Error('Paste a protocol-4 native spec (the JSON written by the Multiway tab or the tools)'); return s; }
    const cfg = Object.assign({ privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128 }, PRESETS[st.preset][1], TRAINERS[st.trainer][1], { privateSeed: Number(st.o.evalSeed) + 1000 });
    return EM.MultiwayGame(cfg).nativeSpec();
  }
  const api = {
    get: p => napi(p),
    post: (p, b) => napi(p, b),
    bytes: async p => { const r = await fetch(p); if (!r.ok) throw new Error('Could not read the training state (' + r.status + ')'); return r.arrayBuffer(); }
  };
  const download = (name, text, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
  const f = (v, d = 3) => v === null || v === undefined || !Number.isFinite(+v) ? '–' : Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0) ? (+v).toExponential(2) : (+v).toFixed(d);
  function tiles(d) {
    const rows = d ? d.evaluations : [], last = rows[rows.length - 1], ev = last && last.evaluation, live = (d && d.live) || {};
    const t = (k, v, s) => `<div class="qd-tile"><span class="label">${k}</span><b>${v}</b>${s ? `<small>${s}</small>` : ''}</div>`;
    const tr = d && d.trainer;
    return `<div class="qd-tiles">` +
      t('Training updates', live.iterations ?? (last ? last.updates : '–'), live.phase || '') +
      t('Sampled deals', live.trainingDeals ?? (last ? last.trainingDeals : '–')) +
      t('Training time', last ? f(last.trainSeconds, 1) + ' s' : '–', 'evaluation time excluded') +
      t('Throughput', last ? f(last.dealsPerSecond, 0) + ' deals/s' : '–') +
      t('Algorithm', tr ? (tr.ownHandEnumeration ? 'own-hand enumeration' : 'external sampling') + (tr.terminalBaseline ? ' + baseline' : '') : '–', tr ? (tr.validatedDefault ? 'validated default' : 'experimental') + ' · ' + tr.weighting : '') +
      t('CPU workers', d ? d.config.threads : '–') +
      t('Memory', last ? f(last.rssMiB, 0) + ' MiB' : '–', last ? 'peak ' + f(last.peakRssMiB, 0) + ' MiB' : '') +
      t('Information sets', last ? last.rows : '–', last ? last.bettingStates + ' betting states (exact)' : '') +
      t('Fallback lookups', last && last.coverage && last.coverage.fallbackShare != null ? (100 * last.coverage.fallbackShare).toFixed(2) + '%' : '–', 'exact count share') +
      t('Strategy change', last && last.strategyChange ? f(last.strategyChange.weightedTv, 4) : '–', 'weighted TV since last evaluation') +
      t('NashConv', ev && !ev.error ? f(ev.nashConv, 5) : '–', ev && !ev.error ? (ev.nashConvCi95 ? '95% ' + f(ev.nashConvCi95[0], 4) + ' to ' + f(ev.nashConvCi95[1], 4) + ' · ' : '') + (ev.mode === 'exactBestResponse' ? 'exact' : ev.mode === 'restrictedBestResponse' ? 'lower bound' : 'estimate of a lower bound') : '') +
      t('Evaluation samples', ev && !ev.error ? (ev.samples || 'exact') : '–') +
      t('Checkpoint', last && last.checkpoint && last.checkpoint.strategyHash ? last.checkpoint.strategyHash.slice(0, 12) : '–', 'strategy hash') +
      t('Trend', d && d.trend ? 'slope ' + f(d.trend.logLogSlope, 2) : '–', 'log-log, descriptive') +
      `</div>`;
  }
  function table() {
    const rows = []; st.docs.forEach((d, di) => d.evaluations.forEach((r, ri) => rows.push([di, ri, d, r])));
    if (!rows.length) return '';
    return `<div class="qd-table"><table><thead><tr><th>Pick</th><th>Run</th><th>#</th><th>Updates</th><th>Deals</th><th>Trainer</th><th>Seed</th><th>Strategy hash</th><th>Evaluation</th><th>NashConv</th><th>95% CI</th><th>Train s</th></tr></thead><tbody>` +
      rows.map(([di, ri, d, r]) => { const e = r.evaluation || {}; const id = di + ':' + ri; return `<tr><td><input type="checkbox" data-qd-pick="${id}" ${st.pick.includes(id) ? 'checked' : ''} aria-label="Pick for comparison"></td><td>${esc(di === 0 && st.monitor !== null ? 'this run' : d.label || 'run ' + (di + 1))}</td><td>${r.index}</td><td>${r.updates}</td><td>${r.trainingDeals}</td><td>${esc(d.trainer ? (d.trainer.ownHandEnumeration ? 'own-hands' : 'default') + (d.trainer.terminalBaseline ? '+base' : '') : '?')}</td><td>${esc(String(d.game && d.game.actionSeed != null ? d.game.actionSeed : ''))}</td><td><code>${esc((r.checkpoint && r.checkpoint.strategyHash || '').slice(0, 12))}</code></td><td>${esc(e.mode === 'exactBestResponse' ? 'exact' : e.mode === 'restrictedBestResponse' ? 'restricted (lower bound)' : e.mode ? 'sampled (estimate)' : e.error ? 'failed' : '–')}</td><td>${f(e.nashConv, 5)}</td><td>${e.nashConvCi95 ? f(e.nashConvCi95[0], 4) + ' to ' + f(e.nashConvCi95[1], 4) : '–'}</td><td>${f(r.trainSeconds, 2)}</td></tr>`; }).join('') + `</tbody></table></div>`;
  }
  function comparison() {
    if (st.pick.length !== 2) return `<p class="small muted">Pick two checkpoints in the table to compare their measured gains. For a full strategy comparison (row overlap and strategy distances) use <code>mwcli --compare</code> on saved checkpoints.</p>`;
    const [a, b] = st.pick.map(id => id.split(':').map(Number)), da = st.docs[a[0]], db = st.docs[b[0]];
    const c = A.compareRows(da, da.evaluations[a[1]], db, db.evaluations[b[1]]);
    if (!c.compatible || !c.seats) return `<p class="warn">${esc(c.verdict)}</p>`;
    return `<div class="qd-table"><p class="small">${c.sameStrategy ? 'Identical average strategies (equal strategy hashes).' : 'Different strategies.'} Updates A ${c.updatesA}, B ${c.updatesB}. ${esc(c.note)}</p><table><thead><tr><th>Seat</th><th>Gain A</th><th>Gain B</th><th>B − A</th><th>Simultaneous 95%</th><th>Verdict</th></tr></thead><tbody>` +
      c.seats.map(s => `<tr><td>${esc(s.position)}</td><td>${f(s.gainA, 5)}</td><td>${f(s.gainB, 5)}</td><td>${f(s.difference, 5)}</td><td>${s.simultaneousCi ? f(s.simultaneousCi[0], 4) + ' to ' + f(s.simultaneousCi[1], 4) : 'exact'}</td><td>${esc(s.verdict)}</td></tr>`).join('') + `</tbody></table></div>`;
  }
  function render() {
    const d = st.docs[0], running = !!(st.monitor && !st.monitor.done);
    const o = st.o, inp = (k, label, extra = '') => `<div class="field"><label class="label" for="qd-${k}">${label}</label><input id="qd-${k}" data-qd="${k}" type="number" value="${esc(String(o[k]))}" ${extra} ${running ? 'disabled' : ''}></div>`;
    root.innerHTML = `<div class="card"><div class="row sb"><h2>Convergence dashboard</h2><span class="small muted">${NATIVE ? 'Live data from the native engine' : 'Offline: import analytics files; live training needs the desktop application'}</span></div>
      <p class="small muted">Trains a native multiway study and measures its average strategy at adaptive intervals (exact best response when tractable, otherwise a restricted or sampled lower bound). Evaluations use their own seeds and never change the training state.</p>
      ${NATIVE ? `<div class="grid2">
        <div class="field"><label class="label" for="qd-preset">Study</label><select id="qd-preset" ${running ? 'disabled' : ''}>${Object.entries(PRESETS).map(([k, v]) => `<option value="${k}" ${st.preset === k ? 'selected' : ''}>${esc(v[0])}</option>`).join('')}<option value="custom" ${st.preset === 'custom' ? 'selected' : ''}>Custom native spec (JSON)</option></select></div>
        <div class="field"><label class="label" for="qd-trainer">Trainer</label><select id="qd-trainer" ${running || st.preset === 'custom' ? 'disabled' : ''}>${Object.entries(TRAINERS).map(([k, v]) => `<option value="${k}" ${st.trainer === k ? 'selected' : ''}>${esc(v[0])}</option>`).join('')}</select></div>
        <div class="field"><label class="label" for="qd-evaluation">Evaluation</label><select id="qd-evaluation" ${running ? 'disabled' : ''}>${['auto', 'exact', 'restricted', 'sampled', 'none'].map(m => `<option ${o.evaluation === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
        ${inp('threads', 'CPU workers', 'min="1" max="64"')}${inp('tableMiB', 'Table budget (MiB)', 'min="16"')}${inp('samples', 'Samples (sampled evaluation)', 'min="64"')}
        ${inp('evalSeed', 'Seed', 'min="0"')}${inp('first', 'First evaluation (updates)', 'min="1"')}${inp('growth', 'Interval growth', 'min="1.05" step="0.05"')}
        ${inp('share', 'Max evaluation share of time', 'min="0.01" max="1" step="0.05"')}${inp('maxUpdates', 'Stop: updates', 'min="1"')}${inp('maxSeconds', 'Stop: training seconds', 'min="1"')}
        ${inp('target', 'Stop: NashConv target (optional)', 'min="0" step="any"')}</div>
        ${st.preset === 'custom' ? `<textarea id="qd-spec" rows="5" placeholder="Native spec JSON" ${running ? 'disabled' : ''}>${esc(st.specText)}</textarea>` : ''}` : ''}
      <div class="row">${NATIVE ? `<button class="btn primary" id="qd-start" ${running ? 'disabled' : ''}>Start</button><button class="btn" id="qd-stop" ${running ? '' : 'disabled'}>Stop</button>` : ''}
        <button class="btn" id="qd-json" ${d ? '' : 'disabled'}>Export JSON</button><button class="btn" id="qd-csv" ${d ? '' : 'disabled'}>Export CSV</button>
        <label class="btn">Import analytics<input type="file" id="qd-import" accept=".json,application/json" multiple hidden></label><button class="btn ghost" id="qd-clear" ${st.docs.length ? '' : 'disabled'}>Clear</button></div>
      ${st.error ? `<p class="warn">${esc(st.error)}</p>` : ''}
      ${d && d.stop && d.stop.reason !== 'running' ? `<p class="small">Stopped: <b>${esc(d.stop.reason)}</b>${d.stop.detail ? ' — ' + esc(d.stop.detail) : ''}</p>` : ''}</div>
      <div class="card">${tiles(d)}</div>
      <div class="card">${A.chartsHTML(st.docs)}</div>
      <div class="card"><h3>Checkpoint history</h3>${table() || '<p class="small muted">No evaluations yet.</p>'}${comparison()}</div>
      <div class="card"><h3>Limitations</h3><ul class="small">${A.LIMITATIONS.map(x => `<li>${esc(x)}</li>`).join('')}<li>${esc('Training is paused while an evaluation runs; the adaptive schedule keeps evaluation time below the chosen share of training time.')}</li></ul></div>`;
  }
  root.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.qd) st.o[t.dataset.qd] = t.value;
    if (t.id === 'qd-preset') { st.preset = t.value; render(); }
    if (t.id === 'qd-trainer') st.trainer = t.value;
    if (t.id === 'qd-evaluation') st.o.evaluation = t.value;
    if (t.id === 'qd-spec') st.specText = t.value;
    if (t.dataset.qdPick) { const id = t.dataset.qdPick; st.pick = t.checked ? st.pick.concat(id).slice(-2) : st.pick.filter(x => x !== id); render(); }
    if (t.id === 'qd-import') {
      Promise.all(Array.from(t.files).map(file => file.text().then(x => { const doc = A.validateDoc(JSON.parse(x)); doc.label = file.name; return doc; })))
        .then(ds => { st.docs.push(...ds); st.error = ''; render(); }).catch(err => { st.error = err.message; render(); });
    }
  });
  root.addEventListener('click', async e => {
    const id = e.target.id;
    if (id === 'qd-start') {
      st.error = ''; let spec;
      try { spec = buildSpec(); } catch (err) { st.error = err.message; render(); return; }
      const o = st.o, num = (v, d) => v === '' || v === null || v === undefined ? d : +v;
      const m = st.monitor = new EM.Monitor(api, { threads: num(o.threads, 2), tableMiB: num(o.tableMiB, 512), evaluation: o.evaluation, samples: num(o.samples, 20000), evalSeed: num(o.evalSeed, 7), first: num(o.first, 200), growth: num(o.growth, 2), share: num(o.share, 0.25), maxUpdates: num(o.maxUpdates, 20000), maxSeconds: num(o.maxSeconds, Infinity), target: num(o.target, NaN) }, doc => { if (st.docs[0] !== doc) { if (st.liveSlot) st.docs[0] = doc; else { st.docs.unshift(doc); st.liveSlot = true; } } schedule(); });
      st.liveSlot = false; st.pick = [];
      m.run(spec).catch(err => { st.error = err.message; }).finally(() => { m.done = true; render(); });
      render();
    }
    if (id === 'qd-stop' && st.monitor) st.monitor.stop();
    if (id === 'qd-json' && st.docs[0]) download('eightmax-analytics.json', JSON.stringify(st.docs[0], null, 1), 'application/json');
    if (id === 'qd-csv' && st.docs[0]) download('eightmax-analytics.csv', A.toCSV(st.docs[0]), 'text/csv');
    if (id === 'qd-clear') { if (!(st.monitor && !st.monitor.done)) { st.docs = []; st.pick = []; st.monitor = null; } render(); }
  });
  // Rendering is coalesced to at most 2 frames per second so polling never piles up DOM work.
  let pending = false; function schedule() { if (pending) return; pending = true; setTimeout(() => { pending = false; render(); }, 500); }
  render();
  return { render };
};
})();
