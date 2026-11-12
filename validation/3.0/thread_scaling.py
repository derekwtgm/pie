"""Run with python3 thread_scaling.py NATIVE_CLI from any directory on Linux."""
import hashlib
import json
import os
from pathlib import Path
import random
import resource
import subprocess
import sys
import tempfile
import time
here = Path(__file__).resolve().parent
root = here.parents[1]
source = root / 'source'
# Exercise a six-player tree large enough to use the parallel traversal/merge.
script = """
const E=require('./tools/loadlib');
for(const l of ['lib_runouts','lib_wide','lib_river','lib_river_ui']) require('./web/'+l);
const cfg={...E.multiwaySpotConfig(E.multiwayExample(6,'River',8)),privateMode:'sampled',
 abstraction:'exact',engine:'native',batchDeals:16,evaluationDeals:128,privateSeed:17};
process.stdout.write(JSON.stringify(E.MultiwayGame(cfg).nativeSpec()));
"""
spec = subprocess.check_output(['node','-e',script],cwd=source)
rows = []
threads = sorted({1,2,4,8,min(16,len(os.sched_getaffinity(0)))})
with tempfile.TemporaryDirectory() as tmp:
    folder = Path(tmp)
    path = folder/'spec.json'
    path.write_bytes(spec)
    reference = None
    for repeat in range(3):
        order = threads[:]
        random.Random(repeat).shuffle(order)
        for count in order:
            state = folder/'out.state'
            with tempfile.TemporaryFile() as log:
                start = time.perf_counter()
                p = subprocess.Popen([sys.argv[1],str(path),'64',str(count),str(state),'1024'],stdout=log)
                _,status,usage = os.wait4(p.pid,0)
                elapsed = time.perf_counter()-start
                p.returncode = os.waitstatus_to_exitcode(status)
                if p.returncode: raise RuntimeError(p.returncode)
                log.seek(0); info = json.load(log)
            body = state.read_bytes()
            offset = 12+int.from_bytes(body[8:12],'little')
            digest = hashlib.sha256(body[offset:]).hexdigest()
            if reference is None: reference = digest
            assert digest==reference and info['iterations']==64
            rows.append(dict(repeat=repeat,threads=count,trainSeconds=info['wallSeconds'],
                             processSeconds=elapsed,peakRssMiB=usage.ru_maxrss/1024,
                             cpuPercent=100*(usage.ru_utime+usage.ru_stime)/elapsed,
                             dealsPerSecond=info['trainingDeals']/info['wallSeconds'],strategySHA256=digest))
(here/'thread-scaling.json').write_text(json.dumps(dict(threads=threads,rows=rows),indent=2))
