'use strict';
// Accuracy per sampled deal and per second, EightMax 2.8 (JavaScript) vs 2.9
// (JavaScript reference and native engine), on the three-player river used since 2.5.
// Each run trains one seed through cumulative deal budgets; after each budget the
// average strategy is evaluated by an exact best response in the enumerated game
// (the largest single-seat gain, in bb; lower is better). Intervals are 95% Student-t
// half-widths across seeds. Times are training wall time only (evaluation excluded).
// Usage: node tools/bench29.js <2.8 source dir> <native mwcli> <out.json> [--seeds=6] [--max=500000]
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const [old, cli, out] = process.argv.slice(2);
const opt = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? +a.slice(k.length + 3) : d; };
const seeds = Array.from({ length: opt('seeds', 6) }, (_, i) => i + 1), maxDeals = opt('max', 500000);
const budgets = [4000, 20000, 50000, 100000, 250000, 500000].filter((b) => b <= maxDeals);
const T = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 9: 2.262 };
const cfg = { board: 'Ks8d5h2c2s', common: 12, stacks: [30, 30, 30], ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc,QhJh,9c9d', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd,6h6d,4c3c', 'Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc,6s5s,AdJd'],
  streets: { river: { bets: '50,125', raises: '2.5x', maxBets: 2 } }, privateMode: 'sampled', abstraction: 'exact', traversal: 'full', evaluationDeals: 128 };
const here = path.join(__dirname, '..');
function load(root) { const key = path.resolve(root); delete globalThis.EM; for (const k of Object.keys(require.cache)) if (k.startsWith(key)) delete require.cache[k];
  const E = require(path.join(root, 'tools/loadlib.js')); for (const l of ['lib_runouts', 'lib_wide', 'lib_river']) require(path.join(root, 'web', l + '.js')); return E; }
const E28 = load(old), E29 = load(here);   // E29 also evaluates every variant (same exact best response)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench29-'));
const variants = [
  { name: '2.8 JS, 4 deals per update (default)', engine: 'js28', batchDeals: 4 },
  { name: '2.8 JS, 1 deal per update', engine: 'js28', batchDeals: 1 },
  { name: '2.8 JS, stratified 4', engine: 'js28', batchDeals: 4, riverStrata: true },
  { name: '2.9 native, 4 deals per update', engine: 'native', batchDeals: 4, threads: 1 },
  { name: '2.9 native, 16 deals per update', engine: 'native', batchDeals: 16, threads: 1 },
  { name: '2.9 native, own-hand enumeration, 4', engine: 'native', batchDeals: 4, updates: 'enumerate', threads: 1 },
  { name: '2.9 native, own-hand enumeration, 4, 4 threads', engine: 'native', batchDeals: 4, updates: 'enumerate', threads: 4 }];
const rows = [];
for (const v of variants) for (const seed of seeds) {
  const c = { ...cfg, privateSeed: seed, batchDeals: v.batchDeals, riverStrata: v.riverStrata === true, updates: v.updates || 'simultaneous' };
  const perUpdate = v.batchDeals * (c.updates === 'enumerate' ? 3 : 1);
  let done = 0, seconds = 0, state = null, js = null;
  if (v.engine === 'js28') js = E28.MultiwayGame(c);
  const spec = v.engine === 'native' ? E29.MultiwayGame(c).nativeSpec() : null;
  if (spec) fs.writeFileSync(path.join(tmp, 'spec.json'), JSON.stringify(spec));
  for (const deals of budgets) {
    const updates = Math.round(deals / perUpdate) - done; done += updates;
    let evalGame;
    if (js) { const t = performance.now(); js.iterate(updates); seconds += (performance.now() - t) / 1000; evalGame = js; }
    else {
      const args = [path.join(tmp, 'spec.json'), String(updates), String(v.threads), path.join(tmp, 'out.state'), '2048'];
      if (state) { fs.writeFileSync(path.join(tmp, 'in.state'), state); args.push(path.join(tmp, 'in.state')); }
      const info = JSON.parse(execFileSync(cli, args).toString()); seconds += info.wallSeconds;
      state = fs.readFileSync(path.join(tmp, 'out.state')); evalGame = E29.MultiwayGame(c); evalGame.importNative(state);
    }
    // Evaluate with the 2.9 exact cross-check (a 2.8 game exposes the same averageAt()).
    const r = E29.exactCheckSampled(c, evalGame);
    rows.push({ variant: v.name, seed, deals: evalGame.trainingDeals ?? done * perUpdate, updates: done, seconds, gains: r.gain, maxGain: r.maxGain });
  }
  process.stderr.write('.');
}
const summary = [];
for (const v of variants) for (const deals of budgets) {
  const r = rows.filter((x) => x.variant === v.name && Math.abs(x.deals - deals) <= v.batchDeals * 3), g = r.map((x) => x.maxGain), m = g.reduce((a, b) => a + b, 0) / g.length;
  const sd = Math.sqrt(g.reduce((a, b) => a + (b - m) ** 2, 0) / (g.length - 1)), sec = r.reduce((a, b) => a + b.seconds, 0) / r.length;
  summary.push({ variant: v.name, deals, meanGainBb: m, ci95: T[g.length - 1] * sd / Math.sqrt(g.length), meanTrainingSeconds: sec, dealsPerSecond: deals / sec, seeds: g.length });
}
fs.writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), cpu: os.cpus()[0].model, cores: os.cpus().length, node: process.version, cfg, seeds, budgets, variants, summary, rows }, null, 1));
console.log('\n| Variant | ' + budgets.map((b) => (b / 1000) + 'k deals').join(' | ') + ' |');
console.log('|---|' + budgets.map(() => '---:').join('|') + '|');
for (const v of variants) console.log('| ' + v.name + ' | ' + budgets.map((b) => { const s = summary.find((x) => x.variant === v.name && x.deals === b); return s.meanGainBb.toFixed(4) + ' ± ' + s.ci95.toFixed(4) + ' (' + s.meanTrainingSeconds.toFixed(2) + ' s)'; }).join(' | ') + ' |');
fs.rmSync(tmp, { recursive: true, force: true });
