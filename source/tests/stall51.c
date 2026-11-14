/* EightMax 5.1: independent scheduling-stall detector for the deadline investigation (tools/deadline51.js --stall).
   Sleeps 1 ms in a loop on CLOCK_MONOTONIC (the clock of std::chrono::steady_clock on Linux) and prints every
   wake-up that came more than THRESH_MS late: "<start ns> <end ns> <late ms>". A stall seen here and inside the
   evaluator at the same time is a machine/VM stall, not an evaluator code path. */
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
int main(int argc, char **argv) {
  const double thresh = argc > 1 ? atof(argv[1]) : 15.0; struct timespec a, b, d = {0, 1000000};
  setvbuf(stdout, NULL, _IOLBF, 0);
  for (;;) { clock_gettime(CLOCK_MONOTONIC, &a); nanosleep(&d, NULL); clock_gettime(CLOCK_MONOTONIC, &b);
    long long s = a.tv_sec * 1000000000LL + a.tv_nsec, e = b.tv_sec * 1000000000LL + b.tv_nsec; double late = (e - s) / 1e6 - 1.0;
    if (late > thresh) printf("%lld %lld %.3f\n", s, e, late); }
}
