"""Static bracket/string balance check for PowerShell scripts (4.6).
Not a parser: catches unbalanced (), {}, [], unterminated strings and here-strings,
which are the errors most likely from editing without a PowerShell to run.
usage: python3 -I ps_balance.py file.ps1 [...]   exit 1 on any problem"""
import sys
def check(path):
    s = open(path, encoding='utf-8-sig').read(); i = 0; n = len(s); stack = []; line = 1
    pairs = {')': '(', '}': '{', ']': '['}
    def err(msg): return f'{path}:{line}: {msg}'
    while i < n:
        c = s[i]
        if c == '\n': line += 1; i += 1; continue
        if s.startswith('<#', i):
            j = s.find('#>', i + 2)
            if j < 0: return err('unterminated block comment')
            line += s.count('\n', i, j); i = j + 2; continue
        if c == '#':
            j = s.find('\n', i); i = n if j < 0 else j; continue
        if s.startswith("@'", i) and s[i+2:i+3] in ('\n', '\r'):
            j = s.find("\n'@", i)
            if j < 0: return err('unterminated @\' here-string')
            line += s.count('\n', i, j + 1); i = j + 3; continue
        if s.startswith('@"', i) and s[i+2:i+3] in ('\n', '\r'):
            j = s.find('\n"@', i)
            if j < 0: return err('unterminated @" here-string')
            line += s.count('\n', i, j + 1); i = j + 3; continue
        if c == "'":
            j = i + 1
            while True:
                if j >= n: return err('unterminated single-quoted string')
                if s[j] == "'":
                    if j + 1 < n and s[j+1] == "'": j += 2; continue
                    break
                j += 1
            line += s.count('\n', i, j); i = j + 1; continue
        if c == '"':
            j = i + 1; depth = 0
            while True:
                if j >= n: return err('unterminated double-quoted string')
                if s[j] == '`': j += 2; continue
                if s.startswith('$(', j): depth += 1; j += 2; continue
                if depth and s[j] == ')': depth -= 1; j += 1; continue
                if s[j] == '"' and not depth:
                    if j + 1 < n and s[j+1] == '"': j += 2; continue
                    break
                j += 1
            line += s.count('\n', i, j); i = j + 1; continue
        if c == '`': i += 2; continue
        if c in '({[': stack.append((c, line))
        elif c in ')}]':
            if not stack or stack[-1][0] != pairs[c]:
                return err(f"unexpected '{c}'" + (f" (open '{stack[-1][0]}' from line {stack[-1][1]})" if stack else ''))
            stack.pop()
        i += 1
    if stack: return f"{path}: unclosed '{stack[-1][0]}' opened at line {stack[-1][1]}"
    return None
bad = 0
for p in sys.argv[1:]:
    e = check(p); print(e or f'ok  {p}'); bad += bool(e)
sys.exit(1 if bad else 0)
