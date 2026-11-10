"""Verify PE architecture, dependent DLLs, embedded CUDA images, repeat builds, and the offline source identity."""
import argparse,hashlib,json,pathlib,re,struct,subprocess
P=pathlib.Path
a=argparse.ArgumentParser(description=__doc__);a.add_argument('repeat',type=P);a.add_argument('output',type=P);a.add_argument('--objdump',default='x86_64-w64-mingw32-objdump');a.add_argument('--v36',type=P)
args=a.parse_args();root=P(__file__).resolve().parents[2];h=lambda b:hashlib.sha256(b).hexdigest()
src=root/'source/native';header=(src/'score_ptx.hpp').read_text();kernel=(src/'score.cu').read_bytes()
assert h(kernel) in header
asserted=False
if args.v36:
 for name in ['score.cu','score_ptx.hpp']:assert (src/name).read_bytes()==(args.v36/'source/native'/name).read_bytes()
 asserted=True
result=dict(build=json.loads((root/'BUILD-INFO.json').read_text())['build'],target='Windows x64, cross-compiled on Linux, two separate links',sourceVerification=subprocess.check_output(['node',root/'source/tools/verify_build.js',root],text=True).strip(),
    cudaSourceSHA256=h(kernel),cudaImagesMatch36=asserted,binaries={},images=[])
ptx=header.split('R"ptx(',1)[1].split(')ptx"',1)[0].encode();images=[('PTX',ptx)]
for arch,data in re.findall(r'scoreCubin_sm_(\d+)\[\]=\{([0-9,\s]+)\};',header):
 images.append(('sm_'+arch,bytes(int(t) for t in data.split(',') if t.strip())))
assert len(images)==5
for name in ['EightMax.exe','mwcli.exe']:
 b=(root/name).read_bytes();assert b==(args.repeat/name).read_bytes()
 offset=struct.unpack_from('<I',b,60)[0];assert b[offset:offset+4]==b'PE\0\0' and struct.unpack_from('<H',b,offset+4)[0]==0x8664
 imports=subprocess.check_output([args.objdump,'-p',root/name],text=True)
 result['binaries'][name]=dict(bytes=len(b),sha256=h(b),PE='x86-64',repeatIdentical=True,imports=re.findall(r'DLL Name: (\S+)',imports))
 for _,image in images:assert image in b
for name,image in images:result['images'].append(dict(name=name,bytes=len(image),sha256=h(image),presentInBothBinaries=True))
result['offlineHTML_SHA256']=h((root/'EightMax-Offline.html').read_bytes());args.output.write_text(json.dumps(result,indent=2))
