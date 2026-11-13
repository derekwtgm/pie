// Summarises validation/4.7/convergence/convergence47.json: Holm-adjusted tallies per variant and
// comparison type, per-game verdicts at the largest checkpoint, and geometric-mean NashConv ratios.
// usage: node tools/summarize47.js <convergence47.json> [out.txt]
'use strict';
const fs = require('node:fs'), [file, out] = process.argv.slice(2), r = JSON.parse(fs.readFileSync(file, 'utf8')), L = [];
L.push(`convergence47: ${r.seeds.length} seeds (${r.seeds[0]}-${r.seeds[r.seeds.length - 1]}), ${r.comparisons} Holm-adjusted comparisons, training threads ${r.trainingThreads}, ${r.cpu}`);
const variants = r.variants.map(v => v.name).slice(1);
for (const v of variants) for (const kind of ['equalSamples', 'equalTime']) {
  let b = 0, w = 0, n = 0; for (const g of r.games) for (const c of g.comparison[v]) { n++; if (c[kind].verdict === 'variant better') b++; if (c[kind].verdict === 'variant worse') w++; }
  L.push(`${v.padEnd(20)} ${kind.padEnd(13)} better ${b}  worse ${w}  no supported difference ${n - b - w}  (of ${n})`);
}
L.push('', 'Per game, largest checkpoint: geometric-mean NashConv ratio variant/default; verdicts (equal deals | equal time)');
for (const g of r.games) {
  const last = g.checkpoints.length - 1;
  for (const v of variants) {
    const c = g.comparison[v][last];
    L.push(`${g.key.padEnd(12)} ${v.padEnd(20)} deals ${String(g.checkpoints[last]).padStart(8)}  ratio(equal deals) ${Math.exp(c.equalSamples.meanDifference).toFixed(3)}  ratio(equal time) ${Math.exp(c.equalTime.meanDifference).toFixed(3)}  ${c.equalSamples.verdict} | ${c.equalTime.verdict}`);
  }
}
L.push('', 'Equal-time verdicts across all checkpoints (B = variant better, W = worse, . = no supported difference)');
for (const g of r.games) for (const v of variants) L.push(`${g.key.padEnd(12)} ${v.padEnd(20)} ${g.comparison[v].map(c => c.equalTime.verdict === 'variant better' ? 'B' : c.equalTime.verdict === 'variant worse' ? 'W' : '.').join('')}`);
const text = L.join('\n') + '\n'; process.stdout.write(text); if (out) fs.writeFileSync(out, text);
