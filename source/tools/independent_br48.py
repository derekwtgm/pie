#!/usr/bin/env python3
"""EightMax 4.8 (Priorities 3, 14): independent exact best-response check for MULTI-STREET
postflop studies (flop, turn or river start; chip EV; dead money from earlier streets).

Extends independent_br47.py (river only) and, like it, shares no code with the engine:
  * the betting tree is rebuilt from the spec's rules street by street (per-street contributions,
    price, minimum raise, bet cap, open flags, all-in calls, pot-fraction / all-in / absolute /
    raise-multiple sizes);
  * chance: every turn and river card is enumerated explicitly, with card removal (the deck
    excludes the board and every seat's hole cards), each card equally likely;
  * hands are ranked by a separate seven-card evaluator; pots are settled by an independent
    side-pot routine over (prior + chips put in since the study root); dead money (the spec's
    common pot and the chips of seats that folded before the study root) goes to the best live hand;
  * the stored AVERAGE strategy is read from the EMMW4 file; a row is identified by the betting
    state, the seat's range index and the public cards of its street (unstored rows = uniform,
    the engine's documented fallback).
The best response of a seat chooses ONE action per (own hand, public betting path, public board),
maximising the value summed over every opponent-hand tuple consistent with that information
(weighted by range weights, card removal and the opponents' policy) - it never sees hidden cards.

usage: independent_br48.py <mwcli> <spec.json> <state> [tolerance=1e-9]
prints a JSON report; exit 0 when every seat agrees with `mwcli --gain` (method exact).
"""
import itertools, json, struct, subprocess, sys, tempfile, os

EPS = 1e-8
CHANCE = 7

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
_rank = {}
def rank7(board, a, b):
    key = (frozenset(board), a, b)
    r = _rank.get(key)
    if r is None: r = _rank[key] = max(rank5(c) for c in itertools.combinations(list(board) + [a, b], 5))
    return r

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

class S:
    __slots__ = ('total', 'street', 'live', 'acted', 'price', 'full', 'count', 'last', 'blen')
    def copy(s):
        t = S(); t.total = s.total[:]; t.street = s.street[:]; t.live = s.live[:]; t.acted = s.acted[:]
        t.price = s.price; t.full = s.full; t.count = s.count; t.last = s.last; t.blen = s.blen; return t

class Game:
    def __init__(g, spec):
        r = spec['rules']; g.n = spec['n']; g.stack = r['stacks']; g.prior = r['prior']; g.open = r['open']
        if r.get('pre') or spec.get('icm') or any(r.get('posted', [])): raise SystemExit('only postflop chip-EV studies are supported')
        if spec.get('groupKeys') or spec.get('turnGroups') or spec.get('riverGroups'): raise SystemExit('grouped studies are not supported')
        g.dead = r['common'] + sum(r['folded']); g.pot0 = r['pot0']; g.sizes = r['sizes']
        if abs(g.pot0 - (g.dead + sum(g.prior))) > 1e-9: raise SystemExit('pot0 is not common + folded + prior')
        g.start = len(spec['board'])
    def root(g):
        s = S(); n = g.n; s.total = [0.0] * n; s.street = [0.0] * n; s.live = [True] * n; s.acted = [-1.0] * n
        s.price = 0.0; s.full = 1.0; s.count = 0; s.last = -1; s.blen = g.start; return s
    def left(g, s, p): return g.stack[p] - s.total[p]
    def actor(g, s):
        if sum(s.live) <= 1: return -1
        acting = [s.live[p] and g.left(s, p) > EPS for p in range(g.n)]; nleft = sum(acting); q = s.last
        for _ in range(g.n):
            q = (q + 1) % g.n
            if acting[q] and (s.street[q] < s.price - EPS or (nleft > 1 and s.acted[q] < 0)): return q
        return -1
    def actions(g, s, p):
        st = g.sizes.get(str(s.blen), {'cap': 0, 'bets': [], 'raises': []})
        facing = s.price > s.street[p] + EPS; rem = s.street[p] + g.left(s, p)
        tos = [s.street[p], min(s.price, rem)] if facing else [s.street[p]]
        respondent = any(s.live[i] and i != p and s.street[i] + g.left(s, i) > s.price + EPS for i in range(g.n))
        if respondent and s.count < st['cap'] and (facing or g.open[p]) and (s.acted[p] < 0 or s.price - s.acted[p] >= s.full - EPS):
            pot = g.pot0 + sum(s.total); amounts = []
            for kind, v in (st['raises'] if facing else st['bets']):
                to = rem
                if kind == 4: to = v
                elif kind == 3: to = v * s.price
                elif kind == 2: to = s.price + v * (pot + (s.price - s.street[p] if facing else 0))
                elif kind == 1: raise SystemExit('geometric sizes are not supported by this checker')
                to = min(rem, max(s.price + s.full, to))
                if to > s.price + EPS and all(abs(a - to) >= EPS for a in amounts): amounts.append(to)
            tos += sorted(amounts)
        return tos, facing
    def advance(g, s, p, a, tos, facing):
        t = s.copy(); t.last = p; to = tos[a]
        if facing and a == 0: t.live[p] = False
        t.total[p] += to - s.street[p]; t.street[p] = to; t.acted[p] = to
        if to > s.price + EPS: t.full = max(s.full, to - s.price); t.price = to; t.count += 1
        return t
    def next_street(g, s):
        t = s.copy(); n = g.n; t.street = [0.0] * n; t.acted = [-1.0] * n; t.price = 0.0; t.full = 1.0; t.count = 0; t.last = -1; t.blen = s.blen + 1; return t
    def payoff(g, s, board, holes):
        n = g.n; live = s.live
        if sum(live) == 1: strength = [0] * n
        else: strength = [rank7(board, holes[i][0], holes[i][1]) if live[i] else (-1,) for i in range(n)]
        contrib = [g.prior[i] + s.total[i] for i in range(n)]
        got = settle(contrib, live, strength)
        lv = [i for i in range(n) if live[i]]; top = max(strength[i] for i in lv); w = [i for i in lv if strength[i] == top]
        return [-s.total[i] + got[i] + (g.dead / len(w) if i in w else 0.0) for i in range(n)]

