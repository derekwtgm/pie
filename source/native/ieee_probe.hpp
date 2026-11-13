// EightMax 4.4: IEEE 754 value preservation probes. Included by mw.cpp.
//
// WHY (4.3 Windows self-test failure). The engine prints doubles with "%.17g",
// which is enough digits for every finite double to round-trip through a
// correctly rounding decimal parser. The 4.3 Windows self-test nevertheless
// reported 15.670177585564112 where the engine had printed 15.670177585564113.
// The value never changed in the engine: Windows PowerShell 5.1's ConvertFrom-Json
// (JavaScriptSerializer) keeps a JSON number with a fraction as System.Decimal,
// and the test then cast it to [double]. Decimal -> Double in .NET Framework is
// (double)(96-bit integer) / 10^scale: two roundings. For 15670177585564113 / 1e15
// the integer exceeds 2^53, so the first rounding loses the last bit and the
// result is the neighbouring double 0x402F57218439052C instead of
// 0x402F57218439052D (tools/ps_number_model.py reproduces this arithmetic).
//
// WHAT THIS FILE PROVIDES
//  * jbits(): the IEEE 754 bit pattern of a double as 16 lowercase hex digits.
//    Action-EV results carry "evBits" next to "ev" and exact response gains carry
//    "gainBits" next to "gain". A bit pattern is a JSON *string*: no JSON reader,
//    shell or serializer can re-round it. Tests that require bit-identical
//    results compare these strings.
//  * mw_ieee_probe(): a fixed table of doubles (the affected EV, both of its
//    one-ULP neighbours, negative, subnormal, tiny, huge and >2^53 values), each
//    printed as {bits, value(%.17g), text(the same digits as a string)}.
//  * mw_ieee_verify(): parses a probe document with the engine's own JSON reader
//    and reports, per entry, the bits of the parsed number against the stated
//    bits and their distance in ULPs. Printing followed by parsing must give
//    distance 0 for every entry (native print / native parse round trip).
//  * ulpDistance(): the number of representable doubles between two finite
//    values (0 = identical bits; -0 and +0 are 0 apart).
#pragma once
#include <cmath>
#include <cstdint>
#include <cstring>
#include <cstdio>
namespace emieee {
inline uint64_t bitsOf(double v) { uint64_t u; std::memcpy(&u, &v, sizeof u); return u; }
inline double fromBits(uint64_t u) { double v; std::memcpy(&v, &u, sizeof v); return v; }
// Monotone integer image of a finite double (two's-complement ordering of sign-magnitude).
inline int64_t ordinal(double v) { const uint64_t u = bitsOf(v); return (u >> 63) ? -(int64_t)(u & 0x7fffffffffffffffULL) : (int64_t)u; }
inline uint64_t ulpDistance(double a, double b) { const int64_t x = ordinal(a), y = ordinal(b); return x > y ? (uint64_t)x - (uint64_t)y : (uint64_t)y - (uint64_t)x; }
inline void hex16(uint64_t u, char out[17]) { static const char *d = "0123456789abcdef"; for (int i = 15; i >= 0; i--) { out[i] = d[u & 15]; u >>= 4; } out[16] = 0; }
inline bool parseHex16(const char *s, uint64_t &u) {
  if (!s || std::strlen(s) != 16) return false; u = 0;
  for (int i = 0; i < 16; i++) { const char c = s[i]; int v; if (c >= '0' && c <= '9') v = c - '0'; else if (c >= 'a' && c <= 'f') v = c - 'a' + 10; else if (c >= 'A' && c <= 'F') v = c - 'A' + 10; else return false; u = u << 4 | (uint64_t)v; }
  return true;
}
struct Probe { const char *name; uint64_t bits; };
inline const Probe *probes(size_t &n) {
  static const Probe table[] = {
    {"ev 4.2 reference 15.670177585564113", 0x402f57218439052dULL},
    {"one ULP below the reference (what Windows PowerShell 5.1 produced)", 0x402f57218439052cULL},
    {"one ULP above the reference", 0x402f57218439052eULL},
    {"ev 4.2 reference 15.020151348500445", 0x402e0a51470d8f36ULL},
    {"negative reference", 0xc02f57218439052dULL},
    {"negative, one ULP towards zero", 0xc02f57218439052cULL},
    {"0.1", 0x3fb999999999999aULL},
    {"one ULP below 0.1", 0x3fb9999999999999ULL},
    {"1/3", 0x3fd5555555555555ULL},
    {"1 + epsilon", 0x3ff0000000000001ULL},
    {"1 - epsilon/2", 0x3fefffffffffffffULL},
    {"2^53 + 2 (integers above 2^53)", 0x4340000000000001ULL},
    {"9007199254740993 rounds to even 2^53", 0x4340000000000000ULL},
    {"smallest subnormal 4.9e-324", 0x0000000000000001ULL},
    {"largest subnormal", 0x000fffffffffffffULL},
    {"smallest normal 2.2250738585072014e-308", 0x0010000000000000ULL},
    {"negative smallest normal", 0x8010000000000000ULL},
    {"1e-300", 0x01a56e1fc2f8f359ULL},
    {"1e300", 0x7e37e43c8800759cULL},
    {"largest finite 1.7976931348623157e308", 0x7fefffffffffffffULL},
    {"one ULP below the largest finite", 0x7feffffffffffffeULL},
    {"negative largest finite", 0xffefffffffffffffULL},
    {"response gain 0.54263262635152465", 0x3fe15d3f18fd8430ULL},
    {"17 significant digits needed: 0.30000000000000004", 0x3fd3333333333334ULL},
    {"5e-324 neighbour 1e-323", 0x0000000000000002ULL},
    {"-1e-300", 0x81a56e1fc2f8f359ULL},
  };
  n = sizeof table / sizeof table[0]; return table;
}
} // namespace emieee
// Appends "0123456789abcdef" (with quotes) or null for a non-finite value.
inline void jbits(JB *o, double v) { if (!std::isfinite(v)) { jb_puts(o, "null"); return; } char h[17]; emieee::hex16(emieee::bitsOf(v), h); jb_putc(o, '"'); jb_puts(o, h); jb_putc(o, '"'); }
inline void jbitsArr(JB *o, const double *v, int k) { jb_putc(o, '['); for (int a = 0; a < k; a++) { if (a) jb_putc(o, ','); jbits(o, v[a]); } jb_putc(o, ']'); }
extern "C" void mw_ieee_probe(JB *o) {
  size_t n; const emieee::Probe *p = emieee::probes(n);
  jb_puts(o, "{\"tool\":\"EightMax IEEE 754 probe\",\"format\":\"%.17g\",\"note\":\"bits is the IEEE 754 binary64 pattern (16 hex digits); value is the same double printed with 17 significant digits; text is the identical digit string, kept as a JSON string so that no reader converts it\",\"probes\":[");
  for (size_t i = 0; i < n; i++) {
    const double v = emieee::fromBits(p[i].bits); char h[17]; emieee::hex16(p[i].bits, h); char digits[40]; std::snprintf(digits, sizeof digits, "%.17g", v);
    if (i) jb_putc(o, ',');
    jb_puts(o, "{\"name\":"); jb_str(o, p[i].name); jb_printf(o, ",\"bits\":\"%s\",\"value\":%s,\"text\":\"%s\"}", h, digits, digits);
  }
  jb_puts(o, "]}");
}
// Parses a probe document with the engine's JSON reader. Returns 200 and a
// report; "mismatches" counts entries whose parsed number is not the stated bits.
extern "C" int mw_ieee_verify(const char *json, size_t len, JB *o, char *err, int errlen) {
  JV *root = json_parse(json, len, err, errlen); if (!root) return 400;
  const JV *list = jget(root, "probes");
  if (!list || list->type != J_ARR) { std::snprintf(err, (size_t)errlen, "probes must be an array"); json_free(root); return 400; }
  int mismatches = 0, textMismatches = 0, count = 0; uint64_t worst = 0;
  jb_puts(o, "{\"tool\":\"EightMax IEEE 754 verify\",\"entries\":[");
  for (int i = 0; i < list->n; i++) {
    const JV *e = list->items[i]; const JV *b = jget(e, "bits"), *v = jget(e, "value"), *t = jget(e, "text"); uint64_t want = 0;
    if (!b || b->type != J_STR || !emieee::parseHex16(b->str, want) || !v || v->type != J_NUM) { std::snprintf(err, (size_t)errlen, "probes[%d] needs bits (16 hex digits) and a numeric value", i); json_free(root); return 400; }
    const uint64_t got = emieee::bitsOf(v->num), d = emieee::ulpDistance(v->num, emieee::fromBits(want)); char h[17]; emieee::hex16(got, h);
    // text -> strtod: the C runtime's decimal parser on the digit string
    bool textOk = true; uint64_t td = 0; if (t && t->type == J_STR) { const double tv = em_parse_double(t->str, nullptr); td = emieee::ulpDistance(tv, emieee::fromBits(want)); textOk = emieee::bitsOf(tv) == want; }
    if (got != want) mismatches++; if (!textOk) textMismatches++; if (d > worst) worst = d; if (td > worst) worst = td; count++;
    if (i) jb_putc(o, ',');
    jb_printf(o, "{\"bits\":\"%s\",\"parsedBits\":\"%s\",\"ulpDistance\":%llu,\"textUlpDistance\":%llu,\"identical\":%s}", b->str, h, (unsigned long long)d, (unsigned long long)td, got == want && textOk ? "true" : "false");
  }
  jb_printf(o, "],\"probeCount\":%d,\"mismatches\":%d,\"textMismatches\":%d,\"worstUlpDistance\":%llu}", count, mismatches, textMismatches, (unsigned long long)worst);
  json_free(root); return 200;
}

