const EM = require('./loadlib.js');
const fs = require('fs');
const path = require('path');
const web = path.resolve(__dirname, '../web');
const ALPH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const stacks = []; for (let s = 3; s <= 25; s++) stacks.push(s);
const data = {}; const meta = {};
let tot = 0;
for (const S of stacks) {
  const t0 = Date.now();
  const s = EM.PushFold({ n: 8, stacks: Array(8).fill(S), ...EM.MTT_ANTE });
  s.solve({ maxIter: 6000, tol: 2e-6 });
  const r = s.results();
  let str = '';
  const enc = f => { for (let h = 0; h < 169; h++) str += ALPH[Math.round(Math.min(1, Math.max(0, f[h])) * 63)]; };
  for (let i = 0; i < 7; i++) enc(r.jam[i].freq);
  for (let i = 0; i < 7; i++) for (let j = i + 1; j < 8; j++) enc(r.call[i][j].freq);
  data[S] = str; meta[S] = { it: r.iterations, ex: +r.exploit.toExponential(2) };
  tot += Date.now() - t0;
  console.log(S + 'bb', r.iterations, 'it', (Date.now() - t0) + 'ms', 'exploit', r.exploit.toExponential(2), 'jam%', r.jam.map(d => d.pct.toFixed(1)).join('/'));
}
const js = "(function (EM) {\n'use strict';\n// Precomputed 8-max push/fold Nash (chip EV), 0.1bb ante per dealt seat, uniform stacks.\n" +
  "EM.CHARTS = " + JSON.stringify({ n: 8, ...EM.MTT_ANTE, alph: ALPH, stacks, meta, data }) + ";\n})(globalThis.EM || (globalThis.EM = {}));\n";
fs.writeFileSync(path.join(web, 'lib_charts.js'), js);
console.log('total', tot, 'ms; bytes', js.length);
