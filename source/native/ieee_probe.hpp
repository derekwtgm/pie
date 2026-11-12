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
    bool textOk = true; uint64_t td = 0; if (t && t->type == J_STR) { const double tv = std::strtod(t->str, nullptr); td = emieee::ulpDistance(tv, emieee::fromBits(want)); textOk = emieee::bitsOf(tv) == want; }
    if (got != want) mismatches++; if (!textOk) textMismatches++; if (d > worst) worst = d; if (td > worst) worst = td; count++;
    if (i) jb_putc(o, ',');
    jb_printf(o, "{\"bits\":\"%s\",\"parsedBits\":\"%s\",\"ulpDistance\":%llu,\"textUlpDistance\":%llu,\"identical\":%s}", b->str, h, (unsigned long long)d, (unsigned long long)td, got == want && textOk ? "true" : "false");
  }
  jb_printf(o, "],\"probeCount\":%d,\"mismatches\":%d,\"textMismatches\":%d,\"worstUlpDistance\":%llu}", count, mismatches, textMismatches, (unsigned long long)worst);
  json_free(root); return 200;
}
