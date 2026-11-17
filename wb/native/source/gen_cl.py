# embeds gpu_kernels.cl as a C string for the OpenCL path
import sys
src = open(sys.argv[1]).read()
out = ['// generated from gpu_kernels.cl by gen_cl.py', 'static const char GPU_CL_SRC[] =']
for line in src.split('\n'):
    out.append('  "' + line.replace('\\', '\\\\').replace('"', '\\"') + '\\n"')
out[-1] += ';'
open(sys.argv[2], 'w').write('\n'.join(out) + '\n')
