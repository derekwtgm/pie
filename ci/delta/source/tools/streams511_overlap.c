/* EightMax 5.11: how the training streams of 5.10 and earlier coincide. Arithmetic only: no training is run.
 *   cc -O2 -o streams511_overlap streams511_overlap.c && ./streams511_overlap [seed]
 *
 * The 32-bit generator (native/mw.cpp struct Rng, web/lib_wide.js randomStream): state += C (mod 2^32), C = 0x6d2b79f5,
 * output = hash(state). C is odd, so the states form ONE cycle of 2^32, and "position" p(s) = s * C^-1 (mod 2^32)
 * counts steps along it: a stream that starts in state s and draws n numbers uses positions p(s)+1 .. p(s)+n.
 * Two streams share numbers exactly when those intervals intersect.
 *
 * "deal" action streams (frozen batches): stream (update t, deal d) starts in
 *      s(t, d) = seed ^ (uint32)((t + 1) * 0x9e3779b1) ^ (uint32)((d + 1) * 0x85ebca6b)        (deriveSeed, mw_es.hpp)
 * This program counts, for U updates of 64 deals:
 *   identical   streams whose start state equals the start state of an earlier stream (the SAME numbers again);
 *   withinL     streams whose position lies fewer than L steps after another stream's (they share numbers when a
 *               stream draws at least that many), for L = 8, 32, 128;
 * and, for the deal stream and the "shared" action stream of one seed (start states seed and seed ^ 0x7138ab94), the
 * number of draws after which the first enters positions the other started from.
 * The deal stream itself is one sequential stream: it repeats after 2^32 draws.
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
static uint32_t inverse(uint32_t a) { uint32_t x = a; for (int i = 0; i < 5; i++) x *= 2 - a * x; return x; }
static int cmp(const void *a, const void *b) { uint32_t x = *(const uint32_t *)a, y = *(const uint32_t *)b; return x < y ? -1 : x > y; }
int main(int argc, char **argv) {
  const uint32_t C = 0x6d2b79f5u, CI = inverse(C), seed = argc > 1 ? (uint32_t)strtoul(argv[1], 0, 10) : 101u, actionSeed = seed ^ 0x7138ab94u;
  if ((uint32_t)(C * CI) != 1u) return 1;
  printf("{\"tool\":\"streams511_overlap\",\"seed\":%u,\"actionSeed\":%u,\"step\":\"0x%08x\",\"stepInverse\":\"0x%08x\",\"cycle\":4294967296,\"dealStreams\":[", seed, actionSeed, C, CI);
  const long long updates[] = {1000, 10000, 100000, 1000000, 10000000}; const int B = 64;
  for (int u = 0; u < 5; u++) {
    const long long U = updates[u], N = U * B; const int exact = N <= 64000000LL;   /* sort up to 64 million positions (256 MiB) */
    long long identical = 0, within[3] = {0, 0, 0}; const uint32_t L[3] = {8, 32, 128};
    if (exact) {
      uint32_t *p = malloc((size_t)N * 4); if (!p) return 2; size_t n = 0;
      for (long long t = 0; t < U; t++) for (int d = 0; d < B; d++) p[n++] = (actionSeed ^ (uint32_t)((uint32_t)(t + 1) * 0x9e3779b1u) ^ (uint32_t)((uint32_t)(d + 1) * 0x85ebca6bu)) * CI;
      qsort(p, n, 4, cmp);
      for (size_t i = 0; i < n; i++) {
        const uint32_t gap = i ? p[i] - p[i - 1] : p[0] - p[n - 1];   /* steps from the previous stream on the cycle */
        if (i && gap == 0) identical++;
        for (int k = 0; k < 3; k++) if (n > 1 && gap < L[k]) within[k]++;
      }
      free(p);
    } else {   /* identical start states only: one bit per state (512 MiB) */
      uint8_t *bits = calloc(1u << 29, 1); if (!bits) return 2;
      for (long long t = 0; t < U; t++) for (int d = 0; d < B; d++) { const uint32_t s = actionSeed ^ (uint32_t)((uint32_t)(t + 1) * 0x9e3779b1u) ^ (uint32_t)((uint32_t)(d + 1) * 0x85ebca6bu); if (bits[s >> 3] >> (s & 7) & 1) identical++; else bits[s >> 3] |= (uint8_t)(1u << (s & 7)); }
      free(bits);
    }
    printf("%s{\"updates\":%lld,\"dealsPerUpdate\":%d,\"streams\":%lld,\"identicalToAnEarlierStream\":%lld", u ? "," : "", U, B, N, identical);
    if (exact) printf(",\"startsFewerThan8StepsAfterAnother\":%lld,\"fewerThan32\":%lld,\"fewerThan128\":%lld}", within[0], within[1], within[2]);
    else printf(",\"note\":\"positions not sorted at this size; on average one stream starts every %.1f positions of the cycle, so streams that draw more numbers than that overlap their neighbours\"}", 4294967296.0 / (double)N);
  }
  /* deal stream and shared action stream of one seed: lag in steps from one start to the other */
  const uint32_t lagActionAhead = (actionSeed - seed) * CI, lagDealAhead = (seed - actionSeed) * CI;
  printf("],\"sharedStreams\":{\"dealStreamStart\":%u,\"actionStreamStart\":%u,\"stepsFromDealStartToActionStart\":%u,\"stepsFromActionStartToDealStart\":%u,"
         "\"meaning\":\"after that many draws the deal stream (the action stream) produces the numbers the other stream began with\"},", seed, actionSeed, lagActionAhead, lagDealAhead);
  /* the smallest such lag over the seeds 0 .. 99999 (the lag is a function of the seed) */
  uint32_t best = 0xffffffffu, bestSeed = 0;
  for (uint32_t s = 0; s < 100000; s++) { const uint32_t a = s ^ 0x7138ab94u, x = (a - s) * CI, y = (s - a) * CI, m = x < y ? x : y; if (m < best) { best = m; bestSeed = s; } }
  printf("\"smallestLagOverSeeds0To99999\":{\"seed\":%u,\"steps\":%u},", bestSeed, best);
  printf("\"dealStream\":{\"drawsUntilItRepeats\":4294967296,\"note\":\"one deal draws at least one number per seat, more for board cards and rejected hands; at 7 draws a deal the stream repeats after 613,566,756 deals, inside the 640,000,000 deals that 10,000,000 updates of 64 deals hold\"}}\n");
  return 0;
}