def read_state(path):
    b = open(path, 'rb').read(); assert b[:8] == b'EMMW4\0\0\0'
    hl = struct.unpack_from('<I', b, 8)[0]; h = json.loads(b[12:12 + hl]); o = 12 + hl
    if h.get('rowKeys'): raise SystemExit('grouped studies are not supported')
    sc = struct.unpack_from('<I', b, o)[0]; o += 4; parent = []; slot = []; length = []
    for i in range(sc): parent.append(struct.unpack_from('<I', b, o)[0]); slot.append(b[o + 4]); length.append(b[o + 7]); o += 9
    def path_of(i):
        p = []
        while i != 0 and i != 0xffffffff: p.append(slot[i]); i = parent[i]
        return tuple(reversed(p))
    rc = struct.unpack_from('<I', b, o)[0]; o += 4; rows = {}
    for _ in range(rc):
        st, hand = struct.unpack_from('<IH', b, o); cards = [c - 1 for c in b[o + 6:o + 11]]; o += 11; k = b[o]; o += 1   # stored as card + 1 (0 = none)
        vals = struct.unpack_from('<%dd' % (2 * k), b, o); o += 16 * k
        if h.get('rowSync'): o += 4
        L = length[st]; pub = tuple(sorted(cards[:3])) + tuple(cards[3:L]) if L >= 3 else ()
        avg = vals[k:]; t = sum(x for x in avg if x > 0)
        rows[(path_of(st), hand, pub)] = [((x if x > 0 else 0) / t) if t > 0 else 1.0 / k for x in avg]
    return rows

