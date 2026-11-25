#!/usr/bin/env python3
"""EightMax 5.11: the released program writes the states of the experiment.
Usage: reproduce511.py <release root> <release mwcli (Linux)> <exact dir> <out.json>
The experiment (convergence511.py) ran with a development build of the 5.11 source, recorded in its plan by SHA-256.
For three seeds (the first, a middle one and the last) and every game, this trains the philox64 arm to 100,000 deals
and the frozen-batch arm to 512,000 deals with the RELEASED program and compares the SHA-256 of the state with the
experiment's row. Equal states mean equal strategies and therefore equal NashConv."""
import sys, json, gzip, subprocess, pathlib, hashlib, tempfile
root = pathlib.Path(sys.argv[1]).resolve(); cli = str(pathlib.Path(sys.argv[2]).resolve()); ex = pathlib.Path(sys.argv[3]); out = pathlib.Path(sys.argv[4])
plan = json.loads((ex / 'plan.json').read_text()); rows = [json.loads(l) for l in gzip.open(ex / 'raw.jsonl.gz', 'rt')]; w = pathlib.Path(tempfile.mkdtemp())
seeds = [plan['seeds'][0], plan['seeds'][len(plan['seeds']) // 2], plan['seeds'][-1]]; res = []; WIDE = {'trainingStreams': 'philox64'}; BATCH = {'batchDeals': 64, 'actionStreams': 'deal'}
def sha_of(game, seed, extra, updates):
    sp = w / 's.json'; st = w / 's.state'; subprocess.run(['node', str(root / 'source/tools/games510.js'), 'spec', game, str(sp), str(seed), json.dumps(extra)], check=True, capture_output=True)
    p = subprocess.run([cli, str(sp), str(updates), '1', str(st), '512'], capture_output=True, text=True); return hashlib.sha256(st.read_bytes()).hexdigest() if p.returncode == 0 else 'failed: ' + p.stderr[-100:]
for seed in seeds:
    for g in plan['games']:
        want = next(r['sha'] for r in rows if r['game'] == g and r['seed'] == seed and r['arm'] == 'p511' and r['kind'] == 'deals' and r['budget'] == 100000)
        res.append({'game': g, 'seed': seed, 'cell': 'p511, 100,000 deals', 'identical': sha_of(g, seed, WIDE, 100000) == want})
        b = [r['sha'] for r in rows if r['game'] == g and r['seed'] == seed and r['arm'] == 'p511b']
        if b: res.append({'game': g, 'seed': seed, 'cell': 'p511b, 512,000 deals in batches of 64', 'identical': sha_of(g, seed, {**WIDE, **BATCH}, plan['batchDeals'] // 64) == b[0]})
doc = {'tool': 'reproduce511.py', 'releaseBuild': subprocess.run([cli, '--build-id'], capture_output=True, text=True).stdout.strip(), 'experimentBuild': plan['build']['mwcli511'], 'experimentBinarySha256': plan['binarySha256']['mwcli511'],
       'seeds': seeds, 'compared': len(res), 'identical': sum(r['identical'] for r in res), 'different': [r for r in res if not r['identical']]}
out.write_text(json.dumps(doc, indent=1) + '\n'); print(json.dumps({k: v for k, v in doc.items() if k != 'different'})); sys.exit(0 if doc['compared'] == doc['identical'] else 1)
