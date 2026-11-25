// EightMax 5.8: mwcli --selftest58 <studies-dir> <work-dir> [all|engine|response|limits]
//
// The mathematics added or changed in 5.8, tested by the shipped program itself (nothing but mwcli is needed;
// "Run 5.8 Windows validation.bat" runs it and validate_windows58.ps1 imports its report check by check).
//
//   engine     mw_selftest58: the evaluation random-number generator against its published outputs; one stream per
//              (seed, seat, block); the four-way ICM cache against the recursion, bit for bit, through hits and
//              evictions; three-player ICM against the finishing-order formula written out.
//   response   the TRAINED RESPONSE measure (response58.hpp) on four shipped fixtures small enough for the exact
//              evaluator (heads-up river with a closed-form solution, three-player flop, six-player flop, three seats
//              of an eight-handed ICM table). For every seat of every fixture:
//                R1  sigma is preserved: in the response state the policy "current" has, exactly, the value and the
//                    best-response value that the trained state's average strategy has;
//                R2  the other seats are frozen: the best-response value against them is the same in the response
//                    state's two profiles;
//                R3  direction: exact gain of the response <= exact best-response gain (tolerance 1e-9), and >= the
//                    gain of keeping sigma (0) minus what a short response training can lose - reported, not required;
//                R4  the estimate from independent deals contains the exact gain in its distribution-free interval;
//                R5  the estimate has the same bits for 1 and 3 evaluation threads;
//                R6  a second run from a fresh load of the state gives the same bits (training and evaluation).
//              plus, once: a response problem cannot be opened twice, an unfinished one cannot be evaluated, and
//              malformed requests are refused.
//   limits     the large-study limit (10,000,000 updates of one engine state): a study whose largest budget needs
//              more updates is refused when it is configured, with the limit and the largest supported budget in the
//              message, in well under a second and without creating its checkpoint; the largest supported budgets
//              (10,000,000 deals at one deal per update, 640,000,000 at 64 deals per update) are accepted; one more
//              deal is refused; the command-line trainer refuses 10,000,001 updates before it loads anything.
//
// Everything is written inside <work-dir>. Each check has a status:
//   passed    the intended condition was produced and the engine reacted as documented
//   failed    it did not
//   untested  a step this check depends on could not be carried out (the reason is given); never counted as passed
// The report is <work-dir>/selftest58.json. Exit status: 0 every check passed, 1 a check failed or is untested,
// 2 usage or unreadable fixtures.
#pragma once
namespace st58 {
namespace fs = std::filesystem;
struct Check { std::string section, id, name, status, detail; };
struct Report {
  std::vector<Check> checks; int passed = 0, failed = 0, untested = 0;
  void add(const std::string &section, const std::string &id, const std::string &name, const std::string &status, const std::string &detail) {
    checks.push_back({section, id, name, status, detail}); (status == "passed" ? passed : status == "failed" ? failed : untested)++;
    std::fprintf(stderr, "[%s] %s %s: %s%s%s\n", status.c_str(), section.c_str(), id.c_str(), name.c_str(), detail.empty() ? "" : " -- ", detail.c_str());
  }
  void check(const std::string &section, const std::string &id, const std::string &name, bool ok, const std::string &detail) { add(section, id, name, ok ? "passed" : "failed", detail); }
};
static std::string fmt(double v) { char b[40]; std::snprintf(b, sizeof b, "%.17g", v); return b; }
static std::string sci(double v) { char b[40]; std::snprintf(b, sizeof b, "%.3g", v); return b; }
static const JV *get(const JV *o, const char *k) { return o && o->type == J_OBJ ? jget(o, k) : nullptr; }
static double num(const JV *v, double d = NAN) { return v && v->type == J_NUM ? v->num : d; }
static std::string str(const JV *v) { return v && v->type == J_STR && v->str ? v->str : ""; }
struct Doc { JV *v = nullptr; explicit Doc(const std::string &t) { char e[160] = ""; if (!t.empty()) v = json_parse(t.c_str(), t.size(), e, sizeof e); } ~Doc() { if (v) json_free(v); } Doc(const Doc &) = delete; Doc &operator=(const Doc &) = delete; };
static std::string take(JB &b) { std::string s(b.s ? b.s : "", b.n); jb_free(&b); return s; }
// The first variant's engine spec of a study fixture, as JSON text.
static std::string specOf(const std::string &fixturePath, std::string &why) {
  const std::vector<unsigned char> b = slurp(fixturePath.c_str()); if (b.empty()) { why = "cannot read " + fixturePath; return ""; }
  const size_t skip = b.size() >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF ? 3 : 0;
  char e[200] = ""; JV *fx = json_parse((const char *)b.data() + skip, b.size() - skip, e, sizeof e); if (!fx) { why = std::string("fixture does not parse: ") + e; return ""; }
  const JV *vs = get(fx, "variants"); const JV *sp = vs && vs->type == J_ARR && vs->n ? get(vs->items[0], "nativeSpec") : nullptr;
  std::string text = sp ? jvText(sp) : ""; json_free(fx); if (text.empty()) why = "fixture has no variants[0].nativeSpec"; return text;
}
static MW *loadState(const std::string &spec, const std::string &path, std::string &why) {
  uint64_t size = 0; FILE *f = openCheckpoint(path.c_str(), size, why); if (!f) return nullptr;
  MW *m = nullptr; char err[512] = ""; const int st = mw_load_stream(f, size, spec.c_str(), 512, -1, &m, err, sizeof err, nullptr, nullptr); std::fclose(f);
  if (st != 200) { why = err[0] ? err : "the state was refused"; return nullptr; }
  return m;
}
struct Exact { bool ok = false; std::string why; std::vector<double> policy, best; };
// Exact policy value and exact best-response value of every seat, under the state's "average" or "current" policy.
static Exact exactOf(MW *m, const char *policy) {
  Exact x; char err[512] = ""; JB b; jb_init(&b); static volatile int cancel = 0;
  const std::string q = std::string("{\"method\":\"exact\",\"policy\":\"") + policy + "\",\"device\":\"cpu\",\"threads\":1,\"timeLimitMs\":1800000,\"maxVisits\":2000000000,\"memoryMiB\":512}";
  const int st = mw_response_gain(m, q.c_str(), q.size(), &b, err, sizeof err, &cancel); const std::string text = take(b);
  if (st != 200) { x.why = err; return x; }
  Doc d(text); const JV *seats = get(d.v, "seats"); if (!seats || seats->type != J_ARR) { x.why = "no seats in the exact result"; return x; }
  for (int i = 0; i < seats->n; i++) { x.policy.push_back(num(get(seats->items[i], "policyValue"))); x.best.push_back(num(get(seats->items[i], "bestResponseValue"))); }
  x.ok = true; for (double v : x.policy) x.ok &= std::isfinite(v); for (double v : x.best) x.ok &= std::isfinite(v);
  if (!x.ok) x.why = "the exact evaluator returned a non-finite value"; return x;
}
struct Sampled { bool ok = false; std::string why, bits, opponents; double mean = NAN, se = NAN, half = NAN; bool within = false; long long samples = 0; };
static Sampled sampledOf(MW *m, long long samples, int threads) {
  Sampled s; char err[512] = ""; JB b; jb_init(&b); static volatile int cancel = 0;
  const std::string q = "{\"samples\":" + std::to_string(samples) + ",\"seed\":58,\"threads\":" + std::to_string(threads) + ",\"timeLimitMs\":1800000}";
  const int st = mw_response_value(m, q.c_str(), q.size(), &b, err, sizeof err, &cancel); const std::string text = take(b);
  if (st != 200) { s.why = err; return s; }
  Doc d(text); const JV *g = get(d.v, "gain"), *bd = get(d.v, "bounded");
  s.mean = num(get(g, "mean")); s.se = num(get(g, "stdErr")); s.bits = str(get(g, "gainBits")); s.half = num(get(bd, "half")); const JV *w = get(bd, "withinBounds"); s.within = w && w->type == J_BOOL && w->num != 0;
  s.samples = (long long)num(get(d.v, "samples"), 0); s.opponents = str(get(d.v, "opponentActions")); s.ok = std::isfinite(s.mean) && !s.bits.empty(); if (!s.ok) s.why = "no gain in the result"; return s;
}
// begin, train, end on a freshly loaded state. Returns the engine (caller frees) or nullptr.
static MW *respond(const std::string &spec, const std::string &state, int seat, long long deals, std::string &why) {
  MW *m = loadState(spec, state, why); if (!m) return nullptr;
  char err[512] = ""; JB b; jb_init(&b); const std::string rq = "{\"seat\":" + std::to_string(seat) + ",\"seed\":58}";
  int st = mw_response_begin(m, rq.c_str(), rq.size(), &b, err, sizeof err); jb_free(&b);
  if (st != 200) { why = std::string("begin: ") + err; mw_free(m); return nullptr; }
  if (!mw_train(m, deals, 1, nullptr, nullptr, nullptr, err, sizeof err)) { why = std::string("training: ") + err; mw_free(m); return nullptr; }
  jb_init(&b); st = mw_response_end(m, &b, err, sizeof err); jb_free(&b);
  if (st != 200) { why = std::string("end: ") + err; mw_free(m); return nullptr; }
  return m;
}

static void responseSection(Report &R, const std::string &studies, const std::string &work) {
  struct Fx { const char *name; long long deals, responseDeals, samples; };
  // Budgets are small on purpose: the checks are about correctness of the measure, not about tight bounds.
  const Fx fixtures[] = {{"known-akq-river", 20000, 100000, 51200}, {"flop3-kings-small", 20000, 100000, 51200}, {"flop6-jack-small", 20000, 100000, 51200}, {"icm8-bb-call-small", 20000, 100000, 20480}};
  bool guards = false;
  for (const Fx &fx : fixtures) {
    const std::string sec = "response", name = fx.name; std::string why;
    const std::string spec = specOf((fs::path(studies) / (name + ".emfix.json")).string(), why);
    if (spec.empty()) { R.add(sec, name, "fixture is readable", "untested", why); continue; }
    char err[512] = ""; MW *t = mw_create(spec.c_str(), spec.size(), 512, err, sizeof err);
    if (!t) { R.add(sec, name, "the engine accepts the fixture", "untested", err); continue; }
    const std::string state = (fs::path(work) / (name + ".state")).string();
    bool saved = mw_train(t, fx.deals, 1, nullptr, nullptr, nullptr, err, sizeof err) != 0;
    if (saved) { SaveReport rep; saveWithReport(state.c_str(), [&](FILE *f) { return mw_write_stream(t, f, nullptr) > 0; }, rep); saved = rep.ok; if (!saved) std::snprintf(err, sizeof err, "%s", rep.text().c_str()); }
    const Exact base = saved ? exactOf(t, "average") : Exact{}; mw_free(t);
    if (!saved || !base.ok) { R.add(sec, name, "trained state and its exact values", "untested", !saved ? err : base.why); continue; }
    const int n = (int)base.policy.size(); double scale = 1; for (double v : base.best) scale = std::max(scale, std::fabs(v));
    double worstSigma = 0, worstFrozen = 0, worstDirection = -INFINITY, sumGain = 0, sumBest = 0, worstZ = 0; int outside = 0, threadDiff = 0, repeatDiff = 0, done = 0; std::string detail4, problem;
    for (int seat = 0; seat < n; seat++) {
      MW *m = respond(spec, state, seat, fx.responseDeals, why); if (!m) { problem = "seat " + std::to_string(seat) + ": " + why; break; }
      const Exact avg = exactOf(m, "average"), cur = exactOf(m, "current");
      const Sampled s1 = sampledOf(m, fx.samples, 1), s3 = sampledOf(m, fx.samples, 3);
      if (!guards) {   // once: the life cycle is enforced
        guards = true; JB b; jb_init(&b); const std::string rq = "{\"seat\":0,\"seed\":1}";
        const int again = mw_response_begin(m, rq.c_str(), rq.size(), &b, err, sizeof err); jb_free(&b); jb_init(&b);
        const int ended = mw_response_end(m, &b, err, sizeof err); jb_free(&b);
        std::string w2; MW *open = loadState(spec, state, w2); int early = -1, bad1 = -1, bad2 = -1, bad3 = -1, noProblem = -1;
        if (open) { static volatile int cancel = 0; const char *q = "{}"; jb_init(&b); noProblem = mw_response_value(open, q, 2, &b, err, sizeof err, &cancel); jb_free(&b);
          const std::string s9 = "{\"seat\":99}", none = "{}", extra = "{\"seat\":0,\"bogus\":1}";
          jb_init(&b); bad1 = mw_response_begin(open, s9.c_str(), s9.size(), &b, err, sizeof err); jb_free(&b);
          jb_init(&b); bad2 = mw_response_begin(open, none.c_str(), none.size(), &b, err, sizeof err); jb_free(&b);
          jb_init(&b); bad3 = mw_response_begin(open, extra.c_str(), extra.size(), &b, err, sizeof err); jb_free(&b);
          jb_init(&b); const int ok = mw_response_begin(open, rq.c_str(), rq.size(), &b, err, sizeof err); jb_free(&b);
          jb_init(&b); early = ok == 200 ? mw_response_value(open, q, 2, &b, err, sizeof err, &cancel) : -2; jb_free(&b); mw_free(open); }
        R.check(sec, "life-cycle", "a response problem is opened once, finished once, and evaluated only when finished; malformed requests are refused",
                again == 409 && ended == 409 && noProblem == 409 && early == 409 && bad1 == 400 && bad2 == 400 && bad3 == 400,
                "second begin " + std::to_string(again) + ", second end " + std::to_string(ended) + ", value without a problem " + std::to_string(noProblem) + ", value before end " + std::to_string(early) + ", seat 99 " + std::to_string(bad1) + ", no seat " + std::to_string(bad2) + ", unknown field " + std::to_string(bad3));
      }
      mw_free(m);
      if (!avg.ok || !cur.ok || !s1.ok || !s3.ok) { problem = "seat " + std::to_string(seat) + ": " + (!avg.ok ? avg.why : !cur.ok ? cur.why : !s1.ok ? s1.why : s3.why); break; }
      const double gain = avg.policy[(size_t)seat] - cur.policy[(size_t)seat], best = cur.best[(size_t)seat] - cur.policy[(size_t)seat];
      worstSigma = std::max({worstSigma, std::fabs(cur.policy[(size_t)seat] - base.policy[(size_t)seat]), std::fabs(cur.best[(size_t)seat] - base.best[(size_t)seat])});
      worstFrozen = std::max(worstFrozen, std::fabs(avg.best[(size_t)seat] - cur.best[(size_t)seat]));
      worstDirection = std::max(worstDirection, gain - best); sumGain += gain; sumBest += best;
      const bool inside = s1.within && std::isfinite(s1.half) && std::fabs(s1.mean - gain) <= s1.half; outside += !inside;
      if (s1.se > 0) worstZ = std::max(worstZ, std::fabs(s1.mean - gain) / s1.se);
      detail4 += (seat ? "; " : "") + std::string("seat ") + std::to_string(seat) + ": " + sci(s1.mean) + " +- " + sci(s1.half) + " (exact " + sci(gain) + ")";
      threadDiff += s1.bits != s3.bits;
      MW *m2 = respond(spec, state, seat, fx.responseDeals, why);
      if (!m2) { problem = "seat " + std::to_string(seat) + " (second run): " + why; break; }
      const Sampled again = sampledOf(m2, fx.samples, 2); const Exact avg2 = exactOf(m2, "average"); mw_free(m2);
      repeatDiff += !again.ok || again.bits != s1.bits || !avg2.ok || avg2.policy[(size_t)seat] != avg.policy[(size_t)seat];
      done++;
    }
    if (!problem.empty()) { R.add(sec, name, "response of every seat", "untested", problem); continue; }
    const std::string seats = std::to_string(done) + " seats";
    R.check(sec, name + " R1", "sigma is preserved in the response state (values of policy \"current\" equal the trained state's)", worstSigma <= 1e-12 * scale, seats + ", largest difference " + sci(worstSigma));
    R.check(sec, name + " R2", "the other seats are frozen (the same best-response value in both profiles of the response state)", worstFrozen <= 1e-12 * scale, seats + ", largest difference " + sci(worstFrozen));
    R.check(sec, name + " R3", "direction: exact gain of the response <= exact best-response gain", worstDirection <= 1e-9 * scale,
            seats + ", largest (response gain - best-response gain) " + sci(worstDirection) + "; the responses find " + sci(sumGain) + " of an exact NashConv of " + sci(sumBest) + (sumBest > 0 ? " (" + sci(100 * sumGain / sumBest) + "%)" : ""));
    R.check(sec, name + " R4", "the estimate from independent deals contains the exact gain in its distribution-free interval", outside == 0, detail4 + "; largest distance " + sci(worstZ) + " standard errors");
    R.check(sec, name + " R5", "the estimate has the same bits for 1 and 3 evaluation threads", threadDiff == 0, seats + ", " + std::to_string(threadDiff) + " differ");
    R.check(sec, name + " R6", "a second run from a fresh load gives the same bits (response training and evaluation)", repeatDiff == 0, seats + ", " + std::to_string(repeatDiff) + " differ");
    std::error_code ec; fs::remove(state, ec);
  }
}

static void limitsSection(Report &R, const std::string &studies, const std::string &work, const char *self) {
  const std::string sec = "limits", path = (fs::path(studies) / "known-akq-river.emfix.json").string(); const std::vector<unsigned char> fx = slurp(path.c_str());
  if (fx.empty()) { R.add(sec, "fixture", "known-akq-river is readable", "untested", "cannot read " + path); return; }
  auto study = [&](const std::string &options, double &seconds, std::string &message) {
    JB out; jb_init(&out); char err[1024] = ""; static volatile int stop = 0; const auto t0 = std::chrono::steady_clock::now();
    const int st = mw_study_run((const char *)fx.data(), fx.size(), options.c_str(), options.size(), &out, err, sizeof err, &stop, nullptr, nullptr);
    seconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count(); message = err; jb_free(&out); return st;
  };
  std::error_code ec; double s = 0; std::string msg;
  { const std::string ck = (fs::path(work) / "limit-ck-a").string(); fs::remove_all(ck, ec);
    // 5.11: the limit belongs to the 5.10 training streams, which these three checks now ask for by name (a study that
    // does not choose trains with the counter-based streams, which have no such limit: mwcli --selftest511, limits L5).
    const int st = study("{\"trainingStreams\":\"5.10\",\"seeds\":[1],\"budgets\":[1000,10000001],\"checkpoint\":" + mwa::jsonEsc(ck) + "}", s, msg);
    R.check(sec, "L1", "a budget of 10,000,001 deals (one deal per update) is refused when the study is configured, before any training",
            st == 400 && msg.find("10 million iteration limit") != std::string::npos && msg.find("Nothing was trained") != std::string::npos && msg.find("10000000 sampled deals") != std::string::npos && s < 2.0 && !fs::exists(ck, ec),
            "status " + std::to_string(st) + " after " + sci(s) + " s; checkpoint directory created: " + (fs::exists(ck, ec) ? "yes" : "no") + "; message: " + msg); }
  { const int st = study("{\"trainingStreams\":\"5.10\",\"seeds\":[1],\"budgets\":[640000001],\"trainer\":{\"batchDeals\":64}}", s, msg);
    R.check(sec, "L2", "with 64 deals per update the limit is 640,000,000 deals: 640,000,001 is refused at once", st == 400 && msg.find("10 million iteration limit") != std::string::npos && msg.find("640000000 sampled deals") != std::string::npos && s < 2.0,
            "status " + std::to_string(st) + " after " + sci(s) + " s; message: " + msg); }
  { // The largest supported budgets pass the configuration check: the study starts and is ended by its time limit.
    const int a = study("{\"trainingStreams\":\"5.10\",\"seeds\":[1],\"budgets\":[10000000],\"timeLimitSeconds\":0.2,\"evaluationSamples\":64,\"qualitySamples\":64}", s, msg); const double sa = s; const std::string ma = msg;
    const int b = study("{\"trainingStreams\":\"5.10\",\"seeds\":[1],\"budgets\":[640000000],\"trainer\":{\"batchDeals\":64},\"timeLimitSeconds\":0.2,\"evaluationSamples\":64,\"qualitySamples\":64}", s, msg);
    R.check(sec, "L3", "the largest supported budgets (10,000,000 deals; 640,000,000 at 64 deals per update) are accepted", a == 200 && b == 200,
            "status " + std::to_string(a) + " (" + sci(sa) + " s) and " + std::to_string(b) + " (" + sci(s) + " s), each ended by a 0.2 s time limit" + (a != 200 ? "; " + ma : "") + (b != 200 ? "; " + msg : "")); }
  { // The command-line trainer: an update count above the limit is a usage error before any file is read.
    const std::string out = (fs::path(work) / "limit-train.state").string(); fs::remove(out, ec);
    const ckpt::Run r = ckpt::spawn({self, "no-such-spec.json", "10000001", "1", out}, work, 30);
    R.check(sec, "L4", "the command-line trainer refuses 10,000,001 updates before it reads its input", r.started && r.exitCode == 2 && r.err.find("10,000,000") != std::string::npos && !fs::exists(out, ec),
            (r.started ? "exit " + std::to_string(r.exitCode) : "the program could not be started: " + r.startError) + "; " + r.err.substr(0, 200)); }
}

static int run(int argc, char **argv) {
  if (argc < 4 || argc > 5) { std::fprintf(stderr, "usage: mwcli --selftest58 studies-dir work-dir [all|engine|response|limits]\n"); return 2; }
  const std::string studies = argv[2], work = argv[3], section = argc > 4 ? argv[4] : "all";
  if (section != "all" && section != "engine" && section != "response" && section != "limits") { std::fprintf(stderr, "error: the section must be all, engine, response or limits\n"); return 2; }
  std::error_code ec; fs::create_directories(work, ec);
  if (!fs::is_directory(studies, ec) || !fs::is_directory(work, ec)) { std::fprintf(stderr, "error: studies-dir and work-dir must be directories\n"); return 2; }
  mw_study_identity(EM_VERSION, EM_BUILD_ID);
  Report R; const auto t0 = std::chrono::steady_clock::now();
  if (section == "all" || section == "engine") {
    JB j; jb_init(&j); mw_selftest58(&j); const std::string text = take(j); Doc d(text);
    if (!d.v || d.v->type != J_ARR || !d.v->n) R.add("engine", "E0", "in-engine checks produced a report", "failed", text.substr(0, 200));
    else for (int i = 0; i < d.v->n; i++) { const JV *e = d.v->items[i], *p = get(e, "passed"); R.check("engine", "E" + std::to_string(i + 1), str(get(e, "name")), p && p->type == J_BOOL && p->num != 0, str(get(e, "detail"))); }
  }
  if (section == "all" || section == "response") responseSection(R, studies, work);
  if (section == "all" || section == "limits") limitsSection(R, studies, work, ckpt::selfPath(argv[0]).c_str());
  const double secs = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
  std::string o = std::string("{\"tool\":\"mwcli selftest58\",\"version\":\"") + EM_VERSION + "\",\"build\":\"" + EM_BUILD_ID + "\",\"section\":\"" + section + "\",\"passed\":" + std::to_string(R.passed) + ",\"failed\":" + std::to_string(R.failed) +
                  ",\"untested\":" + std::to_string(R.untested) + ",\"seconds\":" + fmt(secs) + ",\"checks\":[";
  for (size_t i = 0; i < R.checks.size(); i++) { const Check &c = R.checks[i]; o += std::string(i ? "," : "") + "{\"section\":" + mwa::jsonEsc(c.section) + ",\"id\":" + mwa::jsonEsc(c.id) + ",\"name\":" + mwa::jsonEsc(c.name) + ",\"status\":" + mwa::jsonEsc(c.status) + ",\"detail\":" + mwa::jsonEsc(c.detail) + "}"; }
  o += "]}";
  const std::string report = (fs::path(work) / "selftest58.json").string();
  { FILE *f = std::fopen(report.c_str(), "wb"); if (f) { std::fwrite(o.data(), 1, o.size(), f); std::fclose(f); } }
  std::printf("{\"tool\":\"mwcli selftest58\",\"build\":\"%s\",\"section\":\"%s\",\"passed\":%d,\"failed\":%d,\"untested\":%d,\"report\":%s}\n", EM_BUILD_ID, section.c_str(), R.passed, R.failed, R.untested, mwa::jsonEsc(report).c_str());
  return R.failed || R.untested ? 1 : 0;
}
}
