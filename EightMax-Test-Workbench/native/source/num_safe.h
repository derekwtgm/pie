/* EightMax 4.1: checked numeric conversion and arithmetic.
 *
 * JSON numbers are parsed as IEEE doubles. Converting a double to an integer
 * (or to float) whose range does not contain it is undefined behaviour in C
 * and C++ (C11 6.3.1.4 / 6.3.1.5, C++ [conv.fpint]); 4.0 did this for
 * "memoryMiB": 1e300 in the background-job API before validation. Every
 * supported input path now converts through these helpers, which check, in
 * this order:
 *   1. the JSON type (number; booleans are refused unless asked for),
 *   2. finiteness (NaN, +/-inf),
 *   3. the integer requirement,
 *   4. representability in the destination type (compared against exact
 *      powers of two, never against (double)LLONG_MAX, which rounds up to 2^63),
 *   5. the caller's minimum and maximum (compared as integers after the cast,
 *      which is then known to be defined).
 * Nothing is clamped and no default is substituted for a present-but-invalid
 * value: callers get a status code and a message, and the HTTP routes answer
 * 400 (or 413 for allocations above a budget).
 *
 * Safe arithmetic: em_mul_u64 / em_add_u64 / em_shl_mib report overflow
 * instead of wrapping (used for MiB -> bytes and element-count -> bytes).
 */
#ifndef EM_NUM_SAFE_H
#define EM_NUM_SAFE_H
#include <math.h>
#include <stdint.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>
#include "json.h"

#ifdef __cplusplus
extern "C" {
#endif

enum { EM_NUM_OK = 0, EM_NUM_MISSING = 1, EM_NUM_TYPE = -1, EM_NUM_NONFINITE = -2, EM_NUM_FRACTION = -3, EM_NUM_RANGE = -4 };

#define EM_TWO63 9223372036854775808.0   /* 2^63, exact in binary64 */
#define EM_TWO64 18446744073709551616.0  /* 2^64 */

/* double -> int64 in [lo, hi]. */
static inline int em_dbl_to_i64(double d, long long lo, long long hi, long long *out) {
  if (!isfinite(d)) return EM_NUM_NONFINITE;
  if (floor(d) != d) return EM_NUM_FRACTION;
  if (!(d >= -EM_TWO63 && d < EM_TWO63)) return EM_NUM_RANGE;  /* representable: cast is defined below */
  long long v = (long long)d;
  if (v < lo || v > hi) return EM_NUM_RANGE;
  *out = v; return EM_NUM_OK;
}
/* double -> uint64 in [lo, hi]. */
static inline int em_dbl_to_u64(double d, unsigned long long lo, unsigned long long hi, unsigned long long *out) {
  if (!isfinite(d)) return EM_NUM_NONFINITE;
  if (floor(d) != d) return EM_NUM_FRACTION;
  if (!(d >= 0 && d < EM_TWO64)) return EM_NUM_RANGE;
  unsigned long long v = (unsigned long long)d;
  if (v < lo || v > hi) return EM_NUM_RANGE;
  *out = v; return EM_NUM_OK;
}
/* finite double in [lo, hi] (no integer requirement). */
static inline int em_dbl_in(double d, double lo, double hi) {
  if (!isfinite(d)) return EM_NUM_NONFINITE;
  return d >= lo && d <= hi ? EM_NUM_OK : EM_NUM_RANGE;
}
/* double -> float without overflow: finite and |d| <= FLT_MAX. */
static inline int em_dbl_to_f32(double d, float *out) {
  if (!isfinite(d)) return EM_NUM_NONFINITE;
  if (!(d >= -3.4028234663852886e38 && d <= 3.4028234663852886e38)) return EM_NUM_RANGE;
  *out = (float)d; return EM_NUM_OK;
}

/* JSON value (may be NULL = missing) -> int64 in [lo, hi]. EM_NUM_MISSING leaves *out untouched. */
static inline int em_jv_i64(const JV *v, long long lo, long long hi, long long *out) {
  if (!v) return EM_NUM_MISSING;
  if (v->type != J_NUM) return EM_NUM_TYPE;
  return em_dbl_to_i64(v->num, lo, hi, out);
}
static inline int em_jv_int(const JV *v, int lo, int hi, int *out) {
  long long x = 0; int rc = em_jv_i64(v, lo, hi, &x);
  if (rc == EM_NUM_OK) *out = (int)x;
  return rc;
}
static inline int em_jv_u64(const JV *v, unsigned long long lo, unsigned long long hi, unsigned long long *out) {
  if (!v) return EM_NUM_MISSING;
  if (v->type != J_NUM) return EM_NUM_TYPE;
  return em_dbl_to_u64(v->num, lo, hi, out);
}
static inline int em_jv_dbl(const JV *v, double lo, double hi, double *out) {
  if (!v) return EM_NUM_MISSING;
  if (v->type != J_NUM) return EM_NUM_TYPE;
  int rc = em_dbl_in(v->num, lo, hi);
  if (rc == EM_NUM_OK) *out = v->num;
  return rc;
}
/* Human-readable reason; `name` is the field. */
static inline void em_num_msg(char *buf, size_t n, const char *name, int rc, double lo, double hi, int integer) {
  const char *what = rc == EM_NUM_MISSING ? "is required" : rc == EM_NUM_TYPE ? "must be a JSON number" :
                     rc == EM_NUM_NONFINITE ? "must be finite" : rc == EM_NUM_FRACTION ? "must be a whole number" : "is out of range";
  if (rc == EM_NUM_RANGE || rc == EM_NUM_FRACTION)
    snprintf(buf, n, "%s %s (%s %.17g to %.17g)", name, what, integer ? "an integer from" : "a number from", lo, hi);
  else snprintf(buf, n, "%s %s", name, what);
}

/* Overflow-checked arithmetic. Return 0 on success, 1 on overflow. */
static inline int em_mul_u64(unsigned long long a, unsigned long long b, unsigned long long *r) {
#if defined(__GNUC__) || defined(__clang__)
  return __builtin_mul_overflow(a, b, r);
#else
  if (a && b > UINT64_MAX / a) return 1; *r = a * b; return 0;
#endif
}
static inline int em_add_u64(unsigned long long a, unsigned long long b, unsigned long long *r) {
#if defined(__GNUC__) || defined(__clang__)
  return __builtin_add_overflow(a, b, r);
#else
  if (b > UINT64_MAX - a) return 1; *r = a + b; return 0;
#endif
}
/* MiB -> bytes into size_t (refuses results that do not fit, e.g. on 32-bit). */
static inline int em_mib_to_bytes(unsigned long long mib, size_t *bytes) {
  unsigned long long r;
  if (em_mul_u64(mib, 1048576ULL, &r) || r > (unsigned long long)SIZE_MAX) return 1;
  *bytes = (size_t)r; return 0;
}

#ifdef __cplusplus
}
#endif
#endif
