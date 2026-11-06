(function () {
'use strict';
const EM = window.EM;
const TB = EM.initPushFoldTables();
const NC = 169;
const POS8 = EM.pfPositions(8);
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const fmtS = (x, d = 2) => (Number.isFinite(x) ? (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d) : '–');
const pct = (x, d = 1) => (Number.isFinite(x) ? (x * 100).toFixed(d) + '%' : '–');
const SUITS = ['c', 'd', 'h', 's'];
const store = {
  get(k, d) { try { const v = localStorage.getItem('em8.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('em8.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
};
function cardHTML(c, cls = '') {
  if (c == null || c < 0) return `<span class="pc empty ${cls}">+</span>`;
  return `<span class="pc ${SUITS[c & 3]} ${cls}">${EM.RC[c >> 2]}<em>${EM.SUIT_SYM[c & 3]}</em></span>`;
}
function cardText(c) { return `<b class="suit-${SUITS[c & 3]}">${EM.RC[c >> 2]}${EM.SUIT_SYM[c & 3]}</b>`; }

// ---------- worker ----------
const W = { worker: null, pending: new Map(), id: 0, inline: false };
function onMsg(m) {
  const p = W.pending.get(m.id);
  if (!p) return;
  if (m.type === 'progress') { if (p.onProgress) p.onProgress(m); return; }
  W.pending.delete(m.id);
  if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m.result);
}
function startWorker() {
  try {
    const src = $('#em-lib').textContent + '\n;EM.workerMain(self);\n';
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    W.worker = new Worker(url);
    W.worker.onmessage = (e) => onMsg(e.data);
    W.worker.onerror = (e) => { console.warn('worker error', e.message); };
  } catch (e) {
    W.inline = true;
    const fake = { postMessage: (m) => setTimeout(() => onMsg(m), 0), onmessage: null };
    EM.workerMain(fake);
    W.worker = { postMessage: (m) => setTimeout(() => fake.onmessage({ data: m }), 0) };
  }
}
function call(type, payload = {}, onProgress) {
  return new Promise((resolve, reject) => {
    const id = ++W.id;
    W.pending.set(id, { resolve, reject, onProgress });
    W.worker.postMessage(Object.assign({ type, id }, payload));
  });
}

// ---------- engine: browser worker or the native EightMax server ----------
const NATIVE = !!window.EM_NATIVE;
let NINFO = null;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function napi(path, body) {
  const opt = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-EightMax': '1' }, body: JSON.stringify(body) };
  const r = await fetch(path, opt);
  let j = null; try { j = await r.json(); } catch (e) { /* not json */ }
  if (!r.ok) throw new Error((j && j.error) || ('EightMax engine error ' + r.status));
  return j;
}
const Engine = {
  build(cfg) { return NATIVE ? napi('/api/build', cfg) : call('post-build', { cfg }); },
  estimate(cfg) { return NATIVE ? napi('/api/estimate', cfg) : call('post-estimate', { cfg }); },
  async solve(opts, onProgress) {
    if (!NATIVE) { if (opts.reset) await call('post-reset'); return call('post-solve', opts, onProgress); }
    await napi('/api/solve', { target: opts.target, maxIter: opts.maxIter, reset: opts.reset ? 1 : 0, power: PO.power });
    for (;;) {
      await sleep(350);
      const st = await napi('/api/status');
      if (st.error) throw new Error(st.error);
      onProgress({ it: st.it, ex: st.ex, elapsed: st.elapsed, engine: st.engine, gpu: st.gpu });
      if (!st.running) return { it: st.it, ex: st.ex, chips: st.chips, elapsed: st.elapsed, stopped: st.stopped, engine: st.engine, gpu: st.gpu };
    }
  },
  stop() { if (NATIVE) napi('/api/stop', {}).catch(() => {}); else W.worker.postMessage({ type: 'post-stop' }); },
  node(path) { return NATIVE ? napi('/api/node', { path }) : call('post-node', { path }); },
  runouts(path) { return NATIVE ? napi('/api/runouts', { path }) : call('post-runouts', { path }); },
  lock(path, strategy) { return NATIVE ? napi('/api/lock', { path, strategy: strategy ? Array.from(strategy) : null }) : call('post-lock', { path, strategy }); },
  async report(cfg, flops, target, maxIter, onRow, onCurrent) {
    if (!NATIVE) return call('report-start', { cfg, flops, target, maxIter }, (m) => { if (m.row) onRow(m.row); if (m.current) onCurrent(m.current); });
    await napi('/api/report', { cfg: JSON.stringify(cfg), flops: flops.map(f => [f[0], f[1], f[2], Math.round(f[3])]), target, maxIter, power: PO.power });
    let seen = 0;
    for (;;) {
      await sleep(800);
      const st = await napi('/api/report');
      for (; seen < st.results.length; seen++) onRow(st.results[seen]);
      if (st.current) onCurrent(st.current);
      if (st.error) throw new Error(st.error);
      if (!st.running) return { stopped: st.stopped, done: st.done };
    }
  },
  reportStop() { if (NATIVE) napi('/api/report/stop', {}).catch(() => {}); else W.worker.postMessage({ type: 'report-stop' }); }
};

// ---------- tabs ----------
const riverPanel = EM.multiwayPanel($('#v-river'), call, esc, pct, fmt);
const TABS = ['preflop', 'postflop', 'river', 'reports', 'trainer', 'icm'];
let tab = 'preflop';
function setTab(t, push) {
  if (t === 'multiway') t = 'river';  // Keep the original tab and bookmark working.
  if (!TABS.includes(t)) t = 'preflop';
  tab = t;
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === t));
  for (const v of TABS) $('#v-' + v).hidden = v !== t;
  if (push && location.hash !== '#' + t) history.replaceState(null, '', '#' + t);
  if (t === 'trainer' && !TR.spot) trNew();
  render();
}

// ---------- shared grid ----------
function cellHTML(k, segs, opts = {}) {
  // segs: [[color, fraction], ...]; opts.h: fill height (0..1); opts.text: secondary label; opts.bg
  const h = opts.h == null ? 1 : Math.max(0, Math.min(1, opts.h));
  let fill = '';
  if (h > 0.001 && segs.length) {
    fill = `<div class="fill" style="height:${(h * 100).toFixed(1)}%">` +
      segs.filter(s => s[1] > 0.0005).map(s => `<i style="width:${(s[1] * 100).toFixed(2)}%;background:${s[0]}"></i>`).join('') + '</div>';
  }
  const style = opts.bg ? ` style="background:${opts.bg}"` : '';
  const cls = 'cell' + (opts.sel ? ' sel' : '') + (opts.dim ? ' dim' : '') + (opts.mine ? ' mine' : '');
  return `<button class="${cls}" data-k="${k}"${style} aria-label="${EM.CLASS_NAMES[k]}">${fill}<span class="lab"><span>${EM.CLASS_NAMES[k]}${opts.text != null ? `<small>${opts.text}</small>` : ''}</span></span></button>`;
}
function gridHTML(fn) { let s = '<div class="grid13" role="grid">'; for (let k = 0; k < NC; k++) s += fn(k); return s + '</div>'; }
function heat(v) { // 0..1 -> red..amber..green
  v = Math.max(0, Math.min(1, v));
  const hue = v * 130; return `hsl(${hue.toFixed(0)} 62% ${(30 + 8 * Math.abs(v - .5)).toFixed(0)}%)`;
}

// ============================================================
// PREFLOP
// ============================================================
const CH = EM.CHARTS, AL = {};
for (let i = 0; i < 64; i++) AL[CH.alph[i]] = i;
const libCache = new Map();
function chartIndex(i, j) {
  if (j < 0) return i;
  let k = 7;
  for (let a = 0; a < 7; a++) for (let b = a + 1; b < 8; b++) { if (a === i && b === j) return k; k++; }
  return -1;
}
function libFreq(S, i, j) {
  const str = CH.data[S], base = chartIndex(i, j) * NC, f = new Float64Array(NC);
  for (let h = 0; h < NC; h++) f[h] = AL[str[base + h]] / 63;
  return f;
}
function libSolution(S) {
  if (libCache.has(S)) return libCache.get(S);
  const jam = [], callR = [];
  for (let i = 0; i < 7; i++) jam.push(libFreq(S, i, -1));
  for (let i = 0; i < 7; i++) { callR.push([]); for (let j = 0; j < 8; j++) callR[i].push(j > i ? libFreq(S, i, j) : null); }
  const s = EM.PushFold({ n: 8, stacks: Array(8).fill(S), anteType: CH.anteType, ante: CH.ante });
  s.load({ jam, call: callR });
  const r = s.results();
  const sol = { n: 8, positions: POS8, model: 'chip', unit: 'bb', jam: r.jam, call: r.call, label: `${S}bb · 8-max · 0.1 bb ante each`, stacks: Array(8).fill(S), source: 'library' };
  libCache.set(S, sol);
  return sol;
}

const PF = {
  source: 'library', stack: store.get('pf.stack', 10), hero: 0, facing: -1, cell: null, view: 'freq',
  custom: null, solving: false, prog: null, err: null, setupOpen: true,
  cfg: Object.assign({}, EM.MTT_ANTE, store.get('pf.cfg', { n: 8, stacks: [20, 20, 20, 20, 20, 20, 20, 20], model: 'chip', payouts: '30, 20, 14, 11, 9, 7, 5, 4', others: '' }))
};
function pfSol() { return PF.source === 'custom' && PF.custom ? PF.custom : libSolution(PF.stack); }
function pfDecision(sol) {
  if (PF.facing < 0) return sol.jam[PF.hero] ? { kind: 'jam', d: sol.jam[PF.hero] } : null;
  const row = sol.call[PF.facing];
  return row && row[PF.hero] ? { kind: 'call', d: row[PF.hero] } : null;
}
function pfFixSel(sol) {
  const n = sol.n;
  if (PF.hero >= n) PF.hero = 0;
  if (PF.hero === n - 1 && PF.facing < 0) PF.facing = n - 2;
  if (PF.facing >= PF.hero) PF.facing = -1;
  if (PF.hero === n - 1 && PF.facing < 0) PF.facing = n - 2;
}
// highest library stack where hand k is played >= 50%
function nashMax(hero, facing) {
  const out = new Float64Array(NC).fill(0);
  for (const S of CH.stacks) {
    const f = libFreq(S, facing < 0 ? hero : facing, facing < 0 ? -1 : hero);
    for (let k = 0; k < NC; k++) if (f[k] >= 0.5) out[k] = S;
  }
  return out;
}
function equityVsRange(k, J) {
  let num = 0, den = 0;
  for (let c = 0; c < NC; c++) { const m = TB.MT[c * NC + k] * J[c]; if (m <= 0) continue; num += m * (TB.W[k * NC + c] + 0.5 * TB.T[k * NC + c]); den += m; }
  return den > 0 ? num / den : NaN;
}

function renderPreflop() {
  const v = $('#v-preflop');
  const custOn = PF.source === 'custom';
  const seg = `<div class="seg" role="group" aria-label="Solution source">
    <button data-pf-src="library" aria-pressed="${PF.source === 'library'}">Push/fold</button>
    <button data-pf-src="deep" aria-pressed="${PF.source === 'deep'}">15–100bb</button>
    <button data-pf-src="custom" aria-pressed="${custOn}">Custom / ICM</button></div>`;
  if (PF.source === 'deep') { renderDeep(v, seg); return; }
  if (custOn && !PF.custom) {
    v.innerHTML = `<div class="card"><div class="row sb">${seg}<span class="small muted">Custom stacks and payouts</span></div></div>` +
      renderCustomSetup(true) + `<p class="note">Set the stacks for each seat, then solve. Typical solves take a few seconds.</p>`;
    return;
  }
  const sol = custOn ? PF.custom : libSolution(PF.stack);
  pfFixSel(sol);
  const n = sol.n, pos = sol.positions;
  const dec = pfDecision(sol);
  const isLib = !custOn;
  const unit = sol.model === 'icm' ? '$' : 'bb';
  let html = '';
  html += `<div class="card"><div class="row sb">${seg}
    <span class="small muted">${isLib ? 'Chip EV · 0.1 bb ante each · equal stacks' : esc(sol.label)}</span></div>`;
  if (isLib) {
    html += `<div class="row sb"><div class="stepper"><button class="iconbtn" data-pf-step="-1" aria-label="Shorter stack">−</button>
      <div class="val num">${PF.stack}<small>bb</small></div><button class="iconbtn" data-pf-step="1" aria-label="Deeper stack">+</button></div>
      <input type="range" id="pf-stack" min="${CH.stacks[0]}" max="${CH.stacks[CH.stacks.length - 1]}" step="1" value="${PF.stack}" aria-label="Stack depth" style="flex:1;min-width:140px"></div>`;
  } else {
    html += `<div class="seats">${pos.map((p, i) => `<span class="small"><span class="muted">${p}</span> <b class="num">${fmt(sol.stacks[i], sol.stacks[i] % 1 ? 1 : 0)}</b></span>`).join('')}</div>`;
  }
  html += `</div>`;
  if (custOn) html += renderCustomSetup(PF.setupOpen);
  // seat + facing
  html += `<div class="card"><div class="field"><span class="label">Your seat</span><div class="chips">` +
    pos.map((p, i) => `<button class="chip" data-pf-hero="${i}" aria-pressed="${PF.hero === i}">${p}</button>`).join('') + `</div></div>`;
  html += `<div class="field"><span class="label">Action before you</span><div class="chips">` +
    `<button class="chip" data-pf-facing="-1" aria-pressed="${PF.facing < 0}" ${PF.hero === n - 1 ? 'disabled' : ''}>Folded to you</button>` +
    pos.slice(0, PF.hero).map((p, i) => `<button class="chip" data-pf-facing="${i}" aria-pressed="${PF.facing === i}">${p} jams</button>`).join('') + `</div></div>`;
  // summary
  if (dec) {
    const d = dec.d, verb = dec.kind === 'jam' ? 'jams' : 'calls', color = dec.kind === 'jam' ? 'var(--jam)' : 'var(--call)';
    const combos = d.pct / 100 * 1326;
    const ctx = dec.kind === 'jam' ? 'when folded to' : `vs ${pos[PF.facing]} jam`;
    html += `<div class="summary"><span class="big num" style="color:${color}">${fmt(d.pct, 1)}%</span>
      <span><b>${pos[PF.hero]}</b> ${verb} ${ctx} · <span class="num">${Math.round(combos)}</span> combos</span>
      <span class="small muted">spot occurs ${pct(d.reach, d.reach < 0.01 ? 2 : 1)} of hands</span></div>`;
    html += `<div class="row sb"><div class="seg" role="group" aria-label="Grid view">
      <button data-pf-view="freq" aria-pressed="${PF.view === 'freq'}">Strategy</button>
      <button data-pf-view="ev" aria-pressed="${PF.view === 'ev'}">EV</button>
      ${isLib ? `<button data-pf-view="nash" aria-pressed="${PF.view === 'nash'}">Max stack</button>` : ''}</div>
      ${PF.view === 'ev' && unit === '$' ? '<span class="small muted">EV vs fold, % of prize pool</span>' : ''}
      <div class="legend"><span><i style="background:${color}"></i>${dec.kind === 'jam' ? 'Jam' : 'Call'}</span><span><i style="background:var(--fold)"></i>Fold</span></div></div>`;
    const freq = d.freq, ev = d.ev;
    let nm = null;
    if (PF.view === 'nash' && isLib) nm = nashMax(PF.hero, PF.facing);
    let evMax = 0; for (let k = 0; k < NC; k++) evMax = Math.max(evMax, Math.abs(ev[k]));
    html += `<div class="gridwrap" id="pf-grid">` + gridHTML(k => {
      const f = freq[k], sel = PF.cell === k;
      if (PF.view === 'nash' && nm) {
        const s = nm[k], top = CH.stacks[CH.stacks.length - 1];
        const txt = s >= top ? top + '+' : s > 0 ? String(s) : '';
        return cellHTML(k, s > 0 ? [[color, 1]] : [], { h: s > 0 ? Math.max(0.12, s / top) : 0, text: txt, sel, dim: !s });
      }
      if (PF.view === 'ev') {
        const e = ev[k], a = Math.min(1, Math.abs(e) / Math.max(evMax, 1e-9));
        const bg = e >= 0 ? `rgba(51,160,103,${0.15 + 0.75 * a})` : `rgba(216,67,76,${0.15 + 0.75 * a})`;
        return cellHTML(k, [], { bg, text: unit === '$' ? fmtS(e / sol.total * 100, 1) : fmtS(e, 1), sel });
      }
      const mixed = f > 0.02 && f < 0.98;
      return cellHTML(k, [[color, f], ['rgba(59,105,196,.55)', 1 - f]], { text: mixed ? Math.round(f * 100) : null, sel });
    }) + `</div>`;
    // detail
    if (PF.cell != null) html += pfDetail(sol, dec, PF.cell, unit);
    else html += `<p class="note">Tap a hand for its frequency and EV. ${PF.view === 'nash' ? '<b>Max stack</b> shows the deepest stack (bb) at which Nash still plays the hand.' : ''}</p>`;
  }
  html += `</div>`;
  html += `<p class="note">Model: every player jams or folds; the first caller is heads-up with the jammer (later players fold). Exact hand-vs-hand equities with card removal. ${n === 8 && isLib && PF.stack <= 6 ? '<span class="warn">At very short stacks multiway all-ins are common and not modeled.</span>' : ''} Push/fold is near-optimal up to about 10–12bb; deeper, real strategies add min-raises and limps.</p>`;
  v.innerHTML = html;
}
function pfDetail(sol, dec, k, unit) {
  const d = dec.d, f = d.freq[k], e = d.ev[k];
  const act = dec.kind === 'jam' ? 'Jam' : 'Call';
  let eqTxt = '';
  if (dec.kind === 'call') {
    const eq = equityVsRange(k, sol.jam[PF.facing].freq);
    eqTxt = `<div class="stat"><span class="label">Equity vs jam</span><span class="v">${pct(eq)}</span></div>`;
  }
  const evTxt = unit === '$' ? fmtS(e / sol.total * 100, 2) + '% of pool' : fmtS(e, 2) + ' bb';
  const verdict = f > 0.98 ? `Always ${act.toLowerCase()}` : f < 0.02 ? 'Always fold' : `Mix: ${act.toLowerCase()} ${Math.round(f * 100)}%`;
  return `<div class="detail"><div class="row sb"><h3>${EM.CLASS_NAMES[k]}</h3><span class="small muted">${EM.CLASS_NCOMBOS[k]} combos</span></div>
    <div class="stats"><div class="stat"><span class="label">Nash</span><span class="v">${verdict}</span></div>
    <div class="stat"><span class="label">${act} vs fold</span><span class="v" style="color:${e >= 0 ? 'var(--good)' : 'var(--bad)'}">${evTxt}</span></div>${eqTxt}</div></div>`;
}
function renderCustomSetup(open) {
  const c = PF.cfg, pos = EM.pfPositions(c.n);
  let html = `<details class="card" id="pf-setup" ${open ? 'open' : ''}><summary><h2 style="display:inline">Custom spot</h2></summary>
    <div class="field"><span class="label">Players at the table</span><div class="chips">` +
    [2, 3, 4, 5, 6, 7, 8].map(n => `<button class="chip" data-pfc-n="${n}" aria-pressed="${c.n === n}">${n}</button>`).join('') + `</div></div>
    <div class="field"><span class="label">Stacks before posting (bb)</span><div class="seats">` +
    pos.map((p, i) => `<label for="pfc-s${i}">${p}<input id="pfc-s${i}" type="number" inputmode="decimal" min="1" step="0.5" value="${c.stacks[i] ?? 20}" data-pfc-stack="${i}"></label>`).join('') + `</div>
    <div class="row"><label class="small muted" for="pfc-all">Set all</label><input id="pfc-all" type="number" inputmode="decimal" min="1" step="0.5" placeholder="e.g. 12" style="width:90px"><button class="btn" data-pfc-all="1">Apply</button></div></div>
    <div class="field"><span class="label">Ante</span><div class="seg" role="group" aria-label="Ante structure">${[['classic', 'Each player'], ['bba', 'Big blind ante'], ['none', 'None']].map(([k, l]) => `<button data-pfc-ante="${k}" aria-pressed="${(c.anteType || 'classic') === k}">${l}</button>`).join('')}</div></div>
    ${(c.anteType || 'classic') !== 'none' ? `<div class="row"><label class="small muted" for="pfc-ante">Ante (bb)</label><input id="pfc-ante" type="number" inputmode="decimal" min="0" step="0.05" value="${c.ante ?? 0.1}" style="width:90px"></div>` : ''}
    <p class="note">${(() => { try { return esc(EM.anteModel(c).label(c.n)); } catch (e) { return esc(e.message); } })()}.</p>
    <div class="field"><span class="label">Payoff</span><div class="seg" role="group" aria-label="Payoff model">
      <button data-pfc-model="chip" aria-pressed="${c.model === 'chip'}">Chip EV</button><button data-pfc-model="icm" aria-pressed="${c.model === 'icm'}">ICM</button></div></div>`;
  if (c.model === 'icm') {
    html += `<div class="fields"><div class="field"><label class="label" for="pfc-pay">Payouts, 1st place first</label><input id="pfc-pay" type="text" value="${esc(c.payouts)}" placeholder="30, 20, 14, 11"></div>
      <div class="field"><label class="label" for="pfc-oth">Players at other tables (bb)</label><input id="pfc-oth" type="text" value="${esc(c.others)}" placeholder="optional, e.g. 25, 14"></div></div>
      <p class="note">ICM uses the Malmuth–Harville model over everyone still in, including players at other tables (up to 16 total).</p>
      <div class="field"><span class="label">Future hands (FGS)</span><div class="seg" role="group" aria-label="Future game simulation">${[[0, 'Off'], [1, 'Next hand'], [2, 'Next 2 hands']].map(([k, l]) => `<button data-pfc-fgs="${k}" aria-pressed="${Math.min(+c.fgs || 0, c.n > 4 ? 1 : 2) === k}" ${k === 2 && c.n > 4 ? 'disabled title="Two-hand simulation is limited to 4 players or fewer"' : ''}>${l}</button>`).join('')}</div></div>
      <p class="note">${+c.fgs ? 'Each possible result of this hand is valued by solving the next ' + (+c.fgs === 2 && c.n <= 4 ? 'two hands' : 'hand') + ' at the same blinds, with the button moving one seat. This accounts for blind pressure that plain ICM ignores, such as the short stack who posts the big blind next. It is slower: about ' + (c.n > 6 ? '15' : c.n > 4 ? '6' : '2') + (+c.fgs === 2 && c.n <= 4 ? '0' : '') + ' seconds.' : 'Plain ICM values stacks the moment the hand ends and ignores the blinds still to come.'}</p>
      <div class="field"><span class="label">Bounties</span><div class="seg" role="group" aria-label="Bounty format">${[['none', 'None'], ['pko', 'PKO'], ['ko', 'Knockout']].map(([k, l]) => `<button data-pfc-bk="${k}" aria-pressed="${(c.bountyKind || 'none') === k}">${l}</button>`).join('')}</div></div>`;
    if (c.bountyKind && c.bountyKind !== 'none') {
      html += `<div class="field"><span class="label">Bounty on each player (same units as payouts)</span><div class="seats">` +
        pos.map((p, i) => `<label for="pfc-b${i}">${p}<input id="pfc-b${i}" type="number" inputmode="decimal" min="0" step="0.5" value="${(c.bounties || [])[i] ?? 0}"></label>`).join('') + `</div></div>
        <p class="note">${c.bountyKind === 'pko' ? 'Progressive knockout: busting a player pays half their bounty now and adds the other half to your own.' : 'Knockout: busting a player pays their whole bounty.'} You can only win a bounty from a player you cover. Your own bounty counts at its amount times your share of the chips in play, your rough chance to win it back.</p>`;
    }
  }
  html += `<div class="row"><button class="btn primary big" data-pfc-solve="1" ${PF.solving ? 'disabled' : ''}>${PF.solving ? 'Solving…' : 'Solve push/fold'}</button>
    <button class="btn" data-pfc-overcall="1" ${PF.solving ? 'disabled' : ''}>Solve with overcalls</button>
    ${PF.prog ? `<span class="small muted num">${PF.prog.stage ? esc(PF.prog.stage) : `iteration ${PF.prog.it} · Nash distance ${PF.prog.ex.toExponential(1)}`}</span>` : ''}</div>
    ${PF.err ? `<p class="err">${esc(PF.err)}</p>` : ''}</details>`;
  return html;
}
function readCustom() {
  const c = PF.cfg;
  for (let i = 0; i < c.n; i++) { const el = $('#pfc-s' + i); if (el) c.stacks[i] = parseFloat(el.value); }
  const p = $('#pfc-pay'); if (p) c.payouts = p.value;
  const o = $('#pfc-oth'); if (o) c.others = o.value;
  const an = $('#pfc-ante'); if (an) c.ante = parseFloat(an.value);
  if (!c.bounties) c.bounties = [];
  for (let i = 0; i < c.n; i++) { const el = $('#pfc-b' + i); if (el) c.bounties[i] = parseFloat(el.value) || 0; }
  store.set('pf.cfg', c);
}
// Push/fold assumes the first caller ends the action. The Shove / call study lets every seat
// overcall or isolate, so it is the more complete model for multiway jams.
function pfToShove() {
  readCustom();
  const c = PF.cfg, pos = EM.pfPositions(c.n);
  const seats = pos.map((name, i) => ({ name, stack: String(c.stacks[i] ?? 20), prior: '0', range: 'random', lead: true }));
  const ok = riverPanel.importSpot({ study: 'shove', board: '', privateMode: 'sampled', maxIter: 20000, dealt: c.n, common: '0', folded: '', seats,
    anteType: c.anteType || 'classic', ante: c.ante == null ? '' : String(c.ante), payoff: c.model === 'icm' ? 'icm' : 'chip', payouts: c.payouts || '50,30,20', others: c.others || '',
    notes: 'Imported from push/fold. Every seat can call, overcall or isolate all-in.' + (c.bountyKind && c.bountyKind !== 'none' ? ' Bounties are not modeled in this study.' : '') + (c.model === 'icm' && +c.fgs ? ' Future-hand simulation (FGS) is push/fold only; this study uses plain ICM.' : '') });
  if (ok) setTab('river', true);
}
async function pfSolveCustom() {
  readCustom();
  const c = PF.cfg;
  PF.err = null;
  let cfg;
  try {
    const stacks = c.stacks.slice(0, c.n).map(Number);
    if (stacks.some(x => !(x > 0))) throw new Error('Enter a stack for every seat');
    const am = EM.anteModel(c);
    cfg = { n: c.n, stacks, anteType: am.type, ante: am.amount, model: c.model };
    if (c.model === 'icm') { cfg.payouts = EM.parseNumberList(c.payouts); cfg.others = EM.parseNumberList(c.others); if (!cfg.payouts.length) throw new Error('Enter the payouts'); }
    if (c.model === 'icm' && +c.fgs) cfg.fgs = { depth: c.n > 4 ? 1 : Math.min(2, +c.fgs) };
    if (c.model === 'icm' && c.bountyKind && c.bountyKind !== 'none') {
      const b = Array.from({ length: c.n }, (_, i) => +((c.bounties || [])[i]) || 0);
      if (b.some(x => x < 0)) throw new Error('Bounties cannot be negative');
      if (b.some(x => x > 0)) cfg.bounty = { kind: c.bountyKind, b };
    }
  } catch (e) { PF.err = e.message; render(); return; }
  PF.solving = true; PF.prog = null; render();
  try {
    const r = await call('pf-solve', { cfg, tol: c.model === 'icm' ? 1e-6 : 2e-6 }, (m) => { PF.prog = m; renderPreflopProgress(); });
    const total = cfg.model === 'icm' ? cfg.payouts.reduce((a, b) => a + b, 0) : 1;
    PF.custom = {
      n: r.n, positions: r.positions, model: r.model, unit: r.model === 'icm' ? '$' : 'bb', jam: r.jam, call: r.call, total,
      label: `${r.n}-handed · ${cfg.model === 'icm' ? 'ICM' : 'chip EV'}${cfg.fgs ? ' · FGS ' + cfg.fgs.depth + (cfg.fgs.depth > 1 ? ' hands' : ' hand') : ''}${cfg.bounty ? (cfg.bounty.kind === 'ko' ? ' · knockout bounties' : ' · PKO bounties') : ''} · ${EM.anteModel(cfg).label(r.n)} · ${r.iterations} iterations`,
      stacks: cfg.stacks, source: 'custom'
    };
    PF.source = 'custom'; PF.setupOpen = false;
  } catch (e) { PF.err = e.message; PF.setupOpen = true; }
  PF.solving = false; PF.prog = null;
  render();
}
function renderPreflopProgress() {
  const b = document.querySelector('[data-pfc-solve]');
  if (b && b.nextElementSibling && PF.prog) b.nextElementSibling.textContent = PF.prog.stage || `iteration ${PF.prog.it} · Nash distance ${PF.prog.ex.toExponential(1)}`;
  else if (b && PF.prog) { const s = document.createElement('span'); s.className = 'small muted num'; s.textContent = `iteration ${PF.prog.it}`; b.after(s); }
}

// ============================================================
// POSTFLOP
// ============================================================
const PRESETS = [
  { name: 'BTN vs BB · single raised · 25bb', pot: 5.5, stack: 22.8, board: 'Ks7d2c', oop: 'BB', ip: 'BTN', raiser: 'ip', tree: 'srp',
    r: ['22-99,A2s-ATs,A2o-AJo,K2s-KJs,K5o-KJo,Q2s-QJs,Q7o-QJo,J4s-JTs,J7o-JTo,T5s-T9s,T7o-T9o,95s-98s,97o-98o,85s-87s,86o-87o,74s-76s,76o,63s-65s,53s-54s,43s',
      '22+,A2s+,A2o+,K2s+,K7o+,Q4s+,Q9o+,J6s+,J9o+,T6s+,T9o,96s+,98o,85s+,87o,75s+,64s+,54s'] },
  { name: 'CO vs BB · single raised · 40bb', pot: 5.7, stack: 37.7, board: 'Qh8s4d', oop: 'BB', ip: 'CO', raiser: 'ip', tree: 'srp',
    r: ['22-JJ,A2s-AJs,A8o-AQo,A5o-A2o,K2s-KQs,K8o-KQo,Q4s-QJs,Q9o-QJo,J6s-JTs,J9o-JTo,T6s-T9s,T9o,96s-98s,98o,85s-87s,87o,75s-76s,64s-65s,53s-54s,43s',
      '22+,A2s+,A8o+,A5o,K6s+,KTo+,Q8s+,QTo+,J8s+,JTo,T8s+,97s+,86s+,76s,65s,54s'] },
  { name: 'HJ vs BTN · 3-bet pot · 40bb', pot: 14.7, stack: 33.7, board: 'Jc9c3h', oop: 'HJ', ip: 'BTN', raiser: 'ip', tree: 'tbp',
    r: ['TT-77,AQs-ATs,AQo,KQs,KJs,QJs,JTs,T9s,A5s-A4s,98s',
      'JJ+,AKs,AKo,AQs,A5s-A4s,KQs,K9s-K8s,Q9s,J9s,T8s,76s,65s'] },
  { name: 'SB vs BB · limped pot · 20bb', pot: 2.8, stack: 18.9, board: 'Td6s5s', oop: 'SB', ip: 'BB', raiser: 'limp', tree: 'standard',
    r: ['22-99,A2s-ATs,A2o-ATo,K2s-KJs,K2o-KJo,Q2s-QJs,Q2o-QJo,J2s-JTs,J4o-JTo,T2s-T9s,T6o-T9o,92s-98s,96o-98o,82s-87s,85o-87o,72s-76s,75o-76o,62s-65s,64o-65o,52s-54s,54o,42s-43s,32s',
      '22-88,A2s-A9s,A2o-A9o,K2s-KTs,K2o-KTo,Q2s-QTs,Q2o-QJo,J2s-JTs,J2o-JTo,T2s-T9s,T2o-T9o,92s-98s,92o-98o,82s-87s,82o-87o,72s-76s,72o-76o,62s-65s,62o-65o,52s-54s,52o-54o,42s-43s,42o-43o,32s,32o'] }
];
// Bet-size presets, written for the preflop raiser and the caller; treeSizes() maps them onto OOP and IP.
// Per street: r = the raiser's bets, c = the caller's (on the flop: OOP's lead; cIP = IP's bet when an OOP
// raiser checks), rR / cR = raise sizes, donk = OOP's lead right after calling a bet (turn, river).
// Sizes: % of pot, Nx = N times the bet faced, g = geometric (all-in by the river), a = all-in.
const TREES = {
  fast: { label: 'Fast', group: 'Quick', note: 'One size per street. The quickest solve.', maxBets: 3, reraise: 'allin',
    s: [{ r: '33', c: '', cIP: '33', rR: 'a', cR: 'a' }, { r: '75', c: '75', rR: 'a', cR: 'a', donk: '' }, { r: '75', c: '75', rR: 'a', cR: 'a', donk: '' }] },
  standard: { label: 'Standard', group: 'Quick', note: 'Two sizes per street, check-raises 60% or all-in.', maxBets: 3, reraise: 'allin',
    s: [{ r: '33,75', c: '', cIP: '33,75', rR: 'a', cR: '60,a' }, { r: '50,100', c: '50', rR: 'a', cR: 'a', donk: '' }, { r: '50,100', c: '50', rR: 'a', cR: 'a', donk: '' }] },
  srp: { label: 'Single-raised pot', group: 'Online MTT', note: 'C-bets 33%, 75% or 125%; turn 50% or pot; river 33%, 75% or 150%; 3x check-raises; the caller probes 66%.', maxBets: 3, reraise: 'allin',
    s: [{ r: '33,75,125', c: '', cIP: '33,75', rR: 'a', cR: '3x,a' }, { r: '50,100', c: '66', rR: 'a', cR: 'a', donk: '' }, { r: '33,75,150', c: '66', rR: 'a', cR: 'a', donk: '' }] },
  srpRaise: { label: 'Single-raised pot + raises', group: 'Online MTT', note: 'Adds 3x turn raises and 2.5x river raises: about twice the tree.', maxBets: 3, reraise: 'allin',
    s: [{ r: '33,75,125', c: '', cIP: '33,75', rR: 'a', cR: '3x,a' }, { r: '50,100', c: '66', rR: '3x,a', cR: '3x,a', donk: '' }, { r: '33,75,150', c: '66', rR: '2.5x,a', cR: '2.5x,a', donk: '' }] },
  srpLead: { label: 'Single-raised pot + leads', group: 'Online MTT', note: 'The caller may also lead 33% on the flop and donk 33% on the turn and river. Big at 60bb and deeper.', maxBets: 3, reraise: 'allin',
    s: [{ r: '33,75,125', c: '33', cIP: '33,75', rR: '3x,a', cR: '3x,a' }, { r: '50,100', c: '66', rR: 'a', cR: 'a', donk: '33' }, { r: '33,75,150', c: '66', rR: 'a', cR: 'a', donk: '33' }] },
  tbp: { label: '3-bet pot', group: 'Online MTT', note: 'C-bets 25% or 50%; turn 50% or pot; river 50%, pot or all-in.', maxBets: 3, reraise: 'allin',
    s: [{ r: '25,50', c: '', cIP: '33,66', rR: 'a', cR: '3x,a' }, { r: '50,100', c: '50', rR: 'a', cR: 'a', donk: '' }, { r: '50,100,a', c: '50', rR: 'a', cR: 'a', donk: '' }] },
  small: { label: 'Small ball', group: 'Styles', note: 'Small sizes: 25% or 50% on the flop, 33% or 66% on the turn and river.', maxBets: 3, reraise: 'allin',
    s: [{ r: '25,50', c: '', cIP: '25,50', rR: 'a', cR: '3x,a' }, { r: '33,66', c: '33', rR: 'a', cR: 'a', donk: '' }, { r: '33,66', c: '33', rR: 'a', cR: 'a', donk: '' }] },
  polar: { label: 'Polar and overbets', group: 'Styles', note: 'Big bets: 75% or 125% on the flop, 75% or 150% on the turn, up to all-in on the river.', maxBets: 3, reraise: 'allin',
    s: [{ r: '75,125', c: '', cIP: '75', rR: 'a', cR: 'a' }, { r: '75,150', c: '75', rR: 'a', cR: 'a', donk: '' }, { r: '75,150,a', c: '75', rR: 'a', cR: 'a', donk: '' }] },
  geo: { label: 'Geometric', group: 'Styles', note: 'A small bet or the geometric size: the same pot fraction every street gets the stacks in by the river.', maxBets: 3, reraise: 'allin',
    s: [{ r: '33,g', c: '', cIP: '33,g', rR: 'a', cR: '3x,a' }, { r: '50,g', c: 'g', rR: 'a', cR: 'a', donk: '' }, { r: '50,g', c: 'g', rR: 'a', cR: 'a', donk: '' }] },
  detailed: { label: 'Detailed', group: 'Big trees', note: 'Three sizes on most streets, raises at every level. Up to several GB.', maxBets: 3, reraise: 'same',
    s: [{ r: '25,50,100', c: '33', cIP: '25,50,100', rR: '50,a', cR: '50,a' }, { r: '33,75,125', c: '33,75', rR: '60,a', cR: '60,a', donk: '33,75' }, { r: '33,75,125,a', c: '33,75', rR: 'a', cR: 'a', donk: '33,75' }] },
  // deep-stack trees: four bets and raises per street, for 60-100bb+ on a PC
  deep: { label: 'Deep', group: 'Big trees', note: 'Four bets and raises per street, for 60–100bb on a PC.', maxBets: 4, reraise: 'same',
    s: [{ r: '33,75', c: '', cIP: '33,75', rR: '60,a', cR: '60,a' }, { r: '50,100', c: '50,100', rR: '60,a', cR: '60,a', donk: '50,100' }, { r: '50,100,150', c: '50,100', rR: 'a', cR: 'a', donk: '50,100' }] },
  max: { label: 'Max', group: 'Big trees', note: 'The biggest tree: up to about 11 GB at 100bb.', maxBets: 4, reraise: 'same',
    s: [{ r: '33,75,125', c: '', cIP: '33,75,125', rR: '60,a', cR: '60,a' }, { r: '33,75,125', c: '50,100', rR: '60,a', cR: '60,a', donk: '50,100' }, { r: '33,75,150', c: '33,75,150', rR: '60,a', cR: '60,a', donk: '33,75,150' }] }
};
const TREE_GROUPS = ['Quick', 'Online MTT', 'Styles', 'Big trees'];
const treeName = () => TREES[PO.tree] ? TREES[PO.tree].label.toLowerCase() : 'custom';
// OOP/IP size boxes for a preset; raiser: 'ip', 'oop' or 'limp' (nobody raised: both bet like a raiser)
function treeSizes(key, raiser) {
  const T = TREES[key], bet = [], raise = [], donk = ['', '', ''];
  T.s.forEach((x, s) => {
    let ob, ib, orr, ir;
    if (raiser === 'oop') { ob = x.r; ib = s === 0 ? (x.cIP != null ? x.cIP : x.r) : x.c; orr = x.rR; ir = x.cR; }
    else if (raiser === 'limp') { ob = x.r; ib = x.r; orr = x.cR; ir = x.cR; }
    else { ob = x.c; ib = x.r; orr = x.cR; ir = x.rR; }
    bet.push([ob, ib]); raise.push([orr, ir]);
    if (s) donk[s] = x.donk != null ? x.donk : ob;
  });
  return { bet, raise, donk };
}
const STREETS = ['Flop', 'Turn', 'River'];
const PO = {
  preset: 0, board: [], pot: 0, stack: 0, ranges: [null, null], names: ['OOP', 'IP'],
  tree: 'fast', sizes: null, maxBets: 3, reraise: 'allin', allinTh: 0.2, raiser: 'ip', szFocus: null, est: null, accuracy: 0.5, maxIter: 600,
  stage: 'setup', stats: null, combos: null, cmap: null, prog: null, err: null, result: null,
  path: [], node: null, cell: null, view: 'strategy', who: 'act', busy: false, setupOpen: true, solvedCfg: null,
  hand: null, seat: 1,
  payoff: 'chip', icm: { b0: '', b1: '', others: '24, 15', payouts: '50, 30, 20' }
};
function loadPreset(i) {
  const p = PRESETS[i];
  PO.preset = i; PO.board = EM.parseBoard(p.board); PO.pot = p.pot; PO.stack = p.stack;
  PO.ranges = [EM.parseRange(p.r[0]), EM.parseRange(p.r[1])]; PO.names = [p.oop, p.ip];
  if (PO.icm) { PO.icm.b0 = String(p.stack); PO.icm.b1 = String(p.stack); }
  PO.raiser = p.raiser || 'ip'; PO.est = null;
  // a preset chosen by hand stays; otherwise each sample spot brings the sizes that suit it
  // (in the browser the sample spots start on the Fast tree: phones have little memory)
  setTree(PO.treePicked ? PO.tree : NATIVE ? (p.tree || 'fast') : 'fast');
}
function setTree(t) {
  PO.tree = t; PO.est = null;
  if (t !== 'custom' && TREES[t]) { const T = TREES[t]; PO.sizes = treeSizes(t, PO.raiser); PO.maxBets = T.maxBets; PO.reraise = T.reraise; }
  if (!PO.sizes.donk) PO.sizes.donk = ['', PO.sizes.bet[1][0], PO.sizes.bet[2][0]];
  saveTree();
}
function saveTree() { store.set('po.tree2', { tree: PO.tree, picked: !!PO.treePicked, sizes: PO.sizes, maxBets: PO.maxBets, reraise: PO.reraise, allinTh: PO.allinTh }); }
(() => {
  // the last tree you used (a preset, or your own sizes)
  const t = store.get('po.tree2', null);
  if (!t || typeof t !== 'object') return;
  if (t.tree === 'custom' && t.sizes && Array.isArray(t.sizes.bet) && Array.isArray(t.sizes.raise)) {
    PO.sizes = { bet: t.sizes.bet.map(r => r.map(String)), raise: t.sizes.raise.map(r => r.map(String)), donk: Array.isArray(t.sizes.donk) ? t.sizes.donk.map(String) : null };
    PO.tree = 'custom'; PO.treePicked = true;
  } else if (TREES[t.tree]) { PO.tree = t.tree; PO.treePicked = !!t.picked; }
  if ([2, 3, 4, 5].includes(t.maxBets)) PO.maxBets = t.maxBets;
  if (t.reraise === 'same' || t.reraise === 'allin') PO.reraise = t.reraise;
  if ([0, 0.1, 0.2, 0.3, 0.5].includes(t.allinTh)) PO.allinTh = t.allinTh;
})();
if (!PO.sizes) PO.sizes = treeSizes('fast', 'ip');
loadPreset(0);
PO.hand = (() => {
  const h = store.get('po.hand', null);
  const ok = h && Array.isArray(h.cards) && h.cards.length === 2 && h.cards.every(c => Number.isInteger(c) && c >= 0 && c < 52) && h.cards[0] !== h.cards[1] && (h.player === 0 || h.player === 1);
  return ok ? { cards: h.cards.slice().sort((a, b) => b - a), player: h.player } : null;
})();
PO.seat = PO.hand ? PO.hand.player : (store.get('po.seat', 1) === 0 ? 0 : 1);
PO.payoff = store.get('po.payoff', 'chip') === 'icm' ? 'icm' : 'chip';
PO.gpu = store.get('po.gpu', true) !== false;
PO.iso = store.get('po.iso', true) !== false;
PO.power = [0, 1, 2].includes(store.get('po.power', 1)) ? store.get('po.power', 1) : 1;
PO.icm = Object.assign(PO.icm, store.get('po.icm', {}));
const evUnit = () => (PO.solvedCfg && PO.solvedCfg.icm ? '$' : 'bb');
// ICM: each player's tournament equity as a function of OOP's stack after the hand (the two stacks sum to a constant)
function icmTable(pot, S) {
  const I = PO.icm, b0 = parseFloat(I.b0), b1 = parseFloat(I.b1);
  const others = EM.parseNumberList(I.others || ''), pays = EM.parseNumberList(I.payouts || '');
  if (!(b0 > 0 && b1 > 0)) throw new Error('Enter both players\' stacks for ICM');
  if (!pays.length) throw new Error('Enter at least one payout for ICM');
  if (others.length + 2 > 16) throw new Error('ICM handles up to 16 players');
  if (others.some(x => !(x > 0))) throw new Error('Other players\' stacks must be above 0');
  // bounties: busting the other player pays share k now (PKO 0.5, knockout 1) and adds the rest to your own bounty,
  // which is worth its amount times your share of all chips in play
  const bk = I.bountyKind === 'pko' ? 0.5 : I.bountyKind === 'ko' ? 1 : 0;
  const B0 = bk ? Math.max(0, parseFloat(I.bb0) || 0) : 0, B1 = bk ? Math.max(0, parseFloat(I.bb1) || 0) : 0;
  const N = bk ? 1024 : 400, T = b0 + b1 + pot, x0 = b0 - S, dx = (2 * S + pot) / (N - 1), u0 = [], u1 = [];
  const start = [b0 + pot / 2, b1 + pot / 2, ...others], TT = T + others.reduce((a, b) => a + b, 0);
  for (let i = 0; i < N; i++) {
    const x = i === N - 1 ? x0 + 2 * S + pot : x0 + i * dx, y = T - x;
    const fs = [x > 1e-6 ? x : 0, y > 1e-6 ? y : 0, ...others], eq = EM.icmWithBusts(fs, start, pays);
    let e0 = eq[0], e1 = eq[1];
    if (bk) {
      let h0 = B0, h1 = B1;
      if (fs[1] === 0) { e0 += bk * B1; h0 += (1 - bk) * B1; h1 = 0; }
      if (fs[0] === 0) { e1 += bk * B0; h1 += (1 - bk) * B0; h0 = 0; }
      e0 += h0 * fs[0] / TT; e1 += h1 * fs[1] / TT;
    }
    u0.push(+e0.toFixed(6)); u1.push(+e1.toFixed(6));
  }
  return { x0, dx, b0, b1, u0, u1, others: others.join(', '), payouts: pays.join(', '), bounty: bk ? { kind: I.bountyKind, b0: B0, b1: B1 } : undefined };
}
function saveHand() { store.set('po.hand', PO.hand); store.set('po.seat', PO.seat); }

// ---------- your hand: naming made hands and draws ----------
const RANK_N = ['deuce', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'jack', 'queen', 'king', 'ace'];
const RANK_P = ['deuces', 'threes', 'fours', 'fives', 'sixes', 'sevens', 'eights', 'nines', 'tens', 'jacks', 'queens', 'kings', 'aces'];
const ORD = ['Top', 'Second', 'Third', 'Fourth', 'Fifth'];
const capz = (s) => s[0].toUpperCase() + s.slice(1);
const hiBit = (m) => 31 - Math.clz32(m);
const rankMask = (cards) => cards.reduce((m, c) => m | (1 << (c >> 2)), 0);
function straightHi(m) {
  for (let hi = 12; hi >= 4; hi--) { const w = 0x1F << (hi - 4); if ((m & w) === w) return hi + 1; }
  return (m & 0x100F) === 0x100F ? 4 : 0;
}
function nutRank(board, s) { // best rank of suit s not already on the board
  const on = rankMask(board.filter(c => (c & 3) === s));
  let r = 12; while (r >= 0 && ((on >> r) & 1)) r--;
  return r;
}
function describeHand(hole, board) {
  const all = board.concat(hole), v = EM.evalCards(all), cat = v >>> 26;
  const h = hole.map(c => c >> 2).sort((a, b) => b - a), pocket = h[0] === h[1];
  const bm = rankMask(board), bd = [];
  for (let r = 12; r >= 0; r--) if ((bm >> r) & 1) bd.push(r);
  const pairPos = (r) => { const i = bd.indexOf(r); return i === 0 ? 'Top' : i === bd.length - 1 ? 'Bottom' : ORD[i]; };
  let made;
  if (board.length === 5 && EM.evalCards(board) === v) made = `Playing the board (${EM.CAT_NAMES[cat].toLowerCase()})`;
  else if (cat === 8) made = 'Straight flush';
  else if (cat === 7) made = 'Quads';
  else if (cat === 6) made = 'Full house';
  else if (cat === 5) {
    let fs = 0; for (let s = 0; s < 4; s++) if (all.filter(c => (c & 3) === s).length >= 5) fs = s;
    const mine = hole.filter(c => (c & 3) === fs).map(c => c >> 2);
    made = mine.includes(nutRank(board, fs)) ? 'Nut flush' : `${capz(RANK_N[Math.max(...mine)])}-high flush`;
  } else if (cat === 4) made = 'Straight';
  else if (cat === 3) {
    const t = hiBit((v >> 13) & 0x1FFF);
    made = pocket ? `Set of ${RANK_P[t]}` : h.includes(t) ? `Trips, ${RANK_N[h[0] === t ? h[1] : h[0]]} kicker` : 'Trips on the board';
  } else if (cat === 2) {
    const pm = (v >> 13) & 0x1FFF, hi = hiBit(pm), lo = hiBit(pm & ~(1 << hi));
    const used = [hi, lo].filter(r => h.includes(r));
    if (pocket && used.length) made = h[0] > bd[0] ? 'Overpair on a paired board' : `Pocket ${RANK_P[h[0]]} on a paired board`;
    else if (used.length === 2) made = hi === bd[0] && lo === bd[1] ? 'Top two pair' : 'Two pair';
    else if (used.length === 1) made = `${pairPos(used[0])} pair on a paired board`;
    else made = 'Two pair on the board';
  } else if (cat === 1) {
    const p = hiBit((v >> 13) & 0x1FFF);
    if (pocket && h[0] === p) {
      const above = bd.filter(r => r > p).length;
      made = above === 0 ? `Overpair (${RANK_P[p]})` : above === bd.length ? `Underpair (${RANK_P[p]})` : `${ORD[above]} pair (pocket ${RANK_P[p]})`;
    } else if (h.includes(p)) made = `${pairPos(p)} pair, ${RANK_N[h[0] === p ? h[1] : h[0]]} kicker`;
    else made = `Board pair, ${RANK_N[h[0]]} high`;
  } else made = board.length < 5 && h[1] > bd[0] ? 'Two overcards' : `${capz(RANK_N[h[0]])} high`;
  const draws = [];
  if (board.length < 5 && cat < 4) {
    for (let s = 0; s < 4; s++) {
      const n = all.filter(c => (c & 3) === s).length, mine = hole.filter(c => (c & 3) === s).map(c => c >> 2);
      if (n === 4 && mine.length) draws.push(mine.includes(nutRank(board, s)) ? 'nut flush draw' : 'flush draw');
      else if (n === 3 && mine.length === 2 && board.length === 3) draws.push('backdoor flush draw');
    }
    const M = rankMask(all);
    if (!straightHi(M)) {
      const outs = [];
      for (let r = 0; r < 13; r++) if (straightHi(M | (1 << r)) > straightHi(bm | (1 << r))) outs.push(r);
      if (outs.length >= 2) draws.push(outs[1] - outs[0] === 5 || (outs[0] === 4 && outs[1] === 12) ? 'open-ended straight draw' : 'double gutshot');
      else if (outs.length === 1) draws.push('gutshot');
    }
  }
  return made + (draws.length ? ' · ' + draws.join(' + ') : '');
}
// hand classes for the range breakdown: one made-hand class and one draw class per combo
const MADE = ['Quads or better', 'Full house', 'Flush', 'Straight', 'Set', 'Trips', 'Two pair', 'Overpair', 'Top pair', 'Second pair', 'Weak pair', 'Ace high', 'Nothing'];
const DRAWS = ['Combo draw', 'Flush draw', 'Open-ender', 'Gutshot', 'Backdoor flush', 'No draw'];
function handClass(hole, board) {
  const all = board.concat(hole), v = EM.evalCards(all), cat = v >>> 26;
  const h = hole.map(c => c >> 2).sort((a, b) => b - a), pocket = h[0] === h[1];
  const bm = rankMask(board), bd = [];
  for (let r = 12; r >= 0; r--) if ((bm >> r) & 1) bd.push(r);
  let m;
  if (cat >= 7) m = 0; else if (cat === 6) m = 1; else if (cat === 5) m = 2; else if (cat === 4) m = 3;
  else if (cat === 3) m = pocket ? 4 : h.includes(hiBit((v >> 13) & 0x1FFF)) ? 5 : (h[0] === 12 ? 11 : 12);
  else if (cat === 2) {
    const pm = (v >> 13) & 0x1FFF, hi = hiBit(pm), lo = hiBit(pm & ~(1 << hi)), used = [hi, lo].filter(r => h.includes(r));
    if (pocket && used.length) m = h[0] > bd[0] ? 7 : 10;
    else if (used.length === 2) m = 6;
    else if (used.length === 1) { const i = bd.indexOf(used[0]); m = i === 0 ? 8 : i === 1 ? 9 : 10; }
    else m = h[0] === 12 ? 11 : 12;
  } else if (cat === 1) {
    const p = hiBit((v >> 13) & 0x1FFF);
    if (pocket && h[0] === p) m = p > bd[0] ? 7 : bd.filter(r => r > p).length === 1 ? 9 : 10;
    else if (h.includes(p)) { const i = bd.indexOf(p); m = i === 0 ? 8 : i === 1 ? 9 : 10; }
    else m = h[0] === 12 ? 11 : 12;
  } else m = h[0] === 12 ? 11 : 12;
  let fd = 0, bdf = false, sd = 0;
  if (board.length < 5 && cat < 4) {
    for (let st = 0; st < 4; st++) {
      const n = all.filter(c => (c & 3) === st).length, mine = hole.filter(c => (c & 3) === st).length;
      if (n === 4 && mine) fd = 1; else if (n === 3 && mine === 2 && board.length === 3) bdf = true;
    }
    const M = rankMask(all);
    if (!straightHi(M)) { let outs = 0; for (let r = 0; r < 13; r++) if (straightHi(M | (1 << r)) > straightHi(bm | (1 << r))) outs++; sd = outs >= 2 ? 2 : outs; }
  }
  const d = fd && sd ? 0 : fd ? 1 : sd === 2 ? 2 : sd === 1 ? 3 : bdf ? 4 : 5;
  return { m, d };
}
const classCache = new Map();
function rangeClasses(p, board) {
  const key = p + ':' + board.join(',') + ':' + PO.combos[p].length;
  let c = classCache.get(key);
  if (c) return c;
  if (classCache.size > 40) classCache.clear();
  const n = PO.combos[p].length, m = new Uint8Array(n), d = new Uint8Array(n), on = new Set(board);
  for (let i = 0; i < n; i++) {
    const g = PO.combos[p][i], a = EM.C1[g], b = EM.C2[g];
    if (on.has(a) || on.has(b)) { m[i] = 255; continue; }
    const k = handClass([a, b], board); m[i] = k.m; d[i] = k.d;
  }
  c = { m, d }; classCache.set(key, c);
  return c;
}
function breakdownHTML(info, who, showStrat, colors) {
  const n = PO.combos[who].length, reach = info.reach[who], stg = info.strategy, nA = showStrat ? info.actions.length : 0;
  const ev = info.ev ? info.ev[who] : null, eq = info.equity ? info.equity[who] : null, K = rangeClasses(who, info.board);
  const table = (names, key) => {
    const rows = names.map(() => ({ w: 0, F: new Float64Array(Math.max(1, nA)), E: 0, Ew: 0, Q: 0, Qw: 0 }));
    let tot = 0;
    for (let h = 0; h < n; h++) {
      const r = +reach[h], c = K[key][h]; if (!(r > 0) || c === 255) continue;
      const R = rows[c]; R.w += r; tot += r;
      for (let a = 0; a < nA; a++) R.F[a] += r * stg[a * n + h];
      if (ev && Number.isFinite(ev[h])) { R.E += r * ev[h]; R.Ew += r; }
      if (eq && Number.isFinite(eq[h])) { R.Q += r * eq[h]; R.Qw += r; }
    }
    const body = rows.map((R, i) => R.w < 1e-9 ? '' : `<tr><td>${names[i]}</td><td>${fmt(R.w / tot * 100, 1)}%</td>
      ${nA ? `<td class="bdbar"><div class="mbar">${info.actions.map((a, j) => `<i style="width:${(R.F[j] / R.w * 100).toFixed(1)}%;background:${colors[j]}"></i>`).join('')}</div></td>` : ''}
      <td>${R.Qw ? pct(R.Q / R.Qw, 0) : '–'}</td><td>${R.Ew ? fmt(R.E / R.Ew, 2) : '–'}</td></tr>`).join('');
    return `<div class="scrollx"><table class="tbl bd"><thead><tr><th>${key === 'm' ? 'Made hand' : 'Draw'}</th><th>Range</th>${nA ? '<th>Strategy</th>' : ''}<th>Eq</th><th>EV</th></tr></thead><tbody>${body}</tbody></table></div>`;
  };
  return table(MADE, 'm') + (info.board.length < 5 ? table(DRAWS, 'd') : '') +
    `<p class="note">Each combo counts once in the made-hand table and once in the draw table, weighted by how often it is still in ${esc(PO.names[who])}'s range here. EV is in ${evUnit()}.</p>`;
}
function handCombo() { return PO.hand ? EM.PIDX[PO.hand.cards[0] * 52 + PO.hand.cards[1]] : -1; }
function handClassName() { return PO.hand ? EM.CLASS_NAMES[EM.CLS[handCombo()]] : ''; }
function handCardsHTMLFor(cards) { return `<span class="board">${cards.map(c => cardHTML(c)).join('')}</span>`; }
function handCardsHTML(cls = '') { return `<span class="board">${(PO.hand ? PO.hand.cards : [-1, -1]).map(c => cardHTML(c, cls)).join('')}</span>`; }
function handPanelHTML(info) {
  const H = PO.hand;
  if (!H) {
    return `<div class="myhand add"><button class="btn" data-po-hand="node">+ Your hand</button>
      <span class="small muted">Enter your two cards to see how the solver plays that exact hand.</span></div>`;
  }
  const me = H.player, board = info.board, g = handCombo();
  const clash = H.cards.some(c => board.includes(c));
  const desc = clash ? 'One of these cards is on the board' : describeHand(H.cards, board);
  let html = `<div class="myhand"><div class="row sb" style="flex-wrap:nowrap;align-items:flex-start">
    <button class="hcards" data-po-hand="node" aria-label="Change your hand">${handCardsHTML('mini')}</button>
    <div class="hinfo"><div class="hdesc">${esc(desc)}</div><div class="small muted">Your hand · ${me ? 'IP' : 'OOP'} · ${esc(PO.names[me])}</div></div>
    <button class="btn ghost sm" data-po-handclear="1" aria-label="Clear your hand">Clear</button></div>`;
  const h = clash ? -1 : PO.combos[me].indexOf(g);
  if (clash) return html + `<p class="note">Pick a different hand, or go back to an earlier street.</p></div>`;
  if (h < 0) {
    const inEdited = PO.ranges[me] && PO.ranges[me][g] > 0;
    return html + `<p class="note">${esc(handClassName())} isn't in ${esc(PO.names[me])}'s range for this solve, so the solver has no strategy for it.</p>
      <div class="row">${inEdited ? '<button class="btn primary" data-po-solve="1">Solve again with it</button><span class="small muted">It is in your edited range now.</span>'
        : `<button class="btn" data-po-handadd="1">Add ${esc(handClassName())} to the range</button><span class="small muted">then solve again</span>`}</div></div>`;
  }
  const w0 = PO.solvedCfg ? +PO.solvedCfg.ranges[me][g] : 1;
  const reach = +info.reach[me][h], frac = w0 > 0 ? reach / w0 : 0;
  const eq = info.equity ? info.equity[me][h] : null, ev = info.ev ? info.ev[me][h] : null;
  const facts = [];
  if (Number.isFinite(eq)) facts.push(`Equity <b>${pct(eq)}</b>`);
  if (Number.isFinite(ev)) facts.push(evUnit() === '$' ? `EV <b>$${fmt(ev, 3)}</b> vs folding` : `EV <b>${fmt(ev, 2)}</b> bb`);
  if (frac < 1e-4) {
    return html + `<p class="note">The solver never plays your hand this way, so it has no strategy for it here. Step back along the line above to see where it goes another way.</p>
      ${facts.length ? `<div class="small muted num">${facts[0]}</div>` : ''}</div>`;
  }
  if (frac < 0.995) facts.push(`plays this line ${pct(frac, 0)} of the time`);
  if (info.type === 'player' && info.player === me) {
    const nq = PO.combos[me].length, colors = actColors(info.actions);
    const f = info.actions.map((a, i) => +info.strategy[i * nq + h]);
    let best = 0; f.forEach((x, i) => { if (x > f[best]) best = i; });
    html += `<div class="mbar" aria-hidden="true">${f.map((x, i) => `<i style="width:${(x * 100).toFixed(1)}%;background:${colors[i]}"></i>`).join('')}</div>`;
    html += `<div class="hacts">` + info.actions.map((a, i) => {
      const e = info.evActions ? info.evActions[i][h] : null;
      return `<div class="hact${i === best ? ' top' : ''}"><i style="background:${colors[i]}"></i><span class="t">${esc(a.label)}${actSub(a) ? ` <small>${actSub(a)}</small>` : ''}</span>
        <b>${fmt(f[i] * 100, 0)}%</b><span class="e">${Number.isFinite(e) ? 'EV ' + fmt(e, 2) : ''}</span></div>`;
    }).join('') + `</div>`;
    // mixed play: the actions it mixes between should be worth about the same
    const used = info.actions.map((a, i) => i).filter(i => f[i] >= 0.05 && info.evActions && Number.isFinite(info.evActions[i][h]));
    if (used.length >= 2) {
      const evs = used.map(i => info.evActions[i][h]), gap = Math.max(...evs) - Math.min(...evs);
      if (gap <= (evUnit() === '$' ? 0.02 * Math.max(...evs.map(Math.abs), 1e-9) : Math.max(0.05, 0.01 * info.pot))) {
        const names = used.map(i => info.actions[i].label.toLowerCase());
        html += `<p class="note">Close spot: ${esc(names.slice(0, -1).join(', '))} and ${esc(names[names.length - 1])} are worth about the same with this hand (within ${evUnit() === '$' ? '$' + fmt(Math.max(gap, 0.001), 3) : fmt(Math.max(gap, 0.01), 2) + ' bb'}). The solver mixes them so its range stays balanced, and the exact mix can shift from solve to solve.</p>`;
      }
    }
  } else if (info.type === 'player') {
    html += `<p class="note">${esc(PO.names[info.player])} acts next. Pick their action below to see your response.</p>`;
  }
  if (facts.length) html += `<div class="small muted num">${facts.join(' · ')}</div>`;
  return html + `</div>`;
}
function openHandPicker(boardCards) {
  let sel = PO.hand ? PO.hand.cards.slice() : [], seat = PO.hand ? PO.hand.player : PO.seat;
  const blocked = new Set(boardCards);
  const draw = () => openSheet(`<div class="row sb"><h2>Your hand</h2>${boardHTML([0, 1].map(i => sel[i] ?? -1))}</div>
    <div class="field"><span class="label">You are</span><div class="seg" role="group" aria-label="Your seat">${[0, 1].map(p => `<button data-hp="${p}" aria-pressed="${seat === p}">${p ? 'IP' : 'OOP'} · ${esc(PO.names[p])}</button>`).join('')}</div></div>
    <div class="picker">${pickerCells(c => `<button class="${SUITS[c & 3]}" data-hc="${c}" aria-pressed="${sel.includes(c)}" ${blocked.has(c) ? 'disabled' : ''} aria-label="${EM.cardStr(c)}${blocked.has(c) ? ' (on the board)' : ''}">${EM.RC[c >> 2]}<em>${EM.SUIT_SYM[c & 3]}</em></button>`)}</div>
    <p class="note">Changing your hand never needs a re-solve: the solution already covers every hand in the range.</p>
    <div class="row sb"><span class="row" style="gap:6px"><button class="btn" data-hclear="1">Clear</button><button class="btn ghost" data-hcancel="1">Cancel</button></span>
      <button class="btn primary" data-hdone="1" ${sel.length !== 2 ? 'disabled' : ''}>Done</button></div>`, (panel) => {
    panel.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.hc != null) {
        const c = +b.dataset.hc, i = sel.indexOf(c);
        if (i >= 0) sel.splice(i, 1); else if (sel.length < 2) sel.push(c); else sel[1] = c;
        draw();
      } else if (b.dataset.hp != null) { seat = +b.dataset.hp; draw(); }
      else if (b.dataset.hclear) { sel = []; draw(); }
      else if (b.dataset.hcancel) closeSheet();
      else if (b.dataset.hdone && sel.length === 2) {
        PO.hand = { cards: sel.slice().sort((x, y) => y - x), player: seat }; PO.seat = seat;
        saveHand(); closeSheet(); render();
      }
    });
  });
  draw();
}
function addHandToRange() {
  const H = PO.hand; if (!H) return;
  readPostSetup();
  const k = EM.CLS[handCombo()], w = Float32Array.from(PO.ranges[H.player]);
  for (const i of EM.CLASS_COMBOS[k]) w[i] = 1;
  PO.ranges[H.player] = w; PO.setupOpen = true; PO.err = null;
  render();
  const s = $('[data-po-solve]'); if (s) s.scrollIntoView({ block: 'center' });
}
function classMap(combos) { const m = Array.from({ length: NC }, () => []); combos.forEach((g, h) => m[EM.CLS[g]].push(h)); return m; }
// the small label under a bet or raise: % of the pot for bets, the multiple of the bet faced for raises
function actSub(a) { return a.xBet != null && a.kind === 4 ? a.xBet + 'x' : a.pctPot != null ? a.pctPot + '% pot' : ''; }
function actColors(actions) {
  const sized = actions.map((a, i) => (a.kind === 3 || a.kind === 4) ? i : -1).filter(i => i >= 0);
  const pal = ['var(--a-bet1)', 'var(--a-bet2)', 'var(--a-bet3)', 'var(--a-bet4)'];
  return actions.map((a, i) => {
    if (a.kind === 0) return 'var(--fold)';
    if (a.kind === 1 || a.kind === 2) return 'var(--call)';
    if (a.kind === 5) return 'var(--a-allin)';
    const r = sized.indexOf(i), n = sized.length;
    return pal[n <= 1 ? 2 : Math.round(r * 3 / (n - 1))];
  });
}
let DEVICE = (() => {
  const mobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  const gb = navigator.deviceMemory || (mobile ? 3 : 8);
  return { mobile, compressAboveMB: gb >= 8 && !mobile ? 700 : gb >= 6 ? 350 : 200, limitMB: mobile ? (gb >= 6 ? 900 : 650) : 1800 };
})();
function postCfg(board) {
  return { board: (board || PO.board).slice(), pot: +PO.pot, stack: +PO.stack, ranges: [Array.from(PO.ranges[0]), Array.from(PO.ranges[1])],
    sizes: { bet: PO.sizes.bet.map(r => r.slice()), raise: PO.sizes.raise.map(r => r.slice()), donk: PO.sizes.donk.slice() }, maxBets: PO.maxBets, reraise: PO.reraise,
    forceAllin: PO.allinTh, compressAboveMB: DEVICE.compressAboveMB, names: PO.names.slice(),
    icm: PO.payoff === 'icm' ? icmTable(+PO.pot, +PO.stack) : undefined, gpu: PO.gpu ? 1 : 0, iso: PO.iso ? 1 : 0 };
}
function defaultSaveName() {
  const b = (PO.solvedCfg ? PO.solvedCfg.board : PO.board).map(c => EM.cardStr(c)).join('');
  return `${PO.names[1]} vs ${PO.names[0]} ${b} ${Math.round(PO.stack)}bb`;
}
async function postSolve() {
  readPostSetup();
  PO.err = null;
  if (PO.board.length < 3) { PO.err = 'Pick at least 3 board cards'; render(); return; }
  if (!(PO.pot > 0)) { PO.err = 'Pot must be above 0'; render(); return; }
  PT.on = false; PT.hero = -1; PT.node = null;
  PO.stage = 'building'; PO.node = null; PO.path = []; PO.cell = null; PO.lockEdit = null; PO.locksDirty = false; PO.msg = ''; PO.saving = false; render();
  try {
    const b = await Engine.build(postCfg());
    PO.stats = b.stats; PO.combos = b.combos; PO.cmap = [classMap(b.combos[0]), classMap(b.combos[1])];
    if (b.stats.memMB > DEVICE.limitMB) {
      call('post-free').catch(() => {});
      throw new Error(`This tree needs about ${Math.round(b.stats.memMB)} MB, more than this device should use. Pick a smaller preset (Fast or Standard), fewer bet sizes, narrower ranges, or start from the turn.`);
    }
    PO.stage = 'solving'; PO.prog = { it: 0, ex: null, elapsed: 0 }; PO.setupOpen = false; PO.solvedCfg = postCfg();
    render();
    const r = await Engine.solve({ target: PO.accuracy, maxIter: PO.maxIter }, (m) => { PO.prog = m; renderPostProgress(); });
    PO.result = r; PO.stage = 'solved';
    await postLoad([]);
  } catch (e) { PO.err = e.message; PO.stage = PO.node ? 'solved' : 'setup'; PO.setupOpen = true; }
  render();
}
async function postLoad(path) {
  PO.busy = true;
  const card = document.querySelector('#po-node');
  if (card) card.classList.add('busy');
  try {
    const info = await Engine.node(path);
    if (PO.lockEdit && JSON.stringify(path) !== JSON.stringify(PO.path)) PO.lockEdit = null;
    PO.path = path.slice(); PO.node = info; PO.cell = null;
  } catch (e) { PO.err = e.message; }
  PO.busy = false;
  render();
}
function renderPostProgress() {
  const el = $('#po-prog');
  if (!el || !PO.prog) return;
  const p = PO.prog, target = PO.accuracy;
  const frac = p.ex == null ? 0 : Math.max(0, Math.min(1, Math.log(Math.max(p.ex, target) / 50) / Math.log(target / 50)));
  el.querySelector('i').style.width = Math.max(frac * 100, Math.min(100, p.it / PO.maxIter * 100)).toFixed(1) + '%';
  $('#po-prog-t').textContent = `Iteration ${p.it} · ${p.ex == null ? 'measuring…' : 'exploitability ' + fmt(p.ex, 2) + '% of pot'} · ${fmt(p.elapsed, 0)}s${p.gpu && p.gpu.on ? ' · GPU' : ''}`;
}
function readPostSetup() {
  const pot = $('#po-pot'), stk = $('#po-stack');
  if (pot) PO.pot = parseFloat(pot.value);
  if (stk) PO.stack = parseFloat(stk.value);
  for (const [id, k] of [['po-b0', 'b0'], ['po-b1', 'b1'], ['po-others', 'others'], ['po-payouts', 'payouts'], ['po-bb0', 'bb0'], ['po-bb1', 'bb1']]) { const el = $('#' + id); if (el) PO.icm[k] = el.value; }
  if (PO.payoff === 'icm') { const b0 = parseFloat(PO.icm.b0), b1 = parseFloat(PO.icm.b1); if (b0 > 0 && b1 > 0) PO.stack = Math.min(b0, b1); }
  store.set('po.icm', PO.icm); store.set('po.payoff', PO.payoff);
  const mb = $('#po-maxbets'); if (mb && +mb.value !== PO.maxBets) { PO.maxBets = +mb.value; PO.tree = 'custom'; }
  const at = $('#po-allin'); if (at) PO.allinTh = +at.value;
  for (let s = 0; s < 3; s++) {
    for (let p = 0; p < 2; p++) {
      const b = $(`#po-b${s}${p}`), r = $(`#po-r${s}${p}`);
      if (b) PO.sizes.bet[s][p] = b.value;
      if (r) PO.sizes.raise[s][p] = r.value;
    }
    const d = $(`#po-d${s}`); if (d) PO.sizes.donk[s] = d.value;
  }
  saveTree();
}
function boardHTML(cards, cls = '') { return `<div class="board">${cards.map(c => cardHTML(c, cls)).join('')}</div>`; }
function icmFieldsHTML() {
  const I = PO.icm;
  if (!(parseFloat(I.b0) > 0)) I.b0 = String(PO.stack);
  if (!(parseFloat(I.b1) > 0)) I.b1 = String(PO.stack);
  let err = '';
  try { const o = EM.parseNumberList(I.others || ''), p = EM.parseNumberList(I.payouts || ''); if (!p.length) err = 'Enter at least one payout.'; else if (o.length + 2 > 16) err = 'Up to 16 players.'; }
  catch (e) { err = e.message; }
  return `<div class="fields"><div class="field"><label class="label" for="po-b0">${esc(PO.names[0])} stack (bb)</label><input id="po-b0" type="number" inputmode="decimal" step="0.1" min="0" value="${esc(I.b0)}"></div>
      <div class="field"><label class="label" for="po-b1">${esc(PO.names[1])} stack (bb)</label><input id="po-b1" type="number" inputmode="decimal" step="0.1" min="0" value="${esc(I.b1)}"></div></div>
    <div class="fields"><div class="field"><label class="label" for="po-others">Other players' stacks (bb)</label><textarea id="po-others" spellcheck="false">${esc(I.others)}</textarea></div>
      <div class="field"><label class="label" for="po-payouts">Payouts, 1st place first</label><textarea id="po-payouts" spellcheck="false">${esc(I.payouts)}</textarea></div></div>
    <div class="field"><span class="label">Bounties</span><div class="seg" role="group" aria-label="Bounty format">${[['none', 'None'], ['pko', 'PKO'], ['ko', 'Knockout']].map(([k, l]) => `<button data-po-bk="${k}" aria-pressed="${(I.bountyKind || 'none') === k}">${l}</button>`).join('')}</div></div>
    ${I.bountyKind && I.bountyKind !== 'none' ? `<div class="fields"><div class="field"><label class="label" for="po-bb0">${esc(PO.names[0])} bounty</label><input id="po-bb0" type="number" inputmode="decimal" step="0.5" min="0" value="${esc(I.bb0 ?? '')}"></div>
      <div class="field"><label class="label" for="po-bb1">${esc(PO.names[1])} bounty</label><input id="po-bb1" type="number" inputmode="decimal" step="0.5" min="0" value="${esc(I.bb1 ?? '')}"></div></div>
      <p class="note">${I.bountyKind === 'pko' ? 'PKO: busting the other player pays half their bounty now; the other half joins your own bounty.' : 'Knockout: busting the other player pays their whole bounty.'} Only the bigger stack can win a bounty. Bounties are in the same units as the payouts.</p>` : ''}
    <p class="note">Stacks are what each player has behind at the start of this street; the effective stack is the smaller one. EVs are tournament equity in payout units, compared with folding at that point. ${err ? `<span class="err">${esc(err)}</span>` : ''}</p>`;
}
function handSetupHTML() {
  const H = PO.hand;
  let warn = '';
  if (H) {
    const g = handCombo();
    if (H.cards.some(c => PO.board.includes(c))) warn = `<span class="small warn">One of your cards is on the board.</span>`;
    else if (!(PO.ranges[H.player][g] > 0)) warn = `<span class="small warn">${esc(handClassName())} isn't in ${esc(PO.names[H.player])}'s range.</span><button class="btn" data-po-handadd="1">Add it</button>`;
    else if (PO.solvedCfg && !(PO.solvedCfg.ranges[H.player][g] > 0)) warn = `<span class="small warn">Solve again to include it.</span>`;
  }
  return `<div class="field"><span class="label">Your hand · optional</span><div class="row">
    <button class="btn ghost" data-po-hand="setup" style="padding:4px 6px" aria-label="${H ? 'Change your hand' : 'Pick your hand'}">${handCardsHTML()}</button>
    ${H ? `<span class="small">${H.player ? 'IP' : 'OOP'} · ${esc(PO.names[H.player])}</span><button class="btn ghost sm" data-po-handclear="1">Clear</button>`
      : '<span class="small muted">Pick your two cards to follow them through the solution.</span>'}
    ${warn}</div></div>`;
}

