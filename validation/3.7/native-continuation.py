"""Restore a genuine 3.6 trained archive, advance through HTTP, commit, restart and compare every state byte."""
import hashlib,struct,json,sys,tempfile,time,pathlib,subprocess,importlib.util,http.client
P=pathlib.Path;root=P(__file__).resolve().parents[2]
module=importlib.util.spec_from_file_location('transport',root/'source/tools/checkpoint_stress36.py')
s=importlib.util.module_from_spec(module);module.loader.exec_module(s)
exe,cli,out=map(lambda x:P(x).resolve(),sys.argv[1:4])
def check(port,route,body=None):
    code,data=s.request(port,route,body);assert code==200,(route,code,data[:250]);return json.loads(data)
def decode(r):
    h=r.read(24);assert h[:8]==b'EMCP36\r\n';_,ml,total=struct.unpack_from('<IIQ',h,8);meta=r.read(ml)
    manifest=hashlib.sha256(h+meta);full=hashlib.sha256();left=total
    while left:
        d=r.read(40);manifest.update(d);n,w=struct.unpack_from('<II',d);assert n==min(left,262144)
        block=r.read(w)
        if n!=w:
            raw=bytearray();i=0
            while i<len(block):
                cmd=block[i];i+=1;k=(cmd&127)+1
                if cmd&128:raw.extend(bytes(k))
                else:raw.extend(block[i:i+k]);i+=k
            block=raw
        assert len(block)==n and hashlib.sha256(block).digest()==d[8:]
        full.update(block);left-=n
    assert manifest.digest()==r.read(32) and r.read(1)==b''
    return full.hexdigest(),json.loads(meta)['state']['iterations'],total
def encode(meta,raw,archive):
    meta=json.dumps(meta,separators=(',',':')).encode();h=b'EMCP36\r\n'+struct.pack('<IIQ',1,len(meta),raw.stat().st_size)+meta
    with archive.open('wb') as a,raw.open('rb') as f:
        a.write(h);man=hashlib.sha256(h)
        while b:=f.read(262144):
            d=struct.pack('<II',len(b),len(b))+hashlib.sha256(b).digest();man.update(d);a.write(d);a.write(b)
        a.write(man.digest())
def main():
    with tempfile.TemporaryDirectory() as folder:
        d=P(folder);profile=d/'profile';(profile/'Documents').mkdir(parents=True)
        spec=root/'validation/3.6/linked-fixture/spec.json';meta=json.loads((spec.parent/'meta.json').read_text())
        if len(sys.argv)>4:
            existing=P(sys.argv[4]);raw=existing/'state';archive=existing/'real.emstudy'
        else:
            raw=d/'trained';archive=d/'trained.emstudy';subprocess.run([cli,spec,'20000','2',raw,'4096'],check=True,stdout=subprocess.DEVNULL)
            meta['state']['iterations']=20000;encode(meta,raw,archive)
        direct=d/'direct';ref=json.loads(subprocess.check_output([cli,spec,'20007','2',direct,'4096']))
        with s.host(exe,profile) as (port,proc):
            t=time.monotonic()
            with archive.open('rb') as f:check(port,'checkpoint/native-upload',f)
            restore=time.monotonic()-t;peak=s.hwm(proc.pid);start=check(port,'mw/status')['engine'];assert start['iterations']==20000
            check(port,'mw/desktop-train',b'{"iterations":7,"threads":2}')
            while check(port,'mw/status')['running']:time.sleep(.03)
            trained=check(port,'mw/status')['engine'];assert trained['iterations']==ref['iterations'] and trained['rng']==ref['rng']
            t=time.monotonic();check(port,'checkpoint/native-save',b'');save=time.monotonic()-t
            ssh=check(port,'checkpoint/status');saved=P(check(port,'info')['saveDir']);(saved/'autosave.index').write_bytes(b'corrupt')
        with s.host(exe,profile) as (port,proc):
            t=time.monotonic();check(port,'checkpoint/native-latest',b'');cold=time.monotonic()-t
            a=check(port,'mw/status')['engine'];assert a['trainingDeals']==80028
            conn=http.client.HTTPConnection('127.0.0.1',port);conn.request('GET','/api/checkpoint/latest');r=conn.getresponse();assert r.status==200
            actual,it,total=decode(r);conn.close();expected=s.digestfile(direct);assert actual==expected and it==20007
        out.write_text(json.dumps({'kind':'Actual eight-seat linked study with full native table and RNG byte equivalence','platform':sys.platform,'archiveBytes':archive.stat().st_size,'rawBytes':raw.stat().st_size,'restoreSeconds':restore,'peakRestoringHostMiB':peak/2**20,'start':start,'trained':trained,'saveSeconds':save,'statusAfterSave':ssh,'coldIndexRecoveryAndRestoreSeconds':cold,'resumedRawBytes':total,'resumedSHA256':actual,'uninterruptedSHA256':expected,'threads':2},indent=2));print(actual)
if __name__=='__main__':main()
