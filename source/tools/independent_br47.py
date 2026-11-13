#!/usr/bin/env python3
"""EightMax 4.7 (Priority 4): independent exact best-response check for heads-up and
multiway RIVER studies (fixed five-card board, chip EV).

Shares no code with the engine: the betting tree is rebuilt here from the spec's rules
(pot-fraction / all-in / absolute / raise-multiple sizes, raise cap, minimum raises,
all-in short calls), hands are ranked by a separate seven-card evaluator, pots are
settled by an independent side-pot routine, and the stored AVERAGE strategy is read
directly from the EMMW4 checkpoint (rows without stored values = uniform, the engine's
documented fallback). For every seat the exact unilateral best-response value and the
policy value are computed by enumerating every compatible deal (card removal, weighted
ranges) and compared with `mwcli --gain` (method exact).

usage: independent_br47.py <mwcli> <spec.json> <state> [tolerance=1e-9]
prints a JSON report; exit 0 when every seat agrees within the tolerance.
"""
import itertools, json, struct, subprocess, sys, tempfile, os

EPS = 1e-8

# ---------------- seven-card evaluator (independent) ----------------
def rank5(cards):
    rs = sorted((c // 4 for c in cards), reverse=True); ss = [c % 4 for c in cards]
    counts = {}
    for r in rs: counts[r] = counts.get(r, 0) + 1
    groups = sorted(counts.items(), key=lambda x: (x[1], x[0]), reverse=True)
    flush = len(set(ss)) == 1
    uniq = sorted(set(rs), reverse=True); straight = None
    if len(uniq) == 5:
        if uniq[0] - uniq[4] == 4: straight = uniq[0]
        elif uniq == [12, 3, 2, 1, 0]: straight = 3
    if straight is not None and flush: return (8, straight)
    if groups[0][1] == 4: return (7, groups[0][0], groups[1][0])
    if groups[0][1] == 3 and groups[1][1] == 2: return (6, groups[0][0], groups[1][0])
    if flush: return (5,) + tuple(rs)
    if straight is not None: return (4, straight)
    if groups[0][1] == 3: return (3, groups[0][0]) + tuple(r for r, _ in groups[1:])
    if groups[0][1] == 2 and groups[1][1] == 2: return (2, groups[0][0], groups[1][0], groups[2][0])
    if groups[0][1] == 2: return (1, groups[0][0]) + tuple(r for r, _ in groups[1:])
    return (0,) + tuple(rs)
def rank7(cards): return max(rank5(c) for c in itertools.combinations(cards, 5))

# ---------------- betting rules (independent reconstruction) ----------------
class State:
    def __init__(s, n): s.put = [0.0] * n; s.live = [True] * n; s.acted = [-1.0] * n; s.price = 0.0; s.full = 1.0; s.count = 0; s.last = -1

def settle(contrib, live, strength):
    n = len(contrib); got = [0.0] * n; prev = 0.0
    for L in sorted(set(contrib)):
        if L <= prev: continue
        layer = sum(min(c, L) - min(c, prev) for c in contrib)
        elig = [i for i in range(n) if contrib[i] >= L and live[i]]
        if not elig:
            best = max((i for i in range(n) if live[i]), key=lambda i: contrib[i]); got[best] += layer
        else:
            top = max(strength[i] for i in elig); w = [i for i in elig if strength[i] == top]
            for i in w: got[i] += layer / len(w)
        prev = L
    return got

class Game:
    def __init__(g, spec):
        r = spec['rules']; g.n = spec['n']; g.stack = r['stacks']; g.common = r['common']; g.pot0 = r['pot0']
        if r.get('pre') or any(r['prior']) or r['folded'] or any(r['ownAnte']): raise SystemExit('only plain river studies (no prior wagers, folded chips or antes) are supported')
        if len(spec['board']) != 5 or spec.get('icm'): raise SystemExit('only river chip-EV studies are supported')
        st = r['sizes']['5']; g.cap = st['cap']; g.bets = st['bets']; g.raises = st['raises']; g.open = r['open']
    def actor(g, s):
        acting = [s.live[p] and g.stack[p] - s.put[p] > EPS for p in range(g.n)]; left = sum(acting)
        if sum(s.live) <= 1: return -1
        q = s.last
        for _ in range(g.n):
            q = (q + 1) % g.n
            if acting[q] and (s.put[q] < s.price - EPS or (left > 1 and s.acted[q] < 0)): return q
        return -1
    def actions(g, s, p):
        facing = s.price > s.put[p] + EPS; rem = g.stack[p]
        tos = [s.put[p], min(s.price, rem)] if facing else [s.put[p]]
        respondent = any(s.live[i] and i != p and g.stack[i] > s.price + EPS for i in range(g.n))
        if respondent and s.count < g.cap and (facing or g.open[p]) and (s.acted[p] < 0 or s.price - s.acted[p] >= s.full - EPS):
            pot = g.pot0 + sum(s.put); amounts = []
            for kind, v in (g.raises if facing else g.bets):
                to = rem
                if kind == 4: to = v
                elif kind == 3: to = v * s.price
                elif kind == 2: to = s.price + v * (pot + (s.price - s.put[p] if facing else 0))
                elif kind == 1: raise SystemExit('geometric sizes are not supported by this checker')
                to = min(rem, max(s.price + s.full, to))
                if to > s.price + EPS and all(abs(a - to) >= EPS for a in amounts): amounts.append(to)
            tos += sorted(amounts)
        return tos, facing
    def advance(g, s, p, a, tos, facing):
        t = State(g.n); t.put = s.put[:]; t.live = s.live[:]; t.acted = s.acted[:]; t.price = s.price; t.full = s.full; t.count = s.count; t.last = p
        to = tos[a]
        if facing and a == 0: t.live[p] = False
        t.put[p] = to; t.acted[p] = to
        if to > s.price + EPS: t.full = max(s.full, to - s.price); t.price = to; t.count += 1
        return t
    def payoff(g, s, strength):
        live = s.live; got = settle(s.put, live, strength)
        # the common pot goes to the best live hand(s)
        lv = [i for i in range(g.n) if live[i]]; top = max(strength[i] for i in lv); w = [i for i in lv if strength[i] == top]
        return [-s.put[i] + got[i] + (g.common / len(w) if i in w else 0.0) for i in range(g.n)]

# ---------------- EMMW4 average strategies ----------------
def read_state(path):
    b = open(path, 'rb').read(); assert b[:8] == b'EMMW4\0\0\0'
    hl = struct.unpack_from('<I', b, 8)[0]; h = json.loads(b[12:12 + hl]); o = 12 + hl
    sc = struct.unpack_from('<I', b, o)[0]; o += 4; parent = []; slot = []
    for i in range(sc): parent.append(struct.unpack_from('<I', b, o)[0]); slot.append(b[o + 4]); o += 9
    def path_of(i):
        p = []
        while i != 0 and i != 0xffffffff: p.append(slot[i]); i = parent[i]
        return tuple(reversed(p))
    rc = struct.unpack_from('<I', b, o)[0]; o += 4; rows = {}
    if h.get('rowKeys'): raise SystemExit('grouped studies are not supported')
    for _ in range(rc):
        st, hand = struct.unpack_from('<IH', b, o); o += 6 + 5; k = b[o]; o += 1
        vals = struct.unpack_from('<%dd' % (2 * k), b, o); o += 16 * k
        if h.get('rowSync'): o += 4
        avg = vals[k:]; t = sum(x for x in avg if x > 0)
        rows[(path_of(st), hand)] = [((x if x > 0 else 0) / t) if t > 0 else 1.0 / k for x in avg]
    return rows

def main():
    cli, spec_path, state = sys.argv[1:4]; tol = float(sys.argv[4]) if len(sys.argv) > 4 else 1e-9
    spec = json.load(open(spec_path)); g = Game(spec); board = spec['board']; rows = read_state(state)
    hands = [[(h[1], h[2], h[3]) for h in seat] for seat in spec['hands']]
    strength = [[rank7(board + [a, b]) for (a, b, _) in seat] for seat in hands]
    n = g.n
    deals = []   # every compatible tuple of hand indices with its weight
    for tup in itertools.product(*[range(len(s)) for s in hands]):
        cards = [c for p, i in enumerate(tup) for c in hands[p][i][:2]]
        if len(set(cards + board)) != len(cards) + 5: continue
        w = 1.0
        for p, i in enumerate(tup): w *= hands[p][i][2]
        deals.append((tup, w))
    Z = sum(w for _, w in deals)
    def sigma(path, p, hand, k):
        r = rows.get((path, hand)); return r if r and len(r) == k else [1.0 / k] * k
    used_rows = set()
    def policy_value(seat):
        def walk(s, path, tup):
            p = g.actor(s)
            if p < 0:
                st = [strength[q][tup[q]] for q in range(n)]; return g.payoff(s, st)[seat]
            tos, facing = g.actions(s, p); k = len(tos)
            if k == 1: return walk(g.advance(s, p, 0, tos, facing), path + (0,), tup)
            sg = sigma(path, p, tup[p], k); used_rows.add((path, tup[p]))
            return sum(sg[a] * walk(g.advance(s, p, a, tos, facing), path + (a,), tup) for a in range(k) if sg[a] > 0)
        return sum(w * walk(State(n), (), tup) for tup, w in deals) / Z
    def best_response(seat):
        # for every own hand: max over own decisions of the opponent-weighted value
        total = 0.0
        for h in range(len(hands[seat])):
            mine = [(tup, w) for tup, w in deals if tup[seat] == h]
            if not mine: continue
            def walk(s, path, weighted):   # weighted: list of (tuple, reach weight)
                p = g.actor(s)
                if p < 0:
                    return sum(w * g.payoff(s, [strength[q][t[q]] for q in range(n)])[seat] for t, w in weighted)
                tos, facing = g.actions(s, p); k = len(tos)
                if k == 1: return walk(g.advance(s, p, 0, tos, facing), path + (0,), weighted)
                if p == seat: return max(walk(g.advance(s, p, a, tos, facing), path + (a,), weighted) for a in range(k))
                out = 0.0
                for a in range(k):
                    nw = [(t, w * sigma(path, p, t[p], k)[a]) for t, w in weighted]
                    nw = [(t, w) for t, w in nw if w > 0]
                    if nw: out += walk(g.advance(s, p, a, tos, facing), path + (a,), nw)
                return out
            total += walk(State(n), (), mine)
        return total / Z
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as q: json.dump({'method': 'exact'}, q)
    try: eng = json.loads(subprocess.run([cli, '--gain', spec_path, state, q.name], capture_output=True, text=True, check=True).stdout)
    finally: os.unlink(q.name)
    seats = []; ok = True
    for p in range(n):
        pv, br = policy_value(p), best_response(p); e = eng['seats'][p]
        dp, db, dg = abs(pv - e['policyValue']), abs(br - e['bestResponseValue']), abs((br - pv) - e['gain'])
        agree = max(dp, db, dg) <= tol * max(1.0, abs(br)); ok &= agree
        seats.append({'seat': p, 'independentPolicyValue': pv, 'independentBestResponse': br, 'independentGain': br - pv, 'enginePolicyValue': e['policyValue'], 'engineBestResponse': e['bestResponseValue'], 'engineGain': e['gain'], 'maxAbsDifference': max(dp, db, dg), 'agree': agree})
    print(json.dumps({'tool': 'independent_br47', 'spec': spec_path, 'state': state, 'deals': len(deals), 'storedRowsUsed': len(used_rows), 'storedRows': len(rows), 'tolerance': tol, 'agree': ok, 'seats': seats}, indent=1))
    sys.exit(0 if ok else 1)

if __name__ == '__main__': main()