// ---------- bet-size editor ----------
const SZ_CHIPS = { bet: ['10', '20', '25', '33', '50', '66', '75', '100', '125', '150', '200', 'g', 'a'], raise: ['2x', '2.5x', '3x', '3.5x', '4x', '50', '75', '100', 'a'] };
// box id -> [array, index] in PO.sizes, and whether it takes bet or raise sizes
function szSlot(id) {
  const m = /^po-([brd])(\d)(\d)?$/.exec(id || '');
  if (!m) return null;
  const s = +m[2], p = m[3] != null ? +m[3] : 0;
  if (m[1] === 'd') return { arr: PO.sizes.donk, i: s, kind: 'bet', name: `${STREETS[s]} donk (OOP)` };
  return { arr: m[1] === 'b' ? PO.sizes.bet[s] : PO.sizes.raise[s], i: p, kind: m[1] === 'b' ? 'bet' : 'raise', name: `${STREETS[s]} ${m[1] === 'b' ? 'bet' : 'raise'} (${p ? 'IP' : 'OOP'})` };
}
const szTokens = (v) => String(v || '').split(/[\s,;]+/).filter(Boolean).map(x => x.toLowerCase().replace('%', ''));
function szSort(toks) {
  const rank = (t) => t[0] === 'a' ? [3, 0] : t === 'g' || t === 'geo' ? [2, 0] : t.endsWith('x') ? [1, parseFloat(t)] : [0, parseFloat(t)];
  return toks.slice().sort((a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1]; });
}
function szChipsHTML() {
  const sl = szSlot(PO.szFocus);
  if (!sl) return '<span class="small muted">Tap a box, then tap sizes to add or remove them.</span>';
  const cur = new Set(szTokens(sl.arr[sl.i]).map(t => t[0] === 'a' ? 'a' : t === 'geo' ? 'g' : t));
  return `<span class="small muted">${esc(sl.name)}:</span>` + SZ_CHIPS[sl.kind].map(v => `<button class="chip" data-szc="${v}" aria-pressed="${cur.has(v)}">${v === 'a' ? 'All-in' : v === 'g' ? 'Geo' : v.endsWith('x') ? v : v + '%'}</button>`).join('') + '<button class="chip" data-szc="-">Clear</button>';
}
function szMarkCustom() {
  if (PO.tree === 'custom') return;
  PO.tree = 'custom'; PO.treePicked = true;
  const sel = $('#po-tree'); if (sel) sel.value = 'custom';
  const n = $('#po-treenote'); if (n) n.textContent = 'Your own sizes.';
  const r = $('#po-raiserrow'); if (r) r.hidden = true;
}
function szToggle(v) {
  const sl = szSlot(PO.szFocus);
  if (!sl) return;
  let toks = szTokens(sl.arr[sl.i]).map(t => t[0] === 'a' ? 'a' : t === 'geo' ? 'g' : t);
  if (v === '-') toks = [];
  else if (toks.includes(v)) toks = toks.filter(t => t !== v);
  else { if (toks.length >= 8) return; toks.push(v); }
  sl.arr[sl.i] = szSort(toks).join(',');
  const el = $('#' + PO.szFocus); if (el) el.value = sl.arr[sl.i];
  szMarkCustom(); PO.est = null; saveTree();
  const c = $('#po-szchips'); if (c) c.innerHTML = szChipsHTML();
  const e = $('#po-est'); if (e) e.innerHTML = estHTML();
}
function fmtMB(mb) { return mb >= 1024 ? fmt(mb / 1024, 1) + ' GB' : Math.max(1, Math.round(mb)) + ' MB'; }
function estHTML() {
  const E = PO.est;
  if (!E) return '';
  if (E.busy) return '<span class="muted">Building the tree…</span>';
  if (E.err) return `<span class="err">${esc(E.err)}</span>`;
  const st = E.stats, big = st.memMB > DEVICE.limitMB;
  let t = `<b>${fmtMB(st.memMB)}</b> · ${st.decisions.toLocaleString()} decisions${st.compressed ? ' · stored in 16-bit' : ''} · `;
  t += big ? `<span class="warn">too big for this ${NATIVE ? 'PC' : 'device'} (about ${fmtMB(DEVICE.limitMB)} usable)</span>` : '<span class="good">fits in memory</span>';
  if (NATIVE && NINFO && NINFO.gpu && NINFO.gpu.available && st.gpuMB != null && PO.board.length < 5 && PO.gpu) {
    t += st.gpuMB <= NINFO.gpu.budgetMB ? ` · river on the GPU (${fmtMB(st.gpuMB)} of ${fmtMB(NINFO.gpu.budgetMB)})` : ` · <span class="warn">too big for the GPU (${fmtMB(st.gpuMB)} of ${fmtMB(NINFO.gpu.budgetMB)}): solved on the CPU</span>`;
  }
  return t;
}
async function postEstimate() {
  readPostSetup();
  if (PO.board.length < 3) { PO.est = { err: 'Pick at least 3 board cards' }; render(); return; }
  PO.est = { busy: true }; render();
  try { PO.est = { stats: (await Engine.estimate(postCfg())).stats }; }
  catch (e) { PO.est = { err: e.message }; }
  render();
}
function powerHTML() {
  const n = NINFO ? NINFO.threads : 0, half = Math.max(1, Math.ceil(n / 2));
  const notes = ['Every thread at normal priority: the fastest, but the PC can feel slow while it runs.',
    'Every thread, but other programs go first: about as fast on an idle PC, and the PC stays responsive.',
    `${n ? half + ' of ' + n : 'Half the'} threads at the lowest priority, and the graphics card rests half the time: cooler and quieter, roughly half the speed.`];
  return `<div class="field"><span class="label">Power</span><div class="seg" role="group" aria-label="Power">${[[0, 'Full speed'], [1, 'Balanced'], [2, 'Quiet']].map(([v, l]) => `<button data-po-power="${v}" aria-pressed="${PO.power === v}">${l}</button>`).join('')}</div>
    <p class="note">${notes[PO.power]}</p></div>`;
}
function sizesHTML() {
  const T = TREES[PO.tree];
  const opts = TREE_GROUPS.map(g => `<optgroup label="${esc(g)}">${Object.keys(TREES).filter(k => TREES[k].group === g).map(k => `<option value="${k}" ${PO.tree === k ? 'selected' : ''}>${esc(TREES[k].label)}</option>`).join('')}</optgroup>`).join('') +
    `<option value="custom" ${PO.tree === 'custom' ? 'selected' : ''}>Custom sizes</option>`;
  const box = (id, val, kind, label) => `<input id="${id}" value="${esc(val)}" data-sz="${kind}" aria-label="${esc(label)}" autocomplete="off" spellcheck="false">`;
  let rows = '';
  for (let s = 0; s < 3; s++) {
    const st = STREETS[s];
    rows += `<span class="h">${st} bet</span>${box(`po-b${s}0`, PO.sizes.bet[s][0], 'bet', st + ' OOP bet sizes')}${box(`po-b${s}1`, PO.sizes.bet[s][1], 'bet', st + ' IP bet sizes')}`;
    if (s) rows += `<span class="h">${st} donk</span>${box(`po-d${s}`, PO.sizes.donk[s], 'bet', st + ' OOP donk sizes')}<span class="na small muted">OOP only</span>`;
    rows += `<span class="h">${st} raise</span>${box(`po-r${s}0`, PO.sizes.raise[s][0], 'raise', st + ' OOP raise sizes')}${box(`po-r${s}1`, PO.sizes.raise[s][1], 'raise', st + ' IP raise sizes')}`;
  }
  return `<div class="field"><label class="label" for="po-tree">Bet sizes</label><select id="po-tree">${opts}</select>
      <p class="note" id="po-treenote">${T ? esc(T.note) : 'Your own sizes.'}</p></div>
    <div class="field" id="po-raiserrow" ${T ? '' : 'hidden'}><span class="label">Raised preflop · the preset's c-bets go to this player</span><div class="seg" role="group" aria-label="Preflop raiser">${[['ip', 'IP · ' + PO.names[1]], ['oop', 'OOP · ' + PO.names[0]], ['limp', 'Limped']].map(([k, l]) => `<button data-po-raiser="${k}" aria-pressed="${PO.raiser === k}">${esc(l)}</button>`).join('')}</div></div>
    <details id="po-szedit" ${PO.szOpen ? 'open' : ''}><summary>Edit sizes</summary>
      <div class="sizes"><span></span><span class="h">OOP · ${esc(PO.names[0])}</span><span class="h">IP · ${esc(PO.names[1])}</span>${rows}</div>
      <div class="szchips" id="po-szchips">${szChipsHTML()}</div>
      <p class="note">Bets are % of the pot. Raises are % of the pot after calling, or a multiple of the bet faced (3x). <b>g</b> = geometric: the same pot fraction on every street left gets the stacks in by the river. <b>a</b> = all-in. Donk = OOP leading right after calling a bet on the last street. An empty box takes that option out. Auto all-in turns a bet into a shove when it would leave less than that share of the pot behind.</p>
      <div class="fields">
        <div class="field"><label class="label" for="po-maxbets">Bets per street</label><select id="po-maxbets">${[2, 3, 4, 5].map(x => `<option value="${x}" ${x === PO.maxBets ? 'selected' : ''}>${x === 2 ? '2 · bet, raise' : x === 3 ? '3 · up to a 3-bet' : x === 4 ? '4 · up to a 4-bet' : '5 · up to a 5-bet'}</option>`).join('')}</select></div>
        <div class="field"><label class="label" for="po-allin">Auto all-in</label><select id="po-allin">${[[0, 'Off'], [0.1, 'If < 10% of pot left'], [0.2, 'If < 20% of pot left'], [0.3, 'If < 30% of pot left'], [0.5, 'If < 50% of pot left']].map(([v, l]) => `<option value="${v}" ${PO.allinTh === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <div class="field"><span class="label">3-bets and later</span><div class="seg" role="group" aria-label="Re-raise sizes">${[['same', 'Same sizes as raises'], ['allin', 'All-in only']].map(([k, l]) => `<button data-po-rr="${k}" aria-pressed="${PO.reraise === k}">${l}</button>`).join('')}</div></div>
    </details>
    <div class="row"><button class="btn" data-po-est="1">Check tree size</button><span class="small" id="po-est">${estHTML()}</span></div>`;
}
function renderPostflop() {
  const v = $('#v-postflop');
  let html = '';
  const solving = PO.stage === 'solving' || PO.stage === 'building';
  // setup
  const st = EM.rangeStats(PO.ranges[0]), st1 = EM.rangeStats(PO.ranges[1]);
  const startStreet = PO.board.length >= 3 ? STREETS[Math.min(2, PO.board.length - 3)] : 'Flop';
  if (PO.setupOpen || !PO.node) {
    html += `<div class="card"><div class="row sb"><h2>Spot</h2>${PO.node ? '<button class="btn ghost" data-po-hide="1">Hide setup</button>' : ''}</div>
      <div class="field"><label class="label" for="po-preset">Sample spot</label><select id="po-preset">${PO.preset < 0 ? `<option value="-1" selected>${esc(PO.linkName || 'Custom ranges')}</option>` : ''}${PRESETS.map((p, i) => `<option value="${i}" ${i === PO.preset ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      <div class="field"><span class="label">Board · solve starts on the ${startStreet.toLowerCase()}</span>
        <div class="row"><button class="btn ghost" data-po-board="1" style="padding:4px 6px" aria-label="Edit board">${boardHTML([0, 1, 2, 3, 4].map(i => PO.board[i] ?? -1))}</button>
        <button class="btn" data-po-rand="3">Random flop</button></div></div>
      <div class="fields"><div class="field"><label class="label" for="po-pot">Pot (bb)</label><input id="po-pot" type="number" inputmode="decimal" step="0.1" min="0.1" value="${PO.pot}"></div>
        <div class="field"><label class="label" for="po-stack">Effective stack (bb)</label><input id="po-stack" type="number" inputmode="decimal" step="0.1" min="0" value="${PO.stack}" ${PO.payoff === 'icm' ? 'disabled title="The smaller of the two ICM stacks"' : ''}></div>
        <div class="field"><span class="label">SPR</span><span class="stat"><span class="v num">${fmt(PO.stack / PO.pot, 1)}</span></span></div></div>
      <div class="field"><span class="label">Payoffs</span><div class="seg" role="group" aria-label="Payoffs"><button data-po-pay="chip" aria-pressed="${PO.payoff === 'chip'}">Chip EV</button><button data-po-pay="icm" aria-pressed="${PO.payoff === 'icm'}">ICM</button></div></div>
      ${PO.payoff === 'icm' ? icmFieldsHTML() : ''}
      <div class="fields">${[0, 1].map(p => `<div class="field"><span class="label">${p ? 'In position' : 'Out of position'} · ${esc(PO.names[p])}</span>
        <button class="btn" data-po-range="${p}" style="text-align:left"><span class="num">${fmt((p ? st1 : st).pct, 1)}%</span> <span class="muted small">· ${Math.round((p ? st1 : st).combos)} combos · edit</span></button></div>`).join('')}</div>
      <p class="note">Sample pots include eight 0.1 bb antes. The ranges are approximate starting points for 8-max MTTs. Edit them to match your own preflop charts.</p>
      ${handSetupHTML()}
      ${sizesHTML()}
      <div class="field"><span class="label">Accuracy (exploitability target)</span><div class="seg" role="group" aria-label="Accuracy">${[[1, 'Quick 1%'], [0.5, 'Standard 0.5%'], [0.25, 'Precise 0.25%']].map(([a, l]) => `<button data-po-acc="${a}" aria-pressed="${PO.accuracy === a}">${l}</button>`).join('')}</div></div>
      ${NATIVE && NINFO && NINFO.gpu && NINFO.gpu.available && PO.board.length < 5 ? `<div class="field"><span class="label">Graphics card</span><div class="seg" role="group" aria-label="Use the graphics card">${[[true, 'Use GPU'], [false, 'CPU only']].map(([v, l]) => `<button data-po-gpu="${v ? 1 : 0}" aria-pressed="${PO.gpu === v}">${l}</button>`).join('')}</div>
        <p class="note">${esc(NINFO.gpu.device)} solves the river while the CPU handles the flop and turn. A tree too big for the card in full precision is stored in 16-bit so the river still fits. Spots with locked river decisions use the CPU.</p></div>` : ''}
      ${PO.board.length < 5 ? `<div class="field"><span class="label">Suit isomorphism</span><div class="seg" role="group" aria-label="Suit isomorphism">${[[true, 'On (faster)'], [false, 'Off']].map(([v, l]) => `<button data-po-iso="${v ? 1 : 0}" aria-pressed="${PO.iso === v}">${l}</button>`).join('')}</div>
        <p class="note">On shares work between suit-equivalent turn and river cards. Turn it off before locking a strategy after a specific turn or river card.</p></div>` : ''}
      ${NATIVE ? powerHTML() : ''}
      ${PO.board.length === 3 ? (NATIVE ? `<p class="note">Native engine: ${NINFO ? NINFO.threads : '?'} threads and up to ${NINFO ? fmt(DEVICE.limitMB / 1024, 1) : '?'} GB for the tree. Check tree size shows what a tree needs before you solve. Deeper stacks and more sizes grow it fast; boards with matching suits need less.</p>` : `<p class="note">Flop solves are heavy: the Fast tree needs about 0.2–0.7 GB and a few minutes on a phone. Turn and river spots solve in seconds. The online presets and big trees are meant for the Windows app.</p>`) : ''}
      ${NATIVE ? `<details id="po-saves" ${PO.savesOpen ? 'open' : ''}><summary>Saved solutions</summary>${PO.saves ? (PO.saves.length ? `<div class="saves">${PO.saves.map(x => `<div class="saverow"><span><b>${esc(x.name)}</b> <span class="small muted">${fmt(x.bytes / 1048576, 1)} MB · ${new Date(x.time * 1000).toLocaleString()}</span></span><span class="row" style="gap:6px"><button class="btn" data-po-load="${esc(x.name)}">Open</button><button class="btn ghost" data-po-del="${esc(x.name)}" aria-label="Delete ${esc(x.name)}">Delete</button></span></div>`).join('')}</div>` : '<p class="note">No saved solutions yet. Solve a spot, then use Save solution.</p>') : '<p class="note">Loading…</p>'}${NINFO ? `<p class="note">Files live in ${esc(NINFO.saveDir)}</p>` : ''}</details>` : ''}
      <div class="row"><button class="btn primary big" data-po-solve="1" ${solving ? 'disabled' : ''}>${solving ? 'Solving…' : 'Solve'}</button>
      ${PO.err ? `<span class="err">${esc(PO.err)}</span>` : ''}</div></div>`;
  } else {
    html += `<div class="card tight"><div class="row sb"><div class="row" style="gap:8px">${boardHTML(PO.solvedCfg ? PO.solvedCfg.board : PO.board, 'mini')}
      <span class="small muted num">pot ${fmt(PO.solvedCfg ? PO.solvedCfg.pot : PO.pot, 1)} · stack ${fmt(PO.solvedCfg ? PO.solvedCfg.stack : PO.stack, 1)} · ${esc(PO.names[0])} vs ${esc(PO.names[1])}</span></div>
      <button class="btn" data-po-show="1">Edit spot</button></div>${PO.err ? `<p class="err">${esc(PO.err)}</p>` : ''}</div>`;
  }
  if (solving || (PO.stage === 'solved' && PO.result)) {
    const p = PO.prog;
    html += `<div class="card tight"><div class="row sb"><span class="label">${PO.stage === 'building' ? 'Building tree…' : PO.stage === 'solving' ? 'Solving' : PO.result && PO.result.stopped ? 'Stopped early' : 'Solved'}</span>
      ${PO.stats ? `<span class="small muted num">${PO.stats.decisions.toLocaleString()} decisions · ${Math.round(PO.stats.memMB)} MB</span>` : ''}</div>`;
    if (PO.stage === 'solving') {
      html += `<div class="prog" id="po-prog"><i></i></div><div class="row sb"><span class="small num" id="po-prog-t">Starting…</span>
        <span class="row" style="gap:6px"><button class="btn" data-po-peek="1">View current</button><button class="btn" data-po-stop="1">Stop</button></span></div>`;
    } else if (PO.result) {
      const r = PO.result;
      html += `<div class="small num">${r.loaded ? 'Saved solution · ' : ''}${r.stopped ? 'Stopped at ' : ''}${r.it} iterations · exploitability <b>${fmt(r.ex, 2)}%</b> of pot${Number.isFinite(r.chips) ? ` (${evUnit() === '$' ? '$' + fmt(r.chips, 4) : fmt(r.chips, 3) + ' bb'})` : ''}${PO.solvedCfg && PO.solvedCfg.icm ? (PO.solvedCfg.icm.bounty ? (PO.solvedCfg.icm.bounty.kind === 'ko' ? ' · ICM + knockout' : ' · ICM + PKO') : ' · ICM') : ''}${r.elapsed ? ' · ' + fmt(r.elapsed, 1) + 's' : ''}${r.engine === 'js' ? ' · JS engine' : ''}${r.gpu && r.gpu.on ? ' · GPU' : ''}</div>`;
      if (r.gpu && !r.gpu.on && r.gpu.available && r.gpu.why && !r.loaded) html += `<div class="small muted">Solved on the CPU: ${esc(r.gpu.why)}.</div>`;
      if (PO.locksDirty) html += `<div class="row sb"><span class="small warn">Locks changed. Re-solve so the rest of the tree adapts.</span><button class="btn primary" data-po-resolve="1">Re-solve with locks</button></div>`;
      if (NATIVE) {
        html += PO.saving ? `<div class="row"><input id="po-savename" type="text" value="${esc(defaultSaveName())}" aria-label="Solution name" style="flex:1;min-width:160px"><button class="btn primary" data-po-savego="1">Save</button><button class="btn ghost" data-po-savecancel="1">Cancel</button></div>`
          : `<div class="row"><button class="btn" data-po-save="1">Save solution</button>${PO.msg ? `<span class="small muted">${esc(PO.msg)}</span>` : ''}</div>`;
      } else if (PO.msg) html += `<div class="small muted">${esc(PO.msg)}</div>`;
    }
    html += `</div>`;
  }
  if (PT.on && PO.stage === 'solved') html += renderPractice();
  else if (PO.node) html += renderNode();
  v.innerHTML = html;
  if (PO.stage === 'solving') renderPostProgress();
}
// ---------- practice: play hands from the solution and get graded on EV ----------
const PT = { on: false, seat: 1, busy: false, hero: -1, vil: -1, path: [], node: null, log: [], fb: null, over: null, err: null,
  stats: store.get('pt.stats', { hands: 0, dec: 0, loss: 0, best: 0 }) };
function pick(weights) { let s = 0; for (const w of weights) s += w; let x = Math.random() * s; for (let i = 0; i < weights.length; i++) { x -= weights[i]; if (x <= 0) return i; } return weights.length - 1; }
function ptCards(p, i) { const g = PO.combos[p][i]; return [EM.C2[g], EM.C1[g]]; }
async function ptNewHand() {
  const cfg = PO.solvedCfg, hp = PT.seat, vp = 1 - hp;
  PT.hero = pick(Array.from(PO.combos[hp], g => +cfg.ranges[hp][g] || 0));
  const hc = ptCards(hp, PT.hero);
  PT.vil = pick(Array.from(PO.combos[vp], g => (hc.includes(EM.C1[g]) || hc.includes(EM.C2[g]) ? 0 : +cfg.ranges[vp][g] || 0)));
  PT.path = []; PT.log = []; PT.fb = null; PT.over = null; PT.err = null;
  await ptAdvance();
}
// ---------- runout reports: every turn (or river) card at once ----------
async function loadRunouts() {
  const key = JSON.stringify(PO.path), sort = PO.ro ? PO.ro.sort : 'card';
  PO.ro = { key, busy: true, rows: null, err: null, sort };
  render();
  try { const rows = await Engine.runouts(PO.path); if (PO.ro && PO.ro.key === key) PO.ro.rows = rows; }
  catch (e) { if (PO.ro) PO.ro.err = e.message; }
  if (PO.ro) PO.ro.busy = false;
  render();
}
function runoutHTML(st) {
  const R = PO.ro, Street = st === 'turn' ? 'Turn' : 'River';
  if (!R || R.key !== JSON.stringify(PO.path)) return `<div class="row" style="margin:10px 0"><button class="btn" data-po-runouts="1">${Street} report</button><span class="small muted">action mix, EV and equity on every ${st} card</span></div>`;
  if (R.busy) return `<p class="note">Building the ${st} report…</p>`;
  if (R.err) return `<p class="err">${esc(R.err)}</p>`;
  const rows = (R.rows || []).filter(r => r.info);
  if (!rows.length) return `<p class="note">No decisions follow these cards.</p>`;
  const A = rows[0].info.actions, colors = actColors(A), q = rows[0].info.player, o = 1 - q, n = rows.length;
  const betF = (r) => r.info.freq.reduce((t, x, i) => t + (A[i] && A[i].kind >= 3 ? x : 0), 0);
  const mean = (f) => rows.reduce((t, r) => t + f(r), 0) / n;
  const key = { card: r => -((r.card >> 2) * 4 + (r.card & 3)), bet: r => -betF(r), ev: r => -r.info.evAvg, eq: r => -r.info.eqAvg }[R.sort] || (r => 0);
  const sorted = rows.slice().sort((a, b) => key(a) - key(b));
  const icm = evUnit() === '$', ev = (x) => icm ? '$' + fmt(x, 3) : fmt(x, 2);
  const unit = icm ? 'EV in $ vs folding now' : 'EV in bb';
  const row = (lab, f, b, e0, e1, eq, cls) => `<tr class="${cls || ''}"><td>${lab}</td><td class="bdbar"><div class="mbar">${f.map((x, i) => `<i style="width:${(x * 100).toFixed(1)}%;background:${colors[i]}"></i>`).join('')}</div></td><td>${pct(b, 0)}</td><td>${ev(e0)}</td><td>${ev(e1)}</td><td>${pct(eq, 0)}</td></tr>`;
  let h = `<div class="ro"><div class="row sb" style="margin-top:12px"><h3>${Street} report</h3><span class="small muted">${esc(PO.names[q])} acts first · ${n} cards</span></div>
    <div class="legend">${A.map((a, i) => `<span><i style="background:${colors[i]}"></i>${esc(a.label)}</span>`).join('')}</div>
    <div class="seg" role="group" aria-label="Sort the report" style="margin:8px 0">${[['card', 'Card'], ['bet', 'Bet %'], ['ev', 'EV'], ['eq', 'Equity']].map(([k, l]) => `<button data-po-rosort="${k}" aria-pressed="${R.sort === k}">${l}</button>`).join('')}</div>
    <table class="tbl bd ro"><thead><tr><th>Card</th><th>Mix</th><th>Bet</th><th title="${unit}">${q ? 'IP' : 'OOP'} EV</th><th title="${unit}">${o ? 'IP' : 'OOP'} EV</th><th>Eq</th></tr></thead><tbody>`;
  h += row('All', A.map((_, i) => mean(r => r.info.freq[i])), mean(betF), mean(r => r.info.evAvg), mean(r => r.info.evOpp), mean(r => r.info.eqAvg), 'avg');
  for (const r of sorted) h += row(`<button class="rcard ${SUITS[r.card & 3]}" data-po-card="${r.card}" aria-label="Deal ${EM.cardStr(r.card)}">${EM.RC[r.card >> 2]}${EM.SUIT_SYM[r.card & 3]}</button>`, r.info.freq, betF(r), r.info.evAvg, r.info.evOpp, r.info.eqAvg);
  h += `</tbody></table><p class="note">${esc(PO.names[q])}'s first decision on each card, averaged over the range that gets here. "All" weights every card equally. Tap a card to deal it.</p></div>`;
  return h;
}
// let the solution play the villain's hand and deal the cards until the hero has to act or the hand ends
async function ptAdvance() {
  PT.busy = true; render();
  try {
    const hp = PT.seat, vp = 1 - hp, dead = ptCards(hp, PT.hero).concat(ptCards(vp, PT.vil));
    for (let guard = 0; guard < 60; guard++) {
      const info = await Engine.node(PT.path);
      PT.node = info;
      if (info.type === 'chance') {
        const ok = info.cards.filter(c => !dead.includes(c)), c = ok[(Math.random() * ok.length) | 0];
        PT.path.push(c); PT.log.push({ text: `${info.board.length === 3 ? 'Turn' : 'River'} ${EM.cardStr(c)}` }); continue;
      }
      if (info.type === 'player' && info.player === hp) break;
      if (info.type === 'player') {
        const nq = PO.combos[vp].length, a = pick(info.actions.map((x, i) => +info.strategy[i * nq + PT.vil]));
        PT.path.push(a); PT.log.push({ text: `${PO.names[vp]}: ${info.actions[a].label}`, vil: true }); continue;
      }
      PT.over = ptResult(info); PT.stats.hands++; store.set('pt.stats', PT.stats); break;
    }
  } catch (e) { PT.err = e.message; }
  PT.busy = false; render();
}
function ptResult(info) {
  const hp = PT.seat, vp = 1 - hp, hc = ptCards(hp, PT.hero), vc = ptCards(vp, PT.vil);
  if (info.type === 'fold') { const last = info.line[info.line.length - 1]; return { text: last && last.player === hp ? 'You folded.' : `${PO.names[vp]} folded. You win the pot.`, vc }; }
  const board = info.board.slice(), used = new Set(board.concat(hc, vc));
  while (board.length < 5) { let c; do { c = (Math.random() * 52) | 0; } while (used.has(c)); used.add(c); board.push(c); }
  const a = EM.evalCards(board.concat(hc)), b = EM.evalCards(board.concat(vc));
  return { text: a > b ? 'You win at showdown.' : a < b ? `${PO.names[vp]} wins at showdown.` : 'Split pot.', vc, board };
}
function ptAnswer(a) {
  const info = PT.node, hp = PT.seat, nq = PO.combos[hp].length, h = PT.hero;
  const freq = info.actions.map((x, i) => +info.strategy[i * nq + h]);
  const evs = info.actions.map((x, i) => (info.evActions && Number.isFinite(info.evActions[i][h]) ? info.evActions[i][h] : NaN));
  const best = Math.max(...evs.filter(Number.isFinite)), loss = Number.isFinite(evs[a]) ? Math.max(0, best - evs[a]) : 0;
  const reach = +info.reach[hp][h], w0 = +PO.solvedCfg.ranges[hp][PO.combos[hp][h]] || 1;
  const close = loss <= (evUnit() === '$' ? 0.002 + 0.01 * Math.abs(best) : 0.05);
  PT.fb = { a, freq, evs, loss, good: freq[a] >= 0.25 || close, off: reach / w0 < 1e-4, labels: info.actions.map(x => x.label) };
  PT.stats.dec++; PT.stats.loss += loss; if (PT.fb.good) PT.stats.best++; store.set('pt.stats', PT.stats);
  PT.log.push({ text: `You: ${info.actions[a].label}`, hero: true });
  render();
}
function renderPractice() {
  const hp = PT.seat, vp = 1 - hp, st = PT.stats, u = evUnit();
  let html = `<div class="card" id="po-practice"><div class="row sb"><h2>Practice</h2><span class="row" style="gap:6px">
      <div class="seg" role="group" aria-label="Your seat">${[0, 1].map(p => `<button data-pt-seat="${p}" aria-pressed="${hp === p}">${p ? 'IP' : 'OOP'} · ${esc(PO.names[p])}</button>`).join('')}</div>
      <button class="btn ghost sm" data-pt-exit="1">Exit</button></span></div>`;
  if (PT.err) html += `<p class="err">${esc(PT.err)}</p>`;
  if (PT.hero < 0 || !PT.node) { html += `<p class="note">You'll be dealt a hand from ${esc(PO.names[hp])}'s range; the solution plays ${esc(PO.names[vp])} and the cards. At each decision you see how the solver plays your exact hand and the EV you gave up.</p><button class="btn primary big" data-pt-deal="1" ${PT.busy ? 'disabled' : ''}>Deal</button></div>`; return html; }
  const info = PT.node;
  html += `<div class="row sb"><div class="row" style="gap:10px">${handCardsHTMLFor(ptCards(hp, PT.hero))}${boardHTML(info.board, 'mini')}</div><span class="small num">Pot <b>${fmt(info.pot, 2)}</b></span></div>`;
  html += `<div class="ptlog small">${PT.log.map(e => `<span class="${e.hero ? 'me' : e.vil ? 'vil' : ''}">${esc(e.text)}</span>`).join('')}</div>`;
  if (PT.busy) html += `<p class="note">…</p>`;
  else if (PT.over) {
    html += `<div class="verdict mix"><b>${esc(PT.over.text)}</b> ${esc(PO.names[vp])} had ${PT.over.vc.map(c => cardText(c)).join('')}${PT.over.board && PT.over.board.length > info.board.length ? ` · board ran ${PT.over.board.slice(info.board.length).map(c => cardText(c)).join('')}` : ''}</div>
      <button class="btn primary big" data-pt-deal="1">Next hand</button>`;
  } else if (PT.fb) {
    const f = PT.fb;
    html += `<div class="verdict ${f.good ? 'ok' : 'no'}"><b>${f.good ? (f.loss < 1e-9 ? 'Best play.' : 'Fine.') : 'Mistake.'}</b> ${f.loss > 1e-9 ? `You gave up ${u === '$' ? '$' + fmt(f.loss, 3) : fmt(f.loss, 2) + ' bb'}.` : ''}${f.off ? ' The solver never reaches this spot with your hand, so treat its mix here as a rough guide.' : ''}</div>
      <div class="hacts">${f.labels.map((l, i) => `<div class="hact${i === f.a ? ' top' : ''}"><i style="background:${actColors(PT.node.actions)[i]}"></i><span class="t">${esc(l)}</span><b>${fmt(f.freq[i] * 100, 0)}%</b><span class="e">${Number.isFinite(f.evs[i]) ? 'EV ' + fmt(f.evs[i], u === '$' ? 3 : 2) : ''}</span></div>`).join('')}</div>
      <button class="btn primary big" data-pt-next="1">Continue</button>`;
  } else {
    html += `<div class="row sb"><h2><span class="who ${hp ? 'ip' : 'oop'}">${hp ? 'IP' : 'OOP'}</span> Your move</h2><span class="small muted">${info.toCall > 0 ? 'facing ' + fmt(info.toCall, 2) : ''}</span></div>
      <div class="acts">${info.actions.map((a, i) => `<button class="act" data-pt-act="${i}"><i style="background:${actColors(info.actions)[i]}"></i><span class="t">${esc(a.label)}${actSub(a) ? `<small>${actSub(a)}</small>` : ''}</span><span class="f"></span></button>`).join('')}</div>`;
  }
  html += `<div class="stats"><div class="stat"><span class="label">Hands</span><span class="v">${st.hands}</span></div>
    <div class="stat"><span class="label">Good decisions</span><span class="v">${st.dec ? pct(st.best / st.dec, 0) : '–'}</span></div>
    <div class="stat"><span class="label">EV lost / decision</span><span class="v">${st.dec ? fmt(st.loss / st.dec, u === '$' ? 4 : 3) : '–'} <span class="small muted">${u}</span></span></div></div>
    <div class="row sb"><span class="note">Mixed actions the solver takes at least 25% of the time, or that cost almost nothing, count as good.</span><button class="btn ghost sm" data-pt-reset="1">Reset stats</button></div></div>`;
  return html;
}
function crumbLabel(e, names) {
  if (e.card != null) return `${STREETS[e.street]} ${EM.RC[e.card >> 2]}${EM.SUIT_SYM[e.card & 3]}`;
  const who = names[e.player];
  const k = e.kind;
  const lab = k === 0 ? 'fold' : k === 1 ? 'check' : k === 2 ? 'call' : k === 3 ? 'bet ' + fmt(e.amt, 1) : k === 4 ? 'raise ' + fmt(e.amt, 1) : 'all-in';
  return `${who} ${lab}`;
}
function renderNode() {
  const info = PO.node, names = PO.names;
  let html = '<div class="card" id="po-node">';
  // crumbs
  html += `<div class="crumbs"><button data-po-go="0" class="${PO.path.length === 0 ? 'cur' : ''}">${STREETS[Math.min(2, (PO.solvedCfg ? PO.solvedCfg.board.length : 3) - 3)]}</button>` +
    info.line.map((e, i) => `<button data-po-go="${i + 1}" class="${i + 1 === PO.path.length ? 'cur' : ''}">${crumbLabel(e, names)}</button>`).join('') + `</div>`;
  html += `<div class="row sb"><div class="row" style="gap:8px">${boardHTML(info.board, 'mini')}</div>
    <span class="row small num" style="gap:8px">Pot <b>${fmt(info.pot, 2)}</b> · behind ${fmt(Math.min(info.stack[0], info.stack[1]), 2)}${PO.stage === 'solved' ? '<button class="btn sm" data-pt-start="1">Practice</button>' : ''}</span></div>`;
  if (info.type === 'player' || info.type === 'chance') html += handPanelHTML(info);
  if (info.type === 'chance') {
    const st = info.board.length === 3 ? 'turn' : 'river';
    html += `<div class="row sb"><h2>Deal the ${st}</h2><button class="btn" data-po-randcard="1">Random card</button></div>`;
    html += `<div class="picker">` + pickerCells(c => {
      const mine = !!PO.hand && PO.hand.cards.includes(c), ok = info.cards.includes(c) && !mine;
      return `<button class="${SUITS[c & 3]}" data-po-card="${c}" ${ok ? '' : 'disabled'} aria-label="${EM.cardStr(c)}${mine ? ' (in your hand)' : ''}">${EM.RC[c >> 2]}<em>${EM.SUIT_SYM[c & 3]}</em></button>`;
    }) + `</div>`;
    html += runoutHTML(st);
    html += renderRangeGrid(info, null);
    html += '</div>';
    return html;
  }
  if (info.type !== 'player') { html += `<p class="note">Hand over.</p></div>`; return html; }
  const q = info.player, nq = PO.combos[q].length, nA = info.actions.length;
  const colors = actColors(info.actions);
  // overall frequencies
  const tot = new Float64Array(nA); let R = 0;
  const rq = info.reach[q], stg = info.strategy;
  for (let h = 0; h < nq; h++) { const r = rq[h]; if (!r) continue; R += r; for (let a = 0; a < nA; a++) tot[a] += r * stg[a * nq + h]; }
  html += `<div class="row sb"><h2><span class="who ${q ? 'ip' : 'oop'}">${q ? 'IP' : 'OOP'}</span> ${esc(names[q])} to act${info.locked ? ' <span class="pill lock">Locked</span>' : ''}</h2>
    <span class="small muted">${[info.toCall > 0 ? 'facing ' + fmt(info.toCall, 2) : '', PO.hand ? 'whole range' : ''].filter(Boolean).join(' · ')}</span></div>`;
  html += `<div class="actbar" aria-hidden="true">${info.actions.map((a, i) => `<i style="width:${(tot[i] / R * 100).toFixed(2)}%;background:${colors[i]}"></i>`).join('')}</div>`;
  html += `<div class="acts">` + info.actions.map((a, i) => {
    const nav = a.childType === 'player' || a.childType === 'chance';
    const sub = actSub(a) ? `<small>${actSub(a)}</small>` : '';
    return `<button class="act" data-po-act="${i}" ${nav ? '' : 'disabled'}><i style="background:${colors[i]}"></i><span class="t">${esc(a.label)}${sub}</span><span class="f">${fmt(tot[i] / R * 100, 1)}%</span></button>`;
  }).join('') + `</div>`;
  html += lockPanelHTML(info, colors);
  html += renderRangeGrid(info, colors);
  html += '</div>';
  return html;
}
function pickerCells(fn) {
  let s = '';
  for (const su of [3, 2, 1, 0]) for (let r = 12; r >= 0; r--) s += fn(r * 4 + su);
  return s;
}
function renderRangeGrid(info, colors) {
  const isPlayer = info.type === 'player';
  const q = isPlayer ? info.player : 0;
  const who = isPlayer ? (PO.who === 'act' ? q : 1 - q) : (PO.who === 'act' ? 0 : 1);
  const showStrat = isPlayer && who === q;
  const views = showStrat ? ['strategy', 'ev', 'equity', 'hands'] : ['range', 'ev', 'equity', 'hands'];
  let view = PO.view;
  if (!views.includes(view)) view = views[0];
  const n = PO.combos[who].length, reach = info.reach[who];
  const ev = info.ev ? info.ev[who] : null, eq = info.equity ? info.equity[who] : null;
  const nA = isPlayer ? info.actions.length : 0, stg = info.strategy;
  const agg = []; let totR = 0, totEV = 0, totEQ = 0;
  for (let k = 0; k < NC; k++) {
    let R = 0, E = 0, Q = 0; const F = new Float64Array(Math.max(1, nA));
    for (const h of PO.cmap[who][k]) {
      const r = reach[h]; if (!r) continue;
      R += r;
      if (showStrat) for (let a = 0; a < nA; a++) F[a] += r * stg[a * n + h];
      if (ev && Number.isFinite(ev[h])) E += r * ev[h];
      if (eq && Number.isFinite(eq[h])) Q += r * eq[h];
    }
    agg.push({ R, F, E: R ? E / R : NaN, Q: R ? Q / R : NaN });
    totR += R; totEV += E; totEQ += Q;
  }
  let html = `<div class="row sb"><div class="seg" role="group" aria-label="Player">
      <button data-po-who="act" aria-pressed="${PO.who === 'act'}">${isPlayer ? (q ? 'IP' : 'OOP') + ' (to act)' : 'OOP'}</button>
      <button data-po-who="opp" aria-pressed="${PO.who === 'opp'}">${isPlayer ? (q ? 'OOP' : 'IP') : 'IP'}</button></div>
    <div class="seg" role="group" aria-label="Grid view">${views.map(x => `<button data-po-view="${x}" aria-pressed="${view === x}">${x === 'ev' ? 'EV' : x[0].toUpperCase() + x.slice(1)}</button>`).join('')}</div></div>`;
  html += `<div class="stats"><div class="stat"><span class="label">${esc(PO.names[who])} range</span><span class="v">${fmt(totR, 0)} <span class="small muted">combos</span></span></div>
    ${ev ? `<div class="stat"><span class="label">Avg EV</span><span class="v">${fmt(totEV / totR, 2)} <span class="small muted">${evUnit()}</span></span></div>` : ''}
    ${eq ? `<div class="stat"><span class="label">Equity</span><span class="v">${pct(totEQ / totR)}</span></div>` : ''}</div>`;
  const potNow = info.pot, evMax = Math.max(1e-9, ...agg.map(a => (a.R > 1e-6 && Number.isFinite(a.E) ? Math.abs(a.E) : 0)));
  const mineK = PO.hand && who === PO.hand.player ? EM.CLS[handCombo()] : -1;
  const cell = (k, segs, o) => cellHTML(k, segs, Object.assign(o, { mine: k === mineK }));
  if (view === 'hands') return html + breakdownHTML(info, who, showStrat, colors);
  html += `<div class="gridwrap" id="po-grid">` + gridHTML(k => {
    const a = agg[k], sel = PO.cell === k;
    const fillH = a.R / EM.CLASS_NCOMBOS[k];
    if (a.R < 1e-6) return cell(k, [], { h: 0, dim: true, sel });
    if (view === 'strategy') {
      if (PO.lockEdit && showStrat && PO.lockEdit.cls.has(k) && PO.lockEdit.cls.get(k) >= 0) { const b = PO.lockEdit.cls.get(k); return cell(k, colors.map((c, i) => [c, i === b ? 1 : 0]), { h: fillH, sel, text: 'lock' }); }
      return cell(k, colors.map((c, i) => [c, a.F[i] / a.R]), { h: fillH, sel });
    }
    if (view === 'range') return cell(k, [['var(--gold)', 1]], { h: fillH, sel });
    if (view === 'ev') return cell(k, [[heat(evUnit() === '$' ? 0.5 + a.E / (2 * evMax) : a.E / Math.max(potNow, 1e-9)), 1]], { h: fillH, text: evUnit() === '$' ? fmt(a.E, 2) : fmt(a.E, 1), sel });
    return cell(k, [[heat(a.Q), 1]], { h: fillH, text: Math.round(a.Q * 100), sel });
  }) + `</div>`;
  if (showStrat && view === 'strategy') html += `<div class="legend">${info.actions.map((a, i) => `<span><i style="background:${colors[i]}"></i>${esc(a.label)}</span>`).join('')}</div>`;
  if (PO.cell != null) html += postDetail(info, who, PO.cell, showStrat, colors);
  else html += `<p class="note">Tap a hand to see each combo. Cell height shows how much of the hand is still in the range.</p>`;
  return html;
}
function postDetail(info, who, k, showStrat, colors) {
  const n = PO.combos[who].length, reach = info.reach[who], stg = info.strategy;
  const ev = info.ev ? info.ev[who] : null, eq = info.equity ? info.equity[who] : null;
  const nA = info.actions ? info.actions.length : 0;
  const myG = PO.hand && who === PO.hand.player ? handCombo() : -1;
  const rows = [];
  for (const h of PO.cmap[who][k]) {
    const g = PO.combos[who][h], r = reach[h];
    if (!r) continue;
    let bar = '';
    if (showStrat) bar = `<div class="mbar">${info.actions.map((a, i) => `<i style="width:${(stg[i * n + h] * 100).toFixed(1)}%;background:${colors[i]}"></i>`).join('')}</div>`;
    const evActs = showStrat && info.evActions ? info.actions.map((a, i) => Number.isFinite(info.evActions[i][h]) ? `${a.label.split(' ')[0]} ${fmt(info.evActions[i][h], 2)}` : '').filter(Boolean).join(' · ') : '';
    rows.push(`<div class="combo${g === myG ? ' mine' : ''}"><span>${cardText(EM.C2[g])}${cardText(EM.C1[g])}</span><span>${bar}<span class="small muted">${r < 0.999 ? Math.round(r * 100) + '% in range · ' : ''}EV ${ev ? fmt(ev[h], 2) : '–'} · eq ${eq ? pct(eq[h], 0) : '–'}</span>${evActs ? `<br><span class="small muted">${esc(evActs)}</span>` : ''}</span></div>`);
  }
  return `<div class="detail"><div class="row sb"><h3>${EM.CLASS_NAMES[k]}</h3><span class="small muted">${esc(PO.names[who])}</span></div>${rows.length ? `<div class="combos">${rows.join('')}</div>` : '<p class="note">Not in range here.</p>'}</div>`;
}

// ---------- sheets: range editor + board picker ----------
const sheet = { el: null, panel: null, onClose: null };
function openSheet(html, bind) {
  // swap in a fresh panel so listeners from earlier draws (and earlier sheets) never stack up
  sheet.el = $('#sheet');
  const old = $('#sheet-panel'), fresh = old.cloneNode(false);
  old.replaceWith(fresh); sheet.panel = fresh;
  fresh.innerHTML = html; sheet.el.hidden = false;
  if (bind) bind(fresh);
}
function closeSheet() { $('#sheet').hidden = true; $('#sheet-panel').innerHTML = ''; }
const RANKED = Array.from({ length: NC }, (_, k) => k).sort((a, b) => TB.vsRandom[b] - TB.vsRandom[a]);
function openRangeEditor(p) {
  const w = Float32Array.from(PO.ranges[p]);
  let weight = 1, paintVal = null, err = '';
  const clsW = (k) => { let s = 0; for (const i of EM.CLASS_COMBOS[k]) s += w[i]; return s / EM.CLASS_NCOMBOS[k]; };
  const draw = () => {
    const stt = EM.rangeStats(w);
    openSheet(`<div class="row sb"><h2>${p ? 'In position' : 'Out of position'} · ${esc(PO.names[p])}</h2><span class="num">${fmt(stt.pct, 1)}% · ${Math.round(stt.combos)} combos</span></div>
      <div class="row sb"><div class="seg" role="group" aria-label="Paint weight">${[1, 0.75, 0.5, 0.25].map(x => `<button data-rw="${x}" aria-pressed="${weight === x}">${x * 100}%</button>`).join('')}</div>
        <div class="row" style="gap:6px"><button class="btn" data-rclear="1">Clear</button><button class="btn" data-rall="1">All</button></div></div>
      <div class="gridwrap">${gridHTML(k => { const x = clsW(k); return cellHTML(k, x > 0 ? [['var(--gold)', 1]] : [], { h: x, dim: x === 0, text: x > 0 && x < 0.999 ? Math.round(x * 100) : null }); }).replace('class="grid13"', 'class="grid13 paint" id="rgrid"')}</div>
      <div class="field"><label class="label" for="rtop">Top hands: <span id="rtopv">–</span></label><input id="rtop" type="range" min="0" max="100" step="1" value="0"></div>
      <div class="field"><label class="label" for="rtext">Range text</label><textarea id="rtext" spellcheck="false">${esc(EM.rangeToString(w))}</textarea>
        <div class="row"><button class="btn" data-rapply="1">Apply text</button>${err ? `<span class="err">${esc(err)}</span>` : ''}</div></div>
      <div class="row sb"><button class="btn" data-rcancel="1">Cancel</button><button class="btn primary" data-rdone="1">Use this range</button></div>`, bindEditor);
  };
  const paintCell = (k) => { for (const i of EM.CLASS_COMBOS[k]) w[i] = paintVal; };
  const refreshGrid = () => {
    const g = $('#rgrid'); if (!g) return;
    for (const el of g.children) {
      const k = +el.dataset.k, x = clsW(k);
      const f = el.querySelector('.fill');
      if (x > 0) {
        if (f) { f.style.height = (x * 100) + '%'; } else { el.insertAdjacentHTML('afterbegin', `<div class="fill" style="height:${x * 100}%"><i style="width:100%;background:var(--gold)"></i></div>`); }
        el.classList.remove('dim');
      } else { if (f) f.remove(); el.classList.add('dim'); }
    }
    const stt = EM.rangeStats(w);
    const hdr = sheet.panel.querySelector('.num'); if (hdr) hdr.textContent = `${fmt(stt.pct, 1)}% · ${Math.round(stt.combos)} combos`;
    const t = $('#rtext'); if (t) t.value = EM.rangeToString(w);
  };
  function bindEditor(panel) {
    const g = $('#rgrid');
    const at = (e) => { const el = document.elementFromPoint(e.clientX, e.clientY); return el && el.closest ? el.closest('#rgrid .cell') : null; };
    g.addEventListener('pointerdown', (e) => {
      const c = at(e); if (!c) return;
      e.preventDefault();
      const k = +c.dataset.k;
      paintVal = Math.abs(clsW(k) - weight) < 1e-3 ? 0 : weight;
      paintCell(k); refreshGrid();
      try { g.setPointerCapture(e.pointerId); } catch (x) { /* not supported */ }
    });
    g.addEventListener('pointermove', (e) => { if (paintVal == null) return; const c = at(e); if (c) { paintCell(+c.dataset.k); refreshGrid(); } });
    const end = () => { paintVal = null; };
    g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end);
    panel.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || b.classList.contains('cell')) return;
      if (b.dataset.rw) { weight = +b.dataset.rw; for (const x of panel.querySelectorAll('[data-rw]')) x.setAttribute('aria-pressed', String(+x.dataset.rw === weight)); }
      else if (b.dataset.rclear) { w.fill(0); refreshGrid(); }
      else if (b.dataset.rall) { w.fill(1); refreshGrid(); }
      else if (b.dataset.rapply) {
        try { const nw = EM.parseRange($('#rtext').value); w.set(nw); err = ''; refreshGrid(); }
        catch (x) { err = x.message; draw(); }
      }
      else if (b.dataset.rcancel) closeSheet();
      else if (b.dataset.rdone) { PO.ranges[p] = Float32Array.from(w); closeSheet(); render(); }
    });
    const top = $('#rtop');
    top.addEventListener('input', () => {
      const target = +top.value / 100 * 1326; let acc = 0;
      w.fill(0);
      for (const k of RANKED) { if (acc >= target - 0.5) break; for (const i of EM.CLASS_COMBOS[k]) w[i] = 1; acc += EM.CLASS_NCOMBOS[k]; }
      $('#rtopv').textContent = top.value + '%';
      refreshGrid();
    });
  }
  draw();
}
function openBoardPicker() {
  let sel = PO.board.slice();
  const draw = () => openSheet(`<div class="row sb"><h2>Board</h2>${boardHTML([0, 1, 2, 3, 4].map(i => sel[i] ?? -1))}</div>
    <p class="note">Pick 3 cards for a flop solve, 4 for the turn, or 5 for the river.</p>
    <div class="picker">${pickerCells(c => `<button class="${SUITS[c & 3]}" data-bc="${c}" aria-pressed="${sel.includes(c)}" aria-label="${EM.cardStr(c)}">${EM.RC[c >> 2]}<em>${EM.SUIT_SYM[c & 3]}</em></button>`)}</div>
    <div class="row sb"><span class="row" style="gap:6px"><button class="btn" data-bclear="1">Clear</button><button class="btn" data-brand="1">Random flop</button></span>
      <button class="btn primary" data-bdone="1" ${sel.length < 3 ? 'disabled' : ''}>Done</button></div>`, (panel) => {
    panel.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.bc != null) { const c = +b.dataset.bc; const i = sel.indexOf(c); if (i >= 0) sel.splice(i, 1); else if (sel.length < 5) sel.push(c); draw(); }
      else if (b.dataset.bclear) { sel = []; draw(); }
      else if (b.dataset.brand) { sel = randomCards(3); draw(); }
      else if (b.dataset.bdone) { PO.board = sel.slice(); closeSheet(); render(); }
    });
  });
  draw();
}
function randomCards(n, exclude = []) {
  const out = [];
  while (out.length < n) { const c = (Math.random() * 52) | 0; if (!out.includes(c) && !exclude.includes(c)) out.push(c); }
  return out;
}

