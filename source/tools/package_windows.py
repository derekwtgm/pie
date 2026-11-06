"""Refresh only the embedded HTML and version data of a verified EightMax Windows host."""
import argparse
import hashlib
import struct
from pathlib import Path

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('base',type=Path,help='known 1.6 through 2.3 EightMax.exe')
parser.add_argument('html',type=Path,help='native.html produced by build.js')
parser.add_argument('output',type=Path)
args=parser.parse_args()
image=bytearray(args.base.read_bytes())
# The immutable fingerprint covers ALL bytes outside two fixed read-only data
# slots, including the PE headers, native machine code and OpenCL source.
version=329842
begin,end=330224,1166177
if (len(image)!=1539072 or image[version:version+4] not in (b'1.6\0',b'1.7\0',b'1.8\0',b'1.9\0',b'2.0\0',b'2.1\0',b'2.2\0',b'2.3\0',b'2.4\0',b'2.5\0') or
    image[begin:begin+15]!=b'<!DOCTYPE html>' or image[end]!=0):
    raise SystemExit('Unknown Windows host layout. Use the full native source build.')
normalized=image.copy()
normalized[version:version+3]=b'000'
normalized[begin:end]=bytes(end-begin)
if hashlib.sha256(normalized).hexdigest()!='cbbb6273d0ab97dade1ba0e746a2aca2f1d5fbb185cc40dcfec4ed331551c7a5':
    raise SystemExit('Windows host verification failed. Use the full native source build.')
pe=struct.unpack_from('<I',image,0x3c)[0]
assert image[pe:pe+4]==b'PE\0\0' and struct.unpack_from('<H',image,pe+4)[0]==0x8664
ui=args.html.read_bytes()
if len(ui)>end-begin or not ui.startswith(b'<!DOCTYPE html>') or b'window.EM_NATIVE = true;' not in ui or not ui.rstrip().endswith(b'</html>'):
    raise SystemExit('Invalid UI or reserved space exceeded. Use the full native source build.')
image[begin:end]=ui.ljust(end-begin,b' ')
image[version:version+3]=b'2.5'
args.output.parent.mkdir(parents=True,exist_ok=True)
temp=args.output.with_suffix('.tmp')
temp.write_bytes(image);temp.replace(args.output)
print('Packaged',args.output.name,'with',len(ui),'bytes of updated UI')
