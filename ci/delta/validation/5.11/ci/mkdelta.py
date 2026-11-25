#!/usr/bin/env python3
"""Writes the files of <new tree> that are new or differ from <base tree> into <out>/delta, and the deleted ones into <out>/delete.txt."""
import sys, pathlib, shutil, filecmp
new, base, out = (pathlib.Path(a).resolve() for a in sys.argv[1:4]); skip = {'build', 'dev', 'node_modules'}
if (out / 'delta').exists(): shutil.rmtree(out / 'delta')
n = 0; exe = {'.exe', '.html'}
for f in sorted(new.rglob('*')):
    rel = f.relative_to(new)
    if not f.is_file() or rel.parts[0] in skip: continue
    if len(rel.parts) == 1 and (f.suffix in exe or f.name in ('BUILD-INFO.json', 'SHA256SUMS.txt')): continue   # built or generated
    if rel.parts[:3] == ('validation', '5.11', 'linux-bin'): continue
    b = base / rel
    if b.is_file() and filecmp.cmp(f, b, shallow=False): continue
    d = out / 'delta' / rel; d.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(f, d); n += 1
gone = [str(f.relative_to(base)) for f in sorted(base.rglob('*')) if f.is_file() and f.relative_to(base).parts[0] not in skip and not (new / f.relative_to(base)).exists()]
(out / 'delete.txt').write_text('\n'.join(gone) + ('\n' if gone else '')); print(n, 'files in delta;', len(gone), 'deleted')