// ============================================================
// TRAINER
// ============================================================
const TR = Object.assign({ mode: 'mixed', minS: 5, maxS: 15, spot: null, answer: null }, store.get('tr.cfg', {}));
TR.stats = store.get('tr.stats', { n: 0, ok: 0, loss: 0 });
function trNew() {
  const lo = Math.max(CH.stacks[0], TR.minS | 0), hi = Math.min(CH.stacks[CH.stacks.length - 1], TR.maxS | 0);
  for (let tries = 0; tries < 400; tries++) {
    const S = lo + Math.floor(Math.random() * (Math.max(hi, lo) - lo + 1));
    const sol = libSolution(S);
    const isCall = TR.mode === 'call' || (TR.mode === 'mixed' && Math.random() < 0.45);
    let hero, facing;
    if (isCall) { facing = Math.floor(Math.random() * 7); hero = facing + 1 + Math.floor(Math.random() * (7 - facing)); }
    else { facing = -1; hero = Math.floor(Math.random() * 7); }
    const d = isCall ? sol.call[facing][hero] : sol.jam[hero];
    const combo = Math.floor(Math.random() * 1326), k = EM.CLS[combo];
    const ev = d.ev[k];
    // favour close decisions so the drill is not mostly trash folds
    if (Math.random() > Math.max(0.12, Math.exp(-Math.abs(ev) / 0.9))) continue;
    TR.spot = { S, hero, facing, combo, k, freq: d.freq[k], ev, kind: isCall ? 'call' : 'jam' };
    TR.answer = null;
    return;
  }
}
function trAnswer(go) {
  const s = TR.spot; if (!s || TR.answer) return;
  const best = s.ev > 0;
  const loss = go ? Math.max(0, -s.ev) : Math.max(0, s.ev);
  const mixed = s.freq > 0.1 && s.freq < 0.9;
  const ok = mixed || go === (s.freq >= 0.5);
  TR.answer = { go, ok, loss, best, mixed };
  TR.stats.n++; if (ok) TR.stats.ok++; TR.stats.loss += loss;
  store.set('tr.stats', TR.stats);
  render();
}
function renderTrainer() {
  const v = $('#v-trainer');
  const s = TR.spot, st = TR.stats;
  let html = `<div class="card tight"><div class="row sb"><div class="seg" role="group" aria-label="Drill">
      ${[['mixed', 'Jam + call'], ['jam', 'Jam only'], ['call', 'Call only']].map(([m, l]) => `<button data-tr-mode="${m}" aria-pressed="${TR.mode === m}">${l}</button>`).join('')}</div>
      <span class="row small" style="gap:6px"><label for="tr-min" class="muted">Stacks</label><input id="tr-min" type="number" min="3" max="25" value="${TR.minS}" style="width:58px">–<input id="tr-max" type="number" min="3" max="25" value="${TR.maxS}" style="width:58px">bb</span></div></div>`;
  if (s) {
    const pos = POS8;
    const ctx = s.kind === 'jam' ? 'Folded to you' : `<b>${pos[s.facing]}</b> jams ${s.S}bb`;
    html += `<div class="card"><div class="spot"><div class="label">8-max · ${s.S}bb effective · 0.1 bb ante each · chip EV</div>
      <div class="ctx">You are <b>${pos[s.hero]}</b> · ${ctx}</div>
      <div class="hand">${cardHTML(EM.C2[s.combo], 'lg')}${cardHTML(EM.C1[s.combo], 'lg')}</div>
      <div class="choice"><button class="btn fold" data-tr-go="0" ${TR.answer ? 'disabled' : ''}>Fold</button>
        <button class="btn go ${s.kind === 'call' ? 'callc' : ''}" data-tr-go="1" ${TR.answer ? 'disabled' : ''}>${s.kind === 'jam' ? 'Jam' : 'Call'}</button></div>`;
    if (TR.answer) {
      const a = TR.answer, act = s.kind === 'jam' ? 'jam' : 'call';
      const cls = a.mixed ? 'mix' : a.ok ? 'ok' : 'no';
      const head = a.mixed ? 'Close spot: Nash mixes' : a.ok ? 'Correct' : 'Mistake';
      html += `<div class="verdict ${cls}"><b>${head}.</b> Nash ${act}s ${EM.CLASS_NAMES[s.k]} ${Math.round(s.freq * 100)}% of the time. ${act[0].toUpperCase() + act.slice(1)} is worth <b>${fmtS(s.ev, 2)} bb</b> versus folding${a.loss > 0.005 ? `; your choice cost ${fmt(a.loss, 2)} bb` : ''}.</div>
        <button class="btn primary big" data-tr-next="1">Next hand</button>`;
    }
    html += `</div></div>`;
  }
  html += `<div class="card tight"><div class="stats"><div class="stat"><span class="label">Hands</span><span class="v">${st.n}</span></div>
    <div class="stat"><span class="label">Accuracy</span><span class="v">${st.n ? pct(st.ok / st.n, 0) : '–'}</span></div>
    <div class="stat"><span class="label">EV lost / hand</span><span class="v">${st.n ? fmt(st.loss / st.n, 3) : '–'} <span class="small muted">bb</span></span></div></div>
    <div class="row sb"><span class="note">Drills use the Nash library. Close hands are dealt more often than trash.</span><button class="btn ghost" data-tr-reset="1">Reset stats</button></div></div>`;
  v.innerHTML = html;
}

