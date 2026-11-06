// Solve the preflop tree at each library depth and write src/lib_deeplib.js.
// Usage: node gen_deep.js solve 15,20,25   (writes /tmp/deeplib_<S>.json for each depth)
//        node gen_deep.js merge            (combines them into src/lib_deeplib.js)
process.env.EXTRA_LIBS = 'lib_deep.js';
const EM = require('./loadlib.js');
const fs = require('fs');
const path = require('path');
const web = path.resolve(__dirname, '../web');
const DEPTHS = [15, 20, 25, 30, 40, 50, 60, 80, 100];
const base = (S) => ({ n: 8, stack: S, ...EM.MTT_ANTE });
// run-length coding for long runs of one character (pure strategies): '.' + char + ALPH[run - 4]
const ALPH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function rle(s) {
  let o = '';
  for (let i = 0; i < s.length;) {
    let j = i; while (j < s.length && s[j] === s[i] && j - i < 67) j++;
    const run = j - i;
    o += run >= 4 ? '.' + s[i] + ALPH[run - 4] : s.slice(i, j);
    i = j;
  }
  return o;
}
const cacheDir = path.resolve(process.env.EIGHTMAX_CHART_DIR || path.join(__dirname, '../build/charts'));
fs.mkdirSync(cacheDir, { recursive: true });
const mode = process.argv[2];
if (mode === 'solve') {
  for (const S of process.argv[3].split(',').map(Number)) {
    const t0 = Date.now();
    const m = EM.DeepTree(base(S));
    const ex = m.solve({ maxIter: +process.env.MAXIT || 2500, tol: +process.env.TOL || 0.001 });
    const s = m.pack();
    const m2 = EM.DeepTree(base(S)); m2.load(s);
    const exq = m2.exploitability();
    const out = { S, ...EM.MTT_ANTE, it: m.iterations, ex: +ex.toFixed(5), exq: +exq.toFixed(5), data: rle(s), raw: s.length };
    fs.writeFileSync(path.join(cacheDir, `deeplib_${S}.json`), JSON.stringify(out));
    console.log(`${S}bb: ${m.iterations} it, ${((Date.now() - t0) / 1000).toFixed(0)}s, expl ${ex.toFixed(5)} -> quantised ${exq.toFixed(5)}, ${s.length} -> ${out.data.length} chars`);
  }
} else if (mode === 'merge') {
  const data = {}, meta = {};
  for (const S of DEPTHS) {
    const j = JSON.parse(fs.readFileSync(path.join(cacheDir, `deeplib_${S}.json`), 'utf8'));
    if (j.anteType !== EM.MTT_ANTE.anteType || j.ante !== EM.MTT_ANTE.ante)
      throw new Error('Regenerate the '+S+'bb chart with the current ante.');
    data[S] = j.data; meta[S] = { it: j.it, ex: j.exq };
  }
  const js = "(function (EM) {\n'use strict';\n// Precomputed preflop tree model (approximate), 8-max, 0.1bb ante per dealt seat, default sizes per depth. Run-length coded.\nEM.DEEP_LIB = " +
    JSON.stringify({ alph: ALPH, depths: DEPTHS, meta, base: { n: 8, ...EM.MTT_ANTE }, data }) + ";\n})(globalThis.EM || (globalThis.EM = {}));\n";
  fs.writeFileSync(path.join(web, 'lib_deeplib.js'), js);
  console.log('wrote lib_deeplib.js', js.length, 'bytes');
}
