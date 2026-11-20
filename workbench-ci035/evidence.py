"""EightMax Test Workbench 0.35.0 packaging helper: turn the Windows CI results in ci-results/0.35/ into release evidence.
Appends one record per 0.35 CI run to evidence/windows-ci-runs.json (the executables that run built AND tested, by SHA-256, and what
was observed), copies the small reports to evidence/windows-ci-0.35/<run>/ and the latest ones to reports/0.35-*.json.
Usage: python3 evidence.py RELEASE_TREE CI_RESULTS_DIR"""
import hashlib, json, re, shutil, sys
from pathlib import Path
tree, ci = Path(sys.argv[1]), Path(sys.argv[2])
def load(p):
    try: return json.loads(p.read_text(encoding='utf-8-sig'))
    except Exception: return None
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
ev_path = tree / 'evidence/windows-ci-runs.json'; ev = json.loads(ev_path.read_text())
ev['note'] = (ev.get('note') or '') + ' 0.35: records "0.35.0 ..." come from workbench-ci035 runs (ci-results/0.35/ on the development branch).'
runs = sorted([d for d in ci.iterdir() if d.is_dir() and d.name.startswith('run-')], key=lambda d: int(d.name.split('-')[1]))
latest = {}
for d in runs:
    rid = int(d.name.split('-')[1]); summ = load(d / 'ci-summary.json')
    if not summ: continue   # cancelled or incomplete run: no evidence
    stages = summ.get('stages', {})
    st = lambda k: (stages.get(k, {}) or {}).get('exit') if isinstance(stages.get(k), dict) else stages.get(k)
    sel = load(d / 'input-selftest.json'); acc = load(d / 'input-acceptance.json'); bench = load(d / 'simulator-benchmark.json')
    if bench and 'workloads' not in bench and 'runs' in bench: bench = {**bench, 'workloads': [{'name': 'stress', 'runs': bench['runs'], 'sustainableTables': bench.get('sustainableTables')}]}
    tests = None
    for f in ('node-tests-all.txt', 'node-tests-035.txt'):
        p = d / f
        if p.exists():
            raw = p.read_bytes(); txt = raw.decode('utf-16') if raw[:2] in (b'\xff\xfe', b'\xfe\xff') else raw.decode('utf-8', 'replace').lstrip('﻿')
            m = {k: int(v) for k, v in re.findall(r'^# (tests|pass|fail|skipped|cancelled) (\d+)', txt, re.M)}
            if m: tests = {'file': f, **m, 'failed': re.findall(r'^not ok \d+ - (.*)$', txt, re.M)[:20]}; break
    bins = {}
    if (d / 'bin').exists():
        for e in sorted((d / 'bin').iterdir()): bins['desktop/bin/' + e.name] = sha(e)
    exe = summ.get('executables')   # validate-zip runs list the files of the exact ZIP
    if exe: bins = {k: v for k, v in exe.items()}
    if not bins: continue
    obs = {}
    if sel: obs['desktop/bin/EightMaxInput.exe'] = 'input self-test %s/%s (%s)' % (sel.get('passed'), sel.get('total'), sel.get('dpiAwareness'))
    if acc: obs['desktop/bin/EightMaxInput.exe'] = obs.get('desktop/bin/EightMaxInput.exe', '') + '; input acceptance %s/%s checks on the controlled test tables' % (acc.get('passed'), acc.get('total')); obs['desktop/bin/EightMaxTestTable.exe'] = 'controlled test table in the input acceptance (%s/%s)' % (acc.get('passed'), acc.get('total'))
    if bench:
        parts = []
        for w in bench.get('workloads', []):
            rs = [r for r in w.get('runs', []) if not r.get('error')]
            parts.append('%s: sustainable %s tables, %d confirmed, %d incorrect clicks, %d incorrect wagers' % (w.get('name'), w.get('sustainableTables'), sum(r['actions']['confirmed'] for r in rs), sum(r['correctness']['incorrectClicks'] for r in rs), sum(r['correctness']['incorrectWagers'] for r in rs)))
        obs['desktop/bin/EightMaxWorkbench.exe'] = 'end-to-end benchmark through the host (capture + input broker): ' + '; '.join(parts)
    if tests: obs['runtime/node/node.exe'] = 'Node %s: %s tests, %s pass, %s fail, %s skipped' % (tests['file'], tests.get('tests'), tests.get('pass'), tests.get('fail'), tests.get('skipped'))
    rel = st('release-acceptance')
    if rel is not None: obs['desktop/bin/EightMaxWorkbench.exe'] = obs.get('desktop/bin/EightMaxWorkbench.exe', '') + '; release acceptance exit %s' % rel
    kind = 'release ZIP validation' if summ.get('format') == 'eightmax-ci-035-validate' else 'build + test'
    rec = {'release': '0.35.0 ' + kind + ' run', 'runId': rid, 'date': None, 'conclusion': 'see stages', 'runner': 'GitHub-hosted windows-latest: Microsoft Windows Server 2025 Datacenter, no GPU, Hyper-V virtual display set to 1920x1080 at 100 %',
           'candidate': ('ZIP sha256 ' + summ.get('zipSha256', '')) if summ.get('zipSha256') else 'assembled from the 0.33.0 ZIP + workbench-src (commit %s)' % (summ.get('sha') or '')[:12],
           'executables': bins, 'observed': obs, 'stages': stages, 'tests': tests}
    ev['runs'] = [r for r in ev['runs'] if r.get('runId') != rid] + [rec]
    dst = tree / 'evidence/windows-ci-0.35' / d.name; dst.mkdir(parents=True, exist_ok=True)
    for f in ('ci-summary.json', 'input-selftest.json', 'input-acceptance.json', 'simulator-benchmark.json', 'build-evidence.json', 'node-tests-035.txt', 'node-tests-all.txt', 'ci-log.txt'):
        if (d / f).exists() and (d / f).stat().st_size < 4_000_000: shutil.copy(d / f, dst / f)
    for f in ('input-selftest.json', 'input-acceptance.json', 'simulator-benchmark.json'):
        if (d / f).exists(): latest[f] = d / f
ev_path.write_text(json.dumps(ev, indent=2) + '\n')
for f, p in latest.items(): shutil.copy(p, tree / 'reports' / ('0.35-windows-' + f))
print('evidence: %d 0.35 runs recorded; latest reports: %s' % (len(runs), ', '.join(sorted(latest))))
