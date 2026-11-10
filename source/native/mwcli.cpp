// Command-line driver for the native multiway engine (tests and benchmarks).
// usage: mwcli <spec.json> <iterations> <threads> <out.state> [memoryMiB] [in.state]
//        mwcli --cuda-info            CUDA device probe (JSON)
//        mwcli --equity <spec.json>   exact all-in equity {hands,board,device:cpu|gpu|both,threads,gpuMiB}
// Prints mw_info JSON plus "seconds" (training wall time) on stdout.
#include "mw.h"
#include <cstring>
#ifndef EM_BUILD_ID
#define EM_BUILD_ID "development"
#endif
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <vector>
#include "state_file.hpp"
static std::vector<unsigned char> slurp(const char *f) {
  std::vector<unsigned char> b; FILE *fp = std::fopen(f, "rb"); if (!fp) return b;
  unsigned char tmp[65536]; size_t n; while ((n = std::fread(tmp, 1, sizeof tmp, fp)) > 0) b.insert(b.end(), tmp, tmp + n);
  std::fclose(fp); return b;
}
#include <cerrno>
#include <cmath>
#ifdef _WIN32
#define PSAPI_VERSION 2
#include <windows.h>
#include <psapi.h>
#else
#include <sys/resource.h>
#endif
// 3.3: peak resident memory of the whole process (tables, scratch, allocator and runtime).
static double peakRssMiB() {
#ifdef _WIN32
  PROCESS_MEMORY_COUNTERS pmc; if (K32GetProcessMemoryInfo(GetCurrentProcess(), &pmc, sizeof pmc)) return pmc.PeakWorkingSetSize / 1048576.0;
  return -1;
#else
  struct rusage ru; if (!getrusage(RUSAGE_SELF, &ru)) return ru.ru_maxrss / 1024.0;
  return -1;
#endif
}
static bool wholeArg(const char *s, long long lo, long long hi, long long &out) {
  if (!s || !*s) return false;
  char *end = nullptr; errno = 0;
  const long long v = std::strtoll(s, &end, 10);
  if (errno || *end || v < lo || v > hi) return false;
  out = v; return true;
}
static bool numberArg(const char *s, double &out) {
  if (!s || !*s) return false;
  char *end = nullptr; errno = 0;
  const double v = std::strtod(s, &end);
  if (errno || *end || !std::isfinite(v) || !(v > 0) || v > 65536) return false;
  out = v; return true;
}
int main(int argc, char **argv) {
  if (argc == 2 && !std::strcmp(argv[1], "--build-id")) { std::puts("EightMaxBuild=" EM_BUILD_ID); return 0; }
  if (argc == 2 && !std::strcmp(argv[1], "--cuda-info")) { JB j; jb_init(&j); mw_cuda_info(&j); std::printf("%.*s\n", (int)j.n, j.s); jb_free(&j); return 0; }
  if (argc == 3 && !std::strcmp(argv[1], "--equity")) {
    std::vector<unsigned char> spec = slurp(argv[2]); char err[512] = "";
    JB j; jb_init(&j);
    if (!mw_equity((const char *)spec.data(), spec.size(), &j, err, sizeof err)) { std::fprintf(stderr, "error: %s\n", err); jb_free(&j); return 1; }
    std::printf("%.*s\n", (int)j.n, j.s); jb_free(&j); return 0;
  }
  // 3.8: mwcli --node spec.json state.emmw request.json [memoryMiB]  (strategy explorer query)
  if (argc >= 5 && argc <= 6 && !std::strcmp(argv[1], "--node")) {
    std::vector<unsigned char> spec = slurp(argv[2]), req = slurp(argv[4]); char err[512] = ""; double mib = 4096;
    if (argc == 6 && !numberArg(argv[5], mib)) { std::fprintf(stderr, "error: bad memoryMiB\n"); return 2; }
    if (spec.empty()) { std::fprintf(stderr, "cannot read %s\n", argv[2]); return 2; }
    FILE *f = std::fopen(argv[3], "rb"); std::error_code ec; auto size = std::filesystem::file_size(argv[3], ec);
    std::string text((const char *)spec.data(), spec.size()); MW *m = nullptr;
    const bool ok = f && !ec && mw_load_stream(f, size, text.c_str(), mib, -1, &m, err, sizeof err, nullptr, nullptr) == 200;
    if (f) std::fclose(f);
    if (!ok) { std::fprintf(stderr, "error: %s\n", err[0] ? err : "Unable to open state"); return 1; }
    JB j; jb_init(&j); req.push_back(0);
    const int status = mw_node_query(m, (const char *)req.data(), req.size() - 1, &j, err, sizeof err, nullptr);
    if (status != 200) { std::fprintf(stderr, "error %d: %s\n", status, err); jb_free(&j); mw_free(m); return 1; }
    std::printf("%.*s\n", (int)j.n, j.s); jb_free(&j); mw_free(m); return 0;
  }
  if (argc < 5 || argc > 7) { std::fprintf(stderr, "usage: mwcli spec.json iterations threads out.state [memoryMiB] [in.state]\n"); return 2; }
  // 3.3: strict numeric arguments (atoll/atoi/atof accepted "abc" as 0 and negative thread counts).
  long long iterations = 0, threads = 0; double memoryMiB = 4096;
  if (!wholeArg(argv[2], 0, 10000000, iterations)) { std::fprintf(stderr, "error: iterations must be a whole number from 0 to 10,000,000\n"); return 2; }
  if (!wholeArg(argv[3], 1, 256, threads)) { std::fprintf(stderr, "error: threads must be a whole number from 1 to 256\n"); return 2; }
  if (argc > 5 && !numberArg(argv[5], memoryMiB)) { std::fprintf(stderr, "error: memoryMiB must be a finite number above 0 and at most 65536\n"); return 2; }
  std::vector<unsigned char> spec = slurp(argv[1]);
  if (spec.empty()) { std::fprintf(stderr, "cannot read %s\n", argv[1]); return 2; }
  char err[512] = "";
  MW *m = mw_create((const char *)spec.data(), spec.size(), memoryMiB, err, sizeof err);
  if (!m) { std::fprintf(stderr, "error: %s\n", err); return 1; }
  if (argc > 6) {
    if(mw_is_external(m)){
      FILE *f=fopen(argv[6],"rb");std::error_code ec;auto size=std::filesystem::file_size(argv[6],ec);
      mw_free(m);m=nullptr;std::string text((const char*)spec.data(),spec.size());
      bool ok=f && !ec && mw_load_stream(f,size,text.c_str(),memoryMiB,-1,&m,err,sizeof err,nullptr,nullptr)==200;
      if(f)fclose(f);if(!ok){std::fprintf(stderr,"error: %s\n",err[0]?err:"Unable to open checkpoint");return 1;}
    }else{
      auto st=slurp(argv[6]);
      if(!mw_import(m,st.data(),st.size(),err,sizeof err)){std::fprintf(stderr,"error: %s\n",err);mw_free(m);return 1;}
    }
  }
  auto t0 = std::chrono::steady_clock::now();
  if (!mw_train(m, iterations, (int)threads, nullptr, nullptr, nullptr, err, sizeof err)) { std::fprintf(stderr, "error: %s\n", err); mw_free(m); return 1; }
  double secs = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
  bool saved;
  if(mw_is_external(m))saved=saveWith(argv[4],[&](FILE *f){return mw_write_stream(m,f,nullptr)>0;});
  else{unsigned char *buf=nullptr;size_t n=mw_export(m,&buf);saved=saveState(argv[4],buf,n);std::free(buf);}
  if(!saved){std::fprintf(stderr,"cannot write %s\n",argv[4]);mw_free(m);return 1;}
  JB j; jb_init(&j); mw_info(m, &j);
  std::printf("%.*s", (int)j.n - 1, j.s); std::printf(",\"wallSeconds\":%.6f,\"processPeakRssMiB\":%.1f}\n", secs, peakRssMiB());
  jb_free(&j); mw_free(m);
  return 0;
}