def main():
    cli, spec_path, state = sys.argv[1:4]; tol = float(sys.argv[4]) if len(sys.argv) > 4 else 1e-9
    spec = json.load(open(spec_path)); g = Game(spec); n = g.n; rows = read_state(state)
    hands = [[(h[1], h[2], h[3]) for h in seat] for seat in spec['hands']]
    board0 = list(spec['board'])
    deals = []
    for tup in itertools.product(*[range(len(s)) for s in hands]):
        cards = [c for p, i in enumerate(tup) for c in hands[p][i][:2]]
        if len(set(cards + board0)) != len(cards) + len(board0): continue
        w = 1.0
        for p, i in enumerate(tup): w *= hands[p][i][2]
        if w > 0: deals.append((tup, w))
    Z = sum(w for _, w in deals)
    holes_of = lambda tup: [hands[p][tup[p]][:2] for p in range(n)]
    mask_of = lambda tup: frozenset(c for p in range(n) for c in hands[p][tup[p]][:2])
    deck_size = lambda blen: 52 - blen - 2 * n
    used_rows = set()
    def pubkey(board): return tuple(sorted(board[:3])) + tuple(board[3:])
    def sigma(path, p, hand, board, k):
        key = (path, hand, pubkey(board)); r = rows.get(key)
        if r and len(r) == k: used_rows.add(key); return r
        return [1.0 / k] * k
    # value of a node where nobody decides any more (k == 1 nodes, chance, terminal), cached per
    # (deal, betting outcome, board): the expected payoff vector of every seat.
    runout_cache = {}
    def passive(s, path, board, tup):
        key = (tup, tuple(s.total), tuple(s.live), tuple(board), s.blen)
        v = runout_cache.get(key)
        if v is not None: return v
        p = g.actor(s)
        if p >= 0:
            tos, facing = g.actions(s, p); assert len(tos) == 1
            v = passive(g.advance(s, p, 0, tos, facing), path + (0,), board, tup)
        elif sum(s.live) <= 1 or s.blen == 5: v = g.payoff(s, board, holes_of(tup))
        else:
            m = mask_of(tup); acc = [0.0] * n; d = deck_size(s.blen); t = g.next_street(s)
            for x in range(52):
                if x in m or x in board: continue
                r = passive(t, path + (CHANCE,), board + [x], tup)
                for i in range(n): acc[i] += r[i] / d
            v = acc
        runout_cache[key] = v; return v
    def decisive(s):   # does anyone still have a real decision below this node?
        p = g.actor(s)
        if p >= 0: return len(g.actions(s, p)[0]) > 1 or decisive(g.advance(s, p, 0, *g.actions(s, p)))
        if sum(s.live) <= 1 or s.blen == 5: return False
        return decisive(g.next_street(s))
    def walk(seat, own, s, path, board, weighted, maximize):
        """weighted: list of (tuple, weight). Returns sum_t w * value(seat). maximize: seat best-responds."""
        if not weighted: return 0.0
        if not decisive(s): return sum(w * passive(s, path, board, t)[seat] for t, w in weighted)
        p = g.actor(s)
        if p < 0:
            t2 = g.next_street(s); d = deck_size(s.blen); out = 0.0
            for x in range(52):
                if x in board: continue
                nw = [(t, w / d) for t, w in weighted if x not in mask_of(t)]
                if own is not None and x in hands[seat][own][:2]: continue
                if nw: out += walk(seat, own, t2, path + (CHANCE,), board + [x], nw, maximize)
            return out
        tos, facing = g.actions(s, p); k = len(tos)
        if k == 1: return walk(seat, own, g.advance(s, p, 0, tos, facing), path + (0,), board, weighted, maximize)
        if p == seat:
            if maximize: return max(walk(seat, own, g.advance(s, p, a, tos, facing), path + (a,), board, weighted, True) for a in range(k))
            sg = sigma(path, p, own, board, k)
            return sum(sg[a] * walk(seat, own, g.advance(s, p, a, tos, facing), path + (a,), board, weighted, False) for a in range(k) if sg[a] > 0)
        out = 0.0
        for a in range(k):
            nw = [(t, w * sigma(path, p, t[p], board, k)[a]) for t, w in weighted]
            nw = [(t, w) for t, w in nw if w > 0]
            if nw: out += walk(seat, own, g.advance(s, p, a, tos, facing), path + (a,), board, nw, maximize)
        return out
    def evaluate(seat):
        pv = br = 0.0
        for h in range(len(hands[seat])):
            mine = [(t, w) for t, w in deals if t[seat] == h]
            if not mine: continue
            pv += walk(seat, h, g.root(), (), board0, mine, False)
            br += walk(seat, h, g.root(), (), board0, mine, True)
        return pv / Z, br / Z
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as q: json.dump({'method': 'exact', 'timeLimitMs': 3600000, 'maxVisits': 2000000000}, q)
    try: eng = json.loads(subprocess.run([cli, '--gain', spec_path, state, q.name], capture_output=True, text=True, check=True).stdout)
    finally: os.unlink(q.name)
    seats = []; ok = True
    for p in range(n):
        pv, br = evaluate(p); e = eng['seats'][p]
        dp, db, dg = abs(pv - e['policyValue']), abs(br - e['bestResponseValue']), abs((br - pv) - e['gain'])
        agree = max(dp, db, dg) <= tol * max(1.0, abs(br)); ok &= agree
        seats.append({'seat': p, 'independentPolicyValue': pv, 'independentBestResponse': br, 'independentGain': br - pv, 'enginePolicyValue': e['policyValue'], 'engineBestResponse': e['bestResponseValue'], 'engineGain': e['gain'], 'maxAbsDifference': max(dp, db, dg), 'agree': agree})
    total_pv = sum(x['independentPolicyValue'] for x in seats)
    print(json.dumps({'tool': 'independent_br48', 'spec': spec_path, 'state': state, 'players': n, 'startCards': len(board0), 'deals': len(deals), 'storedRowsUsed': len(used_rows), 'storedRows': len(rows),
                      'chipConservation': {'sumOfPolicyValues': total_pv, 'pot0': g.pot0, 'conserved': abs(total_pv - g.pot0) <= 1e-9 * max(1.0, g.pot0), 'note': 'net chips relative to the study root sum to the root pot (common pot + chips folded before the root + every seat\'s prior wager) for every strategy profile'},
                      'tolerance': tol, 'agree': ok, 'seats': seats}, indent=1))
    sys.exit(0 if ok and abs(total_pv - g.pot0) <= 1e-9 * max(1.0, g.pot0) else 1)

if __name__ == '__main__': main()
