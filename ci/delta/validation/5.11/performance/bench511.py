#!/usr/bin/env python3
"""EightMax 5.11: time per sampled deal with the 5.10 streams and with philox64 (one thread, same program, same deals).
Usage: bench511.py <release root> <mwcli> <out.json> [repeats]
For every game: the two arms alternate `repeats` times; the fastest run of each arm is reported (the least disturbed one)."""
import sys, json, subprocess, pathlib, tempfile, os, platform
root = pathlib.Path(sys.argv[1]).resolve(); cli = str(pathlib.Path(sys.argv[2]).resolve()); out = pathlib.Path(sys.argv[3]); reps = int(sys.argv[4]) if len(sys.argv) > 4 else 5
GAMES = [('hu-river', 2000000), ('rg-hu-turn', 1000000), ('rg-river3', 1000000), ('turn4', 600000), ('rg-turn4', 600000), ('flop6', 400000), ('rg-flop6c', 300000), ('rg-icm3-river', 800000), ('final8', 200000), ('mid3-turn', 600000)]
FIX = [('flop3-kings', 30000), ('flop6-jack', 20000), ('flop3-kings-detailed', 20000), ('icm8-bb-call', 30000), ('btn25-open', 20000)]
w = pathlib.Path(tempfile.mkdtemp()); rows = []
def run(spec, updates):
    p = subprocess.run([cli, str(spec), str(updates), '1', str(w / 'x.state'), '2048'], capture_output=True, text=True); assert p.returncode == 0, p.stderr; d = json.loads(p.stdout); return d['wallSeconds'], d['trainingDeals']
def measure(name, kind, base, updates):
    a = w / 'a.json'; b = w / 'b.json'; a.write_text(json.dumps(base)); b.write_text(json.dumps({**base, 'trainingStreams': 'philox64'}))
    ta, tb = [], []
    for i in range(reps):
        for arm in ((a, ta), (b, tb)) if i % 2 == 0 else ((b, tb), (a, ta)): arm[1].append(run(arm[0], updates)[0])
    deals = run(a, 1000)[1] // 1000 * updates
    r = {'game': name, 'kind': kind, 'deals': deals, 'seconds510': min(ta), 'secondsPhilox64': min(tb), 'nsPerDeal510': min(ta) / deals * 1e9, 'nsPerDealPhilox64': min(tb) / deals * 1e9, 'timeRatio': min(tb) / min(ta), 'allRuns510': ta, 'allRunsPhilox64': tb}
    rows.append(r); print('%-22s %-8s %8.0f ns/deal  -> %8.0f ns/deal   x%.3f' % (name, kind, r['nsPerDeal510'], r['nsPerDealPhilox64'], r['timeRatio']), flush=True)
for g, n in GAMES:
    s = json.loads(subprocess.run(['node', '-e', 'const g=require(process.argv[1]);console.log(JSON.stringify(g.spec(process.argv[2],7)))', str(root / 'source/tools/games510.js'), g], capture_output=True, text=True, check=True).stdout); measure(g, 'reference', s, n)
for f, n in FIX:
    s = json.loads((root / f'source/studies/{f}.emfix.json').read_text(encoding='utf-8-sig'))['variants'][0]['nativeSpec']; s.pop('device', None); measure(f, 'fixture', s, n)
    measure(f, 'fixture, batches of 64', {**s, 'batchDeals': 64, 'actionStreams': 'deal'}, max(1, n // 64))
cpu = next((l.split(':', 1)[1].strip() for l in open('/proc/cpuinfo') if l.startswith('model name')), None) if os.path.exists('/proc/cpuinfo') else platform.processor()
import statistics
doc = {'tool': 'bench511.py', 'build': subprocess.run([cli, '--build-id'], capture_output=True, text=True).stdout.strip(), 'processor': cpu, 'logicalProcessors': os.cpu_count(), 'threads': 1, 'repeats': reps,
       'medianTimeRatio': {k: statistics.median(r['timeRatio'] for r in rows if r['kind'] == k) for k in ('reference', 'fixture', 'fixture, batches of 64')}, 'rows': rows}
out.write_text(json.dumps(doc, indent=1)); print(json.dumps(doc['medianTimeRatio']))
