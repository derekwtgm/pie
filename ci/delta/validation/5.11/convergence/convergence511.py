#!/usr/bin/env python3
"""EightMax 5.11: is the default trainer with the counter-based 64-bit training streams ("trainingStreams":"philox64")
no worse than with the 32-bit streams of 5.10?  The plan below is written to plan.json BEFORE anything is measured, and
the runner refuses an existing output directory.

  convergence511.py run     <release root> <5.10 mwcli> <5.11 mwcli> <5.10 timed> <5.11 timed> <fresh out dir> [jobs]
  convergence511.py analyze <out dir>
  ... --resume  (with run and the SAME arguments: continue an interrupted run; complete units are kept)

GAMES    17 of the 20 reference games of the 5.10 experiment (tools/games510.js): small enough for the exact best
         response of every seat and played with the exact abstraction, so exact NashConv falls to 0 with training and
         measures nothing but the distance to equilibrium. Left out, for cost only and before any measurement: the
         three games whose exact evaluation takes 24 to 45 seconds per strategy on the build machine (rg-bubble4,
         early3-flop, short8-push; 5.10 spent most of its experiment on them).
         Classes: "few hands" (7), "ranges" (7), "tournament" (3).
         SCALE GAMES (13): the 17 without final8, bubble4, bubble5-icm and turn4. In those four the 5.10 trainer
         reaches an exact equilibrium in some seeds (NashConv below 1e-4, down to 1e-8, in the 5.10 data:
         validation/5.10/convergence/exact), so the logarithm of their NashConv has a standard deviation above 0.8
         across seeds and is no scale on which a 10% margin can be judged. They are measured, every one of their cells
         is in the guard family, and the share of seeds below 1e-4 is reported per arm; the POOLED statistics use the
         13 scale games. This choice was made from the 5.10 data, before this experiment.
ARMS     s510   the unchanged 5.10 program (build 7fa0e8c16d6c6ade), default trainer: the 32-bit streams
         p511   the 5.11 program, the same spec plus "trainingStreams":"philox64"
         l511   the 5.11 program, the same spec WITHOUT the key (trained to 100,000 deals only: its state must be the
                state of s510, SHA-256 for SHA-256; this is the identity check, not a convergence arm)
         s510b / p511b   the "ranges" games only: frozen batches of 64 deals with per-deal action streams, 8000 updates
                (512,000 deals). In this mode the 5.10 action streams are the ones that can coincide
                (MATHEMATICAL-VALIDATION-5.11.md, section 2), so it is where a difference would be expected first.
SEEDS    32 seeds, 5201 .. 5232, never used by an earlier experiment; the SAME seed number for both arms of a unit. The
         two arms draw different random numbers by construction, so pairing by seed does not reduce variance; it fixes
         the analysis (differences per seed) and guards against choosing seeds.
BUDGETS  equal deals: 100,000 / 500,000 sampled deals (one state continued through the budgets);
         equal time:  2 seconds of training, one thread, a fresh run stopped by the clock (the timed tools);
         batch:       512,000 deals (equal deals).
MEASURE  exact NashConv of the average strategy (mwcli --gain, method exact; the 5.11 program evaluates both arms).
         NashConv below 1e-12 is treated as 1e-12 in both arms.
STATISTICS
  per cell (game x budget): d_seed = ln(NashConv p511 / NashConv s510); mean over seeds, Student-t interval.
  pooled (one number per budget): D_seed = mean over the 13 scale games of d_seed; mean over seeds, Student-t interval
         (the seeds are the independent replications; a seed with a failed cell in either arm is left out of that
         pooled statistic entirely).
  DECISIVE comparisons (2): pooled, equal time 2 s  [primary: equal time]
                            pooled, equal deals 500,000  [the requirement of the phase: "no worse at equal deals"]
         each with a two-sided interval at level 0.05 / 2.
  GUARD family: every cell of every game (17 games x 3 budgets + 7 batch cells = 58 intervals), each at 0.05 / 58, and
         the pooled batch comparison (the 7 "ranges" games, all of them scale games) at 0.05.
  PLANNED PRECISION (from the 5.10 data, default trainer): the pooled statistic of one arm has a standard deviation
         of about 0.09 to 0.10 across seeds on the scale games, so the half-width of a decisive interval with 32
         seeds is about 0.06 in the logarithm (6%), against a margin of ln 1.10 = 0.095.
  Verdict of an interval for the ratio p511 / s510:
         "no worse"    the whole interval is below 1.10 (non-inferiority margin: 10% of NashConv; for scale, two
                       trainings of ONE game with different seeds differ by a standard deviation of about 25% in the
                       5.10 data, so a pooled 10% is well inside what a single study cannot tell apart)
         "worse"       the whole interval is above 1
         "unresolved"  neither. ("better" - whole interval below 1 - is reported but changes nothing.)
RULE, fixed here before measurement.  philox64 becomes the training streams of NEW studies (and the documented choice
  for new trainings) in 5.11 only if ALL of:
    (a) mathematics: mwcli --selftest511 streams passes and the independent implementation agrees (not this experiment);
    (b) identity: every l511 state equals the s510 state (the 5.10 streams are untouched in the 5.11 program);
    (c) BOTH decisive comparisons are "no worse";
    (d) no interval of the guard family is "worse";
    (e) p511 reaches no table limit that s510 does not reach.
  If (c) is "unresolved" for either comparison: NOT promoted (philox64 stays opt-in; reported as unresolved).
  If any comparison is "worse": NOT promoted, reported as a failure of the phase's requirement.
  Whatever the outcome, states of the 5.10 streams keep their rules and the 5.10 streams stay selectable.
STOPPING  every unit (game x seed) once; no interim analysis; a failed run is recorded and its cell excluded for that
  seed in both arms.
NOT ESTABLISHED BY THIS EXPERIMENT (stated before measurement): anything about games too large for the exact best
  response; hand groups; the user's Windows PC (timings here are from the build machine: 2 logical processors, other
  work running; the equal-time arms of a unit run back to back, in an order that alternates with the seed).
"""
import sys, json, subprocess, pathlib, time, statistics, math, platform, os, hashlib, threading, concurrent.futures as cf
sys.dont_write_bytecode = True   # importing the 5.10 runner must not leave a __pycache__ folder in the 5.10 evidence
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / '5.10' / 'convergence'))
from convergence510 import t_quantile, FEW, RANGES, TOURNAMENT   # the Student-t quantile and the game lists of 5.10 (importing runs nothing)
CLASSES = {'few hands': FEW, 'ranges': RANGES, 'tournament': TOURNAMENT}; GAMES = FEW + RANGES + TOURNAMENT
HEAVY = ['rg-bubble4', 'early3-flop', 'short8-push']; DEGENERATE = ['final8', 'bubble4', 'bubble5-icm', 'turn4']
FEW = [g for g in FEW if g not in HEAVY]; RANGES = [g for g in RANGES if g not in HEAVY]; TOURNAMENT = [g for g in TOURNAMENT if g not in HEAVY]; CLASSES = {'few hands': FEW, 'ranges': RANGES, 'tournament': TOURNAMENT}; GAMES = FEW + RANGES + TOURNAMENT
DEALS = [100000, 500000]; TIME = 2.0; BATCH_UPDATES = 8000; IDENTITY_DEALS = 100000; SEEDS = list(range(5201, 5233)); MARGIN = 1.10; FLOOR = 1e-12
WIDE = {'trainingStreams': 'philox64'}; BATCH = {'batchDeals': 64, 'actionStreams': 'deal'}
DRY = os.environ.get('EM_DRY_RUN') == '1'
if DRY: GAMES = ['hu-river', 'rg-hu-turn', 'turn4']; CLASSES = {'few hands': ['hu-river', 'turn4'], 'ranges': ['rg-hu-turn'], 'tournament': []}; DEALS = [2000, 10000]; TIME = 0.1; BATCH_UPDATES = 100; IDENTITY_DEALS = 10000; SEEDS = [9901, 9902, 9903]
def sha(p): return hashlib.sha256(open(p, 'rb').read()).hexdigest()
def build(cli): return subprocess.run([cli, '--build-id'], capture_output=True, text=True).stdout.strip()
def spec_of(root, key, seed, extra, path): subprocess.run(['node', str(root / 'source/tools/games510.js'), 'spec', key, str(path), str(seed)] + ([json.dumps(extra)] if extra else []), check=True, capture_output=True)
def train(cli, spec, updates, state, cont=None):
    p = subprocess.run([cli, str(spec), str(updates), '1', str(state), '512'] + ([str(cont)] if cont else []), capture_output=True, text=True)
    return (json.loads(p.stdout), None) if p.returncode == 0 else (None, p.stderr.strip()[-200:])
