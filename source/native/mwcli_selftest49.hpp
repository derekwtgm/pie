// EightMax 4.9: mwcli --selftest49 <fixtures-dir> <work-dir>
// Compressed-checkpoint (EMZ1) restoration checks for Windows CI and the target PC
// ("Run 4.9 checks.bat"). 4.8 on a standard Windows account failed "150 + 150 resumed from EMZ1"
// because std::tmpfile() (msvcrt) creates its file in the root of the drive; 4.9 uses
// native/temp_file.hpp. Every step is a separate mwcli process, recorded in <work-dir>/selftest49.json.
// Fixture: icm-final8.spec.json (the 4.4-4.8 golden study; 300 updates = GOLDEN).
#pragma once
#include <thread>
#include <mutex>
namespace st49 {
inline std::string fileSha(const std::string &p) { auto b = slurp(p.c_str()); if (b.empty()) return ""; emsha::Sha256 h; h.add(b.data(), b.size()); return h.hex(); }
#ifdef _WIN32
// Directories and environment values are created through the wide (UTF-16) API so the test really
// exercises Unicode and long paths; \\?\ is used for paths of 240 characters or more.
inline std::wstring wide(const std::string &utf8) { int n = MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), -1, nullptr, 0); std::wstring w(n > 0 ? (size_t)n - 1 : 0, L'\0'); if (n > 1) MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), -1, &w[0], n); return w; }
inline std::wstring absW(const std::wstring &p) { wchar_t b[4096]; DWORD n = GetFullPathNameW(p.c_str(), 4096, b, nullptr); return n && n < 4096 ? std::wstring(b, n) : p; }
inline bool mkdirsW(std::wstring p) {
  p = absW(p); for (auto &c : p) if (c == L'/') c = L'\\';
  const std::wstring pre = L"\\\\?\\"; std::wstring cur;
  for (size_t i = 0; i <= p.size(); i++) { if (i == p.size() || p[i] == L'\\') { cur = p.substr(0, i); if (cur.size() > 3) { CreateDirectoryW((pre + cur).c_str(), nullptr); } } }
  DWORD a = GetFileAttributesW((pre + p).c_str()); return a != INVALID_FILE_ATTRIBUTES && (a & FILE_ATTRIBUTE_DIRECTORY);
}
inline void setEnvU8(const char *k, const std::string *v) { const std::wstring wk = wide(k); if (v) { const std::wstring wv = wide(*v); SetEnvironmentVariableW(wk.c_str(), wv.c_str()); _wputenv_s(wk.c_str(), wv.c_str()); } else { SetEnvironmentVariableW(wk.c_str(), nullptr); _wputenv_s(wk.c_str(), L""); } }
inline bool makeDir(const std::string &u8) { return mkdirsW(wide(u8)); }
inline int countTemp(const std::string &dirU8) {
  WIN32_FIND_DATAW d; std::wstring q = L"\\\\?\\" + absW(wide(dirU8)) + L"\\EightMax-emz-*"; HANDLE h = FindFirstFileW(q.c_str(), &d); if (h == INVALID_HANDLE_VALUE) return 0;
  int n = 0; do n++; while (FindNextFileW(h, &d)); FindClose(h); return n;
}
#else
inline bool makeDir(const std::string &p) { std::error_code ec; std::filesystem::create_directories(p, ec); return std::filesystem::is_directory(p, ec); }
inline void setEnvU8(const char *k, const std::string *v) { if (v) setenv(k, v->c_str(), 1); else unsetenv(k); }
inline int countTemp(const std::string &dir) { int n = 0; std::error_code ec; for (auto &e : std::filesystem::directory_iterator(dir, ec)) if (e.path().filename().string().rfind("EightMax-emz-", 0) == 0) n++; return n; }
#endif
inline int run(int argc, char **argv) {
  if (argc < 4) { std::fprintf(stderr, "usage: mwcli --selftest49 fixtures-dir work-dir\n"); return 2; }
  namespace fs = std::filesystem; std::error_code ec;
  const std::string self = ckpt::selfPath(argv[0]), fx = fs::absolute(argv[2], ec).string(), dir = fs::absolute(argv[3], ec).string();
  fs::create_directories(dir, ec);
  const std::string spec = (fs::path(fx) / "icm-final8.spec.json").string();
  const std::string GOLDEN = "aa80974199182afa91d5a47166d32af0eb00ecff3ba334593eb5a359cc2e22b8";
  auto P = [&](const std::string &name) { return (fs::path(dir) / name).string(); };
  std::ostringstream steps, checks; int passed = 0, failed = 0; bool firstStep = true, firstCheck = true; std::mutex mu;
  const auto t0 = std::chrono::steady_clock::now();
  using Env = std::vector<std::pair<std::string, std::string>>;
  auto record = [&](const std::string &label, const ckpt::Run &r) {
    std::lock_guard<std::mutex> g(mu);
    steps << (firstStep ? "" : ",\n") << "{\"label\":" << mwa::jsonEsc(label) << ",\"command\":" << mwa::jsonEsc(r.command) << ",\"exitCode\":" << r.exitCode << ",\"timedOut\":" << (r.timedOut ? "true" : "false") << ",\"ms\":" << mwa::fmt(r.ms) << ",\"stderr\":" << mwa::jsonEsc(ckpt::clip(r.err, 4096)) << "}";
    firstStep = false;
  };
  auto step = [&](const std::string &label, std::vector<std::string> args, const Env &env = {}) { args.insert(args.begin(), self); ckpt::Run r = ckpt::spawn(args, dir, 900, env); record(label, r); return r; };
  auto check = [&](const std::string &name, bool ok, const std::string &detail) {
    (ok ? passed : failed)++; checks << (firstCheck ? "" : ",\n") << "{\"name\":" << mwa::jsonEsc(name) << ",\"passed\":" << (ok ? "true" : "false") << ",\"detail\":" << mwa::jsonEsc(detail) << "}"; firstCheck = false;
    std::fprintf(stderr, "%s %s %s\n", ok ? "PASS" : "FAIL", name.c_str(), detail.c_str());
  };
  if (!fs::exists(spec, ec)) { std::fprintf(stderr, "error: missing fixture %s\n", spec.c_str()); return 2; }
  // the work folder itself has a space in its name: every checkpoint path below contains one
  const std::string W = P("ckpt dir");
  fs::create_directories(W, ec);
  auto Q = [&](const std::string &n) { return (fs::path(W) / n).string(); };
  // reference states (uncompressed)
  step("150 updates", {spec, "150", "4", Q("a150.state"), "512"});
  auto u = step("150 + 150 from the uncompressed checkpoint", {spec, "150", "4", Q("u300.state"), "512", Q("a150.state")});
  check("uncompressed restoration: 150 + 150 = 300 uninterrupted (golden)", u.exitCode == 0 && fileSha(Q("u300.state")) == GOLDEN, fileSha(Q("u300.state")));
  // 1 default temporary directory, three compression levels
  for (const char *lv : {"1", "6", "9"}) {
    const std::string z = Q(std::string("a150-l") + lv + ".emz"), out = Q(std::string("z300-l") + lv + ".state");
    step(std::string("compress level ") + lv, {"--compress", Q("a150.state"), z, lv});
    auto r = step(std::string("150 + 150 from EMZ1 level ") + lv, {spec, "150", "4", out, "512", z});
    check(std::string("EMZ1 level ") + lv + ": 150 + 150 resumed from the compressed checkpoint = golden 300", r.exitCode == 0 && fileSha(out) == GOLDEN, r.err.empty() ? fileSha(out) : r.err);
  }
  const std::string Z = Q("a150-l6.emz");
  // 2 the system temporary directory is missing: falls back to the checkpoint's folder
  {
    const std::string missing = P("no such temp dir");
    auto r = step("resume with TMP, TEMP and TMPDIR pointing to a missing directory", {spec, "150", "4", Q("fb300.state"), "512", Z}, {{"TMP", missing}, {"TEMP", missing}, {"TMPDIR", missing}});
    check("unusable system temporary directory: falls back to the checkpoint's folder and restores exactly", r.exitCode == 0 && fileSha(Q("fb300.state")) == GOLDEN, r.err.empty() ? fileSha(Q("fb300.state")) : r.err);
  }
  // 3 temporary directory with spaces and non-ASCII characters (UTF-16 on Windows)
  {
    // UTF-8 by plain concatenation (std::filesystem::path::string() would convert through the ANSI code page on Windows)
#ifdef _WIN32
    const std::string uni = dir + "\\temp dir \xC3\xA9\xC3\xBC \xE6\x97\xA5\xE6\x9C\xAC";   // "temp dir éü 日本"
#else
    const std::string uni = dir + "/temp dir \xC3\xA9\xC3\xBC \xE6\x97\xA5\xE6\x9C\xAC";
#endif
    const bool made = makeDir(uni);
    setEnvU8("EM_TEMP_DIR", &uni);
    ckpt::Run r; { std::vector<std::string> a{self, spec, "150", "4", Q("uni300.state"), "512", Z}; r = ckpt::spawn(a, dir, 900); record("resume with EM_TEMP_DIR = a Unicode path with spaces", r); }
    setEnvU8("EM_TEMP_DIR", nullptr);
    check("temporary directory with spaces and Unicode characters: exact restoration", made && r.exitCode == 0 && fileSha(Q("uni300.state")) == GOLDEN, std::string(made ? "" : "directory not created; ") + (r.err.empty() ? fileSha(Q("uni300.state")) : r.err));
    check("no temporary file is left in the Unicode temporary directory", countTemp(uni) == 0, std::to_string(countTemp(uni)) + " left");
  }
  // 4 long temporary directory (>= 240 characters; \\?\ on Windows)
  {
    std::string lng = dir; while (lng.size() < 250) lng += std::string(1, '/') + "long-path-segment-0123456789";
#ifdef _WIN32
    for (auto &c : lng) if (c == '/') c = '\\';
#endif
    const bool made = makeDir(lng);
    setEnvU8("EM_TEMP_DIR", &lng);
    ckpt::Run r; { std::vector<std::string> a{self, spec, "150", "4", Q("long300.state"), "512", Z}; r = ckpt::spawn(a, dir, 900); record("resume with EM_TEMP_DIR = a path of " + std::to_string(lng.size()) + " characters", r); }
    setEnvU8("EM_TEMP_DIR", nullptr);
    check("long temporary directory (" + std::to_string(lng.size()) + " characters): exact restoration, nothing left behind", made && r.exitCode == 0 && fileSha(Q("long300.state")) == GOLDEN && countTemp(lng) == 0, std::string(made ? "" : "directory not created; ") + (r.err.empty() ? fileSha(Q("long300.state")) : r.err));
  }
  // 5 temporary file creation impossible: clean refusal, nothing written, existing output kept
  {
    fs::copy_file(Q("a150.state"), Q("keep.state"), fs::copy_options::overwrite_existing, ec); const std::string before = fileSha(Q("keep.state"));
    auto r = step("resume with temporary file creation disabled (fault injection)", {spec, "150", "4", Q("keep.state"), "512", Z}, {{"EM_TEST_TEMP_FAIL", "1"}});
    check("temporary file creation failure: exit 3, the reason is named, the existing output checkpoint is unchanged", r.exitCode == 3 && r.err.find("temporary file") != std::string::npos && fileSha(Q("keep.state")) == before, "exit " + std::to_string(r.exitCode) + "; " + r.err);
  }
  // 6 corrupted, truncated and checksum-mismatched compressed checkpoints are refused; nothing is written
  {
    auto b = slurp(Z.c_str()); bool okAll = !b.empty(); std::string detail;
    struct Case { const char *name; std::vector<unsigned char> data; };
    std::vector<Case> cs;
    if (!b.empty()) {
      auto c1 = b; c1[c1.size() / 2] ^= 0x10; cs.push_back({"corrupted block", c1});
      cs.push_back({"truncated file", std::vector<unsigned char>(b.begin(), b.begin() + (long)(b.size() * 2 / 3))});
      auto c3 = b; c3[c3.size() - 5] ^= 0x01; cs.push_back({"SHA-256 mismatch in the end block", c3});
    }
    for (size_t i = 0; i < cs.size(); i++) {
      const std::string f = Q("bad" + std::to_string(i) + ".emz"), out = Q("bad" + std::to_string(i) + ".state");
      FILE *o = std::fopen(f.c_str(), "wb"); if (o) { std::fwrite(cs[i].data.data(), 1, cs[i].data.size(), o); std::fclose(o); }
      auto r = step(std::string("train from a ") + cs[i].name, {spec, "5", "1", out, "512", f});
      const bool ok = r.exitCode == 3 && !fs::exists(out, ec); okAll &= ok; detail += std::string(cs[i].name) + ": exit " + std::to_string(r.exitCode) + (ok ? "" : " WRITTEN") + "; ";
    }
    check("corrupted, truncated and checksum-mismatched EMZ1 files are refused and no output is written", okAll && cs.size() == 3, detail);
  }
  // 7 concurrent restorations from the same compressed checkpoint
  {
    std::vector<std::thread> ts; std::vector<ckpt::Run> rs(4);
    for (int i = 0; i < 4; i++) ts.emplace_back([&, i] { std::vector<std::string> a{self, spec, "150", "2", Q("par" + std::to_string(i) + ".state"), "512", Z}; rs[(size_t)i] = ckpt::spawn(a, dir, 900); });
    for (auto &t : ts) t.join();
    bool ok = true; for (int i = 0; i < 4; i++) { record("concurrent restoration " + std::to_string(i), rs[(size_t)i]); ok &= rs[(size_t)i].exitCode == 0 && fileSha(Q("par" + std::to_string(i) + ".state")) == GOLDEN; }
    check("four concurrent restorations from one EMZ1 file all equal golden 300", ok, "");
  }
  // 8 longer continuations from compressed checkpoints
  for (const long long n : {500LL, 1000LL}) {
    const std::string a = Q("c" + std::to_string(n) + "a.state"), z = Q("c" + std::to_string(n) + "a.emz"), b = Q("c" + std::to_string(n) + "b.state"), d = Q("c" + std::to_string(n) + "d.state");
    step(std::to_string(n) + " updates", {spec, std::to_string(n), "4", a, "512"}); step("compress", {"--compress", a, z});
    step(std::to_string(n) + " more from EMZ1", {spec, std::to_string(n), "4", b, "512", z}); step(std::to_string(2 * n) + " uninterrupted", {spec, std::to_string(2 * n), "4", d, "512"});
    check(std::to_string(n) + " + " + std::to_string(n) + " resumed from EMZ1 = " + std::to_string(2 * n) + " uninterrupted", !fileSha(d).empty() && fileSha(b) == fileSha(d), fileSha(d));
  }
  // 9 three compressed generations
  {
    std::string prev;
    for (int g = 1; g <= 3; g++) {
      const std::string st = Q("g" + std::to_string(g) + ".state"), z = Q("g" + std::to_string(g) + ".emz");
      std::vector<std::string> a{spec, "100", "4", st, "512"}; if (!prev.empty()) a.push_back(prev);
      step("generation " + std::to_string(g), a); step("compress generation " + std::to_string(g), {"--compress", st, z}); prev = z;
    }
    step("300 uninterrupted", {spec, "300", "4", Q("g-direct.state"), "512"});
    check("three generations, each resumed from the previous compressed checkpoint = 300 uninterrupted (golden)", fileSha(Q("g3.state")) == GOLDEN && fileSha(Q("g-direct.state")) == GOLDEN, fileSha(Q("g3.state")));
  }
  // 10 no temporary decompression files left in the checkpoint folder (fallback directory)
  check("no temporary decompression file is left in the checkpoint folder", countTemp(W) == 0, std::to_string(countTemp(W)) + " left");
  const double secs = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
  std::ostringstream o; o << "{\"tool\":\"mwcli selftest49\",\"version\":\"" << EM_VERSION << "\",\"build\":\"" << EM_BUILD_ID << "\",\"passed\":" << passed << ",\"failed\":" << failed << ",\"seconds\":" << mwa::fmt(secs) << ",\"checks\":[" << checks.str() << "],\"steps\":[" << steps.str() << "]}";
  { FILE *f = std::fopen(P("selftest49.json").c_str(), "wb"); if (f) { const std::string s = o.str(); std::fwrite(s.data(), 1, s.size(), f); std::fclose(f); } }
  std::printf("{\"tool\":\"mwcli selftest49\",\"build\":\"%s\",\"passed\":%d,\"failed\":%d,\"report\":%s}\n", EM_BUILD_ID, passed, failed, mwa::jsonEsc(P("selftest49.json")).c_str());
  return failed ? 1 : 0;
}
}
