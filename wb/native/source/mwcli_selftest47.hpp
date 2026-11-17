// EightMax 4.7: mwcli --selftest47 <fixtures-dir> <work-dir>
// Self-recording check of the 4.7 features for the target PC ("Run 4.7 checks.bat"). Every step
// is a separate mwcli process (cold engine start), recorded with command, exit code, output and
// milliseconds in <work-dir>/selftest47.json, written before the verdict. Needs the fixtures
// icm-final8.spec.json (4.4-4.6 golden study), river3.spec.json and river3-own.spec.json.
#pragma once
namespace st47 {
inline std::string fileSha(const std::string &p) { auto b = slurp(p.c_str()); if (b.empty()) return ""; emsha::Sha256 h; h.add(b.data(), b.size()); return h.hex(); }
inline int run(int argc, char **argv) {
  if (argc < 4) { std::fprintf(stderr, "usage: mwcli --selftest47 fixtures-dir work-dir\n"); return 2; }
  namespace fs = std::filesystem; std::error_code ec;
  const std::string self = ckpt::selfPath(argv[0]), fx = fs::absolute(argv[2], ec).string(), dir = fs::absolute(argv[3], ec).string();
  fs::create_directories(dir, ec);
  const std::string spec8 = (fs::path(fx) / "icm-final8.spec.json").string(), r3 = (fs::path(fx) / "river3.spec.json").string(), own = (fs::path(fx) / "river3-own.spec.json").string();
  const std::string GOLDEN = "aa80974199182afa91d5a47166d32af0eb00ecff3ba334593eb5a359cc2e22b8";
  auto P = [&](const char *name) { return (fs::path(dir) / name).string(); };
  std::ostringstream steps, checks; int passed = 0, failed = 0; bool firstStep = true, firstCheck = true;
  const auto t0 = std::chrono::steady_clock::now();
  auto step = [&](const std::string &label, std::vector<std::string> args, double timeout = 900) {
    args.insert(args.begin(), self); ckpt::Run r = ckpt::spawn(args, dir, timeout);
    steps << (firstStep ? "" : ",\n") << "{\"label\":" << mwa::jsonEsc(label) << ",\"command\":" << mwa::jsonEsc(r.command) << ",\"exitCode\":" << r.exitCode << ",\"timedOut\":" << (r.timedOut ? "true" : "false") << ",\"ms\":" << mwa::fmt(r.ms) << ",\"stdout\":" << mwa::jsonEsc(ckpt::clip(r.out)) << ",\"stderr\":" << mwa::jsonEsc(ckpt::clip(r.err)) << "}";
    firstStep = false; return r;
  };
  auto check = [&](const std::string &name, bool ok, const std::string &detail) {
    (ok ? passed : failed)++; checks << (firstCheck ? "" : ",\n") << "{\"name\":" << mwa::jsonEsc(name) << ",\"passed\":" << (ok ? "true" : "false") << ",\"detail\":" << mwa::jsonEsc(detail) << "}"; firstCheck = false;
    std::fprintf(stderr, "%s %s %s\n", ok ? "PASS" : "FAIL", name.c_str(), detail.c_str());
  };
  for (const auto &f : {spec8, r3, own}) if (!fs::exists(f, ec)) { std::fprintf(stderr, "error: missing fixture %s\n", f.c_str()); return 2; }
  // 1 golden training
  auto g = step("golden: 300 updates, 4 threads", {spec8, "300", "4", P("golden.state"), "512"});
  check("default trainer writes the 4.4-4.6 golden state", g.exitCode == 0 && fileSha(P("golden.state")) == GOLDEN, "sha256 " + fileSha(P("golden.state")));
  // 2 compressed checkpoints
  step("150 updates", {spec8, "150", "4", P("a150.state"), "512"});
  auto c = step("compress", {"--compress", P("a150.state"), P("a150.emz")});
  step("decompress", {"--decompress", P("a150.emz"), P("a150.back")});
  check("EMZ1 round trip restores every byte", c.exitCode == 0 && fileSha(P("a150.back")) == fileSha(P("a150.state")) && !fileSha(P("a150.state")).empty(), "compressed " + std::to_string(fs::file_size(P("a150.emz"), ec)) + " of " + std::to_string(fs::file_size(P("a150.state"), ec)) + " bytes");
  auto rz = step("resume 150 from the compressed checkpoint", {spec8, "150", "4", P("b300.state"), "512", P("a150.emz")});
  check("150 + 150 resumed from EMZ1 = golden 300", rz.exitCode == 0 && fileSha(P("b300.state")) == GOLDEN, rz.err);
  { auto b = slurp(P("a150.emz").c_str()); if (!b.empty()) { b[b.size() / 2] ^= 0x10; FILE *f = std::fopen(P("bad.emz").c_str(), "wb"); if (f) { std::fwrite(b.data(), 1, b.size(), f); std::fclose(f); } } }
  auto bd = step("decompress a corrupted file", {"--decompress", P("bad.emz"), P("bad.state")});
  auto bt = step("train from a corrupted file", {spec8, "5", "1", P("bad2.state"), "512", P("bad.emz")});
  check("corrupted compressed checkpoints are refused and nothing is written", bd.exitCode == 1 && bt.exitCode == 3 && !fs::exists(P("bad.state"), ec) && !fs::exists(P("bad2.state"), ec), bd.err + bt.err);
  // 3 experimental estimator continuation
  step("own-hands 150", {own, "150", "4", P("o150.state"), "256"});
  step("own-hands +150", {own, "150", "4", P("o300r.state"), "256", P("o150.state")});
  step("own-hands 300 (4 threads)", {own, "300", "4", P("o300.state"), "256"});
  step("own-hands 300 (1 thread)", {own, "300", "1", P("o300t1.state"), "256"});
  check("own-hand enumeration: 150 + 150 = 300 and 1 thread = 4 threads", !fileSha(P("o300.state")).empty() && fileSha(P("o300r.state")) == fileSha(P("o300.state")) && fileSha(P("o300t1.state")) == fileSha(P("o300.state")), fileSha(P("o300.state")));
  // 4 verification
  step("river3 2000", {r3, "2000", "4", P("r2000.state"), "256"});
  auto v = step("verify (exact)", {"--verify", r3, P("r2000.state"), "method=exact"});
  { mwa::Json j(v.out); double sum = 0; const JV *seats = j.v ? jget(j.v, "seats") : nullptr; for (int i = 0; seats && i < seats->n; i++) sum += jnum(jget(seats->items[i], "gain"), NAN);
    const double nc = j.v ? jnum(jget(jget(j.v, "aggregate"), "nashConv"), NAN) : NAN; const char *mode = j.v ? jstr(jget(j.v, "mode")) : nullptr;
    check("verify: exact NashConv = sum of exact seat gains, labelled exact", v.exitCode == 0 && mode && !std::strcmp(mode, "exactBestResponse") && nc >= 0 && nc == sum, "NashConv " + mwa::fmt(nc)); }
  auto vs = step("verify (sampled)", {"--verify", r3, P("r2000.state"), "method=sampled", "samples=2000"});
  { mwa::Json j(vs.out); const char *cls = j.v ? jstr(jget(j.v, "resultClass")) : nullptr; check("verify: sampled results are labelled as estimates of lower bounds", vs.exitCode == 0 && cls && std::strstr(cls, "LOWER BOUND"), cls ? cls : vs.err); }
  // 5 comparison
  step("river3 500", {r3, "500", "4", P("r500.state"), "256"});
  auto cp = step("compare 500 vs 2000", {"--compare", r3, P("r500.state"), P("r2000.state"), "gains=exact"});
  { mwa::Json j(cp.out); const bool comp = j.v && jget(j.v, "compatible") && jget(j.v, "compatible")->num != 0, same = j.v && jget(j.v, "identicalStrategies") && jget(j.v, "identicalStrategies")->num != 0;
    check("compare: same game is compatible, strategies differ, gains compared", cp.exitCode == 0 && comp && !same && jget(j.v, "gains"), "weighted TV " + mwa::fmt(j.v ? jnum(jget(jget(j.v, "strategyDistance"), "weightedOverCommonRows"), NAN) : NAN)); }
  auto ci = step("compare different games", {"--compare", r3, P("r500.state"), P("golden.state"), "specB=" + spec8});
  check("compare: different games are refused (exit 3)", ci.exitCode == 3, ci.out.substr(0, 200));
  // 6 monitoring
  auto mo = step("monitor 1500 updates", {"--monitor", r3, P("mon"), "updates=1500", "first=100", "threads=4"});
  step("plain 1500", {r3, "1500", "1", P("p1500.state"), "256"});
  check("monitor: analytics written and final checkpoint = uninterrupted training", mo.exitCode == 0 && fs::exists(fs::path(P("mon")) / "analytics.json", ec) && fileSha((fs::path(P("mon")) / "checkpoint-00001500.state").string()) == fileSha(P("p1500.state")) && !fileSha(P("p1500.state")).empty(), mo.out.substr(0, 200));
  const double secs = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
  std::ostringstream doc; doc << "{\"tool\":\"mwcli selftest47\",\"version\":\"" << EM_VERSION << "\",\"build\":\"" << EM_BUILD_ID << "\",\"executable\":" << mwa::jsonEsc(self) << ",\"workDirectory\":" << mwa::jsonEsc(dir) << ",\"seconds\":" << mwa::fmt(secs) << ",\"checksPassed\":" << passed << ",\"checksFailed\":" << failed << ",\"passed\":" << (failed ? "false" : "true") << ",\"hardwareDependent\":\"none (CPU only; no GPU is used by these checks)\",\"checks\":[\n" << checks.str() << "],\"steps\":[\n" << steps.str() << "]}\n";
  mwa::writeAtomic(P("selftest47.json"), doc.str());
  std::printf("{\"tool\":\"mwcli selftest47\",\"build\":\"%s\",\"checksPassed\":%d,\"checksFailed\":%d,\"passed\":%s,\"report\":%s}\n", EM_BUILD_ID, passed, failed, failed ? "false" : "true", mwa::jsonEsc(P("selftest47.json")).c_str());
  return failed ? 1 : 0;
}
} // namespace st47
