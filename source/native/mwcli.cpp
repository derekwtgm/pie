// Command-line driver for the native multiway engine (tests and benchmarks).
// usage: mwcli <spec.json> <iterations> <threads> <out.state> [memoryMiB] [in.state]
// Prints mw_info JSON plus "seconds" (training wall time) on stdout.
#include "mw.h"
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <vector>
static std::vector<unsigned char> slurp(const char *f) {
  std::vector<unsigned char> b; FILE *fp = std::fopen(f, "rb"); if (!fp) return b;
  unsigned char tmp[65536]; size_t n; while ((n = std::fread(tmp, 1, sizeof tmp, fp)) > 0) b.insert(b.end(), tmp, tmp + n);
  std::fclose(fp); return b;
}
int main(int argc, char **argv) {
  if (argc < 5) { std::fprintf(stderr, "usage: mwcli spec.json iterations threads out.state [memoryMiB] [in.state]\n"); return 2; }
  std::vector<unsigned char> spec = slurp(argv[1]);
  if (spec.empty()) { std::fprintf(stderr, "cannot read %s\n", argv[1]); return 2; }
  char err[512] = "";
  MW *m = mw_create((const char *)spec.data(), spec.size(), argc > 5 ? std::atof(argv[5]) : 4096, err, sizeof err);
  if (!m) { std::fprintf(stderr, "error: %s\n", err); return 1; }
  if (argc > 6) {
    std::vector<unsigned char> st = slurp(argv[6]);
    if (!mw_import(m, st.data(), st.size(), err, sizeof err)) { std::fprintf(stderr, "error: %s\n", err); mw_free(m); return 1; }
  }
  auto t0 = std::chrono::steady_clock::now();
  if (!mw_train(m, std::atoll(argv[2]), std::atoi(argv[3]), nullptr, nullptr, nullptr, err, sizeof err)) { std::fprintf(stderr, "error: %s\n", err); mw_free(m); return 1; }
  double secs = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
  unsigned char *buf = nullptr; size_t n = mw_export(m, &buf);
  FILE *fp = std::fopen(argv[4], "wb"); if (!fp || std::fwrite(buf, 1, n, fp) != n) { std::fprintf(stderr, "cannot write %s\n", argv[4]); return 1; }
  std::fclose(fp); std::free(buf);
  JB j; jb_init(&j); mw_info(m, &j);
  std::printf("%.*s", (int)j.n - 1, j.s); std::printf(",\"seconds\":%.6f}\n", secs);
  jb_free(&j); mw_free(m);
  return 0;
}