def timed(tool, spec, seconds, state):
    p = subprocess.run([tool, str(spec), str(int(round(seconds * 1000))), '1', str(state), '512'], capture_output=True, text=True)
    return (json.loads(p.stdout), None) if p.returncode == 0 else (None, p.stderr.strip()[-200:])
def nashconv(cli, spec, state, q):
    q.write_text(json.dumps({'method': 'exact', 'policy': 'average', 'device': 'cpu', 'threads': 1, 'timeLimitMs': 3600000, 'maxVisits': 2000000000, 'memoryMiB': 2048}))
    p = subprocess.run([cli, '--gain', str(spec), str(state), str(q), '512'], capture_output=True, text=True)
    if p.returncode: return None, p.stderr.strip()[-200:]
    d = json.loads(p.stdout); return sum(s['bestResponseValue'] - s['policyValue'] for s in d['seats']), None
def interval(d, level):
    n = len(d)
    if n < 3: return {'seeds': n, 'verdict': 'no data'}
    mean = statistics.fmean(d); sd = statistics.stdev(d); se = sd / math.sqrt(n); q = t_quantile(1 - level / 2, n - 1) if sd else 0.0; lo, hi = mean - q * se, mean + q * se
    return {'seeds': n, 'ratioOfGeometricMeans': math.exp(mean), 'interval': [math.exp(lo), math.exp(hi)], 'level': level, 'sdOfLogRatio': sd, 'tCritical': q,
            'verdict': 'identical' if sd == 0 and mean == 0 else 'worse' if lo > 0 else 'better' if hi < 0 else 'no worse' if hi < math.log(MARGIN) else 'unresolved',
            'noWorseWithinMargin': bool(hi < math.log(MARGIN)), 'lowerInSeeds': sum(1 for x in d if x < 0), 'higherInSeeds': sum(1 for x in d if x > 0)}
