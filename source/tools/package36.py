"""Build a deterministic ZIP and check every archived member against its manifest."""
import hashlib,pathlib,shutil,subprocess,sys,tempfile,zipfile
root=pathlib.Path(sys.argv[1]).resolve();out=pathlib.Path(sys.argv[2]).resolve()
out.parent.mkdir(parents=True,exist_ok=True)
subprocess.run(['node',str(root/'source/tools/verify_build.js'),str(root)],check=True)
files=[p for p in root.iterdir() if p.is_file() and (p.suffix.lower() in {'.md','.bat'} or p.name in {'README.txt','BUILD-INFO.json','EightMax.exe','mwcli.exe','EightMax-Offline.html'})]
for folder in ['source','validation','.github']:
    files.extend(p for p in (root/folder).rglob('*') if p.is_file() and not {'build','__pycache__'}.intersection(p.relative_to(root).parts) and p.suffix!='.pyc')
items={p.relative_to(root).as_posix():p for p in files}
def digest(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
hashes={n:digest(p) for n,p in sorted(items.items())}
manifest=root/'SHA256SUMS.txt'
manifest.write_bytes(''.join(h+'  '+n+'\n' for n,h in hashes.items()).encode())
items[manifest.name]=manifest
with tempfile.TemporaryDirectory(dir=out.parent) as temp:
    candidate=pathlib.Path(temp)/out.name
    with zipfile.ZipFile(candidate,'w') as z:
        for name,p in sorted(items.items()):
            info=zipfile.ZipInfo('EightMax/'+name,(2026,11,9,0,0,0));info.create_system=3
            info.external_attr=(0o100755 if name.endswith(('.sh','.exe')) else 0o100644)<<16
            info.compress_type=zipfile.ZIP_DEFLATED
            with z.open(info,'w') as dst,p.open('rb') as src:shutil.copyfileobj(src,dst,1<<20)
    with zipfile.ZipFile(candidate) as z:
        assert z.testzip() is None
        m=dict(line.split('  ',1)[::-1] for line in z.read('EightMax/SHA256SUMS.txt').decode().splitlines())
        assert m==hashes and len(items)==len(z.namelist()) and set(items)=={x.removeprefix('EightMax/') for x in z.namelist()}
        for name,h in m.items():
            with z.open('EightMax/'+name) as f:assert hashlib.file_digest(f,'sha256').hexdigest()==h,name
    candidate.replace(out)
print(f'{len(hashes)} SHA-256 entries verified, ZIP CRC passed, {out.stat().st_size} bytes')
print(digest(out)+'  '+out.name)
