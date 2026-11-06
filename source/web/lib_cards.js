(function (EM) {
'use strict';
// Cards: id = rank*4 + suit. rank 0 = deuce ... 12 = ace. suit 0..3 = c d h s.
const GR = 'AKQJT98765432';           // grid order (index 0 = ace)
const RC = '23456789TJQKA';           // card rank chars
const SC = 'cdhs';
const SUIT_SYM = ['♣', '♦', '♥', '♠'];

function cardStr(c) { return RC[c >> 2] + SC[c & 3]; }
function parseCard(s) {
  if (!s || s.length < 2) return -1;
  const r = RC.indexOf(s[0].toUpperCase()), su = SC.indexOf(s[1].toLowerCase());
  return (r < 0 || su < 0) ? -1 : r * 4 + su;
}
function parseBoard(str) {
  const t = (str || '').replace(/[\s,]+/g, '');
  const out = [];
  for (let i = 0; i + 1 < t.length; i += 2) {
    const c = parseCard(t.slice(i, i + 2));
    if (c < 0) throw new Error('Bad card "' + t.slice(i, i + 2) + '"');
    if (out.includes(c)) throw new Error('Duplicate card ' + cardStr(c));
    out.push(c);
  }
  if (t.length % 2) throw new Error('Incomplete card in board');
  return out;
}

function classOf(c1, c2) {
  let r1 = c1 >> 2, r2 = c2 >> 2;
  const suited = (c1 & 3) === (c2 & 3);
  if (r1 < r2) { const t = r1; r1 = r2; r2 = t; }
  const hi = 12 - r1, lo = 12 - r2;
  if (r1 === r2) return hi * 13 + hi;
  return suited ? hi * 13 + lo : lo * 13 + hi;
}

const C1 = new Uint8Array(1326), C2 = new Uint8Array(1326), CLS = new Uint8Array(1326);
const PIDX = new Int16Array(52 * 52).fill(-1);
{
  let k = 0;
  for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) {
    C1[k] = a; C2[k] = b; CLS[k] = classOf(a, b); PIDX[a * 52 + b] = k; PIDX[b * 52 + a] = k; k++;
  }
}
const CLASS_COMBOS = Array.from({ length: 169 }, () => []);
for (let i = 0; i < 1326; i++) CLASS_COMBOS[CLS[i]].push(i);
const CLASS_NCOMBOS = CLASS_COMBOS.map(a => a.length);

function className(k) {
  const r = (k / 13) | 0, c = k % 13;
  if (r === c) return GR[r] + GR[r];
  return r < c ? GR[r] + GR[c] + 's' : GR[c] + GR[r] + 'o';
}
const CLASS_NAMES = Array.from({ length: 169 }, (_, k) => className(k));
function comboStr(i) { return cardStr(C2[i]) + cardStr(C1[i]); }

// ---- range notation ----
function gi(ch) { return GR.indexOf(ch.toUpperCase()); }
function setClass(w, cls, val) { for (const i of CLASS_COMBOS[cls]) w[i] = val; }

function applyToken(tok, val, w) {
  if (/^(random|any)$/i.test(tok)) { w.fill(val); return; }
  let m = /^([2-9TJQKA][cdhs])([2-9TJQKA][cdhs])$/i.exec(tok);
  if (m) {
    const a = parseCard(m[1]), b = parseCard(m[2]);
    if (a < 0 || b < 0 || a === b) throw new Error('Bad combo "' + tok + '"');
    w[PIDX[a * 52 + b]] = val; return;
  }
  m = /^([2-9TJQKA])([2-9TJQKA])([so]?)-([2-9TJQKA])([2-9TJQKA])([so]?)$/i.exec(tok);
  if (m) {
    const a1 = gi(m[1]), a2 = gi(m[2]), b1 = gi(m[4]), b2 = gi(m[5]);
    const s = (m[3] || m[6] || '').toLowerCase();
    if (a1 === a2 && b1 === b2) { // pair range
      for (let r = Math.min(a1, b1); r <= Math.max(a1, b1); r++) setClass(w, r * 13 + r, val);
      return;
    }
    const hiA = Math.min(a1, a2), loA = Math.max(a1, a2), hiB = Math.min(b1, b2), loB = Math.max(b1, b2);
    if (hiA === loA || hiB === loB) throw new Error('Bad range "' + tok + '"');
    const list = [];
    if (hiA === hiB) { for (let k = Math.min(loA, loB); k <= Math.max(loA, loB); k++) if (k > hiA) list.push([hiA, k]); }
    else if (loA - hiA === loB - hiB) { const g = loA - hiA; for (let h = Math.min(hiA, hiB); h <= Math.max(hiA, hiB); h++) list.push([h, h + g]); }
    else throw new Error('Bad range "' + tok + '"');
    for (const [h, l] of list) {
      if (s !== 'o') setClass(w, h * 13 + l, val);
      if (s !== 's') setClass(w, l * 13 + h, val);
    }
    return;
  }
  m = /^([2-9TJQKA])([2-9TJQKA])([so]?)(\+?)$/i.exec(tok);
  if (m) {
    const a = gi(m[1]), b = gi(m[2]), s = m[3].toLowerCase(), plus = m[4] === '+';
    if (a === b) {
      if (s) throw new Error('Pairs have no suit: "' + tok + '"');
      if (plus) for (let r = 0; r <= a; r++) setClass(w, r * 13 + r, val);
      else setClass(w, a * 13 + a, val);
      return;
    }
    const hi = Math.min(a, b), lo = Math.max(a, b);
    const ks = plus ? Array.from({ length: lo - hi }, (_, t) => hi + 1 + t) : [lo];
    for (const k of ks) {
      if (s !== 'o') setClass(w, hi * 13 + k, val);
      if (s !== 's') setClass(w, k * 13 + hi, val);
    }
    return;
  }
  throw new Error('Could not read "' + tok + '"');
}

function parseRange(str) {
  const w = new Float32Array(1326);
  const tokens = (str || '').split(/[\s,;]+/).filter(Boolean);
  for (const t0 of tokens) {
    let tok = t0, val = 1;
    const ci = tok.indexOf(':');
    if (ci >= 0) {
      val = parseFloat(tok.slice(ci + 1));
      if (!(val >= 0)) throw new Error('Bad weight in "' + t0 + '"');
      if (val > 1) val /= 100;
      if (val > 1) val = 1;
      tok = tok.slice(0, ci);
    }
    applyToken(tok, val, w);
  }
  return w;
}

function fmtW(v) { return (Math.round(v * 1000) / 1000).toString(); }

// per-combo weights -> compact notation
function rangeToString(w) {
  const parts = [];
  const cw = new Float64Array(169).fill(-1); // uniform class weight, or -1 if mixed per combo
  const singles = [];
  for (let k = 0; k < 169; k++) {
    const cs = CLASS_COMBOS[k];
    const v = w[cs[0]];
    let same = true;
    for (const i of cs) if (Math.abs(w[i] - v) > 1e-4) { same = false; break; }
    if (same) cw[k] = v;
    else { cw[k] = 0; for (const i of cs) if (w[i] > 1e-4) singles.push(i); }
  }
  const tag = v => (v >= 0.9995 ? '' : ':' + fmtW(v));
  // pairs
  let r = 0;
  while (r < 13) {
    const v = cw[r * 13 + r];
    if (v <= 1e-4) { r++; continue; }
    let e = r;
    while (e + 1 < 13 && Math.abs(cw[(e + 1) * 13 + e + 1] - v) < 1e-4) e++;
    const lo = GR[e] + GR[e];
    if (r === 0 && e > 0) parts.push(lo + '+' + tag(v));
    else if (r === e) parts.push(lo + tag(v));
    else parts.push(GR[r] + GR[r] + '-' + lo + tag(v));
    r = e + 1;
  }
  for (const suf of ['s', 'o']) {
    for (let hi = 0; hi < 12; hi++) {
      let k = hi + 1;
      const idx = kk => (suf === 's' ? hi * 13 + kk : kk * 13 + hi);
      while (k < 13) {
        const v = cw[idx(k)];
        if (v <= 1e-4) { k++; continue; }
        let e = k;
        while (e + 1 < 13 && Math.abs(cw[idx(e + 1)] - v) < 1e-4) e++;
        const nm = kk => GR[hi] + GR[kk] + suf;
        if (k === hi + 1 && e > k) parts.push(nm(e) + '+' + tag(v));
        else if (k === e) parts.push(nm(k) + tag(v));
        else parts.push(nm(k) + '-' + nm(e) + tag(v));
        k = e + 1;
      }
    }
  }
  for (const i of singles) parts.push(comboStr(i) + tag(w[i]));
  return parts.join(',');
}

function rangeStats(w) { // combos and % of all 1326
  let s = 0; for (let i = 0; i < 1326; i++) s += w[i];
  return { combos: s, pct: s / 1326 * 100 };
}

Object.assign(EM, { GR, RC, SC, SUIT_SYM, cardStr, parseCard, parseBoard, classOf, C1, C2, CLS, PIDX,
  CLASS_COMBOS, CLASS_NCOMBOS, CLASS_NAMES, className, comboStr, parseRange, rangeToString, rangeStats });
})(globalThis.EM || (globalThis.EM = {}));