// ============================================================
// ICM
// ============================================================
const IC = store.get('icm', { stacks: '42, 31, 27, 22, 18, 14, 10, 6', payouts: '30, 20, 14, 11, 9, 7, 5, 4', err: null });
function renderICM() {
  const v = $('#v-icm');
  let rows = '', err = null, total = 0;
  try {
    const stacks = EM.parseNumberList(IC.stacks), pays = EM.parseNumberList(IC.payouts);
    if (stacks.length < 2) throw new Error('Enter at least 2 stacks');
    if (stacks.length > 16) throw new Error('Up to 16 players');
    if (!pays.length) throw new Error('Enter at least one payout');
    const eq = EM.icmRaw(stacks, pays);
    const chips = stacks.reduce((a, b) => a + b, 0); total = pays.slice(0, stacks.length).reduce((a, b) => a + b, 0);
    rows = stacks.map((s, i) => `<tr><td>Player ${i + 1}</td><td>${s}</td><td>${pct(s / chips)}</td><td><b>${fmt(eq[i], 2)}</b></td><td>${pct(eq[i] / total)}</td><td style="color:${eq[i] / total - s / chips >= 0 ? 'var(--good)' : 'var(--bad)'}">${fmtS((eq[i] / total - s / chips) * 100, 1)}</td></tr>`).join('');
  } catch (e) { err = e.message; }
  v.innerHTML = `<div class="card"><h2>ICM equity</h2>
    <div class="fields"><div class="field"><label class="label" for="ic-st">Stacks (chips or bb)</label><textarea id="ic-st" spellcheck="false">${esc(IC.stacks)}</textarea></div>
      <div class="field"><label class="label" for="ic-pay">Payouts, 1st place first</label><textarea id="ic-pay" spellcheck="false">${esc(IC.payouts)}</textarea></div></div>
    ${err ? `<p class="err">${esc(err)}</p>` : `<div class="scrollx"><table class="tbl"><thead><tr><th>Seat</th><th>Stack</th><th>Chips</th><th>$EV</th><th>Pool</th><th>±pts</th></tr></thead><tbody>${rows}</tbody></table></div>`}
    <p class="note">Malmuth–Harville model. ±pts compares each player's share of the prize pool with their share of the chips. Short stacks gain, big stacks lose: that gap is the ICM pressure the push/fold solver plays around.</p>
    <div class="row"><button class="btn" data-ic-send="1" ${err ? 'disabled' : ''}>Solve push/fold with these stacks</button></div>
    <p class="note">Sends up to 8 stacks to the preflop solver as UTG→BB (the rest count as other tables). Enter stacks in big blinds for that.</p></div>`;
}


