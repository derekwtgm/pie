"""EightMax 3.8: genuine trained-state restoration series.

usage: python3 large-restore.py <mwcli> <spec.json> <workdir> <out.json> [updates ...]

For each update count U (default: sizes of roughly 128 MiB, 256 MiB, 512 MiB,
1 GiB and 2 GiB of live tables for the eight-player linked benchmark study):
  1. train U updates from scratch and save state A (one process);
  2. train U+1 updates from scratch and save state B (uninterrupted reference);
  3. restore A in a new process, train one update, save C, require C == B
     byte for byte (regrets, averages, betting states, RNGs, counters, CRC);
  4. restore A alone (mwcli --restore): record the pre-allocation estimate,
     the live table capacity, restore seconds and process peak RSS.
States are real solver output, not synthetic fixtures."""
import json, subprocess, sys, pathlib, hashlib, time, os
cli, spec, work, out = sys.argv[1:5]
updates = [int(x) for x in sys.argv[5:]] or [2300, 4600, 9300, 19000, 38500]
work = pathlib.Path(work); work.mkdir(parents=True, exist_ok=True)
threads = str(min(4, os.cpu_count() or 1)); mib = '12288'
def run(*args):
    r = subprocess.run([cli, *map(str, args)], capture_output=True, text=True)
    if r.returncode: raise SystemExit('mwcli failed: ' + ' '.join(map(str, args)) + '\n' + r.stderr + r.stdout)
    return json.loads(r.stdout)
def sha(p): return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
report = {'generated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'spec': pathlib.Path(spec).name, 'threads': int(threads), 'series': []}
for U in updates:
    a, b, c = work / 'A.state', work / 'B.state', work / 'C.state'
    t0 = time.time(); ia = run(spec, U, threads, a, mib); ta = time.time() - t0
    ib = run(spec, U + 1, threads, b, mib)
    ic = run(spec, 1, threads, c, mib, a)
    ir = run('--restore', spec, a, mib)
    est = ir['restoreEstimate']['totalBytes']; cap = ir['tableCapacityBytes']
    row = {'updates': U, 'committedDeals': ia['trainingDeals'], 'rows': ia['rows'], 'states': ia['states'], 'stateFileMiB': a.stat().st_size / 2**20,
           'liveTableMiB': ia['tableMiB'], 'trainSeconds': round(ta, 2), 'trainPeakRssMiB': ia['processPeakRssMiB'],
           'restoreSeconds': ir['restoreSeconds'], 'restorePeakRssMiB': ir['processPeakRssMiB'],
           'estimateMiB': est / 2**20, 'restoredCapacityMiB': cap / 2**20, 'estimateError': (est - cap) / cap,
           'resumedEqualsUninterrupted': sha(c) == sha(b), 'resumedSHA256': sha(c), 'resumedUpdates': ic['iterations'], 'resumedDeals': ic['trainingDeals']}
    report['series'].append(row); print(json.dumps(row), flush=True)
    for p in (a, b, c): p.unlink()
    pathlib.Path(out).write_text(json.dumps(report, indent=1))
report['allResumedEqual'] = all(r['resumedEqualsUninterrupted'] for r in report['series'])
pathlib.Path(out).write_text(json.dumps(report, indent=1))
sys.exit(0 if report['allResumedEqual'] else 1)
