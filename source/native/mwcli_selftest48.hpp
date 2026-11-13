// EightMax 4.8: mwcli --selftest48 <fixtures-dir> <work-dir>
// Self-recording check of the 4.8 changes for Windows CI and the target PC ("Run 4.8 checks.bat").
// Every step is a separate mwcli process (cold engine start) recorded with command, exit code,
// output and milliseconds in <work-dir>/selftest48.json, written before the verdict.
// Fixtures (validation/4.8/fixtures): icm-final8.spec.json (4.4-4.7 golden study),
// bubble4-own.spec.json (four-player bubble, own-hand enumeration), flop6.spec.json, turn4.spec.json.
#pragma once
namespace st48 {
inline std::string fileSha(const std::string &p) { auto b = slurp(p.c_str()); if (b.empty()) return ""; emsha::Sha256 h; h.add(b.data(), b.size()); return h.hex(); }
inline bool writeText(const std::string &p, const std::string &s) { FILE *f = std::fopen(p.c_str(), "wb"); if (!f) return false; const bool ok = std::fwrite(s.data(), 1, s.size(), f) == s.size(); return std::fclose(f) == 0 && ok; }
inline int run(int argc, char **argv) {
  if (argc < 4) { std::fprintf(stderr, "usage: mwcli --selftest48 fixtures-dir work-dir\n"); return 2; }
  namespace fs = std::filesystem; std::error_code ec;
  const std::string self = ckpt::selfPath(argv[0]), fx = fs::absolute(argv[2], ec).string(), dir = fs::absolute(argv[3], ec).string();
  fs::create_directories(dir, ec);
  auto F = [&](const char *name) { return (fs::path(fx) / name).string(); };
  auto P = [&](const std::string &name) { return (fs::path(dir) / name).string(); };
  const std::string spec8 = F("icm-final8.spec.json"), bub = F("bubble4-own.spec.json"), flop6 = F("flop6.spec.json"), turn4 = F("turn4.spec.json");
  const std::string GOLDEN = "aa80974199182afa91d5a47166d32af0eb00ecff3ba334593eb5a359cc2e22b8";
  std::ostringstream steps, checks; int passed = 0, failed = 0; bool firstStep = true, firstCheck = true;
  const auto t0 = std::chrono::steady_clock::now();
  using Env = std::vector<std::pair<std::string, std::string>>;
  auto step = [&](const std::string &label, std::vector<std::string> args, const Env &env = {}, double timeout = 900) {
    args.insert(args.begin(), self); ckpt::Run r = ckpt::spawn(args, dir, timeout, env);
    steps << (firstStep ? "" : ",\n") << "{\"label\":" << mwa::jsonEsc(label) << ",\"command\":" << mwa::jsonEsc(r.command) << ",\"exitCode\":" << r.exitCode << ",\"timedOut\":" << (r.timedOut ? "true" : "false") << ",\"ms\":" << mwa::fmt(r.ms) << ",\"stdout\":" << mwa::jsonEsc(ckpt::clip(r.out, 4096)) << ",\"stderr\":" << mwa::jsonEsc(ckpt::clip(r.err, 4096)) << "}";
    firstStep = false; return r;
  };
  auto check = [&](const std::string &name, bool ok, const std::string &detail) {
    (ok ? passed : failed)++; checks << (firstCheck ? "" : ",\n") << "{\"name\":" << mwa::jsonEsc(name) << ",\"passed\":" << (ok ? "true" : "false") << ",\"detail\":" << mwa::jsonEsc(detail) << "}"; firstCheck = false;
    std::fprintf(stderr, "%s %s %s\n", ok ? "PASS" : "FAIL", name.c_str(), detail.c_str());
  };
  for (const auto &f : {spec8, bub, flop6, turn4}) if (!fs::exists(f, ec)) { std::fprintf(stderr, "error: missing fixture %s\n", f.c_str()); return 2; }
  auto gainsOf = [&](const ckpt::Run &r) -> std::string {   // gainBits of every seat, or "" on failure
    if (r.exitCode != 0) return "";
    mwa::Json j(r.out); const JV *s = j.v ? jget(j.v, "seats") : nullptr; if (!s || s->type != J_ARR) return "";
    std::string o; for (int i = 0; i < s->n; i++) { const JV *b = jget(s->items[i], "gainBits"); o += (b && jstr(b) ? jstr(b) : "?"); o += ","; } return o;
  };
  // 1 golden training state
  auto g = step("golden: 300 updates, 4 threads", {spec8, "300", "4", P("golden.state"), "512"});
  check("default trainer writes the 4.4-4.7 golden state", g.exitCode == 0 && fileSha(P("golden.state")) == GOLDEN, "sha256 " + fileSha(P("golden.state")));
  // 2 the 4.5 continuation sequence with a deadline-limited evaluation in the middle
  step("150 updates", {spec8, "150", "4", P("a150.state"), "512"});
  writeText(P("deadline.json"), "{\"path\":[],\"hands\":[3],\"range\":true,\"method\":\"sampled\",\"samples\":2000000,\"timeLimitMs\":250,\"threads\":4,\"coverageMiB\":1}");
  const std::string before = fileSha(P("a150.state"));
  auto ev = step("deadline-limited sampled evaluation", {"--ev", spec8, P("a150.state"), P("deadline.json")});
  auto b = step("resume +150", {spec8, "150", "4", P("b300.state"), "512", P("a150.state")});
  check("150 updates, deadline-limited evaluation, 150 more = 300 uninterrupted (golden)", ev.exitCode == 0 && fileSha(P("a150.state")) == before && b.exitCode == 0 && fileSha(P("b300.state")) == GOLDEN, "evaluation exit " + std::to_string(ev.exitCode) + "; resumed " + fileSha(P("b300.state")));
  // 3 the repaired four-player continuation fixture
  auto cs = step("continuation suite, four-player bubble with own-hand enumeration", {"--continuation-suite", bub, P("suite"), "standard", "4"}, {}, 1800);
  { auto rep = slurp(P("suite/continuation-suite.json").c_str()); mwa::Json j(std::string(rep.begin(), rep.end()));
    const double ok = j.v ? jnum(jget(j.v, "checksPassed"), -1) : -1, bad = j.v ? jnum(jget(j.v, "checksFailed"), -1) : -1; bool valid = j.v != nullptr; const JV *h = j.v ? jget(j.v, "evaluationHands") : nullptr;
    if (!h || h->type != J_ARR || h->n != 2) valid = false; else for (int i = 0; i < h->n; i++) valid &= jnum(jget(h->items[i], "usedIndex"), -1) >= 0 && jnum(jget(h->items[i], "usedIndex"), 99) < jnum(jget(h->items[i], "rangeSize"), 0);
    check("four-player continuation suite: every check passes with valid evaluation hands", cs.exitCode == 0 && bad == 0 && ok >= 25 && valid, "passed " + mwa::fmt(ok) + ", failed " + mwa::fmt(bad)); }
  // 4 response evaluation: 4.8 paths bit-identical to the 4.7 paths
  step("six-player flop, 20,000 updates", {flop6, "20000", "2", P("f6.state"), "512"});
  step("four-player turn, 20,000 updates", {turn4, "20000", "2", P("t4.state"), "512"});
  writeText(P("exact.json"), "{\"method\":\"exact\",\"threads\":2}");
  const Env legacy = {{"EM_EV_NO_RANK_CACHE", "1"}, {"EM_BR_NO_HOIST", "1"}, {"EM_EV_SMALL_TABLE_CAP", "4"}, {"EM_EV_TABLE_CAP", "0"}};
  for (const auto &[name, spec, state] : std::vector<std::tuple<std::string, std::string, std::string>>{{"six-player flop", flop6, P("f6.state")}, {"four-player turn", turn4, P("t4.state")}}) {
    auto x = step(name + ": exact gains (4.8)", {"--gain", spec, state, P("exact.json")}), y = step(name + ": exact gains (4.7 code path)", {"--gain", spec, state, P("exact.json")}, legacy);
    check(name + ": exact response gains of every seat are bit-identical to the 4.7 evaluation path", !gainsOf(x).empty() && gainsOf(x) == gainsOf(y), gainsOf(x));
  }
  // 5 deadline inside a long exact evaluation
  writeText(P("short.json"), "{\"method\":\"exact\",\"threads\":1,\"timeLimitMs\":100}");
  auto d = step("exact evaluation with a 100 ms deadline", {"--gain", flop6, P("f6.state"), P("short.json")});
  check("an exact evaluation stops at its deadline with an error, not a partial result", (d.exitCode != 0 && d.err.find("Time limit") != std::string::npos && d.ms < 10000) || (d.exitCode == 0 && d.ms < 200), "exit " + std::to_string(d.exitCode) + " after " + mwa::fmt(d.ms) + " ms");
  // 6 checkpoint comparison classes
  step("six-player flop, 2,000 updates", {flop6, "2000", "2", P("early.state"), "512"});
  auto cmp = [&](const std::string &a, const std::string &bb) { return step("compare", {"--compare", flop6, a, bb, "gains=exact"}); };
  auto c1 = cmp(P("early.state"), P("f6.state")), c2 = cmp(P("f6.state"), P("f6.state"));
  auto cls = [&](const ckpt::Run &r) { mwa::Json j(r.out); const JV *q = j.v ? jget(jget(j.v, "gains"), "qualityChange") : nullptr; const JV *c = q ? jget(q, "class") : nullptr; return std::string(c && jstr(c) ? jstr(c) : ""); };
  check("checkpoint comparison: exact classes (a change is classified; identical checkpoints are 'no change')", (cls(c1) == "meaningful improvement" || cls(c1) == "meaningful regression") && cls(c2) == "no change (equal within rounding)", cls(c1) + " / " + cls(c2));
  // 7 EMZ1 levels
  for (const char *level : {"1", "9"}) {
    auto z = step(std::string("compress level ") + level, {"--compress", P("t4.state"), P(std::string("t4-") + level + ".emz"), level});
    step(std::string("decompress level ") + level, {"--decompress", P(std::string("t4-") + level + ".emz"), P(std::string("t4-") + level + ".back")});
    check(std::string("EMZ1 level ") + level + " restores every byte", z.exitCode == 0 && fileSha(P(std::string("t4-") + level + ".back")) == fileSha(P("t4.state")), fileSha(P("t4.state")));
  }
  const double secs = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
  std::ostringstream o; o << "{\"tool\":\"mwcli selftest48\",\"version\":\"" << EM_VERSION << "\",\"build\":\"" << EM_BUILD_ID << "\",\"passed\":" << passed << ",\"failed\":" << failed << ",\"seconds\":" << mwa::fmt(secs) << ",\"checks\":[" << checks.str() << "],\"steps\":[" << steps.str() << "]}";
  writeText(P("selftest48.json"), o.str());
  std::printf("{\"tool\":\"mwcli selftest48\",\"build\":\"%s\",\"passed\":%d,\"failed\":%d,\"report\":%s}\n", EM_BUILD_ID, passed, failed, mwa::jsonEsc(P("selftest48.json")).c_str());
  return failed ? 1 : 0;
}
}
