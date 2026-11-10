"""Independent standard-library generator, streaming HTTP client and failure oracle.
Usage: python checkpoint_stress36.py path/to/eightmax report.json [16 64 128 256 512]
Run from the release root. Isolated profile, no personal study files touched.
"""
import contextlib, hashlib, http.client, itertools, json, os, pathlib, random, shutil, socket, struct, subprocess, sys, tempfile, time, zlib
from urllib.parse import urlparse
P=pathlib.Path
M=1<<20
def sample(exe,port,profile,env=None):
    return subprocess.Popen([str(exe),'--no-browser','--port='+str(port)],env={**os.environ,'HOME':str(profile),'USERPROFILE':str(profile),'EIGHTMAX_GPU':'off',**(env or {})},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
@contextlib.contextmanager
def host(exe,profile,env=None):
    with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
    proc=sample(exe,port,profile,env)
    try:
        for _ in range(400):
            try:
                if request(port,'info')[0]==200:break
            except OSError:pass
            time.sleep(.025)
        else:raise RuntimeError('host startup failed')
        yield port,proc
    finally:proc.terminate();proc.wait(timeout=10)
def request(port,path,body=None,chunked=False):
    h=http.client.HTTPConnection('127.0.0.1',port,timeout=1200)
    try:
        hdr={'X-EightMax':'1'}
        if body is not None and hasattr(body,'fileno') and not chunked:hdr['Content-Length']=str(os.fstat(body.fileno()).st_size)
        h.request('GET' if body is None else 'POST','/api/'+path,body=body,headers=hdr,encode_chunked=chunked)
        r=h.getresponse();return r.status,r.read()
    finally:h.close()
def digestfile(path):
    with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def download(port,key):
    h=http.client.HTTPConnection('127.0.0.1',port,timeout=1200);h.request('GET','/api/checkpoint/'+key)
    r=h.getresponse();assert r.status==200,(key,r.status,r.read());digest=hashlib.sha256();total=0
    while b:=r.read(65536):total+=len(b);digest.update(b)
    h.close();return total,digest.hexdigest()
def hwm(pid):
    try:return int(next(l.split()[1] for l in P('/proc',str(pid),'status').read_text().splitlines() if l.startswith('VmHWM:')))*1024
    except (OSError,StopIteration):return None
def fixture(folder,size,wide=False):
    seed=(folder/'small.state').read_bytes();ml=struct.unpack_from('<I',seed,8)[0];start=12+ml
    head=json.loads(seed[12:start]);sc=struct.unpack_from('<I',seed,start)[0];states=seed[start:start+4+9*sc]
    table=[struct.unpack_from('<IBBBBB',states,4+9*i) for i in range(sc)]
    sid=next(i for i,(_,slot,kind,actor,length,k) in enumerate(table) if kind==0 and length==5 and k>=2)
    if wide:sid=max((i for i,t in enumerate(table) if t[2]==0 and t[4]==5),key=lambda i:table[i][5])
    actor,k=table[sid][3],table[sid][5];hands=json.loads((folder/'spec.json').read_text())['hands'][actor]
    unit=12+16*k;rows=max(1,(size*M-len(states)-ml-20)//unit)
    rng=random.Random(36);values=[struct.pack('<'+'d'*(2*k),*[rng.uniform(-50,50) for _ in range(k)],*[rng.uniform(0,100) for _ in range(k)]) for _ in hands]
    header=json.dumps(head,separators=(',',':')).encode();fp=folder/'large.state'
    with fp.open('wb+') as out:
        out.write(b'EMMW4\0\0\0'+struct.pack('<I',len(header))+header)
        prefix=states+struct.pack('<I',rows);out.write(prefix);crc=zlib.crc32(prefix);done=0;buf=bytearray()
        for board in itertools.permutations(range(52),5):
            if not board[0]<board[1]<board[2]:continue
            cards=bytes(c+1 for c in board)+bytes([k])
            for i,(_,a,b,_) in enumerate(hands):
                if a in board or b in board:continue
                buf.extend(struct.pack('<IH',sid,i));buf.extend(cards);buf.extend(values[i]);done+=1
                if len(buf)>=M:out.write(buf);crc=zlib.crc32(buf,crc);buf.clear()
                if done==rows:break
            if done==rows:break
        out.write(buf);crc=zlib.crc32(buf,crc)
        head['rowCrc32']=format(crc&0xffffffff,'08x');rep=json.dumps(head,separators=(',',':')).encode();assert len(rep)==len(header)
        out.seek(12);out.write(rep)
    meta=(folder/'meta.json').read_bytes();dest=folder/'large.emstudy';manifest=hashlib.sha256()
    with fp.open('rb') as inp,dest.open('wb') as out:
        h=b'EMCP36\r\n'+struct.pack('<IIQ',1,len(meta),fp.stat().st_size)+meta;manifest.update(h);out.write(h)
        while b:=inp.read(256*1024):
            d=struct.pack('<II',len(b),len(b))+hashlib.sha256(b).digest();manifest.update(d);out.write(d);out.write(b)
        out.write(manifest.digest())
    return dest,rows
def main():
    exe=P(sys.argv[1]).resolve();dest=P(sys.argv[2]);sizes=list(map(int,sys.argv[3:])) or [16,64,128,256,512]
    result={'kind':'Synthetic legal physical river rows on a betting state reached by an eight-seat linked study. Retains the trained seed topology. Absolute values exercise persistence, not convergence. Raw wire blocks force the requested disk and network sizes.','runs':[]}
    with tempfile.TemporaryDirectory(prefix='em36-stress-') as td:
        d=P(td);subprocess.run(['node',str(P(__file__).with_name('fixture36.js')),str(d)],check=True)
        small=d/'small.emstudy';smallSha=digestfile(small)
        for size in sizes:
            then=time.monotonic();big,rows=fixture(d,size);made=time.monotonic()-then;expected=(big.stat().st_size,digestfile(big));profile=d/'profile';profile.mkdir(exist_ok=True);(profile/'Documents').mkdir(exist_ok=True)
            with host(exe,profile) as (port,proc):
                with small.open('rb') as f:assert request(port,'checkpoint/write',f)[0]==200
                baseline=hwm(proc.pid);ts=time.monotonic()
                with big.open('rb') as f:
                    code,reply=request(port,'checkpoint/write',f,size==128)
                assert code==200,(code,reply);saved=time.monotonic()-ts;savePeak=hwm(proc.pid)
                start=time.monotonic();assert download(port,'latest')==expected;readSeconds=time.monotonic()-start
                assert download(port,'previous')[1]==smallSha
                info=json.loads(request(port,'info')[1]);store=P(info['saveDir']);(store/'autosave.index').write_bytes(b'corrupt')
            with host(exe,profile) as (port,proc):
                start=time.monotonic();st=json.loads(request(port,'checkpoint/status')[1]);assert st['generation']=='2' and st['reconstructed'];assert download(port,'latest')==expected
                recovered=time.monotonic()-start;peak=hwm(proc.pid)
            row={'nominalMiB':size,'rows':rows,'storedBytes':expected[0],'sha256':expected[1],'fixtureSeconds':made,'saveSeconds':saved,'loadSeconds':readSeconds,'coldIndexRebuildPlusLoadSeconds':recovered,'hostPeakBeforeLargeBytes':baseline,'saveHostHighWaterBytes':savePeak,'recoveryHostHighWaterBytes':peak,'chunkedHTTP':size==128}
            result['runs'].append(row);dest.write_text(json.dumps(result,indent=2));print(json.dumps(row),flush=True);shutil.rmtree(profile)
if __name__=='__main__':main()
