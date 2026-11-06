# embed an HTML file into ui_html.h as a byte array
import sys
src, dst = sys.argv[1], sys.argv[2]
data = open(src, 'rb').read()
with open(dst, 'w') as f:
    f.write('// generated from %s\n#pragma once\nstatic const unsigned char UI_HTML[] = {\n' % src.split('/')[-1])
    for i in range(0, len(data), 40):
        f.write(','.join(str(b) for b in data[i:i+40]) + ',\n')
    f.write('0};\nstatic const unsigned int UI_HTML_LEN = %d;\n' % len(data))
print('embedded', len(data), 'bytes')
