#!/usr/bin/env python3
"""EightMax 5.11: an independent implementation of the counter-based training streams, in Python integers.

  independent_streams511.py selfcheck <mwcli>     compare with the program (mwcli --streams511) and exit 0 or 1
  independent_streams511.py numbers <seedHex> <domain> <purpose> <t> <d> <count>

Written from the published definition of Philox4x64-10 (Salmon, Moraes, Dror & Shaw, SC 2011) and from the address
rule stated in MATHEMATICAL-VALIDATION-5.11.md, section 3 - not from the C++ source:
    key     = (seed, DOMAIN)       DOMAIN = the eight ASCII bytes "EM511trn" read as a big-endian 64-bit number for
                                   training; "EM511rs" followed by the byte `seat` for the response training of a seat
    counter = (j, t, d, purpose)   purpose 1 cards, 2 actions, 3 Latin; j = 0, 1, 2, ... one counter per four numbers
    number  = (word >> 11) * 2^-53 the four output words in order
Checks of `selfcheck`:
  K  the three known-answer vectors of the reference implementation (Random123, "philox4x64 10");
  B  the inverse of the round function, written out here, undoes ten rounds for 2000 random counters and keys
     (the map is a bijection of the counter for a fixed key);
  S  for 300 random addresses - update indices up to 140,737,488,355,327, every purpose and domain - the first 37
     numbers the program prints are the bits computed here.
"""
import sys, json, struct, subprocess, random
M64 = (1 << 64) - 1; M0 = 0xD2E7470EE14C6C93; M1 = 0xCA5A826395121157; W0 = 0x9E3779B97F4A7C15; W1 = 0xBB67AE8584CAA73B
def rnd(c, k):
    p0 = c[0] * M0; p1 = c[2] * M1
    return [((p1 >> 64) ^ c[1] ^ k[0]) & M64, p1 & M64, ((p0 >> 64) ^ c[3] ^ k[1]) & M64, p0 & M64]
def philox(ctr, key):
    c = list(ctr); k = list(key)
    for r in range(10):
        if r: k = [(k[0] + W0) & M64, (k[1] + W1) & M64]
        c = rnd(c, k)
    return c
def unphilox(out, key):
    i0 = pow(M0, -1, 1 << 64); i1 = pow(M1, -1, 1 << 64); c = list(out)
    for r in range(9, -1, -1):
        k = [(key[0] + r * W0) & M64, (key[1] + r * W1) & M64]
        c0 = (c[3] * i0) & M64; c2 = (c[1] * i1) & M64
        c = [c0, c[0] ^ ((c2 * M1) >> 64) ^ k[0], c2, c[2] ^ ((c0 * M0) >> 64) ^ k[1]]
    return c
def domain_key(domain):
    return int.from_bytes(b'EM511trn', 'big') if domain == 0 else int.from_bytes(b'EM511rs' + bytes([domain - 1]), 'big')
def numbers(seed, domain, purpose, t, d, count):
    key = [seed & M64, domain_key(domain)]; out = []; j = 0
    while len(out) < count:
        for w in philox([j, t, d, purpose], key): out.append((w >> 11) * 2.0 ** -53)
        j += 1
    return out[:count]
def bits(x): return '%016x' % struct.unpack('<Q', struct.pack('<d', x))[0]
KATS = [([0, 0, 0, 0], [0, 0], [0x16554d9eca36314c, 0xdb20fe9d672d0fdc, 0xd7e772cee186176b, 0x7e68b68aec7ba23b]),
        ([M64] * 4, [M64] * 2, [0x87b092c3013fe90b, 0x438c3c67be8d0224, 0x9cc7d7c69cd777b6, 0xa09caebf594f0ba0]),
        ([0x243f6a8885a308d3, 0x13198a2e03707344, 0xa4093822299f31d0, 0x082efa98ec4e6c89], [0x452821e638d01377, 0xbe5466cf34e90c6c], [0xa528f45403e61d95, 0x38c72dbd566e9788, 0xa5a1610e72fd18b5, 0x57bd43b5e52b7fe6])]
if __name__ == '__main__':
    if len(sys.argv) == 8 and sys.argv[1] == 'numbers':
        print(json.dumps({'unitBits': [bits(x) for x in numbers(int(sys.argv[2], 16), *map(int, sys.argv[3:8]))]})); sys.exit(0)
    if len(sys.argv) != 3 or sys.argv[1] != 'selfcheck': print(__doc__); sys.exit(2)
    cli = sys.argv[2]; res = {'tool': 'independent_streams511.py', 'checks': []}
    def check(i, name, ok, detail): res['checks'].append({'id': i, 'name': name, 'passed': bool(ok), 'detail': detail})
    bad = sum(philox(c, k) != w for c, k, w in KATS); check('K', 'Philox4x64-10: the three known-answer vectors of the reference implementation', bad == 0, f'{bad} of 3 vectors differ')
    R = random.Random(511); bad = 0
    for _ in range(2000):
        c = [R.getrandbits(64) for _ in range(4)]; k = [R.getrandbits(64) for _ in range(2)]
        bad += unphilox(philox(c, k), k) != c or philox(unphilox(c, k), k) != c
    check('B', 'the inverse of ten rounds returns the counter, in both directions, for 2000 random counters and keys', bad == 0, f'{bad} failures')
    bad = 0; compared = 0; first = ''
    for i in range(300):
        seed = R.getrandbits(64) if i % 3 else R.getrandbits(32); domain = 0 if i % 4 else R.randrange(1, 9); purpose = R.randrange(1, 4)
        t = [0, 1, 9999999, 10000000, 2 ** 32 - 1, 2 ** 32, 2 ** 32 + 1, 140737488355327][i % 8] if i % 2 else R.randrange(0, 140737488355328); d = R.randrange(0, 64)
        p = subprocess.run([cli, '--streams511', '%x' % seed, str(domain), str(purpose), str(t), str(d), '37'], capture_output=True, text=True)
        if p.returncode: bad += 1; first = first or p.stderr.strip()[:200]; continue
        doc = json.loads(p.stdout); mine = [bits(x) for x in numbers(seed, domain, purpose, t, d, 37)]; compared += 37
        if doc['unitBits'] != mine or [bits(x) for x in doc['unit']] != mine: bad += 1; first = first or f'seed {seed:x} domain {domain} purpose {purpose} t {t} d {d}: {doc["unitBits"][:2]} against {mine[:2]}'
    check('S', 'the numbers of 300 random stream addresses printed by the program are the bits computed here (37 numbers each: ten counters)', bad == 0 and compared == 300 * 37, f'{compared} numbers compared, {bad} addresses differ' + (': ' + first if first else ''))
    res['passed'] = sum(c['passed'] for c in res['checks']); res['failed'] = len(res['checks']) - res['passed']; res['allPassed'] = res['failed'] == 0
    print(json.dumps(res, indent=1)); sys.exit(0 if res['allPassed'] else 1)
