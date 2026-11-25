#!/usr/bin/env python3
"""EightMax 5.11: the reference files of section "streams 5.11" of the Windows validation script
(validation/5.11/windows/streams). Usage: make_reference511.py <release root> <5.11 mwcli (Linux build)>

  flop3-kings-philox64-batch64.spec.json  the three-player flop fixture (Compact hand groups, 109 to 360 hands a seat)
                                          with {"trainingStreams":"philox64"} and frozen batches of 64 deals;
                                          reference.json records the SHA-256 of the state the Linux build writes after
                                          `updates` updates. The Windows program must write the same bytes with every
                                          thread count and processing mode. (The fixture's "device" key is removed:
                                          the script puts the mode in front.)
  *-streams510-*.spec.json / *-philox64-*.spec.json   three fixtures with the 5.10 streams and with philox64, for the
                                          throughput measurement (information; nothing is compared).
Run again only after an intended change of the streams; the script checks nothing itself."""
import sys, json, subprocess, pathlib, hashlib, os
root = pathlib.Path(sys.argv[1]).resolve(); cli = str(pathlib.Path(sys.argv[2]).resolve()); out = root / 'validation/5.11/windows/streams'; out.mkdir(parents=True, exist_ok=True)
BATCH = {'batchDeals': 64, 'actionStreams': 'deal'}; WIDE = {'trainingStreams': 'philox64'}
def fixture(name, extra, file):
    s = json.loads((root / f'source/studies/{name}.emfix.json').read_text(encoding='utf-8-sig'))['variants'][0]['nativeSpec']; s.pop('device', None); s.update(extra); (out / file).write_text(json.dumps(s)); return file
ref = {'tool': 'make_reference511.py', 'build': subprocess.run([cli, '--build-id'], capture_output=True, text=True).stdout.strip(), 'algorithm': 'streams-5.11-philox4x64-v1'}
spec = fixture('flop3-kings', {**WIDE, **BATCH}, 'flop3-kings-philox64-batch64.spec.json'); updates = 120; state = out / 'tmp.state'
env = dict(os.environ); env['EIGHTMAX_THREAD_CHOICE'] = 'fixed'
p = subprocess.run([cli, str(out / spec), str(updates), '3', str(state), '512'], capture_output=True, text=True, env=env)
if p.returncode: sys.exit(p.stderr)
info = json.loads(p.stdout); assert info['trainingStreams'] == ref['algorithm']
ref['threads'] = {'spec': spec, 'updates': updates, 'memoryMiB': 512, 'sampledDeals': info['trainingDeals'], 'rows': info['rows'], 'stateSha256': hashlib.sha256(state.read_bytes()).hexdigest()}
state.unlink(); ref['throughput'] = []
for name, upd, batch in (('flop6-jack', 1500, True), ('flop3-kings', 3000, True), ('known-akq-river', 4000000, False)):
    b = BATCH if batch else {}; tag = '-batch64' if batch else ''
    ref['throughput'].append({'name': name, 'batch': batch, 'updates': upd, 'streams510Spec': fixture(name, b, f'{name}-streams510{tag}.spec.json'), 'philox64Spec': fixture(name, {**WIDE, **b}, f'{name}-philox64{tag}.spec.json')})
(out / 'reference.json').write_text(json.dumps(ref, indent=1) + '\n'); print(json.dumps(ref['threads']))