// ============================================================
// PREFLOP TREE MODEL, 15-100bb (approximate)
// ============================================================
const DL = EM.DEEP_LIB;
const deepCache = new Map();
const DP = { stack: store.get('dp.stack', 100), line: [], cell: null, sol: null, solving: false, prog: null, err: null,
  cfg: Object.assign({ stack: 60, n: 8 }, store.get('dp.cfg2', {}), EM.MTT_ANTE), customOpen: false };
if (!DL.depths.includes(DP.stack)) DP.stack = 100;
function unrle(s) {
  let o = '';
  for (let i = 0; i < s.length; i++) { if (s[i] === '.') { o += s[i + 1].repeat(DL.alph.indexOf(s[i + 2]) + 4); i += 2; } else o += s[i]; }
  return o;
}
function deepLabel(m, c) {
  const z = m.sizes;
  const depth = m.stacks.every(s=>s===m.stacks[0]) ? c.stack+'bb' : m.stacks.join(' / ')+'bb';
  return `${depth} · ${c.n}-handed · 0.1 bb ante each · open ${z.open}, SB ${z.sbOpen} · 3-bet ${z.m3ip}× in position, ${z.m3oop}× from the blinds · 4-bet ${z.m4}×`;
}
function deepLib(S) {
  if (deepCache.has(S)) return deepCache.get(S);
  const cfg = { ...DL.base, stack: S };
  const m = EM.DeepTree(cfg);
  m.load(unrle(DL.data[S])); m.evaluate();
  const sol = { m, lib: S, label: deepLabel(m, cfg) };
  deepCache.set(S, sol);
  return sol;
}
function deepSol() { if (!DP.sol) DP.sol = deepLib(DP.stack); return DP.sol; }
const deepColor = (kind) => kind === 0 ? 'var(--fold)' : kind === 1 ? 'var(--call)' : kind === 2 ? 'var(--a-bet2)' : 'var(--jam)';
function deepCrumbs(m, line) {
  // consecutive folds collapse into one crumb
  const out = [], P = m.positions;
  for (let i = 0; i < line.length; i++) {
    const e = line[i];
    if (e.auto) continue;
    if (e.kind === 0 && out.length && out[out.length - 1].fold) { const c = out[out.length - 1]; c.to = e.x; c.n++; continue; }
    out.push({ i, x: e.x, to: e.x, label: e.label, fold: e.kind === 0, n: 1 });
  }
  return out.map(c => ({ i: c.i, text: c.fold ? `${P[c.x]}${c.n > 1 ? '–' + P[c.to] : ''} fold` : `${P[c.x]} ${c.label.toLowerCase()}` }));
}
// send the two ranges at a preflop "see a flop" node to the postflop solver
function deepToPostflop() {
  const sol = deepSol(), m = sol.m, P = m.positions, n = m.n;
  const r = m.reachAt(DP.line.map(e => e.label));
  if (!r) return;
  const w = m.view(r.id);
  if (w.type !== 'show' || w.players.length !== 2 || w.allIn) return;
  const ord = s => EM.postflopOrder(s, n);
  const [a, b] = w.players.slice().sort((x, y) => ord(x) - ord(y));
  const rng = (p) => { const out = new Float32Array(1326), rc = r.reach[p]; for (let g = 0; g < 1326; g++) out[g] = rc ? rc[EM.CLS[g]] : 1; return out; };
  PO.ranges = [rng(a), rng(b)]; PO.names = [P[a], P[b]];
  PO.pot = Math.round(w.pot * 100) / 100; PO.stack = Math.round(w.left * 100) / 100;
  const crumbs = deepCrumbs(m, DP.line).map(c => c.text).join(', ');
  PO.preset = -1; PO.linkName = `From preflop: ${crumbs} (${sol.lib ? sol.lib + 'bb' : 'custom'})`;
  // stacks behind at the flop; an ICM solution also brings everyone else's stacks and the payouts
  const r2 = (x) => Math.round(x * 100) / 100, behind = (p) => r2(m.stacks[p] - m.dead[p] - w.cb[p]);
  if (m.icm && sol.cfg && sol.cfg.icm) {
    PO.payoff = 'icm'; PO.icm.bountyKind = 'none';
    const oth = []; for (let p = 0; p < n; p++) if (p !== a && p !== b) oth.push(behind(p));
    Object.assign(PO.icm, { b0: String(behind(a)), b1: String(behind(b)), others: oth.concat(sol.cfg.icm.others).join(', '), payouts: sol.cfg.icm.payouts.join(', ') });
  } else { PO.payoff = 'chip'; }
  // the last preflop raiser gets the preset's c-bet sizes; with the sizes picked to match the pot
  PO.raiser = w.agg === b ? 'ip' : w.agg === a ? 'oop' : 'limp';
  if (!PO.treePicked) PO.tree = !NATIVE ? 'fast' : w.line && w.line.filter(e => e.kind >= 2).length >= 2 ? 'tbp' : 'srp';
  if (TREES[PO.tree]) setTree(PO.tree);
  PO.board = []; PO.stage = 'setup'; PO.node = null; PO.result = null; PO.setupOpen = true; PO.err = null; PT.on = false; PO.est = null;
  setTab('postflop', true);
}
// The linked preflop study trains preflop together with flop, turn and river decisions, so it
// replaces the realization estimate. It takes all seats (up to eight).
function deepToLinked() {
  const m = deepSol().m, keep = Math.min(8, m.n), first = m.n - keep;
  const seats = m.positions.slice(first).map((name, i) => ({ name, stack: String(+m.stacks[first + i].toFixed(2)), prior: '0', range: 'random', lead: true }));
  const r = (x, d) => String(+(+x).toFixed(d));
  const ok = riverPanel.importSpot({ study: 'linked', board: '', privateMode: 'sampled', maxIter: 20000, dealt: m.n, common: '0', folded: '', seats,
    preOpen: r(m.sizes.open, 2) + ',a', preRaises: r(m.sizes.m3ip, 2) + 'x,a', preCap: 3, preLimps: true,
    tree: { flop: { bets: '33,75', raises: '', maxBets: 1 }, turn: { bets: '75', raises: '', maxBets: 1 }, river: { bets: '75,g', raises: '', maxBets: 1 } },
    notes: 'Imported from the ' + m.n + '-max chart' + (first ? '; ' + m.positions.slice(0, first).join(', ') + ' fold first' : '') + '. Preflop trains with these postflop bets. Increase iterations and compare seeds before trusting close decisions.' });
  if (ok) setTab('river', true);
}
function deepToRiver() {
  return transferMultiway(deepSol().m,DP.line.map(e=>e.label),false);
}
function transferMultiway(m,labels,example) {
  const r=m.reachAt(labels);
  if (!r) return;
  const w=m.view(r.id);
  if (w.type!=='show' || w.players.length!==3 || w.allIn) return;
  const live=w.players.slice().sort((a,b)=>EM.postflopOrder(a,m.n)-EM.postflopOrder(b,m.n));
  const seats=live.map(p=>{
    const range=EM.CLASS_NAMES.flatMap((name,k)=>{const w=r.reach[p]?r.reach[p][k]:1;return w>0?[w===1?name:name+':'+w]:[];}).join(',');
    return {name:m.positions[p],stack:String(+w.behind[p].toFixed(4)),prior:String(+w.cb[p].toFixed(4)),range,lead:true};
  });
  const preset=example?{tree:Object.fromEntries(['flop','turn','river'].map(s=>[s,{bets:'50',raises:'',maxBets:1}]))}:{};
  const ok=riverPanel.importSpot({...preset,board:example?'2c 4d 7h':'',privateMode:'sampled',maxIter:10000,dealt:m.n,common:'0',seats,
    folded:w.cb.filter((v,p)=>!live.includes(p) && v>0).join(', '),
    notes:example?'25 bb chart · Button opens to 2 bb, small blind calls, big blind calls. Eight antes bring the pot to 6.8 bb. Full chart ranges on 2c 4d 7h.':'Imported preflop stacks, wagers and ranges. Enter a three-card flop to solve the remaining streets in chip EV. Wide ranges uses fresh weighted private deals and all legal runouts.'});
  if (ok) setTab('river',true);
}
function renderDeep(v, seg) {
  const sol = deepSol(), m = sol.m, P = m.positions;
  let id = m.follow(DP.line.map(e => e.label));
  if (id < 0) { DP.line = []; id = 0; }
  const w = m.view(id);
  let html = `<div class="card"><div class="row sb">${seg}</div>
    <div class="field"><span class="label">Stack depth</span><div class="chips">` +
    DL.depths.map(S => `<button class="chip" data-dp-stack="${S}" aria-pressed="${sol.lib === S}">${S}bb</button>`).join('') +
    `<button class="chip" data-dp-custom="1" aria-pressed="${!sol.lib}">Custom…</button></div></div>
    <div class="small muted">${esc(sol.label)}</div>
    <p class="note">These charts value pots that see a flop with an equity-realization estimate, fitted to EightMax's own flop solves. For a solved answer, re-solve the spot with real flop, turn and river play for every seat.</p>
    <button class="btn" data-dp-linked="1" ${riverPanel.busy ? 'disabled' : ''}>Re-solve with postflop play</button></div>`;
  if (DP.customOpen) html += renderDeepCustom();
  html += `<div class="card" id="dp-node"><div class="field"><span class="label">First in</span><div class="chips">` +
    P.slice(0, m.n - 1).map((p, s) => `<button class="chip" data-dp-first="${s}" aria-pressed="${w.type === 'dec' && w.lvl === 0 && w.x === s}">${p}</button>`).join('') + `</div></div>`;
  const crumbs = deepCrumbs(m, w.line.filter(e => !e.auto));
  html += `<div class="crumbs"><button data-dp-go="0" class="${w.line.length ? '' : 'cur'}">Start</button>` +
    crumbs.map(c => `<button data-dp-go="${c.i + 1}">${esc(c.text)}</button>`).join('') + `</div>`;
  if (w.type !== 'dec') {
    if (w.type === 'fold') html += `<p class="note">Everyone else folded: ${P[w.winner]} wins the pot.</p></div>`;
    else {
      const who = w.players.map(p => P[p]).join(' vs ');
      html += `<div class="row sb"><h2>${esc(who)} see a flop</h2><span class="small muted num">pot ${fmt(w.pot, 1)} · ${w.allIn ? 'all in' : 'stack ' + fmt(w.left, 1) + ' · SPR ' + fmt(w.spr, 1)}</span></div>`;
      if (w.allIn) html += `<p class="note">The money is all in preflop: there is nothing left to decide.</p>`;
      else if (w.players.length > 2) html += `<p class="note">Three players remain eligible. Transfer their ranges and stacks to a chip-EV flop study.</p><button class="btn primary" data-dp-river="1" ${riverPanel.busy?'disabled':''}>Set up a multiway flop</button>`;

      else html += `<p class="note">Take both ranges, the pot and the stacks to the postflop solver, then pick a flop.</p><div class="row"><button class="btn primary" data-dp-flop="1">Solve a flop from here</button></div>`;
      html += `</div>`;
    }
    v.innerHTML = html; return;
  }
  const facing = w.toCall > 0 && w.lvl > 0;
  html += `<div class="row sb"><h2>${esc(w.position)} to act</h2><span class="small muted num">pot ${fmt(w.pot, 1)}${facing ? ' · to call ' + fmt(w.toCall, 1) : ''}</span></div>`;
  html += `<div class="small muted">Range here: <b class="num">${fmt(w.rangePct, 1)}%</b> of hands${w.lvl === 0 ? '' : ''}</div>`;
  html += `<div class="actbar" aria-hidden="true">${w.actions.map(a => `<i style="width:${a.pct.toFixed(2)}%;background:${deepColor(a.kind)}"></i>`).join('')}</div>`;
  html += `<div class="acts">` + w.actions.map((a, i) => `<button class="act" data-dp-act="${i}" ${a.childType === 'fold' ? 'disabled' : ''}><i style="background:${deepColor(a.kind)}"></i><span class="t">${esc(a.label)}</span><span class="f">${fmt(a.pct, 1)}%</span></button>`).join('') + `</div>`;
  const order = w.actions.map((a, i) => i).sort((x, y) => (w.actions[x].kind === 0) - (w.actions[y].kind === 0) || y - x);
  html += `<div class="gridwrap" id="dp-grid">` + gridHTML(k => {
    const r = w.reach[k];
    if (r < 1e-3) return cellHTML(k, [], { h: 0, dim: true, sel: DP.cell === k });
    const segs = order.map(i => [w.actions[i].kind === 0 ? 'rgba(59,105,196,.55)' : deepColor(w.actions[i].kind), w.freq[i][k]]);
    const play = 1 - w.freq[0][k];
    return cellHTML(k, segs, { h: r, text: play > 0.02 && play < 0.98 ? Math.round(play * 100) : null, sel: DP.cell === k });
  }) + `</div>`;
  html += `<div class="legend">${w.actions.map(a => `<span><i style="background:${deepColor(a.kind)}"></i>${esc(a.label)}</span>`).join('')}</div>`;
  if (DP.cell != null) {
    const k = DP.cell, r = w.reach[k];
    html += `<div class="detail"><div class="row sb"><h3>${EM.CLASS_NAMES[k]}</h3><span class="small muted">${r < 0.999 ? (r < 1e-3 ? 'not in range here' : Math.round(r * 100) + '% still in range') : EM.CLASS_NCOMBOS[k] + ' combos'}</span></div>` +
      (r < 1e-3 ? '' : `<div class="stats">` + w.actions.map((a, i) => `<div class="stat"><span class="label">${esc(a.label)}</span><span class="v" style="color:${deepColor(a.kind)}">${pct(w.freq[i][k], 0)}</span>${i > 0 && Number.isFinite(w.ev[i][k]) ? `<span class="small muted">${m.icm ? fmtS(w.ev[i][k] / sol.total * 100, 2) + '% of pool' : fmtS(w.ev[i][k], 2) + ' bb'} vs ${esc(w.actions[0].label.toLowerCase())}</span>` : ''}</div>`).join('') + `</div>`) + `</div>`;
  } else html += `<p class="note">Tap a hand for its action mix and the EV of each option compared with folding. Cell height shows how much of the hand is still in the range.</p>`;
  html += `</div><p class="note"><b>Approximate preflop model.</b> Up to three players can reach a flop. Uninvolved seats fold to 3-bets. Flop values are estimated using hand strength, position and stack depth. Three-way finish probabilities are estimated from pairs of ranges. ${m.icm ? 'ICM prices each modeled outcome after awarding pots. Heads-up all-ins include ties.' : 'Values are measured in big blinds.'}</p>`;
  v.innerHTML = html;
}
function renderDeepCustom() {
  const c = DP.cfg, D = EM.deepDefaultSizes(+c.stack || 60), icm = c.model === 'icm', perSeat = icm || c.perSeat;
  const val = (k, d) => (c[k] != null && c[k] !== '' ? c[k] : d);
  const pos = EM.pfPositions(c.n);
  return `<div class="card"><h2>Custom preflop spot</h2>
    <div class="field"><span class="label">Payoff</span><div class="seg" role="group" aria-label="Payoff model"><button data-dpc-model="chip" aria-pressed="${!icm}">Chip EV</button><button data-dpc-model="icm" aria-pressed="${icm}">ICM</button></div></div>
    <div class="fields">
      ${perSeat ? '' : `<div class="field"><label class="label" for="dpc-stack">Stack before posting (bb)</label><input id="dpc-stack" type="number" inputmode="decimal" min="5" max="150" step="1" value="${c.stack}"></div>`}
      <div class="field"><label class="label" for="dpc-n">Players</label><select id="dpc-n">${[2, 3, 4, 5, 6, 7, 8].map(x => `<option ${x === c.n ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      <div class="field"><span class="label">Ante</span><span>0.1 bb per dealt player</span></div>
      <div class="field"><label class="label" for="dpc-open">Open to (bb)</label><input id="dpc-open" type="number" inputmode="decimal" min="2" step="0.1" placeholder="${D.open}" value="${val('open', '')}"></div>
      <div class="field"><label class="label" for="dpc-sb">SB open to (bb)</label><input id="dpc-sb" type="number" inputmode="decimal" min="2" step="0.1" placeholder="${D.sbOpen}" value="${val('sbOpen', '')}"></div>
      <div class="field"><label class="label" for="dpc-3ip">3-bet in position (× open)</label><input id="dpc-3ip" type="number" inputmode="decimal" min="2" step="0.05" placeholder="${D.threeBetIP}" value="${val('threeBetIP', '')}"></div>
      <div class="field"><label class="label" for="dpc-3oop">3-bet from blinds (× open)</label><input id="dpc-3oop" type="number" inputmode="decimal" min="2" step="0.05" placeholder="${D.threeBetOOP}" value="${val('threeBetOOP', '')}"></div>
      <div class="field"><label class="label" for="dpc-4">4-bet (× 3-bet)</label><input id="dpc-4" type="number" inputmode="decimal" min="1.8" step="0.05" placeholder="${D.fourBet}" value="${val('fourBet', '')}"></div>
    </div>
    ${icm ? '' : `<label class="small"><input id="dpc-perseat" type="checkbox" ${c.perSeat?'checked':''}> Individual stacks</label>`}
    ${perSeat ? `<div class="field"><span class="label">Stacks before posting (bb, 5–150)</span><div class="seats">${pos.map((p, i) => `<label for="dpc-s${i}">${p}<input id="dpc-s${i}" type="number" inputmode="decimal" min="5" max="150" step="0.5" value="${(c.stacks || [])[i] ?? 25}"></label>`).join('')}</div></div>` : ''}
    ${icm ? `      <div class="fields"><div class="field"><label class="label" for="dpc-pay">Payouts, 1st place first</label><input id="dpc-pay" type="text" value="${esc(c.payouts || '')}" placeholder="30, 20, 14, 11"></div>
        <div class="field"><label class="label" for="dpc-oth">Players at other tables (bb)</label><input id="dpc-oth" type="text" value="${esc(c.others || '')}" placeholder="optional, e.g. 25, 14"></div></div>
      <p class="note">ICM values every result in prize money, including how folding players gain when others clash. Pots that see a flop are valued as if only the pot were at stake, with a model of future betting.</p>` : ''}
    <p class="note">Leave a size empty to use the default for that depth.</p>
    <div class="row"><button class="btn primary" data-dp-solve="1" ${DP.solving ? 'disabled' : ''}>${DP.solving ? 'Solving…' : 'Solve'}</button>
      <span class="small muted num" id="dp-prog">${DP.prog ? `iteration ${DP.prog.it} · ${DP.prog.ex.toFixed(4)} bb/hand local action gain` : (NATIVE ? 'Takes about 1–3 minutes.' : 'Takes about 1–4 minutes; deeper stacks take longer.')}</span>
      ${DP.err ? `<span class="err">${esc(DP.err)}</span>` : ''}</div></div>`;
}
function readDeepCustom() {
  const g = (id) => { const el = $('#' + id); if (!el) return undefined; const x = el.value.trim(); return x === '' ? null : parseFloat(x); };
  const c = DP.cfg, set = (k, v) => { if (v !== undefined) c[k] = v; };
  const ps=$('#dpc-perseat'); if(ps) c.perSeat=ps.checked;
  set('stack', g('dpc-stack')); const nEl = $('#dpc-n'); if (nEl) c.n = parseInt(nEl.value, 10);
  set('open', g('dpc-open')); set('sbOpen', g('dpc-sb')); set('threeBetIP', g('dpc-3ip')); set('threeBetOOP', g('dpc-3oop')); set('fourBet', g('dpc-4'));
  if (!c.stacks) c.stacks = Array(8).fill(+c.stack || 25);
  for (let i = 0; i < 8; i++) { const v = g('dpc-s' + i); if (v != null) c.stacks[i] = v; }
  const pay = $('#dpc-pay'); if (pay) c.payouts = pay.value; const oth = $('#dpc-oth'); if (oth) c.others = oth.value;
  store.set('dp.cfg2', c);
}
async function deepSolveCustom() {
  const c = DP.cfg;
  readDeepCustom();
  DP.err = null;
  const icm = c.model === 'icm';
  let icmCfg = null;
  if (icm || c.perSeat) {
    const st = c.stacks.slice(0,c.n);
    if (st.length !== c.n || st.some(x=>!(x>=5 && x<=150))) { DP.err='Every stack must be between 5 and 150 bb'; render(); return; }
    c.stack=st.reduce((a,b)=>a+b,0)/st.length;
  }
  if (icm) {
    try { icmCfg = { payouts: EM.parseNumberList(c.payouts || ''), others: EM.parseNumberList(c.others || '') }; } catch (e) { DP.err = e.message; render(); return; }
    if (!icmCfg.payouts.length) { DP.err = 'Enter the payouts'; render(); return; }
    if (c.n + icmCfg.others.length > 16) { DP.err = 'ICM handles up to 16 players in total'; render(); return; }
  }
  if (!(c.stack >= 5 && c.stack <= 150)) { DP.err = 'Stack must be between 5 and 150bb'; render(); return; }
  for (const k of ['open', 'sbOpen', 'threeBetIP', 'threeBetOOP', 'fourBet']) if (c[k] != null && !(c[k] > 1)) { DP.err = 'Sizes must be above 1'; render(); return; }
  const cfg = { n: c.n, stack: c.stack, ...EM.MTT_ANTE };
  if (icm || c.perSeat) cfg.stacks = c.stacks.slice(0,c.n);
  if (icm) cfg.icm = icmCfg;
  for (const k of ['open', 'sbOpen', 'threeBetIP', 'threeBetOOP', 'fourBet']) if (c[k] != null) cfg[k] = c[k];
  DP.solving = true; DP.prog = null; render();
  try {
    const r = await call('deep-solve', { cfg },
      (p) => { DP.prog = p; const el = $('#dp-prog'); if (el) el.textContent = `iteration ${p.it} · ${p.ex.toFixed(4)} bb/hand local action gain`; });
    const m = EM.DeepTree(cfg);
    m.load(r.packed); m.evaluate();
    DP.sol = { m, lib: null, cfg, total: icm ? icmCfg.payouts.reduce((a, b) => a + b, 0) : 1,
      label: icm ? `ICM · ${c.n}-handed · stacks ${cfg.stacks.map(x => String(+(+x).toFixed(1))).join(' / ')} · payouts ${icmCfg.payouts.join(', ')}${icmCfg.others.length ? ' · others ' + icmCfg.others.join(', ') : ''} · 0.1 bb ante each` : deepLabel(m, { stack: c.stack, n: c.n, ante: c.ante }) };
    DP.line = []; DP.cell = null; DP.customOpen = false;
  } catch (e) { DP.err = e.message; }
  DP.solving = false; DP.prog = null;
  render();
}

// ============================================================
// NODE LOCKING, SAVED SOLUTIONS
// ============================================================
function lockPanelHTML(info, colors) {
  const L = PO.lockEdit;
  if (!L) {
    return `<div class="row sb">${info.locked ? '<span class="pill lock">Locked strategy</span>' : '<span class="small muted">Force a strategy here and re-solve to find the exploit.</span>'}
      <span class="row" style="gap:6px"><button class="btn" data-po-lockedit="1">${info.locked ? 'Edit lock' : 'Lock strategy'}</button>${info.locked ? '<button class="btn" data-po-unlock="1">Unlock</button>' : ''}</span></div>`;
  }
  return `<div class="lockbar"><div class="field"><span class="label">Paint hands with</span><div class="chips">` +
    info.actions.map((a, i) => `<button class="chip" data-lk-brush="${i}" aria-pressed="${L.brush === i}"><i class="sw" style="background:${colors[i]}"></i>${esc(a.label)}</button>`).join('') +
    `<button class="chip" data-lk-brush="-1" aria-pressed="${L.brush === -1}">Solver mix</button></div></div>
    <div class="row"><button class="btn" data-lk-all="1">Whole range: ${L.brush === -1 ? 'solver mix' : esc(info.actions[L.brush].label)}</button>
      <button class="btn primary" data-lk-apply="1">Apply lock</button><button class="btn ghost" data-lk-cancel="1">Cancel</button></div>
    <p class="note">Tap hands in the grid to force them into the chosen action. Hands you don't paint keep the solver's current mix. After locking, re-solve so the rest of the tree adjusts.</p></div>`;
}
async function applyLock() {
  const info = PO.node, L = PO.lockEdit, q = info.player, nq = PO.combos[q].length, nA = info.actions.length;
  const st = new Float32Array(nA * nq);
  for (let h = 0; h < nq; h++) {
    const k = EM.CLS[PO.combos[q][h]], b = L.cls.has(k) ? L.cls.get(k) : -1;
    for (let a = 0; a < nA; a++) st[a * nq + h] = b >= 0 ? (a === b ? 1 : 0) : info.strategy[a * nq + h];
  }
  try { await Engine.lock(PO.path, st); PO.locksDirty = true; PO.lockEdit = null; await postLoad(PO.path); }
  catch (e) { PO.err = e.message; render(); }
}
async function resolveLocks() {
  PO.stage = 'solving'; PO.prog = { it: 0, ex: null, elapsed: 0 }; PO.err = null; render();
  try {
    const r = await Engine.solve({ target: PO.accuracy, maxIter: PO.maxIter, reset: true }, (m) => { PO.prog = m; renderPostProgress(); });
    PO.result = r; PO.locksDirty = false;
  } catch (e) { PO.err = e.message; }
  PO.stage = 'solved';
  await postLoad(PO.path.length ? PO.path : []);
}
async function refreshSaves() {
  try { PO.saves = await napi('/api/saves'); PO.saves.sort((a, b) => b.time - a.time); } catch (e) { PO.saves = []; PO.err = e.message; }
  render();
}
async function saveSolution() {
  const nm = ($('#po-savename') || {}).value || '';
  try { const r = await napi('/api/save', { name: nm }); PO.msg = 'Saved to ' + r.file; PO.saving = false; }
  catch (e) { PO.err = e.message; }
  render();
}
async function loadSolution(name) {
  try {
    const r = await napi('/api/load', { name });
    const c = r.cfg;
    PO.board = c.board.slice(); PO.pot = c.pot; PO.stack = c.stack;
    PO.ranges = [Float32Array.from(c.ranges[0]), Float32Array.from(c.ranges[1])];
    PO.sizes = { bet: c.sizes.bet.map(x => x.slice()), raise: c.sizes.raise.map(x => x.slice()), donk: Array.isArray(c.sizes.donk) ? c.sizes.donk.slice() : ['', c.sizes.bet[1][0], c.sizes.bet[2][0]] };
    PO.tree = 'custom'; PO.maxBets = c.maxBets || 3; PO.reraise = c.reraise === 'allin' ? 'allin' : 'same'; PO.allinTh = c.forceAllin != null ? +c.forceAllin : 0.2;
    if (c.names) PO.names = c.names.slice();
    PO.payoff = c.icm ? 'icm' : 'chip';
    if (c.icm) PO.icm = { b0: String(c.icm.b0), b1: String(c.icm.b1), others: c.icm.others || '', payouts: c.icm.payouts || '' };
    PO.stats = r.stats; PO.combos = r.combos; PO.cmap = [classMap(r.combos[0]), classMap(r.combos[1])];
    PO.solvedCfg = c; PO.stage = 'solved'; PO.setupOpen = false; PO.locksDirty = false;
    PO.result = { it: r.it, ex: r.ex, chips: NaN, elapsed: 0, stopped: false, engine: 'saved', loaded: name };
    PO.msg = 'Loaded "' + name + '". Saved solutions are view-only; Re-solve to keep improving them.';
    await postLoad([]);
  } catch (e) { PO.err = e.message; render(); }
}
async function deleteSolution(name) {
  try { await napi('/api/delete', { name }); } catch (e) { PO.err = e.message; }
  refreshSaves();
}

// ============================================================
// REPORTS
// ============================================================
const RP = { size: store.get('rp.size', 49), acc: store.get('rp.acc', 1), maxIter: 400, running: false, flops: [], rows: [], current: null, err: null, group: 'high', sort: 'flop', spotLabel: '' };
async function reportStart() {
  if (PO.stage === 'solving' || PO.stage === 'building') { RP.err = 'Wait for the postflop solve to finish, or stop it.'; render(); return; }
  RP.flops = EM.flopSubset(RP.size); RP.rows = []; RP.current = null; RP.err = null; RP.running = true; RP.t0 = Date.now();
  RP.spotLabel = `${PO.names[1]} vs ${PO.names[0]} · pot ${fmt(PO.pot, 1)} · stack ${fmt(PO.stack, 1)} · ${treeName()} sizes`;
  render();
  try {
    const cfg = postCfg(RP.flops[0].cards);
    await Engine.report(cfg, RP.flops.map(f => f.cards.concat(f.w)), RP.acc, RP.maxIter,
      (row) => { const f = RP.flops[RP.rows.length]; RP.rows.push(Object.assign(row, { weight: f ? f.w : row.weight, tags: f ? f.tags : EM.flopTags(row.board) })); if (tab === 'reports') render(); },
      (cur) => { RP.current = cur; const el = $('#rp-cur'); if (el) el.innerHTML = curText(); });
  } catch (e) { RP.err = e.message; }
  RP.running = false; RP.current = null;
  render();
}
function curText() {
  const c = RP.current;
  if (!c || !c.flop) return '';
  return `Now: ${c.flop.map(cardText).join('')} · iteration ${c.it}${c.ex != null ? ' · ' + fmt(c.ex, 2) + '%' : ''}`;
}
function repActions() {
  const r = RP.rows.find(x => x.afterCheck) ; return r ? r.afterCheck.actions : [];
}
function repAgg(rows) {
  const acts = repActions(), nA = acts.length, F = new Float64Array(nA);
  let W = 0, Wa = 0, eq = 0, ev = 0, pot = 0;
  for (const r of rows) {
    const w = r.weight || 1;
    W += w;
    if (r.root) { eq += w * r.root.eqAvg; ev += w * r.root.evAvg; pot = r.root.pot || pot; }
    if (r.afterCheck && r.afterCheck.freq.length === nA) { Wa += w; for (let a = 0; a < nA; a++) F[a] += w * r.afterCheck.freq[a]; }
  }
  return { n: rows.length, freq: Array.from(F, x => (Wa ? x / Wa : 0)), eq: W ? eq / W : NaN, ev: W ? ev / W : NaN, pot };
}
function mixBar(acts, freq) {
  const colors = actColors(acts);
  return `<div class="mbar">${acts.map((a, i) => `<i style="width:${(freq[i] * 100).toFixed(1)}%;background:${colors[i]}"></i>`).join('')}</div>`;
}
const betShare = (acts, freq) => acts.reduce((t, a, i) => t + (a.kind >= 3 ? freq[i] : 0), 0);
function renderReports() {
  const v = $('#v-reports');
  const acts = repActions();
  const est = RP.rows.length ? (Date.now() - RP.t0) / 1000 / RP.rows.length : null;
  let html = `<div class="card"><h2>Flop reports</h2>
    <p class="note">Solves the spot from the <b>Postflop</b> tab (same ranges, pot, stack and bet sizes) on a set of flops chosen to match how often each texture comes up, then charts the in-position player's strategy after a check.</p>
    <div class="small"><b>${esc(PO.names[1])}</b> (IP) vs <b>${esc(PO.names[0])}</b> (OOP) · pot ${fmt(PO.pot, 1)}bb · stack ${fmt(PO.stack, 1)}bb · ${treeName()} sizes · ranges ${fmt(EM.rangeStats(PO.ranges[0]).pct, 0)}% / ${fmt(EM.rangeStats(PO.ranges[1]).pct, 0)}%</div>
    <div class="field"><span class="label">Flops</span><div class="seg" role="group" aria-label="Number of flops">${[25, 49, 95, 184, 1755].map(x => `<button data-rp-size="${x}" aria-pressed="${RP.size === x}" ${RP.running ? 'disabled' : ''}>${x === 1755 ? 'All 1,755' : x}</button>`).join('')}</div></div>
    <div class="field"><span class="label">Accuracy per flop</span><div class="seg" role="group" aria-label="Accuracy">${[[2, '2%'], [1, '1%'], [0.5, '0.5%']].map(([a, l]) => `<button data-rp-acc="${a}" aria-pressed="${RP.acc === a}" ${RP.running ? 'disabled' : ''}>${l}</button>`).join('')}</div></div>
    <div class="row">${RP.running ? '<button class="btn" data-rp-stop="1">Stop</button>' : `<button class="btn primary big" data-rp-start="1">Run report</button>`}
      ${RP.rows.length && !RP.running ? '<button class="btn" data-rp-csv="1">' + (NATIVE ? 'Download CSV' : 'Copy CSV') + '</button>' : ''}
      ${RP.err ? `<span class="err">${esc(RP.err)}</span>` : ''}</div>
    ${!NATIVE ? '<p class="note">In the browser each flop takes about a minute with the Fast tree. The EightMax Windows app runs reports on every CPU core.</p>' : ''}`;
  if (RP.running || RP.rows.length) {
    html += `<div class="prog"><i style="width:${(RP.rows.length / Math.max(1, RP.flops.length) * 100).toFixed(1)}%"></i></div>
      <div class="row sb small num"><span>${RP.rows.length} / ${RP.flops.length} flops${est && RP.running ? ` · about ${fmtDur(est * (RP.flops.length - RP.rows.length))} left` : ''}</span><span id="rp-cur">${RP.running ? curText() : ''}</span></div>`;
  }
  html += `</div>`;
  if (RP.rows.length && acts.length) {
    const all = repAgg(RP.rows);
    html += `<div class="card"><div class="row sb"><h2>${esc(PO.names[1])} after ${esc(PO.names[0])} checks</h2><span class="small muted">${all.n} flops, weighted by frequency</span></div>
      <div class="stats"><div class="stat"><span class="label">Bets</span><span class="v">${pct(betShare(acts, all.freq))}</span></div>
        ${acts.map((a, i) => a.kind >= 3 ? `<div class="stat"><span class="label">${esc(a.label)}${a.pctPot != null ? ' (' + a.pctPot + '%)' : ''}</span><span class="v">${pct(all.freq[i])}</span></div>` : '').join('')}
        <div class="stat"><span class="label">${esc(PO.names[0])} equity</span><span class="v">${pct(all.eq)}</span></div>
        <div class="stat"><span class="label">${esc(PO.names[0])} EV</span><span class="v">${fmt(all.ev, 2)} <span class="small muted">${PO.payoff === 'icm' ? '$' : 'bb'}</span></span></div></div>
      ${mixBar(acts, all.freq)}
      <div class="legend">${acts.map((a, i) => `<span><i style="background:${actColors(acts)[i]}"></i>${esc(a.label)}</span>`).join('')}</div>
      <div class="field"><span class="label">Group by</span><div class="seg" role="group" aria-label="Group by">${[['high', 'High card'], ['suits', 'Suits'], ['paired', 'Pairing'], ['conn', 'Connected']].map(([g, l]) => `<button data-rp-group="${g}" aria-pressed="${RP.group === g}">${l}</button>`).join('')}</div></div>`;
    const groups = new Map();
    for (const r of RP.rows) { const k = r.tags[RP.group]; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    const order = RP.group === 'high' ? ['A-high', 'K-high', 'Q-high', 'J-high', 'T-high', '9-high or lower'] : Array.from(groups.keys()).sort();
    html += `<div class="rgroups">` + order.filter(k => groups.has(k)).map(k => {
      const g = repAgg(groups.get(k));
      return `<div class="rg"><span class="t">${esc(k)} <span class="muted small">${g.n}</span></span>${mixBar(acts, g.freq)}<span class="num small">bet ${pct(betShare(acts, g.freq), 0)} · eq ${pct(g.eq, 0)}</span></div>`;
    }).join('') + `</div></div>`;
    const rows = RP.rows.slice();
    if (RP.sort === 'bet') rows.sort((a, b) => betShare(acts, b.afterCheck ? b.afterCheck.freq : []) - betShare(acts, a.afterCheck ? a.afterCheck.freq : []));
    else if (RP.sort === 'eq') rows.sort((a, b) => (b.root ? b.root.eqAvg : 0) - (a.root ? a.root.eqAvg : 0));
    html += `<div class="card"><div class="row sb"><h2>By flop</h2><div class="seg" role="group" aria-label="Sort">${[['flop', 'Rank'], ['bet', 'Bet %'], ['eq', 'OOP equity']].map(([k, l]) => `<button data-rp-sort="${k}" aria-pressed="${RP.sort === k}">${l}</button>`).join('')}</div></div>
      <div class="scrollx"><table class="tbl rtbl"><thead><tr><th>Flop</th><th>${esc(PO.names[1])} after check</th><th>Bet</th><th>OOP eq</th><th>OOP EV</th><th>Acc.</th></tr></thead><tbody>` +
      rows.map(r => `<tr><td>${boardHTML(r.board, 'mini')}</td><td style="min-width:110px">${r.afterCheck ? mixBar(acts, r.afterCheck.freq) : '–'}</td><td>${r.afterCheck ? pct(betShare(acts, r.afterCheck.freq), 0) : '–'}</td><td>${r.root ? pct(r.root.eqAvg, 1) : '–'}</td><td>${r.root ? fmt(r.root.evAvg, 2) : '–'}</td><td>${fmt(r.ex, 2)}%</td></tr>`).join('') +
      `</tbody></table></div></div>`;
  }
  v.innerHTML = html;
}
function fmtDur(sec) { return sec >= 5400 ? (sec / 3600).toFixed(1) + ' h' : sec >= 90 ? Math.round(sec / 60) + ' min' : Math.round(sec) + ' s'; }
function reportCSV() {
  const acts = repActions();
  const head = ['flop', 'weight'].concat(acts.map(a => 'ip_' + a.label.toLowerCase().replace(/[^a-z0-9.]+/g, '_')), ['oop_equity', 'oop_ev_bb', 'ip_equity', 'ip_ev_bb', 'exploitability_pct', 'iterations']);
  const lines = [head.join(',')];
  for (const r of RP.rows) {
    const b = r.board.map(c => EM.cardStr(c)).join('');
    lines.push([b, (r.weight || 1).toFixed(2)].concat(acts.map((a, i) => r.afterCheck ? r.afterCheck.freq[i].toFixed(4) : ''),
      [r.root ? r.root.eqAvg.toFixed(4) : '', r.root ? r.root.evAvg.toFixed(3) : '', r.root ? r.root.eqOpp.toFixed(4) : '', r.root ? r.root.evOpp.toFixed(3) : '', (+r.ex).toFixed(3), r.it]).join(','));
  }
  return lines.join('\n');
}

// ============================================================
// render + events
// ============================================================
function render() {
  if (tab === 'preflop') renderPreflop();
  else if (tab === 'postflop') renderPostflop();
  else if (tab === 'river') riverPanel.render();
  else if (tab === 'reports') renderReports();
  else if (tab === 'trainer') renderTrainer();
  else renderICM();
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.closest('#sheet')) return;
  const d = b.dataset;
  if (d.tab) { setTab(d.tab, true); return; }
  // preflop
  if (d.pfSrc) { PF.source = d.pfSrc; PF.cell = null; DP.cell = null; render(); return; }
  if (d.pfStep) { const i = CH.stacks.indexOf(PF.stack); PF.stack = CH.stacks[Math.max(0, Math.min(CH.stacks.length - 1, i + (+d.pfStep)))]; store.set('pf.stack', PF.stack); render(); return; }
  if (d.pfHero) { PF.hero = +d.pfHero; if (PF.facing >= PF.hero) PF.facing = -1; render(); return; }
  if (d.pfFacing) { PF.facing = +d.pfFacing; render(); return; }
  if (d.pfView) { PF.view = d.pfView; render(); return; }
  if (b.classList.contains('cell') && b.closest('#pf-grid')) { const k = +d.k; PF.cell = PF.cell === k ? null : k; render(); return; }
  if (d.pfcN) { readCustom(); PF.cfg.n = +d.pfcN; while (PF.cfg.stacks.length < 8) PF.cfg.stacks.push(20); render(); return; }
  if (d.pfcAll) { readCustom(); const x = parseFloat($('#pfc-all').value); if (x > 0) PF.cfg.stacks = PF.cfg.stacks.map(() => x); render(); return; }
  if (d.pfcOvercall) { pfToShove(); return; }
  if (d.pfcAnte) { readCustom(); PF.cfg.anteType = d.pfcAnte; PF.cfg.ante = d.pfcAnte === 'bba' ? 1 : d.pfcAnte === 'classic' ? 0.1 : 0; store.set('pf.cfg', PF.cfg); render(); return; }
  if (d.pfcModel) { readCustom(); PF.cfg.model = d.pfcModel; render(); return; }
  if (d.pfcFgs !== undefined) { readCustom(); PF.cfg.fgs = +d.pfcFgs; store.set('pf.cfg', PF.cfg); render(); return; }
  if (d.pfcBk) { readCustom(); PF.cfg.bountyKind = d.pfcBk; if (d.pfcBk !== 'none' && !(PF.cfg.bounties || []).some(x => x > 0)) PF.cfg.bounties = Array(8).fill(10); store.set('pf.cfg', PF.cfg); render(); return; }
  if (d.pfcSolve) { pfSolveCustom(); return; }
  // postflop
  if (d.poBoard) { readPostSetup(); openBoardPicker(); return; }
  if (d.poRand) { readPostSetup(); PO.board = randomCards(3); render(); return; }
  if (d.poRange) { readPostSetup(); openRangeEditor(+d.poRange); return; }
  if (d.poRaiser) { readPostSetup(); PO.raiser = d.poRaiser; if (TREES[PO.tree]) setTree(PO.tree); render(); return; }
  if (d.poRr) { readPostSetup(); if (PO.reraise !== d.poRr) { PO.reraise = d.poRr; szMarkCustom(); PO.est = null; saveTree(); } render(); return; }
  if (d.szc != null) { szToggle(d.szc); return; }
  if (d.poEst) { postEstimate(); return; }
  if (d.poAcc) { readPostSetup(); PO.accuracy = +d.poAcc; render(); return; }
  if (d.poIso) { readPostSetup(); PO.iso = d.poIso === '1'; store.set('po.iso', PO.iso); render(); return; }
  if (d.poGpu) { readPostSetup(); PO.gpu = d.poGpu === '1'; store.set('po.gpu', PO.gpu); render(); return; }
  if (d.poPower) { readPostSetup(); PO.power = +d.poPower; store.set('po.power', PO.power); render(); return; }
  if (d.poBk) { readPostSetup(); PO.icm.bountyKind = d.poBk; if (d.poBk !== 'none') { if (!(parseFloat(PO.icm.bb0) > 0)) PO.icm.bb0 = '10'; if (!(parseFloat(PO.icm.bb1) > 0)) PO.icm.bb1 = '10'; } store.set('po.icm', PO.icm); render(); return; }
  if (d.poPay) { readPostSetup(); PO.payoff = d.poPay; store.set('po.payoff', PO.payoff); if (PO.payoff === 'icm') readPostSetup(); render(); return; }
  if (d.poSolve) { postSolve(); return; }
  if (d.poStop) { Engine.stop(); return; }
  if (d.poPeek) { postLoad(PO.path); return; }
  if (d.poHide) { readPostSetup(); PO.setupOpen = false; render(); return; }
  if (d.poShow) { PO.setupOpen = true; render(); return; }
  if (d.poAct && !PO.busy) { postLoad(PO.path.concat(+d.poAct)); return; }
  if (d.poGo && !PO.busy) { postLoad(PO.path.slice(0, +d.poGo)); return; }
  if (d.poCard && !PO.busy) { postLoad(PO.path.concat(+d.poCard)); return; }
  if (d.poRunouts && !PO.busy) { loadRunouts(); return; }
  if (d.poRosort && PO.ro) { PO.ro.sort = d.poRosort; render(); return; }
  if (d.poRandcard && !PO.busy && PO.node && PO.node.cards) {
    const pool = PO.node.cards.filter(c => !(PO.hand && PO.hand.cards.includes(c)));
    if (pool.length) postLoad(PO.path.concat(pool[(Math.random() * pool.length) | 0]));
    return;
  }
  if (d.ptStart) { PT.on = true; PT.seat = PO.hand ? PO.hand.player : PO.seat; PT.hero = -1; PT.node = null; PT.err = null; render(); return; }
  if (d.ptExit) { PT.on = false; render(); return; }
  if (d.ptSeat && !PT.busy) { PT.seat = +d.ptSeat; PT.hero = -1; PT.node = null; render(); return; }
  if (d.ptDeal && !PT.busy) { ptNewHand(); return; }
  if (d.ptAct && !PT.busy && !PT.fb) { ptAnswer(+d.ptAct); return; }
  if (d.ptNext && !PT.busy && PT.fb) { PT.path.push(PT.fb.a); PT.fb = null; ptAdvance(); return; }
  if (d.ptReset) { PT.stats = { hands: 0, dec: 0, loss: 0, best: 0 }; store.set('pt.stats', PT.stats); render(); return; }
  if (d.poHand) { readPostSetup(); openHandPicker(d.poHand === 'node' && PO.node ? PO.node.board : PO.board); return; }
  if (d.poHandclear) { readPostSetup(); PO.hand = null; saveHand(); render(); return; }
  if (d.poHandadd) { addHandToRange(); return; }
  if (d.poWho) { PO.who = d.poWho; PO.cell = null; render(); return; }
  if (d.poView) { PO.view = d.poView; render(); return; }
  if (b.classList.contains('cell') && b.closest('#po-grid')) {
    const k = +d.k;
    if (PO.lockEdit) { PO.lockEdit.cls.set(k, PO.lockEdit.brush); render(); return; }
    PO.cell = PO.cell === k ? null : k; render(); return;
  }
  if (d.poLockedit) { PO.lockEdit = { brush: PO.node.actions.findIndex(a => a.kind === 1 || a.kind === 2) >= 0 ? PO.node.actions.findIndex(a => a.kind === 1 || a.kind === 2) : 0, cls: new Map() }; PO.view = 'strategy'; PO.who = 'act'; render(); return; }
  if (d.lkBrush) { PO.lockEdit.brush = +d.lkBrush; render(); return; }
  if (d.lkAll) { for (let k = 0; k < NC; k++) PO.lockEdit.cls.set(k, PO.lockEdit.brush); render(); return; }
  if (d.lkCancel) { PO.lockEdit = null; render(); return; }
  if (d.lkApply) { applyLock(); return; }
  if (d.poUnlock) { Engine.lock(PO.path, null).then(() => { PO.locksDirty = true; return postLoad(PO.path); }).catch(e => { PO.err = e.message; render(); }); return; }
  if (d.poResolve) { resolveLocks(); return; }
  if (d.poSave) { PO.saving = true; PO.msg = ''; render(); const el = $('#po-savename'); if (el) { el.focus(); el.select(); } return; }
  if (d.poSavecancel) { PO.saving = false; render(); return; }
  if (d.poSavego) { saveSolution(); return; }
  if (d.poLoad) { loadSolution(d.poLoad); return; }
  if (d.poDel) { deleteSolution(d.poDel); return; }
  // open-raise model
  if (d.dpStack) { DP.stack = +d.dpStack; store.set('dp.stack', DP.stack); DP.sol = deepLib(DP.stack); DP.cell = null; DP.customOpen = false; render(); return; }
  if (d.dpFirst) { const m = deepSol().m; DP.line = m.view(m.firstIn(+d.dpFirst)).line.filter(e => !e.auto); DP.cell = null; render(); return; }
  if (d.dpGo) { DP.line = DP.line.slice(0, Math.max(0, +d.dpGo - 1)); const m = deepSol().m; const full = m.view(m.follow(DP.line.map(e => e.label))).line; DP.line = full.filter(e => !e.auto); DP.cell = null; render(); return; }
  if (d.dpAct) { const m = deepSol().m, w = m.view(m.follow(DP.line.map(e => e.label))), a = w.actions[+d.dpAct]; if (a && a.childType !== 'fold') { DP.line = m.view(a.child).line.filter(e => !e.auto); DP.cell = null; render(); } return; }
  if (d.dpWide25 && !riverPanel.busy) {
    transferMultiway(deepLib(25).m,[...Array(5).fill('Fold'),'Raise 2','Call 1.5','Call 1'],true);return;
  }
  if (d.dpRiver) { deepToRiver(); return; }
  if (d.dpLinked) { deepToLinked(); return; }
  if (d.dpFlop) { deepToPostflop(); return; }
  if (d.dpcModel) { readDeepCustom(); DP.cfg.model = d.dpcModel; if (d.dpcModel === 'icm') { if (!DP.cfg.payouts) DP.cfg.payouts = '30, 20, 14, 11, 9, 7, 5, 4'; DP.cfg.stacks = (DP.cfg.stacks || Array(8).fill(25)).map(x => Math.min(150, Math.max(5, x || 25))); } store.set('dp.cfg2', DP.cfg); render(); return; }
  if (d.dpCustom) { DP.customOpen = !DP.customOpen; render(); return; }
  if (d.dpSolve) { deepSolveCustom(); return; }
  if (b.classList.contains('cell') && b.closest('#dp-grid')) { const k = +d.k; DP.cell = DP.cell === k ? null : k; render(); return; }
  // reports
  if (d.rpSize) { RP.size = +d.rpSize; store.set('rp.size', RP.size); render(); return; }
  if (d.rpAcc) { RP.acc = +d.rpAcc; store.set('rp.acc', RP.acc); render(); return; }
  if (d.rpStart) { reportStart(); return; }
  if (d.rpStop) { Engine.reportStop(); return; }
  if (d.rpGroup) { RP.group = d.rpGroup; render(); return; }
  if (d.rpSort) { RP.sort = d.rpSort; render(); return; }
  if (d.rpCsv) {
    const csv = reportCSV();
    if (NATIVE) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'eightmax-flop-report.csv'; document.body.appendChild(a); a.click(); a.remove(); }
    else navigator.clipboard.writeText(csv).then(() => { RP.err = null; b.textContent = 'Copied'; }).catch(() => { RP.err = 'Copy was blocked by the browser'; render(); });
    return;
  }
  // trainer
  if (d.trMode) { TR.mode = d.trMode; store.set('tr.cfg', { mode: TR.mode, minS: TR.minS, maxS: TR.maxS }); trNew(); render(); return; }
  if (d.trGo) { trAnswer(d.trGo === '1'); return; }
  if (d.trNext) { trNew(); render(); return; }
  if (d.trReset) { TR.stats = { n: 0, ok: 0, loss: 0 }; store.set('tr.stats', TR.stats); render(); return; }
  // icm
  if (d.icSend) {
    const stacks = EM.parseNumberList(IC.stacks), pays = EM.parseNumberList(IC.payouts);
    const n = Math.min(8, stacks.length);
    PF.cfg.n = n; PF.cfg.stacks = stacks.slice(0, n).concat(Array(8 - n).fill(20)); PF.cfg.model = 'icm';
    PF.cfg.payouts = pays.join(', '); PF.cfg.others = stacks.slice(n).join(', ');
    PF.source = 'custom'; store.set('pf.cfg', PF.cfg);
    setTab('preflop', true);
  }
});
document.addEventListener('focusin', (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.sz && t.id !== PO.szFocus) { PO.szFocus = t.id; const c = $('#po-szchips'); if (c) c.innerHTML = szChipsHTML(); }
});
// size chips keep the box focused on desktop
document.addEventListener('mousedown', (e) => { if (e.target.closest && e.target.closest('[data-szc]')) e.preventDefault(); });
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.sz) {
    const sl = szSlot(t.id); if (sl) sl.arr[sl.i] = t.value;
    szMarkCustom(); PO.est = null; saveTree();
    const c = $('#po-szchips'); if (c) c.innerHTML = szChipsHTML();
    const x = $('#po-est'); if (x) x.innerHTML = '';
    return;
  }
  if (t.id === 'pf-stack') { PF.stack = +t.value; store.set('pf.stack', PF.stack); render(); }
  else if (t.id === 'ic-st' || t.id === 'ic-pay') {
    IC.stacks = $('#ic-st').value; IC.payouts = $('#ic-pay').value; store.set('icm', { stacks: IC.stacks, payouts: IC.payouts });
    const pos = t.selectionStart, id = t.id; renderICM(); const el = $('#' + id); el.focus(); try { el.setSelectionRange(pos, pos); } catch (x) { /* ignore */ }
  }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id==='dpc-perseat' || t.id==='dpc-n') { readDeepCustom(); render(); return; }
  if (t.id === 'po-preset' && +t.value >= 0) { loadPreset(+t.value); render(); }
  else if (t.id === 'po-tree') { readPostSetup(); PO.treePicked = true; if (t.value === 'custom') { PO.tree = 'custom'; saveTree(); } else setTree(t.value); render(); }
  else if (t.id === 'po-maxbets' || t.id === 'po-allin') { readPostSetup(); PO.est = null; render(); }
  else if (t.id === 'po-pot' || t.id === 'po-stack' || t.id === 'po-b0' || t.id === 'po-b1' || t.id === 'po-others' || t.id === 'po-payouts') { readPostSetup(); render(); }
  else if (t.id === 'tr-min' || t.id === 'tr-max') {
    TR.minS = Math.max(3, Math.min(25, parseInt($('#tr-min').value, 10) || 5)); TR.maxS = Math.max(TR.minS, Math.min(25, parseInt($('#tr-max').value, 10) || 15));
    store.set('tr.cfg', { mode: TR.mode, minS: TR.minS, maxS: TR.maxS }); trNew(); render();
  }
});
document.addEventListener('toggle', (e) => {
  if (e.target.id === 'pf-setup') PF.setupOpen = e.target.open;
  if (e.target.id === 'po-szedit') PO.szOpen = e.target.open;
  if (e.target.id === 'po-saves') { const was = !!PO.savesOpen; PO.savesOpen = e.target.open; if (e.target.open && !was) refreshSaves(); }
}, true);
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });
window.addEventListener('hashchange', () => setTab(location.hash.slice(1), false));

startWorker();
$('#engine').textContent = W.inline ? 'main-thread mode' : (typeof WebAssembly !== 'undefined' ? 'WASM SIMD engine' : 'JS engine');
if (NATIVE) {
  napi('/api/info').then((info) => {
    NINFO = info;
    DEVICE = { mobile: false, compressAboveMB: Math.max(1500, info.ramMB * 0.45), limitMB: Math.max(2000, info.ramMB * 0.78) };
    $('#engine').textContent = `Native · ${info.threads} threads · ${Math.round(info.ramMB / 1024)} GB${info.gpu && info.gpu.available ? ' · GPU' : ''}`;
    if (info.gpu) $('#engine').title = info.gpu.available ? 'GPU: ' + info.gpu.device : 'No GPU: ' + info.gpu.device;
    render();
  }).catch(() => { $('#engine').textContent = 'Native engine not responding'; });
  setInterval(() => { fetch('/api/status').then(r => { if (!r.ok) throw new Error(); $('#engine').classList.remove('off'); }).catch(() => { $('#engine').textContent = 'EightMax.exe closed'; $('#engine').classList.add('off'); }); }, 5000);
}
setTab(location.hash.slice(1) || 'preflop', false);
})();
