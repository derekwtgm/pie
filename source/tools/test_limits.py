"""Host startup parsing and memory rejection; run against a native Linux host."""
import subprocess,os,sys,json,pathlib
exe=str(pathlib.Path(sys.argv[1]).resolve()); checks=[]
for value in ['0','-1','1.5','abc','257','999999999999999999999']:
 r=subprocess.run([exe,'--no-browser'],env={**os.environ,'EIGHTMAX_THREADS':value},capture_output=True,text=True,timeout=10)
 assert r.returncode==2,(value,r.returncode)
 assert 'must be an integer' in r.stderr
 checks.append('Rejected invalid EIGHTMAX_THREADS='+value)
r=subprocess.run(['node',str(pathlib.Path(__file__).with_name('cpu_benchmark.js')),exe,'/tmp/em-memory-test-unused.json'],env={**os.environ,'EIGHTMAX_MEMORY_MIB':'32','EM_LIMIT_STRESS':'1'},capture_output=True,text=True,timeout=120)
assert r.returncode==1 and 'exceeds EIGHTMAX_MEMORY_MIB limit' in r.stderr,r.stderr
checks.append('Native turn solve rejected before strategy allocation at 32 MiB limit')
print(json.dumps({'passed':True,'checks':checks},indent=2))
