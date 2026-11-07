(function (EM) {
'use strict';
// All 1,755 strategically different flops (suit-isomorphic classes) with their raw weights,
// texture tags, and evenly spread subsets for reports.
let ALL = null;
const PERMS = [];
(function () { const p = [0, 1, 2, 3]; const rec = (k) => { if (k === 4) { PERMS.push(p.slice()); return; } for (let i = k; i < 4; i++) { [p[k], p[i]] = [p[i], p[k]]; rec(k + 1); [p[k], p[i]] = [p[i], p[k]]; } }; rec(0); })();
function keyOf(cards) { const s = cards.slice().sort((a, b) => b - a); return s[0] * 2704 + s[1] * 52 + s[2]; }
function canon(cards) {
  let best = Infinity;
  for (const pm of PERMS) { const k = keyOf(cards.map(c => (c & ~3) | pm[c & 3])); if (k < best) best = k; }
  return best;
}
function tags(cards) {
  const r = cards.map(c => c >> 2).sort((a, b) => b - a), s = cards.map(c => c & 3);
  const suits = new Set(s).size;
  const paired = r[0] === r[1] || r[1] === r[2] ? (r[0] === r[2] ? 'Trips' : 'Paired') : 'Unpaired';
  let connected = false;
  if (paired === 'Unpaired') {
    connected = r[0] - r[2] <= 4;
    if (!connected && r[0] === 12) { const lo = [r[1], r[2]].map(x => x + 1); connected = Math.max(...lo) <= 4; }
  }
  const high = r[0] >= 8 ? 'AKQJT'[12 - r[0]] + '-high' : '9-high or lower';
  return { high, highRank: r[0], paired, suits: suits === 1 ? 'Monotone' : suits === 2 ? 'Two-tone' : 'Rainbow', conn: paired !== 'Unpaired' ? 'Paired board' : connected ? 'Connected' : 'Disconnected' };
}
function all() {
  if (ALL) return ALL;
  const map = new Map();
  for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) for (let c = b + 1; c < 52; c++) {
    const k = canon([a, b, c]);
    const e = map.get(k);
    if (e) e.w++; else map.set(k, { key: k, w: 1 });
  }
  ALL = [];
  for (const e of map.values()) {
    const c0 = Math.floor(e.key / 2704), c1 = Math.floor(e.key / 52) % 52, c2 = e.key % 52;
    // display with spades first for readability
    const cards = [c0, c1, c2].map(c => (c & ~3) | (3 - (c & 3)));
    ALL.push({ cards, w: e.w, tags: tags(cards) });
  }
  ALL.sort((x, y) => { const rx = x.cards.map(c => c >> 2).sort((a, b) => b - a), ry = y.cards.map(c => c >> 2).sort((a, b) => b - a);
    for (let i = 0; i < 3; i++) if (rx[i] !== ry[i]) return ry[i] - rx[i];
    return (x.tags.suits < y.tags.suits ? -1 : x.tags.suits > y.tags.suits ? 1 : 0); });
  return ALL;
}
function subset(n) {
  // stratified: each (high card, suit pattern, pairing) cell gets picks in proportion to its weight,
  // spread evenly through the cell by rank; picked flops carry the cell's weight
  const list = all();
  if (n >= list.length) return list.map(f => ({ cards: f.cards, w: f.w, tags: f.tags }));
  const cells = new Map();
  for (const f of list) { const k = f.tags.high + '|' + f.tags.suits + '|' + f.tags.paired; if (!cells.has(k)) cells.set(k, []); cells.get(k).push(f); }
  const tot = list.reduce((a, f) => a + f.w, 0);
  const arr = Array.from(cells.values()).map(fl => { const w = fl.reduce((a, f) => a + f.w, 0); const q = n * w / tot; return { fl, w, q, k: Math.floor(q) }; });
  let left = n - arr.reduce((a, c) => a + c.k, 0);
  arr.slice().sort((x, y) => (y.q - y.k) - (x.q - x.k)).forEach(c => { if (left > 0) { c.k++; left--; } });
  const out = [];
  let kept = 0;
  for (const c of arr) {
    if (!c.k) continue;
    kept += c.w;
    const step = c.w / c.k; let acc = 0, j = 0;
    const picks = new Map();
    for (const f of c.fl) {
      const lo = acc; acc += f.w;
      while (j < c.k && (j + 0.5) * step >= lo && (j + 0.5) * step < acc) { picks.set(f, (picks.get(f) || 0) + step); j++; }
    }
    for (const [f, w] of picks) out.push({ cards: f.cards, w, tags: f.tags });
  }
  const scale = tot / kept;
  for (const f of out) f.w *= scale;
  return out;
}
EM.flopsAll = all; EM.flopSubset = subset; EM.flopTags = tags;
})(globalThis.EM || (globalThis.EM = {}));
