// EightMax 5.0: one engine instance, several consecutive mw_train calls (short, long, short ...).
// Prints one JSON line per call (the engine's info report, which carries the per-call scheduling
// block) and a final line with the SHA-256 of the exported state, so a test can compare the whole
// call sequence across device modes and check that per-call diagnostics do not leak between calls.
// usage: sched50 <spec.json> <threads> <calls: n1,n2,...>
#include "mw.h"
#include "json.h"
#include "sha256_portable.hpp"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <fstream>
#include <sstream>
int main(int argc, char **argv) {
  if (argc < 4) { std::fprintf(stderr, "usage: sched50 spec.json threads n1,n2,...\n"); return 2; }
  std::ifstream f(argv[1], std::ios::binary); std::stringstream ss; ss << f.rdbuf(); const std::string spec = ss.str();
  char err[512] = ""; MW *m = mw_create(spec.c_str(), spec.size(), 1024, err, sizeof err);
  if (!m) { std::fprintf(stderr, "create: %s\n", err); return 1; }
  const int threads = std::atoi(argv[2]); std::string calls = argv[3];
  size_t at = 0;
  while (at <= calls.size()) {
    const size_t c = calls.find(',', at); const long long n = std::atoll(calls.substr(at, c == std::string::npos ? std::string::npos : c - at).c_str());
    if (!mw_train(m, n, threads, nullptr, nullptr, nullptr, err, sizeof err)) { std::fprintf(stderr, "train: %s\n", err); return 1; }
    JB o; jb_init(&o); mw_info(m, &o); std::printf("%.*s\n", (int)o.n, o.s); jb_free(&o);
    if (c == std::string::npos) break; at = c + 1;
  }
  unsigned char *buf = nullptr; const size_t len = mw_export(m, &buf);
  // body = everything after the EMMW4 header (the header embeds the spec, including its device field)
  uint32_t hl = 0; if (len >= 12) std::memcpy(&hl, buf + 8, 4);
  emsha::Sha256 h; h.add(buf, len); emsha::Sha256 b; if (12 + (size_t)hl <= len) b.add(buf + 12 + hl, len - 12 - hl);
  std::printf("{\"exportSha256\":\"%s\",\"bodySha256\":\"%s\",\"bytes\":%zu}\n", h.hex().c_str(), b.hex().c_str(), len);
  std::free(buf); mw_free(m); return 0;
}
