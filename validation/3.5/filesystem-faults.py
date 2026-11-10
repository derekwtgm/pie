"""Linux integration checks: POSIX access denial and kernel-enforced file size cap.
python filesystem-faults.py /path/to/eightmax output.json
"""
import contextlib,json,os,resource,signal,socket,subprocess,sys,tempfile,time,urllib.request,urllib.error
from pathlib import Path
exe=str(Path(sys.argv[1]).resolve())
testdata=json.loads((Path(__file__).resolve().parents[2]/'source/tests/fixtures/checkpoints-2.5.json').read_text())
a,b=[testdata[k]['text'].encode() for k in ('exact','wide')]
@contextlib.contextmanager
def host(home,cap=False):
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0))
        port=sock.getsockname()[1]
    def limit():
        signal.signal(signal.SIGXFSZ,signal.SIG_IGN)
        resource.setrlimit(resource.RLIMIT_FSIZE,(512,512))
    proc=subprocess.Popen([exe,'--no-browser',f'--port={port}'],env={**os.environ,'HOME':home,'EIGHTMAX_GPU':'off','EIGHTMAX_THREADS':'2'},preexec_fn=limit if cap else None,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    def api(route,data=None):
        req=urllib.request.Request(f'http://127.0.0.1:{port}/api/'+route,data=data,headers={'X-EightMax':'1'})
        try:
            with urllib.request.urlopen(req,timeout=20) as response:return response.status,response.read()
        except urllib.error.HTTPError as e:return e.code,e.read()
    try:
        for _ in range(150):
            try:
                if api('info')[0]==200:break
            except OSError:time.sleep(.04)
        yield api
    finally:proc.terminate();proc.wait(timeout=10)
rows=[]
with tempfile.TemporaryDirectory() as tmp:
    with host(tmp) as api:
        folder=Path(json.loads(api('info')[1])['saveDir'])
        assert api('checkpoint/write',a)[0]==200 and api('checkpoint/write',b)[0]==200
    for case in ['file-size limit','directory permission denied']:
        if case.startswith('directory') and os.geteuid()==0:
            rows.append({'case':case,'status':'skipped as root'});continue
        with host(tmp,case.startswith('file-size')) as api:
            if case.startswith('directory'):folder.chmod(0o500)
            try:
                status,_=api('checkpoint/write',a);assert status==500,status
                assert api('checkpoint/latest')==(200,b) and api('checkpoint/previous')==(200,a)
                rows.append({'case':case,'http':status,'latestAndPreviousIntact':True})
            finally:folder.chmod(0o700)
Path(sys.argv[2]).write_text(json.dumps(rows,indent=2))
