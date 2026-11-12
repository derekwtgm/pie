"""EightMax 3.8: independent check of the native strategy explorer.

usage: python3 explorer-reference.py <mwcli> <spec.json> <state.emmw4> <out.json> [samples] [seed]

Reads the raw EMMW4 external-sampling state with this script's own parser (no
EightMax code), picks random stored rows at decision states on every street,
reconstructs each row's action path from the stored state table (parent, slot)
and its dealt board from the row's card codes, asks `mwcli --node` for that node,
and compares, for the hand of the row:
  - the average strategy  (stored average sums / their total),
  - the current strategy  (regret matching of stored regrets),
  - the acting range reach (weight x product of the seat's own average-strategy
    probabilities along the path; uniform where no average exists),
  - the reach-weighted aggregate average strategy over all non-blocked hands.
Exact-card abstraction only (row key = range index + board code). Values are
compared exactly (binary64, same summation order) except the aggregate, which
is compared to 1e-12 relative."""
import json, struct, subprocess, sys, random, pathlib, tempfile, math, time
cli, spec_path, state_path, out_path = sys.argv[1:5]
samples = int(sys.argv[5]) if len(sys.argv) > 5 else 40
rnd = random.Random(int(sys.argv[6]) if len(sys.argv) > 6 else 1)
spec = json.load(open(spec_path)); buf = pathlib.Path(state_path).read_bytes()
assert buf[:5] == b'EMMW4', 'not an EMMW4 state'
hl = struct.unpack_from('<I', buf, 8)[0]; header = json.loads(buf[12:12 + hl]); p = 12 + hl
assert not header.get('rowKeys'), 'grouped studies are not covered by this exact-card reference'
sync = 4 if header.get('rowSync') else 0
(sc,) = struct.unpack_from('<I', buf, p); p += 4
parent, slot, kind, actor, length, kk = [], [], [], [], [], []
for i in range(sc):
    par, s, kd, ac, ln, k = struct.unpack_from('<IBBBBB', buf, p); p += 9
    parent.append(par); slot.append(s); kind.append(kd); actor.append(ac); length.append(ln); kk.append(k)
(rc,) = struct.unpack_from('<I', buf, p); p += 4
rows = {}
for _ in range(rc):
    st, hand = struct.unpack_from('<IH', buf, p); cards = tuple(buf[p + 6:p + 11]); k = buf[p + 11]; p += 12
    vals = struct.unpack_from('<%dd' % (2 * k), buf, p); p += 16 * k + sync
    rows[(st, hand, cards[:length[st]] if length[st] >= 3 else ())] = vals
start = len(spec['board'])
def decoded(cards):   # row codes store card+1, flop first (sorted), then turn, river
    return [c - 1 for c in cards]
def path_of(state):
    chain = []
    while state != 0: chain.append((parent[state], slot[state])); state = parent[state]
    return list(reversed(chain))
def average(v, k):
    t = 0.0
    for a in range(k): t += v[k + a]
    return [v[k + a] / t for a in range(k)] if t > 0 else None
def current(v, k):
    s = [max(0.0, v[a]) + 0.0 for a in range(k)]; t = 0.0
    for x in s: t += x
    return [x / t if t else 1.0 / k for x in s]
def row_key_cards(cards, L):   # the stored card tuple for a state at street length L
    if L < 3: return ()
    flop = sorted(cards[:3]); rest = cards[3:L]
    return tuple([c + 1 for c in flop] + [c + 1 for c in rest])
candidates = [key for key in rows if kind[key[0]] == 0]
by_street = {}
for key in candidates: by_street.setdefault(length[key[0]], []).append(key)
picked = []
for L, keys in sorted(by_street.items()): picked += rnd.sample(keys, min(len(keys), max(1, samples // len(by_street))))
report = {'generated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'spec': pathlib.Path(spec_path).name, 'states': sc, 'rows': rc,
          'header': {k: header[k] for k in ('iterations', 'trainingDeals') if k in header}, 'checks': [], 'mismatches': 0}
tmp = pathlib.Path(tempfile.mkdtemp())
for key in picked:
    st, hand, ccodes = key; L = length[st]; seat = actor[st]; k = kk[st]
    chain = path_of(st); actions = [s for _, s in chain if s != 7]
    board_all = decoded(ccodes) if L >= 3 else []
    dealt = [c for c in board_all if c not in spec['board'][:start]] if start else board_all
    if start == 0 and len(dealt) >= 3: dealt = sorted(dealt[:3]) + dealt[3:]
    req = {'path': actions, 'board': dealt, 'offset': 0, 'limit': 1326}
    (tmp / 'q.json').write_text(json.dumps(req))
    r = subprocess.run([cli, '--node', spec_path, state_path, str(tmp / 'q.json')], capture_output=True, text=True)
    check = {'state': st, 'street': L, 'seat': seat, 'hand': hand, 'pathLength': len(actions), 'board': dealt}
    if r.returncode != 0: check['error'] = r.stderr.strip(); report['mismatches'] += 1; report['checks'].append(check); continue
    d = json.loads(r.stdout); node = d['node']
    item = next(x for x in d['hands']['items'] if x['i'] == hand)
    v = rows[key]; avg = average(v, k); cur = current(v, k)
    # reach of every hand of `seat` from its own earlier decisions on this path
    hands = spec['hands'][seat]
    def reach(i):
        h = hands[i]; used = set(spec['board'][:start]) | set(board_all)
        if h[1] in used or h[2] in used: return 0.0
        r_ = float(h[3]); state = 0
        for par, s in chain:
            if s != 7 and actor[par] == seat and kind[par] == 0:
                kp = kk[par]; rk = rows.get((par, i, row_key_cards(board_all, length[par])))
                a = average(rk, kp) if rk else None
                r_ *= a[s] if a else 1.0 / kp
        return r_
    agg = [0.0] * k; mass = 0.0
    for x in d['hands']['items']:
        if x['blocked']: continue
        rv = reach(x['i']); rk = rows.get((st, x['i'], ccodes))
        a = average(rk, k) if rk else None
        if a:
            for j in range(k): agg[j] += rv * a[j]
            mass += rv
    agg = [g / mass for g in agg] if mass > 0 else None
    check.update({'nodeState': node['stateId'], 'nodeVisited': node['visited'],
                  'averageMatch': item.get('average') == avg, 'currentMatch': item.get('current') == cur,
                  'reachMatch': item['reach'] == reach(hand),
                  'aggregateMatch': (agg is None and d['aggregate']['average'] is None) or (agg is not None and d['aggregate']['average'] is not None and all(abs(a - b) <= 1e-12 * max(1, abs(a)) for a, b in zip(agg, d['aggregate']['average']))),
                  'stateMatch': node['stateId'] == st, 'actorMatch': node['actor'] == seat})
    if not all(check[x] for x in ('averageMatch', 'currentMatch', 'reachMatch', 'aggregateMatch', 'stateMatch', 'actorMatch')): report['mismatches'] += 1
    report['checks'].append(check)
report['checked'] = len(report['checks'])
report['byStreet'] = {str(L): sum(1 for c in report['checks'] if c['street'] == L) for L in sorted(by_street)}
pathlib.Path(out_path).write_text(json.dumps(report, indent=1))
print('checked', report['checked'], 'by street', report['byStreet'], 'mismatches', report['mismatches'])
sys.exit(1 if report['mismatches'] else 0)
