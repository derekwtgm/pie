"""Rebuild the embedded CUDA module with NVRTC 12.9. Pass the NVRTC library path."""
import ctypes as c
from pathlib import Path
import sys
import hashlib
here = Path(__file__).resolve().parent
lib = c.CDLL(sys.argv[1])
def check(rc):
    if rc:
        raise RuntimeError(f'NVRTC error {rc}')
program = c.c_void_p()
check(lib.nvrtcCreateProgram(c.byref(program), (here/'score.cu').read_bytes(), b'score.cu', 0, None, None))
options = (c.c_char_p*1)(b'--gpu-architecture=compute_75')
check(lib.nvrtcCompileProgram(program, 1, options))
size = c.c_size_t()
check(lib.nvrtcGetPTXSize(program, c.byref(size)))
ptx = c.create_string_buffer(size.value)
check(lib.nvrtcGetPTX(program, ptx))
(here/'score_ptx.hpp').write_bytes(b'// score.cu SHA256 '+hashlib.sha256((here/'score.cu').read_bytes().replace(b'\r\n',b'\n')).hexdigest().encode()+b'\nstatic constexpr char scorePTX[]=R"ptx('+ptx.value+b')ptx";\n')
check(lib.nvrtcDestroyProgram(c.byref(program)))
