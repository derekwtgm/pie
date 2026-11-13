/* EightMax 4.1: property-based and boundary tests for native/num_safe.h.
 * Built and run by tests/v41.test.js with
 *   -fsanitize=undefined,float-cast-overflow -fno-sanitize-recover=all
 * so any conversion the helpers perform outside the destination range aborts.
 * Reference: a value d is accepted for [lo, hi] iff it is finite, integral and
 * lo <= d <= hi in exact arithmetic. The exact comparison is done with long
 * double (64-bit mantissa on x86, which represents every int64 and every
 * integral double below 2^64 exactly); on platforms where long double is
 * binary64 the boundary cases are still checked explicitly below. */
#include <float.h>
#include <stdio.h>
#include <stdlib.h>
#include "num_safe.h"
static int fails = 0;
#define CHECK(c) do { if (!(c)) { fprintf(stderr, "FAIL %s:%d %s\n", __FILE__, __LINE__, #c); fails++; } } while (0)
static unsigned long long rs = 88172645463325252ULL;
static unsigned long long rnd(void) { rs ^= rs << 13; rs ^= rs >> 7; rs ^= rs << 17; return rs; }
static int ref_i64(double d, long long lo, long long hi) {
  if (!isfinite(d) || floor(d) != d) return 0;
  long double x = (long double)d; return x >= (long double)lo && x <= (long double)hi;
}
static int ref_u64(double d, unsigned long long lo, unsigned long long hi) {
  if (!isfinite(d) || floor(d) != d || d < 0) return 0;
  long double x = (long double)d; return x >= (long double)lo && x <= (long double)hi;
}
int main(void) {
  long long o; unsigned long long u; float f;
  /* boundaries */
  CHECK(em_dbl_to_i64(EM_TWO63, LLONG_MIN, LLONG_MAX, &o) == EM_NUM_RANGE);          /* 2^63 is not an int64 */
  CHECK(em_dbl_to_i64(-EM_TWO63, LLONG_MIN, LLONG_MAX, &o) == EM_NUM_OK && o == LLONG_MIN);
  CHECK(em_dbl_to_i64(9223372036854774784.0, LLONG_MIN, LLONG_MAX, &o) == EM_NUM_OK && o == 9223372036854774784LL); /* largest double < 2^63 */
  CHECK(em_dbl_to_i64(nextafter(-EM_TWO63, -INFINITY), LLONG_MIN, LLONG_MAX, &o) == EM_NUM_RANGE);
  CHECK(em_dbl_to_i64(1e300, LLONG_MIN, LLONG_MAX, &o) == EM_NUM_RANGE);
  CHECK(em_dbl_to_i64(-1e300, LLONG_MIN, LLONG_MAX, &o) == EM_NUM_RANGE);
  CHECK(em_dbl_to_i64(INFINITY, 0, 10, &o) == EM_NUM_NONFINITE);
  CHECK(em_dbl_to_i64(-INFINITY, 0, 10, &o) == EM_NUM_NONFINITE);
  CHECK(em_dbl_to_i64(NAN, 0, 10, &o) == EM_NUM_NONFINITE);
  CHECK(em_dbl_to_i64(0.5, 0, 10, &o) == EM_NUM_FRACTION);
  CHECK(em_dbl_to_i64(-0.0, 0, 10, &o) == EM_NUM_OK && o == 0);
  CHECK(em_dbl_to_i64(16, 16, 4096, &o) == EM_NUM_OK && em_dbl_to_i64(4096, 16, 4096, &o) == EM_NUM_OK);
  CHECK(em_dbl_to_i64(15, 16, 4096, &o) == EM_NUM_RANGE && em_dbl_to_i64(4097, 16, 4096, &o) == EM_NUM_RANGE);
  CHECK(em_dbl_to_u64(EM_TWO64, 0, ULLONG_MAX, &u) == EM_NUM_RANGE);
  CHECK(em_dbl_to_u64(18446744073709549568.0, 0, ULLONG_MAX, &u) == EM_NUM_OK && u == 18446744073709549568ULL);
  CHECK(em_dbl_to_u64(-1, 0, ULLONG_MAX, &u) == EM_NUM_RANGE);
  CHECK(em_dbl_to_u64(4294967296.0, 0, 4294967295ULL, &u) == EM_NUM_RANGE);
  CHECK(em_dbl_to_f32(1e300, &f) == EM_NUM_RANGE && em_dbl_to_f32(-1e300, &f) == EM_NUM_RANGE && em_dbl_to_f32(FLT_MAX, &f) == EM_NUM_OK);
  CHECK(em_dbl_in(1e300, 0, 1) == EM_NUM_RANGE && em_dbl_in(NAN, 0, 1) == EM_NUM_NONFINITE);
  /* JSON types: null, strings, booleans, missing */
  { char e[64]; const char *text = "{\"a\":null,\"b\":\"512\",\"c\":true,\"e\":512}"; JV *v = json_parse(text, strlen(text), e, sizeof e); CHECK(v != NULL);
    if (v) { int i = 0;
      CHECK(em_jv_int(jget(v, "a"), 0, 1000, &i) == EM_NUM_TYPE);
      CHECK(em_jv_int(jget(v, "b"), 0, 1000, &i) == EM_NUM_TYPE);
      CHECK(em_jv_int(jget(v, "c"), 0, 1000, &i) == EM_NUM_TYPE);
      CHECK(em_jv_int(jget(v, "e"), 0, 1000, &i) == EM_NUM_OK && i == 512);
      CHECK(em_jv_int(jget(v, "missing"), 0, 1000, &i) == EM_NUM_MISSING);
      json_free(v); } }
  /* the JSON parser refuses literals that overflow to infinity (1e999), so
     non-finite numbers cannot arrive through JSON at all */
  { char e[64]; const char *t1 = "{\"d\":1e999}", *t2 = "{\"d\":-1e999}";
    CHECK(json_parse(t1, strlen(t1), e, sizeof e) == NULL); CHECK(json_parse(t2, strlen(t2), e, sizeof e) == NULL); }
  /* overflow-checked arithmetic, including the MiB -> bytes derivation */
  unsigned long long r;
  CHECK(em_mul_u64(1ULL << 32, 1ULL << 32, &r) == 1);
  CHECK(em_mul_u64(1ULL << 31, 1ULL << 32, &r) == 0 && r == 1ULL << 63);
  CHECK(em_add_u64(ULLONG_MAX, 1, &r) == 1 && em_add_u64(ULLONG_MAX - 1, 1, &r) == 0);
  { size_t b; CHECK(em_mib_to_bytes(4096, &b) == 0 && b == 4096ULL << 20); CHECK(em_mib_to_bytes(1ULL << 45, &b) == 1); }
  /* property test: random bit patterns and values near powers of two */
  long long checked = 0;
  static const long long LO[] = { LLONG_MIN, -1000, 0, 16, 100 }, HI[] = { LLONG_MAX, 1000, 4294967295LL, 4096, 3600000 };
  for (int it = 0; it < 2000000; it++) {
    double d; unsigned long long bits = rnd();
    switch (it % 4) {
      case 0: memcpy(&d, &bits, sizeof d); break;                                   /* any double, incl. NaN/inf/denormals */
      case 1: d = ldexp(1.0, (int)(bits % 70)) * ((bits >> 8) & 1 ? -1 : 1); d = nextafter(d, (bits >> 9) & 1 ? INFINITY : -INFINITY); break;
      case 2: d = (double)(long long)(bits >> (bits % 64)) * ((bits >> 7) & 1 ? -1 : 1); break;
      default: d = (double)(bits % 8000000) - 1000.0 + ((bits >> 40) & 1 ? 0.5 : 0); break;
    }
    const int k = it % 5;
    const int got = em_dbl_to_i64(d, LO[k], HI[k], &o) == EM_NUM_OK, want = ref_i64(d, LO[k], HI[k]);
    CHECK(got == want); if (got) CHECK((long double)o == (long double)d);
    const int gu = em_dbl_to_u64(d, 0, ULLONG_MAX, &u) == EM_NUM_OK, wu = ref_u64(d, 0, ULLONG_MAX);
    CHECK(gu == wu); if (gu) CHECK((long double)u == (long double)d);
    if (fails > 20) break;
    checked++;
  }
  printf("{\"propertyCases\":%lld,\"failures\":%d}\n", checked, fails);
  return fails ? 1 : 0;
}
