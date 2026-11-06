(function (EM) {
'use strict';
// 7-card evaluator on 13-bit suit masks. Higher value = stronger hand.
// Category in bits 26+ (0 high card .. 8 straight flush), rank detail below.
const POP = new Uint8Array(8192), STRAIGHT = new Uint8Array(8192);
for (let m = 0; m < 8192; m++) {
  let p = 0, x = m; while (x) { x &= x - 1; p++; } POP[m] = p;
  let st = 0;
  for (let hi = 12; hi >= 4; hi--) { const w = 0x1F << (hi - 4); if ((m & w) === w) { st = hi + 1; break; } }
  if (!st && (m & 0x100F) === 0x100F) st = 4;
  STRAIGHT[m] = st;
}
function topbits(m, n) { while (POP[m] > n) m &= m - 1; return m; }

function evalMasks(s0, s1, s2, s3) {
  let fl = 0;
  if (POP[s0] >= 5) fl = s0; else if (POP[s1] >= 5) fl = s1; else if (POP[s2] >= 5) fl = s2; else if (POP[s3] >= 5) fl = s3;
  if (fl) { const st = STRAIGHT[fl]; if (st) return (8 << 26) | st; return (5 << 26) | topbits(fl, 5); }
  const ranks = s0 | s1 | s2 | s3;
  const quads = s0 & s1 & s2 & s3;
  if (quads) return (7 << 26) | (quads << 13) | topbits(ranks & ~quads, 1);
  const t3 = (s0 & s1 & s2) | (s0 & s1 & s3) | (s0 & s2 & s3) | (s1 & s2 & s3);
  const t2 = (s0 & s1) | (s0 & s2) | (s0 & s3) | (s1 & s2) | (s1 & s3) | (s2 & s3);
  const pairs = t2 & ~t3;
  if (t3) { const top = topbits(t3, 1); const rest = (t3 & ~top) | pairs; if (rest) return (6 << 26) | (top << 13) | topbits(rest, 1); }
  const st = STRAIGHT[ranks];
  if (st) return (4 << 26) | st;
  if (t3) return (3 << 26) | (t3 << 13) | topbits(ranks & ~t3, 2);
  const np = POP[pairs];
  if (np >= 2) { const tp = topbits(pairs, 2); return (2 << 26) | (tp << 13) | topbits(ranks & ~tp, 1); }
  if (np === 1) return (1 << 26) | (pairs << 13) | topbits(ranks & ~pairs, 3);
  return topbits(ranks, 5);
}

function evalCards(cards) {
  const s = [0, 0, 0, 0];
  for (const c of cards) s[c & 3] |= 1 << (c >> 2);
  return evalMasks(s[0], s[1], s[2], s[3]);
}
const CAT_NAMES = ['High card', 'Pair', 'Two pair', 'Trips', 'Straight', 'Flush', 'Full house', 'Quads', 'Straight flush'];
function category(v) { return v >>> 26; }

Object.assign(EM, { evalMasks, evalCards, CAT_NAMES, category, POP13: POP });
})(globalThis.EM || (globalThis.EM = {}));
