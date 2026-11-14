'use strict';
// EightMax 4.4: merges per-game reports of tools/convergence44.js (run with
// --games=<one game> so that a long study survives an interrupted session) into
// one report and recomputes the Holm adjustment over ALL comparisons of the
// merged study (family-wise 5%), exactly as convergence44.js does for one run.
// usage: node tools/merge_convergence44.js <out.json> <game1.json> [game2.json ...]
const fs = require('node:fs');
const [out, ...files] = process.argv.slice(2);
const parts = files.map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
const report = { ...parts[0], generated: new Date().toISOString(), mergedFrom: files.map(f => f.replace(/^.*[\\/]/, '')), games: parts.flatMap(p => p.games) };
const all = report.games.flatMap(g => Object.values(g.comparison).flat().flatMap(c => [c.equalSamples, c.equalTime]));
all.slice().sort((a, b) => a.p - b.p).reduce((run, c, i) => { c.holmP = Math.max(run, Math.min(1, (all.length - i) * c.p)); return c.holmP; }, 0);
for (const c of all) c.verdict = c.holmP < 0.05 ? (c.meanDifference < 0 ? 'variant better' : 'variant worse') : 'no supported difference';
report.comparisons = all.length;
report.summary = report.games.map(g => ({ game: g.key, variants: Object.fromEntries(Object.entries(g.comparison).map(([v, rows]) => [v, { equalSamples: rows.map(r => r.equalSamples.verdict), equalTime: rows.map(r => r.equalTime.verdict) }])) }));
fs.writeFileSync(out, JSON.stringify(report, null, 1));
console.log('merged', report.games.length, 'games,', report.comparisons, 'comparisons');
for (const g of report.games) {
  console.log('\n' + g.key + ' - ' + g.name);
  for (const [v, rows] of Object.entries(g.variants)) console.log('  ' + v.padEnd(22) + rows.map(r => r.deals + ': ' + r.nashConv.mean.toExponential(2) + ' +/- ' + (r.nashConv.ci95 || 0).toExponential(1)).join('  '));
  for (const [v, rows] of Object.entries(g.comparison)) console.log('  vs default ' + v.padEnd(22) + ' samples: ' + rows.map(r => r.equalSamples.verdict[8] === 'b' ? 'B' : r.equalSamples.verdict[8] === 'w' ? 'W' : '-').join('') + '  time: ' + rows.map(r => r.equalTime.verdict[8] === 'b' ? 'B' : r.equalTime.verdict[8] === 'w' ? 'W' : '-').join(''));
}
