#!/usr/bin/env python3
"""EightMax 5.11: the tables of CONVERGENCE-5.11.md from the experiment's summary. Usage: tables511.py <exact dir>"""
import sys, json, pathlib
d = pathlib.Path(sys.argv[1]); s = json.loads((d / 'summary.json').read_text()); p = json.loads((d / 'plan.json').read_text())
f = lambda v: '%.3f' % v; iv = lambda c: '%s [%s, %s]' % (f(c['ratioOfGeometricMeans']), f(c['interval'][0]), f(c['interval'][1]))
print('### Decisive comparisons (pooled over the 13 scale games; 32 seeds; two-sided level 0.025 each)\n')
print('| Comparison | NashConv philox64 / 5.10 streams | Interval | Seeds lower / higher | Verdict |\n|---|---:|---|---:|---|')
for k, name in (('equalTime', 'equal time, %g s of training' % p['time']), ('equalDeals', 'equal deals, %s sampled deals' % format(max(p['deals']), ','))):
    c = s['decisive'][k]; print('| %s | %s | [%s, %s] | %d / %d | **%s** |' % (name, f(c['ratioOfGeometricMeans']), f(c['interval'][0]), f(c['interval'][1]), c['lowerInSeeds'], c['higherInSeeds'], c['verdict']))
print('\n### Other pooled comparisons (level 0.05 each; not decisive)\n\n| Comparison | Games | Ratio [interval] | Verdict |\n|---|---:|---|---|')
for c in s['pooledOther']: print('| %s, %s deals | %d | %s | %s |' % ('equal deals' if c['kind'] == 'deals' else 'frozen batches of 64', format(int(c['budget']), ','), c['games'], iv(c), c['verdict']))
for cls, v in s['pooledByClass'].items():
    for k, name in (('equalTime', 'equal time'), ('equalDeals', 'equal deals')): c = v[k]; print('| class "%s", %s | %d | %s | %s |' % (cls, name, c['games'], iv(c), c['verdict']))
for k, name in (('equalTime', 'equal time'), ('equalDeals', 'equal deals')): c = s['pooledAllGamesNotPartOfTheRule'][k]; print('| all 17 games (with the four excluded from the rule), %s | %d | %s | %s |' % (name, c['games'], iv(c), c['verdict']))
print('\n### Every cell (guard family: 58 cells at level 0.05 / 58 each, and the pooled batch comparison)\n')
print('Median exact NashConv over 32 seeds (philox64 / 5.10 streams), the ratio of geometric means with its interval, and the verdict. `*` = one of the four games outside the pooled statistics.\n')
kinds = [('deals', d_) for d_ in p['deals']] + [('time', p['time'])]
print('| Game | ' + ' | '.join(('%s deals' % format(b, ',')) if k == 'deals' else '%g s' % b for k, b in kinds) + ' | batches of 64 |\n|---|' + '---|' * (len(kinds) + 1))
cell = {(c['game'], c['kind'], c['budget']): c for c in s['cells']}
def show(c, med=True):
    if not c: return ''
    m = ('%.3g / %.3g; ' % (c['medianNashConv']['p511'], c['medianNashConv']['s510'])) if med and 'medianNashConv' in c else ''
    return m + '%s (%s)' % (iv(c), c['verdict'])
for g in p['games']:
    print('| %s%s | ' % (g, '' if g in p['scaleGames'] else ' *') + ' | '.join(show(cell.get((g, k, b))) for k, b in kinds) + ' | ' + show(cell.get((g, 'batch', p['batchDeals'])), False) + ' |')
v = s['rule']['guardVerdicts']; print('\nVerdicts of the 58 cells: %d worse, %d no worse, %d better, %d unresolved.' % (v['worse'], v['no worse'], v['better'], v['unresolved']))
print('\n### Deals trained in equal time (%g s; median over seeds)\n\n| Game | philox64 | 5.10 streams | Ratio |\n|---|---:|---:|---:|' % p['time'])
for g in p['games']:
    c = cell[(g, 'time', p['time'])]; print('| %s | %s | %s | %.3f |' % (g, format(int(c['medianDeals']['p511']), ','), format(int(c['medianDeals']['s510']), ','), c['dealsRatio']))
t = s['throughput']; print('\nMedian over games %.3f (smallest %.3f, largest %.3f).' % (t['dealsInEqualTimeRatioMedianOverGames'], t['min'], t['max']))
print('\n### The four games outside the pooled statistics: share of seeds with NashConv below 1e-4\n\n| Game | Budget | philox64 | 5.10 streams |\n|---|---|---:|---:|')
for g, v in s['exactEquilibriumShare'].items():
    for b, x in v.items(): print('| %s | %s | %.0f%% | %.0f%% |' % (g, b, 100 * x['p511'], 100 * x['s510']))
