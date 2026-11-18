"""Developer utility: regenerate SHA256SUMS.txt (every file except the manifest itself) and verify it."""
import hashlib, sys
from pathlib import Path
root = Path(__file__).resolve().parent.parent
files = sorted(p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file() and p.name != 'SHA256SUMS.txt' and '.git' not in p.parts and 'release' not in p.relative_to(root).parts[:1])
lines = [hashlib.sha256((root / f).read_bytes()).hexdigest() + '  ' + f for f in files]
(root / 'SHA256SUMS.txt').write_text('\n'.join(lines) + '\n')
bad = [f for f in files if hashlib.sha256((root / f).read_bytes()).hexdigest() != lines[files.index(f)].split('  ')[0]]
print(len(files), 'files listed;', 'verification failures:', len(bad))
sys.exit(1 if bad else 0)
