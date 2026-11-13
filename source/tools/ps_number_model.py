#!/usr/bin/env python3
"""EightMax 4.4: arithmetic model of how Windows PowerShell 5.1 turned the
engine's 15.670177585564113 into 15.670177585564112 in the 4.3 self-test.

THIS IS A MODEL, NOT A RUN OF POWERSHELL. It reproduces, with exact integer
and IEEE 754 arithmetic, the conversion chain the 4.3 test used:

  engine prints "%.17g"                      -> digits d
  ConvertFrom-Json (JavaScriptSerializer)    -> System.Decimal when d has a
                                                fraction, no exponent and fits
                                                (96-bit integer, scale <= 28)
  [double]$value                             -> (double)(integer) / 10^scale
                                                (two correctly rounded steps)
  '{0:R}' -f                                 -> shortest digits that round-trip

A correctly rounding reader (Python float(), the engine's strtod, PowerShell 7)
maps the digits straight to the nearest double: one rounding.

The actual behaviour on the user's machine is measured by
tools/test_windows.ps1 (report section v44.powershell): per probe it records the
type ConvertFrom-Json produced, the bits after the [double] cast and the ULP
distance from the engine's bits.

usage: python3 ps_number_model.py [probe.json from `mwcli --ieee`]
Prints JSON: for every value the engine bits, the modelled PowerShell 5.1 bits
and their ULP distance. Exit code 0 always (it is a diagnostic).
"""
import json, struct, sys
from decimal import Decimal


def bits(x: float) -> str:
    return struct.pack('>d', x).hex()


def ordinal(h: str) -> int:
    u = int(h, 16)
    return -(u & 0x7fffffffffffffff) if u >> 63 else u


def ulp(a: str, b: str) -> int:
    return abs(ordinal(a) - ordinal(b))


def ps51_cast(text: str):
    """Returns (type name, double) as modelled for ConvertFrom-Json + [double]."""
    if 'e' in text.lower() or '.' not in text:
        # exponent form or integer: not Decimal; parsed as Double / Int64 directly
        return ('Double' if 'e' in text.lower() else 'Int', float(text))
    d = Decimal(text)
    sign, digits, exp = d.as_tuple()
    scale = -exp
    mant = int(''.join(map(str, digits)))
    if scale > 28 or mant >= 1 << 96:
        return ('Double', float(text))
    # Decimal -> Double: 96-bit integer to double (rounds), then divide by 10^scale (rounds)
    v = float(mant) / float(10 ** scale)
    return ('Decimal', -v if sign else v)


def main():
    if len(sys.argv) > 1:
        raw = open(sys.argv[1], encoding='utf-8-sig').read()
        doc = json.loads(raw)
        items = [(p['bits'], p['text']) for p in doc['probes']]
    else:
        vals = ['15.670177585564113', '15.020151348500445', '0.54263262635152465', '0.05855764838526234',
                '0.0074652466318276814', '0.036214272672570047', '0.13927187905377458', '0.056570785543963',
                '0.10626431827068394', '0.13421150102554513']
        items = [(bits(float(t)), t) for t in vals]
    rows, changed = [], 0
    for b, text in items:
        kind, v = ps51_cast(text)
        mb = bits(v)
        d = ulp(b, mb)
        changed += d != 0
        rows.append({'text': text, 'engineBits': b, 'correctlyRoundedBits': bits(float(text)), 'modelledType': kind,
                     'modelledPowerShell51Bits': mb, 'modelledDigits': repr(v), 'ulpDistance': d})
    print(json.dumps({'tool': 'ps_number_model (arithmetic model; not a PowerShell run)', 'values': len(rows),
                      'changedByModelledCast': changed, 'rows': rows}, indent=1))


if __name__ == '__main__':
    main()