def analyze(out):
    plan = json.loads((out / 'plan.json').read_text()); rows = [json.loads(l) for l in (out / 'raw.jsonl').read_text().splitlines() if l.strip()]; ok = [r for r in rows if not r.get('error')]
    res = {'rows': len(rows), 'errorCount': len(rows) - len(ok), 'errors': [r for r in rows if r.get('error')][:20], 'margin': plan['margin'], 'dryRun': plan['dryRun']}
    games, seeds = plan['games'], plan['seeds']; ranges = plan['classes']['ranges']; scale = plan['scaleGames']
    a = {(r['game'], r['seed']): r['sha'] for r in ok if r['arm'] == 's510' and r['kind'] == 'deals' and r['budget'] == plan['identityDeals']}; b = {(r['game'], r['seed']): r['sha'] for r in ok if r['arm'] == 'l511'}
    both = [k for k in a if k in b]; res['identity'] = {'compared': len(both), 'identical': sum(1 for k in both if a[k] == b[k]), 'expected': len(games) * len(seeds)}
    nc = {(r['arm'], r['kind'], r['budget'], r['game'], r['seed']): max(r['nashConv'], FLOOR) for r in ok if r.get('nashConv') is not None}
    def logratio(kind, budget, g, s, cand='p511', ref='s510'):
        x, y = nc.get((cand, kind, budget, g, s)), nc.get((ref, kind, budget, g, s)); return None if x is None or y is None else math.log(x / y)
    cells = [('deals', d) for d in plan['deals']] + [('time', plan['time'])]; guardN = len(games) * len(cells) + len(ranges); res['guardLevel'] = 0.05 / guardN; res['cells'] = []
    for kind, budget in cells:
        for g in games:
            d = [x for x in (logratio(kind, budget, g, s) for s in seeds) if x is not None]; c = interval(d, 0.05 / guardN); c.update({'game': g, 'kind': kind, 'budget': budget})
            c['medianNashConv'] = {arm: statistics.median([nc[(arm, kind, budget, g, s)] for s in seeds if (arm, kind, budget, g, s) in nc] or [float('nan')]) for arm in ('p511', 's510')}
            if kind == 'time':
                dl = {arm: [r['deals'] for r in ok if r['arm'] == arm and r['kind'] == 'time' and r['game'] == g] for arm in ('p511', 's510')}
                if dl['p511'] and dl['s510']: c['medianDeals'] = {k: statistics.median(v) for k, v in dl.items()}; c['dealsRatio'] = c['medianDeals']['p511'] / c['medianDeals']['s510']
            res['cells'].append(c)
    for g in ranges:
        d = [x for x in (logratio('batch', plan['batchDeals'], g, s, 'p511b', 's510b') for s in seeds) if x is not None]; c = interval(d, 0.05 / guardN); c.update({'game': g, 'kind': 'batch', 'budget': plan['batchDeals']}); res['cells'].append(c)
    def pooled(kind, budget, gs, level, cand='p511', ref='s510'):
        D = []
        for s in seeds:
            v = [logratio(kind, budget, g, s, cand, ref) for g in gs]
            if all(x is not None for x in v) and v: D.append(statistics.fmean(v))
        c = interval(D, level); c.update({'kind': kind, 'budget': budget, 'games': len(gs)}); return c
    res['decisive'] = {'equalTime': pooled('time', plan['time'], scale, 0.025), 'equalDeals': pooled('deals', max(plan['deals']), scale, 0.025)}
    res['pooledOther'] = [pooled('deals', d, scale, 0.05) for d in plan['deals'][:-1]] + [pooled('batch', plan['batchDeals'], [g for g in ranges if g in scale], 0.05, 'p511b', 's510b')]
    res['pooledByClass'] = {cls: {'equalTime': pooled('time', plan['time'], [g for g in gs if g in scale], 0.05), 'equalDeals': pooled('deals', max(plan['deals']), [g for g in gs if g in scale], 0.05)} for cls, gs in plan['classes'].items() if [g for g in gs if g in scale]}
    res['pooledAllGamesNotPartOfTheRule'] = {'equalTime': pooled('time', plan['time'], games, 0.05), 'equalDeals': pooled('deals', max(plan['deals']), games, 0.05)}
    res['exactEquilibriumShare'] = {g: {f'{kind} {budget}': {arm: (lambda v: sum(1 for x in v if x < 1e-4) / len(v) if v else None)([nc[(arm, kind, budget, g, s)] for s in seeds if (arm, kind, budget, g, s) in nc]) for arm in ('p511', 's510')} for kind, budget in cells} for g in games if g not in scale}
    tr = [c['dealsRatio'] for c in res['cells'] if 'dealsRatio' in c]; res['throughput'] = {'dealsInEqualTimeRatioMedianOverGames': statistics.median(tr) if tr else None, 'min': min(tr) if tr else None, 'max': max(tr) if tr else None}
    limits = {arm: sum(1 for r in ok if r['arm'] == arm and r.get('limitReached')) for arm in ('s510', 'p511', 's510b', 'p511b')}
    worse = [c for c in res['cells'] + [res['pooledOther'][-1]] if c['verdict'] == 'worse']; dec = [res['decisive']['equalTime']['verdict'], res['decisive']['equalDeals']['verdict']]
    good = lambda v: v in ('no worse', 'better', 'identical')
    res['rule'] = {'b_identity': res['identity']['compared'] == res['identity']['identical'] == res['identity']['expected'], 'c_decisive': dec, 'c_bothNoWorse': all(good(v) and c['noWorseWithinMargin'] for v, c in zip(dec, res['decisive'].values())),
                   'd_guardIntervalsWorse': len(worse), 'guardIntervals': guardN + 1, 'guardVerdicts': {v: sum(1 for c in res['cells'] if c['verdict'] == v) for v in ('better', 'no worse', 'unresolved', 'worse', 'identical', 'no data')},
                   'e_tableLimitReached': limits, 'e_ok': limits['p511'] <= limits['s510'] and limits['p511b'] <= limits['s510b']}
    r = res['rule']; r['statisticalConditionsMet'] = bool(r['b_identity'] and r['c_bothNoWorse'] and r['d_guardIntervalsWorse'] == 0 and r['e_ok'] and not plan['dryRun'])
    r['outcome'] = ('dry run: no outcome' if plan['dryRun'] else 'conditions (b) to (e) met: philox64 is promoted if (a) holds' if r['statisticalConditionsMet'] else
                    'FAILED: a comparison is worse; not promoted' if (r['d_guardIntervalsWorse'] or 'worse' in dec) else 'not promoted: ' + ('identity failed' if not r['b_identity'] else 'a decisive comparison is unresolved' if not r['c_bothNoWorse'] else 'table limit'))
    (out / 'summary.json').write_text(json.dumps(res, indent=1)); return res