// 4.5: large deterministic round-trip sweep (mwcli --ieee-sweep [count] [seed]).
// The 4.4 probe table has 26 values. The sweep generates `count` finite doubles from a fixed
// SplitMix64 stream in six classes (any finite bit pattern; EV-sized values 1e-3..1e4 of both
// signs; subnormals; within a few ULPs of zero's neighbours and of powers of two; huge values;
// integers around 2^53) and, for each one,
//   * prints it with "%.17g" (the engine's only number format),
//   * parses the digits with the engine's decimal parser (em_parse_double = std::from_chars,
//     independent of the C runtime) and with the engine's JSON reader: both must return the
//     identical bit pattern (0 ULP). The C runtime's own strtod is measured as well and reported
//     as crtStrtodMismatches (informational: the engine does not use it for values in range).
//     MEASURED with the 4.5 Windows executable (MinGW-w64 runtime, under Wine): strtod and
//     __mingw_strtod return the neighbouring double for 16 of the 28,630 values within 3 ULPs
//     of a power of two (all just below one, magnitudes below 1e-150 or above 1e195), where
//     std::from_chars in the same executable has no error. 4.4 used strtod for JSON numbers.
//   * prints its upper one-ULP neighbour: the digit strings must differ (17 digits separate
//     neighbours), and the neighbour must parse back to its own bits.
// `digest` is a 64-bit FNV-1a hash of every digit string in order. Two builds (Linux, the Windows
// executable under Wine, the Windows executable on a physical PC) that print the same digest
// printed the same characters for all `count` doubles, so exact comparisons of printed numbers
// and of bit patterns are interchangeable on them. Nothing here uses a tolerance.
extern "C" int mw_ieee_sweep(JB *o, long long count, unsigned long long seed) {
  if (count < 1 || count > 50000000) return 0;
  uint64_t st = seed * 0x9e3779b97f4a7c15ULL + 0x45; auto next = [&] { uint64_t z = (st += 0x9e3779b97f4a7c15ULL); z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL; z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL; return z ^ (z >> 31); };
  uint64_t digest = 0xcbf29ce484222325ULL; long long strtodOff = 0, crtOff = 0, jsonOff = 0, collisions = 0, neighbourOff = 0, perClass[6] = {0, 0, 0, 0, 0, 0}; uint64_t worst = 0; char firstBad[17] = "";
  for (long long i = 0; i < count; i++) {
    const int cls = (int)(i % 6); uint64_t r = next(), u;
    switch (cls) {
      case 0: u = r; if (((u >> 52) & 0x7ff) == 0x7ff) u &= ~(uint64_t(1) << 62); break;                          // any finite pattern
      case 1: u = (r & 0x800fffffffffffffULL) | ((uint64_t)(0x3f5 + (r >> 52) % 24) << 52); break;                 // 2^-10 .. 2^13, both signs
      case 2: u = r & 0x800fffffffffffffULL; if (!(u & 0x000fffffffffffffULL)) u |= 1; break;                       // subnormal
      case 3: u = ((uint64_t)(1 + (r >> 8) % 2045) << 52) + (uint64_t)((int64_t)(r & 7) - 3); u |= (r >> 63) << 63; break;   // +-3 ULP around powers of two
      case 4: u = (r & 0x800fffffffffffffULL) | ((uint64_t)(0x7c0 + (r >> 52) % 0x3f) << 52); break;               // huge
      default: u = emieee::bitsOf(9007199254740992.0 + (double)((int64_t)(r % 4096) - 2048) * 2.0); break;          // around 2^53
    }
    if (((u >> 52) & 0x7ff) == 0x7ff) u = 0x7fefffffffffffffULL;
    perClass[cls]++;
    const double v = emieee::fromBits(u); char digits[40], digits2[40];
    const int len = std::snprintf(digits, sizeof digits, "%.17g", v);
    for (int c = 0; c < len; c++) { digest ^= (unsigned char)digits[c]; digest *= 0x100000001b3ULL; }
    digest ^= ','; digest *= 0x100000001b3ULL;
    const double back = em_parse_double(digits, nullptr); bool bad = false;
    if (emieee::bitsOf(back) != u) { strtodOff++; worst = std::max(worst, emieee::ulpDistance(back, v)); bad = true; }
    if (emieee::bitsOf(std::strtod(digits, nullptr)) != u) crtOff++;
    char e[64]; JV *jv = json_parse(digits, (size_t)len, e, sizeof e);
    if (!jv || jv->type != J_NUM || emieee::bitsOf(jv->num) != u) { jsonOff++; bad = true; }
    if (jv) json_free(jv);
    const uint64_t up = (u & 0x7fffffffffffffffULL) == 0x7fefffffffffffffULL ? u - 1 : u + 1;
    std::snprintf(digits2, sizeof digits2, "%.17g", emieee::fromBits(up));
    if (!std::strcmp(digits, digits2)) { collisions++; bad = true; }
    if (emieee::bitsOf(em_parse_double(digits2, nullptr)) != up) { neighbourOff++; bad = true; }
    if (bad && !firstBad[0]) emieee::hex16(u, firstBad);
  }
  char dg[17]; emieee::hex16(digest, dg);
  jb_printf(o, "{\"tool\":\"EightMax IEEE 754 sweep\",\"format\":\"%%.17g\",\"count\":%lld,\"seed\":%llu,\"classes\":{\"anyFinite\":%lld,\"evSized\":%lld,\"subnormal\":%lld,\"aroundPowersOfTwo\":%lld,\"huge\":%lld,\"around2pow53\":%lld}", count, seed, perClass[0], perClass[1], perClass[2], perClass[3], perClass[4], perClass[5]);
  jb_printf(o, ",\"parserMismatches\":%lld,\"crtStrtodMismatches\":%lld,\"jsonReaderMismatches\":%lld,\"neighbourTextCollisions\":%lld,\"neighbourMismatches\":%lld,\"worstUlpDistance\":%llu,\"firstFailingBits\":\"%s\",\"digest\":\"%s\",\"passed\":%s}",
            strtodOff, crtOff, jsonOff, collisions, neighbourOff, (unsigned long long)worst, firstBad, dg, strtodOff + jsonOff + collisions + neighbourOff == 0 ? "true" : "false");
  return strtodOff + jsonOff + collisions + neighbourOff == 0 ? 1 : -1;
}