if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'analyze': r = analyze(pathlib.Path(sys.argv[2]).resolve()); print(json.dumps({k: v for k, v in r.items() if k != 'cells'}, indent=1)); sys.exit(0)
    if cmd != 'run': print(__doc__); sys.exit(2)
    RESUME = '--resume' in sys.argv; sys.argv = [a for a in sys.argv if a != '--resume']
    root = pathlib.Path(sys.argv[2]).resolve(); cli510, cli511, timed510, timed511, outdir = [str(pathlib.Path(a).resolve()) for a in sys.argv[3:8]]; jobs = int(sys.argv[8]) if len(sys.argv) > 8 else 2
    out = pathlib.Path(outdir)
    if out.exists() != RESUME: sys.exit(('no interrupted run in ' if RESUME else 'output directory exists: ') + str(out))
    cpu = next((l.split(':', 1)[1].strip() for l in open('/proc/cpuinfo') if l.startswith('model name')), None) if os.path.exists('/proc/cpuinfo') else None
    plan = {'kind': 'streams', 'question': 'Is the default trainer with the counter-based 64-bit training streams no worse than with the 32-bit streams of 5.10?', 'document': __doc__, 'games': GAMES, 'scaleGames': [g for g in GAMES if g not in DEGENERATE], 'classes': CLASSES, 'seeds': SEEDS, 'dryRun': DRY,
            'arms': {'s510': 'the 5.10 program, default trainer', 'p511': 'the 5.11 program, trainingStreams philox64', 'l511': 'the 5.11 program without the key (identity)', 's510b': 's510 with frozen batches of 64', 'p511b': 'p511 with frozen batches of 64'},
            'deals': DEALS, 'time': TIME, 'batchDeals': BATCH_UPDATES * 64, 'identityDeals': IDENTITY_DEALS, 'margin': MARGIN, 'threads': 1, 'tableBudgetMiB': 512,
            'binarySha256': {'mwcli510': sha(cli510), 'mwcli511': sha(cli511), 'timed510': sha(timed510), 'timed511': sha(timed511)}, 'build': {'mwcli510': build(cli510), 'mwcli511': build(cli511)}}
    env = {'environment': platform.platform(), 'processor': cpu, 'logicalProcessors': os.cpu_count(), 'parallelJobs': jobs, 'written': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    done = set()
    if RESUME:
        stored = json.loads((out / 'plan.json').read_text())
        if any(stored.get(k) != v for k, v in plan.items()): sys.exit('the stored plan differs from the plan of these arguments: not resumed')
        if (out / 'summary.json').exists(): sys.exit('this run was completed and analysed: not resumed')
        rows = [json.loads(l) for l in (out / 'raw.jsonl').read_text().splitlines() if l.strip()]; done = {(r['game'], r['seed']) for r in rows if r.get('unitComplete')}
        kept = [r for r in rows if (r['game'], r['seed']) in done]; n = 1
        while (out / f'resume-{n}.json').exists(): n += 1
        os.replace(out / 'raw.jsonl', out / f'raw.before-resume-{n}.jsonl'); (out / 'raw.jsonl').write_text(''.join(json.dumps(r) + '\n' for r in kept))
        (out / f'resume-{n}.json').write_text(json.dumps({**env, 'rowsBefore': len(rows), 'rowsKept': len(kept), 'unitsComplete': len(done)}, indent=1))
    else:
        out.mkdir(parents=True); (out / 'plan.json').write_text(json.dumps({**plan, **env}, indent=1))
    work = out / 'work'; work.mkdir(exist_ok=True); raw = open(out / 'raw.jsonl', 'a'); lock = threading.Lock(); t0 = time.time()
    def unit(g, seed):
        d = work / f'{g}-{seed}'; d.mkdir(exist_ok=True); rows = []; q = d / 'q.json'
        def rec(**k): rows.append({'game': g, 'seed': seed, **k})
        specs = {}
        for name, extra in (('s', None), ('w', WIDE), ('sb', BATCH), ('wb', {**WIDE, **BATCH})):
            if name in ('sb', 'wb') and g not in CLASSES['ranges']: continue
            specs[name] = d / f'{name}.json'; spec_of(root, g, seed, extra, specs[name])
        order = [('s510', cli510, 's', timed510), ('p511', cli511, 'w', timed511)]
        if seed % 2: order.reverse()
        for arm, cli, sp, _ in order:   # equal deals: one state continued through the budgets
            st = d / f'{arm}.state'; have = 0
            for budget in DEALS:
                nxt = d / f'{arm}.next'; r, err = train(cli, specs[sp], budget - have, nxt, st if have else None)
                if err: rec(arm=arm, kind='deals', budget=budget, error=err); break
                os.replace(nxt, st); have = budget; v, e2 = nashconv(cli511, specs[sp], st, q)
                rec(arm=arm, kind='deals', budget=budget, deals=r['trainingDeals'], trainSeconds=r['wallSeconds'], rows=r['rows'], limitReached=bool(r.get('limitReached')), sha=sha(st), **({'nashConv': v} if e2 is None else {'error': e2}))
            st.unlink(missing_ok=True)
        st = d / 'l511.state'; r, err = train(cli511, specs['s'], IDENTITY_DEALS, st)   # identity
        rec(arm='l511', kind='identity', budget=IDENTITY_DEALS, **({'sha': sha(st)} if err is None else {'error': err})); st.unlink(missing_ok=True)
        for arm, cli, sp, tool in order:   # equal time, back to back
            st = d / f'{arm}.timed'; r, err = timed(tool, specs[sp], TIME, st)
            if err: rec(arm=arm, kind='time', budget=TIME, error=err); continue
            v, e2 = nashconv(cli511, specs[sp], st, q)
            rec(arm=arm, kind='time', budget=TIME, deals=r['deals'], trainSeconds=r['seconds'], limitReached=bool(r.get('limitReached')), **({'nashConv': v} if e2 is None else {'error': e2})); st.unlink(missing_ok=True)
        if 'sb' in specs:
            for arm, cli, sp, _ in order:
                st = d / f'{arm}b.state'; r, err = train(cli, specs[sp + 'b'], BATCH_UPDATES, st)
                if err: rec(arm=arm + 'b', kind='batch', budget=BATCH_UPDATES * 64, error=err); continue
                v, e2 = nashconv(cli511, specs[sp + 'b'], st, q)
                rec(arm=arm + 'b', kind='batch', budget=BATCH_UPDATES * 64, deals=r['trainingDeals'], trainSeconds=r['wallSeconds'], limitReached=bool(r.get('limitReached')), sha=sha(st), **({'nashConv': v} if e2 is None else {'error': e2})); st.unlink(missing_ok=True)
        rows[-1]['unitComplete'] = True
        for f in d.iterdir(): f.unlink()
        d.rmdir()
        with lock:
            raw.write(''.join(json.dumps(r) + '\n' for r in rows)); raw.flush()
    todo = [(g, s) for s in SEEDS for g in GAMES if (g, s) not in done]; n = 0
    with cf.ThreadPoolExecutor(jobs) as ex:
        for f in cf.as_completed([ex.submit(unit, g, s) for g, s in todo]):
            f.result(); n += 1
            if n % 40 == 0: print(f'{n}/{len(todo)} units, {time.time() - t0:.0f} s', flush=True)
    raw.close(); print(f'done: {len(todo)} units in {time.time() - t0:.0f} s; analysis:', flush=True)
    print(json.dumps(analyze(out)['rule'], indent=1))
