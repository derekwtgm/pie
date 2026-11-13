// EightMax 4.7: mwcli --verify, --compare and --monitor (Priorities 4, 7, 8). Included by mwcli.cpp.
//
//   mwcli --verify  spec.json state [key=value ...]
//       Consolidated strategy-quality report: Mode A exact best response, Mode B restricted best
//       response (lower bound), Mode C sampled one-decision deviation (estimate of a lower bound),
//       chosen by method=auto|exact|restricted|sampled; optional Mode D local action deviations at one
//       decision (node=slot.slot... board=c,c hands=range): per-action EVs with the engine's
//       simultaneous (family-wise 95%) comparisons.
//   mwcli --compare specA.json stateA stateB [specB=path] [gains=auto|exact|restricted|sampled|none]
//       Compatibility check, counters, strategy hashes, row overlap, average-strategy distances,
//       per-seat response gains of both checkpoints with paired-difference statements.
//   mwcli --monitor spec.json out-dir [key=value ...]
//       Trains with periodic, adaptive strategy-quality evaluations; writes analytics.json (schema
//       eightmax-analytics/1, importable by the desktop dashboard), analytics.csv and checkpoints.
//
// Keys: method, samples, seed, timeMs, maxVisits, threads, memory (MiB), node, board, hands,
// specB, gains, csv; monitor: updates, deals, seconds, rssMiB, target, eval, first, growth, share,
// evalSeed, resume, keep (all|last).
#pragma once
#include "analytics.hpp"
#include <map>
#include <fstream>
#include <sstream>
#include <ctime>
namespace mwa {
using Args = std::map<std::string, std::string>;
inline Args keyValues(int argc, char **argv, int from) {
  Args a; for (int i = from; i < argc; i++) { const char *eq = std::strchr(argv[i], '='); if (!eq) { a["?" + std::string(argv[i])] = "1"; continue; } a[std::string(argv[i], (size_t)(eq - argv[i]))] = eq + 1; }
  return a;
}
inline bool unknownKeys(const Args &a, std::initializer_list<const char *> allowed) {
  for (auto &[k, v] : a) { bool ok = false; for (const char *x : allowed) ok |= k == x; if (!ok) { std::fprintf(stderr, "error: unknown option '%s'\n", k[0] == '?' ? k.c_str() + 1 : k.c_str()); return true; } }
  return false;
}
inline double num(const Args &a, const char *k, double d) { auto it = a.find(k); if (it == a.end()) return d; char *e = nullptr; const double v = em_parse_double(it->second.c_str(), &e); return (e && !*e && std::isfinite(v)) ? v : NAN; }
inline std::string str(const Args &a, const char *k, const std::string &d) { auto it = a.find(k); return it == a.end() ? d : it->second; }
inline std::string jsonEsc(const std::string &s) { JB b; jb_init(&b); jb_str(&b, s.c_str()); std::string r(b.s ? b.s : "", b.n); jb_free(&b); return r; }
inline std::string fmt(double v) { if (!std::isfinite(v)) return "null"; char b[40]; std::snprintf(b, sizeof b, "%.17g", v); return b; }   // round-trips every double
inline double nowSeconds() { return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count(); }
inline double currentRssMiB() {
#ifdef _WIN32
  PROCESS_MEMORY_COUNTERS pmc; if (K32GetProcessMemoryInfo(GetCurrentProcess(), &pmc, sizeof pmc)) return pmc.WorkingSetSize / 1048576.0; return -1;
#else
  FILE *f = std::fopen("/proc/self/statm", "r"); long pages = 0, rss = 0; if (!f) return -1;
  const int got = std::fscanf(f, "%ld %ld", &pages, &rss); std::fclose(f); return got == 2 ? rss * 4096.0 / 1048576.0 : -1;
#endif
}
struct Json { JV *v = nullptr; Json() = default; explicit Json(const std::string &t) { char e[256] = ""; v = json_parse(t.c_str(), t.size(), e, sizeof e); } ~Json() { if (v) json_free(v); } Json(const Json &) = delete; Json &operator=(const Json &) = delete; };

struct Opened { MW *m = nullptr; std::string specText, error; int status = 0; };
inline Opened open(const std::string &specPath, const std::string &statePath, double mib) {
  Opened o; auto spec = slurp(specPath.c_str()); if (spec.empty()) { o.error = "cannot read " + specPath; return o; }
  o.specText.assign((const char *)spec.data(), spec.size());
  uint64_t size = 0; std::string why; FILE *f = openCheckpoint(statePath.c_str(), size, why);
  char err[512] = "";
  if (!f) { o.status = 404; o.error = statePath + ": " + why; return o; }
  o.status = f ? mw_load_stream(f, size, o.specText.c_str(), mib, -1, &o.m, err, sizeof err, nullptr, nullptr) : 404;
  if (f) std::fclose(f);
  if (o.status != 200) o.error = err[0] ? err : ("cannot read " + statePath);
  return o;
}
inline int query(MW *m, int (*fn)(MW *, const char *, size_t, JB *, char *, int, volatile int *), const std::string &req, std::string &out, std::string &error) {
  JB j; jb_init(&j); char err[512] = ""; static volatile int never = 0;
  const int st = fn(m, req.c_str(), req.size(), &j, err, sizeof err, &never);
  if (st == 200) out.assign(j.s, j.n); else error = err;
  jb_free(&j); return st;
}
inline std::string infoText(MW *m) { JB j; jb_init(&j); mw_info(m, &j); std::string s(j.s, j.n); jb_free(&j); return s; }

// One response-gain evaluation with method fallback (auto: exact -> restricted -> sampled).
struct Eval {
  std::string method, mode, cls, text, attempts; int status = 0; double elapsed = 0; std::string error;
  struct Seat { int seat = 0; double policy = NAN, best = NAN, gain = NAN, se = 0, lo = NAN, hi = NAN; double samples = 0, lookups = 0, fallback = 0, sets = 0, fallbackSets = 0; bool available = true; };
  std::vector<Seat> seats; double nashConv = NAN, nashSe = 0, exploitability = NAN; std::string utility = "chip"; long long samples = 0;
};
inline std::string classOf(const std::string &mode) {
  if (mode == "exactBestResponse") return "exact unilateral best-response gain inside the study abstraction";
  if (mode == "restrictedBestResponse") return "restricted best-response gain: a LOWER BOUND on the unrestricted gain inside the abstraction";
  return "sampled one-decision deviation gain: a statistical ESTIMATE of a LOWER BOUND on the best-response gain";
}
inline Eval evaluate(MW *m, const std::string &requested, long long samples, unsigned long long seed, long long timeMs, double maxVisits, int threads) {
  Eval e; std::vector<std::string> order;
  if (requested == "auto") order = {"exact", "restricted", "sampled"}; else order = {requested};
  for (const std::string &method : order) {
    std::ostringstream q; q << "{\"method\":\"" << method << "\",\"timeLimitMs\":" << timeMs << ",\"seed\":" << seed;
    if (method != "exact") q << ",\"samples\":" << samples; else q << ",\"maxVisits\":" << (long long)maxVisits;
    if (threads > 0) q << ",\"threads\":" << threads;
    q << "}";
    std::string out, err; const double t0 = nowSeconds(); const int st = query(m, mw_response_gain, q.str(), out, err); const double dt = nowSeconds() - t0;
    e.attempts += std::string(e.attempts.empty() ? "" : ",") + "{\"method\":\"" + method + "\",\"status\":" + std::to_string(st) + ",\"seconds\":" + fmt(dt) + (st == 200 ? "" : ",\"error\":" + jsonEsc(err)) + "}";
    e.elapsed += dt;
    if (st != 200) { e.status = st; e.error = err; continue; }
    e.status = 200; e.method = method; e.text = out; Json r(out); if (!r.v) { e.status = 500; e.error = "unreadable response"; return e; }
    if (const char *md = jstr(jget(r.v, "mode"))) e.mode = md;
    e.cls = classOf(e.mode);
    if (const char *u = jstr(jget(jget(r.v, "utility"), "model"))) e.utility = u;
    const JV *seats = jget(r.v, "seats"); double sum = 0, var = 0;
    for (int i = 0; seats && i < seats->n; i++) {
      const JV *s = seats->items[i]; Eval::Seat x; x.seat = (int)jnum(jget(s, "seat"), i);
      const JV *g = jget(s, "gain");
      if (const JV *av = jget(s, "available"); av && av->type == J_BOOL && av->num == 0) x.available = false;
      if (g && g->type == J_NUM) { x.gain = g->num; x.lo = x.hi = g->num; }
      else if (g && g->type == J_OBJ) { x.gain = jnum(jget(g, "mean"), NAN); x.se = jnum(jget(g, "stdErr"), 0); const JV *ci = jget(g, "ci95"); if (ci && ci->type == J_ARR && ci->n == 2) { x.lo = ci->items[0]->num; x.hi = ci->items[1]->num; } else x.lo = x.hi = x.gain; x.samples = jnum(jget(g, "samples"), jnum(jget(s, "evaluationSamples"), 0)); }
      x.policy = jnum(jget(s, "policyValue"), NAN); x.best = jnum(jget(s, "bestResponseValue"), jnum(jget(s, "restrictedResponseValue"), NAN));
      if (!std::isfinite(x.best) && std::isfinite(x.policy) && std::isfinite(x.gain)) x.best = x.policy + x.gain;
      x.lookups = jnum(jget(s, "policyLookups"), 0); x.fallback = jnum(jget(s, "fallbackLookups"), 0); x.sets = jnum(jget(s, "distinctInformationSets"), 0); x.fallbackSets = jnum(jget(s, "distinctFallbackInformationSets"), 0);
      if (std::isfinite(x.gain)) { sum += x.gain; var += x.se * x.se; }
      e.seats.push_back(x);
    }
    e.nashConv = sum; e.nashSe = std::sqrt(var); e.exploitability = jnum(jget(r.v, "exploitability"), NAN);
    e.samples = (long long)jnum(jget(jget(r.v, "budgets"), "samples"), 0);
    return e;
  }
  return e;
}
inline std::string seatsJson(const Eval &e, const JV *spec, int n, bool preflop, double alpha = 0.05) {
  const double z = emana::normalQuantile(1 - alpha / (2.0 * std::max(1, n)));
  const JV *stacks = jget(jget(spec, "rules"), "stacks"); const double pot0 = jnum(jget(jget(spec, "rules"), "pot0"), NAN);
  std::ostringstream o; o << "[";
  for (size_t i = 0; i < e.seats.size(); i++) {
    const auto &s = e.seats[i]; o << (i ? "," : "") << "{\"seat\":" << s.seat << ",\"position\":" << jsonEsc(emana::seatLabel(s.seat, n, preflop));
    o << ",\"stackBB\":" << fmt(stacks && s.seat < stacks->n ? stacks->items[s.seat]->num : NAN) << ",\"available\":" << (s.available ? "true" : "false");
    o << ",\"policyValue\":" << fmt(s.policy) << ",\"bestDeviationValue\":" << fmt(s.best) << ",\"gain\":" << fmt(s.gain) << ",\"stdErr\":" << fmt(s.se);
    if (s.se > 0) o << ",\"ci95\":[" << fmt(s.lo) << "," << fmt(s.hi) << "],\"simultaneousCi\":[" << fmt(s.gain - z * s.se) << "," << fmt(s.gain + z * s.se) << "]";
    else o << ",\"ci95\":null,\"simultaneousCi\":null";
    if (e.utility == "icm") o << ",\"relativeGain\":{\"percent\":" << fmt(s.policy > 0 ? 100 * s.gain / s.policy : NAN) << ",\"basis\":\"percent of the seat's ICM equity under the evaluated strategy\"}";
    else o << ",\"relativeGain\":{\"percent\":" << fmt(pot0 > 0 ? 100 * s.gain / pot0 : NAN) << ",\"basis\":\"percent of the starting pot (chip EV; a gain relative to a near-zero EV would not be meaningful)\"}";
    o << ",\"coverage\":{\"policyLookups\":" << fmt(s.lookups) << ",\"fallbackLookups\":" << fmt(s.fallback) << ",\"fallbackShare\":" << fmt(s.lookups > 0 ? s.fallback / s.lookups : NAN) << ",\"distinctInformationSets\":" << fmt(s.sets) << ",\"distinctFallbackInformationSets\":" << fmt(s.fallbackSets) << ",\"countKind\":\"exact counts of this evaluation's lookups\"}";
    o << "}";
  }
  o << "]"; return o.str();
}
inline std::string aggregateJson(const Eval &e, int n) {
  const double z = emana::normalQuantile(0.975); std::ostringstream o;
  if (e.mode == "exactBestResponse") {
    o << "{\"nashConv\":" << fmt(e.nashConv) << ",\"kind\":\"exact NashConv inside the abstraction (sum of exact unilateral gains)\",\"exploitability\":" << fmt(e.exploitability);
    o << ",\"exploitabilityNote\":" << jsonEsc(std::isfinite(e.exploitability) ? "two-player zero-sum chip EV: exploitability = NashConv / 2, exact for this abstraction" : (n == 2 ? "not zero-sum (ICM) or not available: no exploitability is claimed" : "more than two players: NashConv is not exploitability")) << "}";
  } else if (e.mode == "restrictedBestResponse") o << "{\"nashConvLowerBound\":" << fmt(e.nashConv) << ",\"kind\":\"sum of restricted gains: a LOWER BOUND on NashConv inside the abstraction; never exploitability\"}";
  else o << "{\"nashConvLowerBoundEstimate\":" << fmt(e.nashConv) << ",\"ci95\":[" << fmt(e.nashConv - z * e.nashSe) << "," << fmt(e.nashConv + z * e.nashSe) << "],\"kind\":\"sum of sampled one-decision deviation gains (independent seat streams): an ESTIMATE of a LOWER BOUND on NashConv; never exploitability\"}";
  return o.str();
}
inline std::string specFacts(const JV *spec, const std::string &specText) {
  const int n = (int)jnum(jget(spec, "n"), 0); const JV *board = jget(spec, "board"); const int bl = board && board->type == J_ARR ? board->n : 0;
  std::ostringstream o; o << "{\"players\":" << n << ",\"stage\":\"" << emana::stageName(bl) << "\",\"utility\":\"" << (jget(spec, "icm") ? "icm" : "chip") << "\",\"gameHash\":\"" << emana::gameHash(spec) << "\"";
  if (const char *id = jstr(jget(spec, "studyId"))) o << ",\"studyId\":" << jsonEsc(id);
  o << ",\"actionSeed\":" << fmt(jnum(jget(spec, "actionSeed"), NAN)) << ",\"specSha256\":\""; { emsha::Sha256 h; h.add(specText.data(), specText.size()); o << h.hex(); } o << "\"}";
  return o.str();
}
inline std::string studyFacts(const emana::Study &s, const std::string &path) {
  std::ostringstream o; o << "{\"file\":" << jsonEsc(path) << ",\"bytes\":" << s.bytes << ",\"sha256\":\"" << s.fileSha256 << "\",\"strategyHash\":\"" << emana::strategyHash(s) << "\",\"updates\":" << s.iterations << ",\"trainingDeals\":" << s.trainingDeals << ",\"stateVisits\":" << s.stateVisits << ",\"rows\":" << s.rows.size() << ",\"bettingStates\":" << s.states << ",\"rng\":" << s.rng << ",\"actionRng\":" << s.actionRng << ",\"studyId\":" << jsonEsc(s.studyId) << "}";
  return o.str();
}
inline const char *LIMITS = "[\"All values are measured inside the study's abstraction (ranges, bet menu, streets); nothing here measures unrestricted No-Limit Hold'em.\",\"With more than two players or ICM utilities NashConv is not exploitability, and a small NashConv does not prove that a Nash equilibrium is near in strategy space.\",\"Restricted gains are lower bounds; sampled gains estimate lower bounds and carry sampling error; neither verifies equilibrium.\",\"Rows never visited by training are evaluated with the uniform fallback policy; see coverage.\"]";

inline int verify(int argc, char **argv) {
  if (argc < 4) { std::fprintf(stderr, "usage: mwcli --verify spec.json state [method=auto|exact|restricted|sampled] [samples=N] [seed=N] [timeMs=N] [maxVisits=N] [threads=N] [memory=MiB] [node=s.s.s board=c,c]\n"); return 2; }
  const Args a = keyValues(argc, argv, 4);
  if (unknownKeys(a, {"method", "samples", "seed", "timeMs", "maxVisits", "threads", "memory", "node", "board"})) return 2;
  const std::string method = str(a, "method", "auto");
  if (method != "auto" && method != "exact" && method != "restricted" && method != "sampled") { std::fprintf(stderr, "error: method must be auto, exact, restricted or sampled\n"); return 2; }
  const double samples = num(a, "samples", 20000), seed = num(a, "seed", 1), timeMs = num(a, "timeMs", 120000), maxVisits = num(a, "maxVisits", 2e8), threads = num(a, "threads", 0), mib = num(a, "memory", 4096);
  if (!(samples >= 64 && samples <= 2e6) || !(seed >= 0 && seed <= 4294967295.0) || !(timeMs >= 100 && timeMs <= 3.6e6) || !(maxVisits >= 1000 && maxVisits <= 2e9) || !(threads >= 0 && threads <= 64) || !(mib > 0 && mib <= 65536)) { std::fprintf(stderr, "error: an option is out of range\n"); return 2; }
  Opened st = open(argv[2], argv[3], mib); if (!st.m) { std::fprintf(stderr, "error: %s\n", st.error.c_str()); return 1; }
  Json spec(st.specText); auto bytes = slurpCheckpoint(argv[3]); emana::Study study = emana::parse(bytes.data(), bytes.size());
  const int n = (int)jnum(jget(spec.v, "n"), 0); const JV *rules = jget(spec.v, "rules"); const bool pre = jget(rules, "pre") && jget(rules, "pre")->num != 0;
  const double t0 = nowSeconds();
  Eval e = evaluate(st.m, method, (long long)samples, (unsigned long long)seed, (long long)timeMs, maxVisits, (int)threads);
  std::ostringstream o;
  o << "{\"tool\":\"mwcli verify 4.7\",\"build\":\"" << EM_BUILD_ID << "\",\"game\":" << specFacts(spec.v, st.specText) << ",\"checkpoint\":" << (study.ok ? studyFacts(study, argv[3]) : "{\"error\":" + jsonEsc(study.error) + "}");
  o << ",\"methodRequested\":\"" << method << "\",\"attempts\":[" << e.attempts << "]";
  if (e.status != 200) { o << ",\"error\":" << jsonEsc(e.error) << "}"; std::printf("%s\n", o.str().c_str()); mw_free(st.m); return 1; }
  o << ",\"methodUsed\":\"" << e.method << "\",\"mode\":\"" << e.mode << "\",\"resultClass\":" << jsonEsc(e.cls) << ",\"utilityModel\":\"" << e.utility << "\",\"samples\":" << (e.method == "exact" ? 0 : e.samples) << ",\"seed\":" << (long long)seed;
  o << ",\"seats\":" << seatsJson(e, spec.v, n, pre) << ",\"aggregate\":" << aggregateJson(e, n);
  o << ",\"statistics\":{\"perSeatCi\":\"95% normal intervals from the engine (unadjusted)\",\"simultaneousCi\":\"Bonferroni over the " << n << " seats (family-wise 95%)\",\"stopping\":\"fixed sample size; a deadline-stopped (partial) evaluation is reported by the engine as such and its interval uses the samples actually taken\"}";
  o << ",\"restrictions\":{\"timeLimitMs\":" << (long long)timeMs << ",\"maxVisits\":" << (long long)maxVisits << ",\"abstraction\":\"study betting abstraction and ranges\"}";
  if (a.count("node")) {   // Mode D: local action deviations at one decision
    std::string path = "[", board = "[";
    { std::stringstream ss(a.at("node")); std::string t; bool f = true; while (std::getline(ss, t, '.')) if (!t.empty()) { path += (f ? "" : ",") + t; f = false; } } path += "]";
    { std::stringstream ss(str(a, "board", "")); std::string t; bool f = true; while (std::getline(ss, t, ',')) if (!t.empty()) { board += (f ? "" : ",") + t; f = false; } } board += "]";
    const std::string req = "{\"path\":" + path + ",\"board\":" + board + ",\"range\":true,\"method\":\"auto\",\"samples\":" + std::to_string((long long)samples) + ",\"seed\":" + std::to_string((long long)seed) + ",\"timeLimitMs\":" + std::to_string((long long)timeMs) + "}";
    std::string out, err; const int s2 = query(st.m, mw_action_ev, req, out, err);
    o << ",\"localDeviations\":{\"mode\":\"D: alternative actions at one decision, every hand of the acting range; continuation follows the evaluated strategy; only legal actions of the study's menu are listed\",\"request\":" << req << ",\"status\":" << s2;
    if (s2 == 200) o << ",\"result\":" << out; else o << ",\"error\":" << jsonEsc(err);
    o << "}";
  }
  o << ",\"seconds\":" << fmt(nowSeconds() - t0) << ",\"limitations\":" << LIMITS << "}";
  std::printf("%s\n", o.str().c_str()); mw_free(st.m); return 0;
}

inline int compare(int argc, char **argv) {
  if (argc < 5) { std::fprintf(stderr, "usage: mwcli --compare specA.json stateA stateB [specB=path] [gains=auto|exact|restricted|sampled|none] [samples=N] [seed=N] [timeMs=N] [memory=MiB] [csv=path]\n"); return 2; }
  const Args a = keyValues(argc, argv, 5);
  if (unknownKeys(a, {"specB", "gains", "samples", "seed", "timeMs", "memory", "csv", "maxVisits", "threads"})) return 2;
  const std::string specA = argv[2], specB = str(a, "specB", specA), gains = str(a, "gains", "auto");
  if (gains != "auto" && gains != "exact" && gains != "restricted" && gains != "sampled" && gains != "none") { std::fprintf(stderr, "error: gains must be auto, exact, restricted, sampled or none\n"); return 2; }
  const double samples = num(a, "samples", 20000), seed = num(a, "seed", 1), timeMs = num(a, "timeMs", 120000), mib = num(a, "memory", 4096), maxVisits = num(a, "maxVisits", 2e8), threads = num(a, "threads", 0);
  if (!(samples >= 64 && samples <= 2e6) || !(seed >= 0 && seed <= 4294967295.0 - 1000003) || !(mib > 0 && mib <= 65536) || !(timeMs >= 100) || !(maxVisits >= 1000)) { std::fprintf(stderr, "error: an option is out of range\n"); return 2; }
  auto ta = slurp(specA.c_str()), tb = slurp(specB.c_str()); if (ta.empty() || tb.empty()) { std::fprintf(stderr, "error: cannot read a spec\n"); return 2; }
  Json ja(std::string((const char *)ta.data(), ta.size())), jbv(std::string((const char *)tb.data(), tb.size()));
  if (!ja.v || !jbv.v) { std::fprintf(stderr, "error: unreadable spec JSON\n"); return 2; }
  const auto c = emana::compatibility(ja.v, jbv.v);
  auto ba = slurpCheckpoint(argv[3]), bb = slurpCheckpoint(argv[4]);
  emana::Study A = emana::parse(ba.data(), ba.size()), B = emana::parse(bb.data(), bb.size());
  std::ostringstream o; o << "{\"tool\":\"mwcli compare 4.7\",\"build\":\"" << EM_BUILD_ID << "\",\"compatible\":" << (c.compatible ? "true" : "false");
  o << ",\"differingGameFields\":["; for (size_t i = 0; i < c.differing.size(); i++) o << (i ? "," : "") << jsonEsc(c.differing[i]); o << "]";
  o << ",\"differingTrainerSettings\":["; for (size_t i = 0; i < c.trainerDiffering.size(); i++) o << (i ? "," : "") << jsonEsc(c.trainerDiffering[i]); o << "]";
  const char *idA = jstr(jget(ja.v, "studyId")), *idB = jstr(jget(jbv.v, "studyId"));
  std::string problem;
  if (!A.ok) problem = "checkpoint A: " + A.error; else if (!B.ok) problem = "checkpoint B: " + B.error;
  else if (idA && A.studyId != idA) problem = "checkpoint A belongs to a different study than spec A";
  else if (idB && B.studyId != idB) problem = "checkpoint B belongs to a different study than spec B";
  if (!c.compatible || !problem.empty()) {
    o << ",\"verdict\":" << jsonEsc(!problem.empty() ? problem : "The two checkpoints solve different games (fields listed above); strategies, information sets and gains are not comparable, so no comparison statistics are reported.") << "}";
    std::printf("%s\n", o.str().c_str()); return 3;
  }
  const int n = (int)jnum(jget(ja.v, "n"), 0); const bool pre = jget(jget(ja.v, "rules"), "pre") && jget(jget(ja.v, "rules"), "pre")->num != 0;
  const auto d = emana::distance(A, B, n);
  o << ",\"game\":" << specFacts(ja.v, std::string((const char *)ta.data(), ta.size())) << ",\"A\":" << studyFacts(A, argv[3]) << ",\"B\":" << studyFacts(B, argv[4]);
  o << ",\"identicalStrategies\":" << (emana::strategyHash(A) == emana::strategyHash(B) ? "true" : "false");
  o << ",\"overlap\":{\"rowsA\":" << d.rowsA << ",\"rowsB\":" << d.rowsB << ",\"common\":" << d.common << ",\"onlyA\":" << d.onlyA << ",\"onlyB\":" << d.onlyB << ",\"actionCountMismatch\":" << d.kMismatch << ",\"jaccard\":" << fmt(d.jaccard) << "}";
  o << ",\"strategyDistance\":{\"metric\":\"total variation 0.5*sum|pA-pB| of the normalised average strategy per information-set row\",\"meanOverCommonRows\":" << fmt(d.meanTv) << ",\"weightedOverCommonRows\":" << fmt(d.weightedTv) << ",\"weights\":\"average of the two checkpoints' average-strategy mass shares\",\"maxOverCommonRows\":" << fmt(d.maxTv) << ",\"maxRow\":" << jsonEsc(d.maxTvKey) << ",\"maxRowSeat\":" << d.maxTvSeat;
  o << ",\"weightedOverUnionWithUniformFallback\":" << fmt(d.unionWeightedTv) << ",\"currentStrategyMeanOverCommonRows\":" << fmt(d.currentMeanTv) << ",\"perSeatWeighted\":[";
  for (int s = 0; s < n; s++) o << (s ? "," : "") << "{\"seat\":" << s << ",\"position\":" << jsonEsc(emana::seatLabel(s, n, pre)) << ",\"commonRows\":" << d.seatCommon[(size_t)s] << ",\"weightedTv\":" << fmt(d.seatWeightedTv[(size_t)s]) << "}";
  o << "]}";
  std::ostringstream csv; csv << "seat,position,gainA,stdErrA,gainB,stdErrB,difference,simultaneousLow,simultaneousHigh,verdict\n";
  if (gains != "none") {
    Opened oa = open(specA, argv[3], mib), ob = open(specB, argv[4], mib);
    if (!oa.m || !ob.m) { o << ",\"gains\":{\"error\":" << jsonEsc(!oa.m ? oa.error : ob.error) << "}"; }
    else {
      JB ia; jb_init(&ia); mw_info(oa.m, &ia); JB ib; jb_init(&ib); mw_info(ob.m, &ib);
      Json fa(std::string(ia.s, ia.n)), fb(std::string(ib.s, ib.n)); jb_free(&ia); jb_free(&ib);
      o << ",\"memory\":{\"tableMiBA\":" << fmt(jnum(jget(fa.v, "tableMiB"), NAN)) << ",\"tableMiBB\":" << fmt(jnum(jget(fb.v, "tableMiB"), NAN)) << ",\"restoreEstimateBytesA\":" << fmt(jnum(jget(jget(fa.v, "restoreEstimate"), "totalBytes"), NAN)) << ",\"restoreEstimateBytesB\":" << fmt(jnum(jget(jget(fb.v, "restoreEstimate"), "totalBytes"), NAN)) << "}";
      o << ",\"trainingTime\":\"not stored in checkpoints; use the analytics.json written by mwcli --monitor or the dashboard export\"";
      // independent evaluation streams for the two checkpoints (seed and seed + 1000003)
      Eval ea = evaluate(oa.m, gains, (long long)samples, (unsigned long long)seed, (long long)timeMs, maxVisits, (int)threads);
      Eval eb = evaluate(ob.m, ea.status == 200 && gains == "auto" ? ea.method : gains, (long long)samples, (unsigned long long)seed + 1000003ULL, (long long)timeMs, maxVisits, (int)threads);
      if (ea.status != 200 || eb.status != 200) o << ",\"gains\":{\"error\":" << jsonEsc(ea.status != 200 ? ea.error : eb.error) << "}";
      else {
        const bool exact = ea.mode == "exactBestResponse" && eb.mode == "exactBestResponse", restricted = ea.mode == "restrictedBestResponse";
        const double z = emana::normalQuantile(1 - 0.05 / (2.0 * std::max(1, n)));
        o << ",\"gains\":{\"method\":\"" << ea.method << "\",\"class\":" << jsonEsc(ea.cls) << ",\"seedA\":" << (long long)seed << ",\"seedB\":" << (long long)seed + 1000003LL << ",\"A\":" << seatsJson(ea, ja.v, n, pre) << ",\"B\":" << seatsJson(eb, jbv.v, n, pre) << ",\"aggregateA\":" << aggregateJson(ea, n) << ",\"aggregateB\":" << aggregateJson(eb, n) << ",\"differences\":[";
        int better = 0, worse = 0;
        for (size_t i = 0; i < ea.seats.size() && i < eb.seats.size(); i++) {
          const auto &x = ea.seats[i], &y = eb.seats[i]; const double diff = y.gain - x.gain, se = std::sqrt(x.se * x.se + y.se * y.se), lo = diff - z * se, hi = diff + z * se;
          std::string v;
          if (exact) v = diff < 0 ? "B has the smaller exact gain" : diff > 0 ? "A has the smaller exact gain" : "equal exact gains";
          else if (restricted) v = "both are lower bounds: their difference does not establish which strategy is stronger";
          else v = hi < 0 ? "B smaller (supported, simultaneous 95%)" : lo > 0 ? "A smaller (supported, simultaneous 95%)" : "difference not established";
          if (exact ? diff < 0 : (!restricted && hi < 0)) better++;
          if (exact ? diff > 0 : (!restricted && lo > 0)) worse++;
          o << (i ? "," : "") << "{\"seat\":" << x.seat << ",\"position\":" << jsonEsc(emana::seatLabel(x.seat, n, pre)) << ",\"gainB_minus_gainA\":" << fmt(diff) << ",\"simultaneousCi\":" << (exact ? "null" : "[" + fmt(lo) + "," + fmt(hi) + "]") << ",\"verdict\":" << jsonEsc(v) << "}";
          csv << x.seat << "," << emana::seatLabel(x.seat, n, pre) << "," << fmt(x.gain) << "," << fmt(x.se) << "," << fmt(y.gain) << "," << fmt(y.se) << "," << fmt(diff) << "," << (exact ? "" : fmt(lo)) << "," << (exact ? "" : fmt(hi)) << ",\"" << v << "\"\n";
        }
        o << "],\"seatsWhereBSmaller\":" << better << ",\"seatsWhereASmaller\":" << worse;
        o << ",\"statistics\":" << jsonEsc(exact ? "exact values; differences are exact" : restricted ? "lower bounds; no ordering is inferred" : "independent evaluation streams; difference intervals use sqrt(seA^2 + seB^2) and Bonferroni over seats (family-wise 95%)");
        o << ",\"interpretation\":" << jsonEsc(exact ? (ea.nashConv > eb.nashConv ? "B has the smaller exact NashConv inside the abstraction" : ea.nashConv < eb.nashConv ? "A has the smaller exact NashConv inside the abstraction" : "equal exact NashConv") : "Sampled or restricted gains bound the best-response gains from below; a smaller value is evidence, not proof, of a stronger strategy.") << "}";
      }
    }
    if (oa.m) mw_free(oa.m);
    if (ob.m) mw_free(ob.m);
  }
  o << ",\"laterIsNotAutomaticallyBetter\":\"More updates do not guarantee a stronger strategy; only the gains above (and their class) support a quality statement.\",\"limitations\":" << LIMITS << "}";
  std::printf("%s\n", o.str().c_str());
  if (a.count("csv")) { std::ofstream f(a.at("csv"), std::ios::binary); f << csv.str(); }
  return 0;
}

// ---------------------------------------------------------------- monitor
inline bool writeAtomic(const std::string &path, const std::string &text) {
  SaveReport rep; saveWithReport(path.c_str(), [&](FILE *f) { return std::fwrite(text.data(), 1, text.size(), f) == text.size(); }, rep); return rep.ok;
}
inline int monitor(int argc, char **argv) {
  if (argc < 4) { std::fprintf(stderr, "usage: mwcli --monitor spec.json out-dir [updates=N] [deals=N] [seconds=S] [rssMiB=M] [target=x] [eval=auto|exact|restricted|sampled|none] [samples=N] [evalSeed=N] [first=N] [growth=G] [share=F] [threads=T] [memory=MiB] [resume=state] [keep=all|last]\n"); return 2; }
  const Args a = keyValues(argc, argv, 4);
  if (unknownKeys(a, {"updates", "deals", "seconds", "rssMiB", "target", "eval", "samples", "evalSeed", "first", "growth", "share", "threads", "memory", "resume", "keep", "timeMs", "maxVisits"})) return 2;
  const double maxUpdates = num(a, "updates", 10000), maxDeals = num(a, "deals", 1e18), maxSeconds = num(a, "seconds", 1e18), rssLimit = num(a, "rssMiB", 1e18), target = num(a, "target", NAN);
  const std::string evalMethod = str(a, "eval", "auto"), keep = str(a, "keep", "last");
  const double samples = num(a, "samples", 20000), evalSeed = num(a, "evalSeed", 7), first = num(a, "first", 100), growth = num(a, "growth", 2), share = num(a, "share", 0.25), threads = num(a, "threads", 4), mib = num(a, "memory", 512), timeMs = num(a, "timeMs", 120000), maxVisits = num(a, "maxVisits", 2e8);
  if (!(maxUpdates >= 1 && maxUpdates <= 1e7) || !(first >= 1) || !(growth >= 1.05 && growth <= 100) || !(share > 0 && share <= 1) || !(threads >= 1 && threads <= 256) || !(mib > 0 && mib <= 65536) || !(samples >= 64 && samples <= 2e6) || (evalMethod != "auto" && evalMethod != "exact" && evalMethod != "restricted" && evalMethod != "sampled" && evalMethod != "none") || (keep != "all" && keep != "last") || std::isnan(maxDeals) || std::isnan(maxSeconds) || std::isnan(rssLimit) || !(evalSeed >= 0 && evalSeed < 4294967295.0)) { std::fprintf(stderr, "error: an option is out of range\n"); return 2; }
  const std::string dir = argv[3]; std::error_code ec; std::filesystem::create_directories(dir, ec);
  auto specBytes = slurp(argv[2]); if (specBytes.empty()) { std::fprintf(stderr, "error: cannot read %s\n", argv[2]); return 2; }
  const std::string specText((const char *)specBytes.data(), specBytes.size()); Json spec(specText);
  char err[512] = ""; MW *m = nullptr;
  if (a.count("resume")) { Opened o = open(argv[2], a.at("resume"), mib); if (!o.m) { std::fprintf(stderr, "error: resume: %s\n", o.error.c_str()); return 1; } m = o.m; }
  else { m = mw_create(specText.c_str(), specText.size(), mib, err, sizeof err); if (!m) { std::fprintf(stderr, "error: %s\n", err); return 1; } }
  if (!mw_is_external(m)) { std::fprintf(stderr, "error: monitoring needs an external-sampling (protocol 4) study\n"); mw_free(m); return 1; }
  const int n = (int)jnum(jget(spec.v, "n"), 0); const bool pre = jget(jget(spec.v, "rules"), "pre") && jget(jget(spec.v, "rules"), "pre")->num != 0;
  std::string trainer; { Json info(infoText(m)); trainer = info.v && jget(info.v, "trainer") ? jvText(jget(info.v, "trainer")) : "null"; }
  std::vector<std::string> rows; std::ostringstream csv;
  csv << "index,updates,trainingDeals,trainSeconds,evalSeconds,dealsPerSecond,rssMiB,peakRssMiB,tableMiB,rows,bettingStates,strategyHash,weightedStrategyChange,method,class,nashConv,nashConvLow,nashConvHigh,fallbackShare";
  for (int s = 0; s < n; s++) csv << ",gain_" << s << ",gainLow_" << s << ",gainHigh_" << s;
  csv << "\n";
  emana::Study previous; bool havePrevious = false; double trainSeconds = 0; long long nextEval = (long long)first; int evalIndex = 0;
  std::string stopReason = "maximum updates", stopDetail, lastCkpt; bool certified = false; double lastNash = NAN;
  volatile int stop = 0; long long lastUpdates = 0; double lastTrain = 0; std::vector<std::pair<double, double>> trend;
  Json info0(infoText(m)); const long long startUpdates = (long long)jnum(jget(info0.v, "iterations"), 0);
  const std::string started = [] { char b[64]; std::time_t t = std::time(nullptr); std::strftime(b, sizeof b, "%Y-%m-%dT%H:%M:%SZ", std::gmtime(&t)); return std::string(b); }();
  auto header = [&](const std::string &status) {
    std::ostringstream h;
    h << "{\"schema\":\"eightmax-analytics/1\",\"tool\":\"mwcli monitor 4.7\",\"version\":\"" << EM_VERSION << "\",\"build\":\"" << EM_BUILD_ID << "\",\"started\":\"" << started << "\",\"status\":\"" << status << "\",\"spec\":" << jsonEsc(argv[2]) << ",\"game\":" << specFacts(spec.v, specText) << ",\"trainer\":" << trainer;
    h << ",\"config\":{\"threads\":" << (int)threads << ",\"tableBudgetMiB\":" << fmt(mib) << ",\"evaluation\":\"" << evalMethod << "\",\"samples\":" << (long long)samples << ",\"evalSeed\":" << (long long)evalSeed << ",\"evalSeedRule\":\"evaluation k uses seed evalSeed + 7919 k; evaluation streams never share state with the training streams (evaluations only read the strategy)\",\"firstEvaluationAtUpdates\":" << (long long)first << ",\"growth\":" << fmt(growth) << ",\"maxEvaluationShare\":" << fmt(share);
    h << ",\"stops\":{\"updates\":" << fmt(maxUpdates) << ",\"deals\":" << fmt(maxDeals) << ",\"seconds\":" << fmt(maxSeconds) << ",\"rssMiB\":" << fmt(rssLimit) << ",\"target\":" << fmt(target) << "},\"resume\":" << (a.count("resume") ? jsonEsc(a.at("resume")) : "null") << ",\"startUpdates\":" << startUpdates << "}";
    h << ",\"evaluations\":["; for (size_t i = 0; i < rows.size(); i++) h << (i ? ",\n" : "\n") << rows[i]; h << "]";
    h << ",\"stop\":{\"reason\":" << jsonEsc(stopReason) << ",\"detail\":" << jsonEsc(stopDetail) << ",\"targetCertified\":" << (certified ? "true" : "false") << "},\"finalCheckpoint\":" << jsonEsc(lastCkpt);
    if (trend.size() >= 3) {   // descriptive log-log slope of NashConv against sampled deals over the last <= 6 evaluations
      const size_t k = std::min<size_t>(6, trend.size()); double sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (size_t i = trend.size() - k; i < trend.size(); i++) { sx += trend[i].first; sy += trend[i].second; sxx += trend[i].first * trend[i].first; sxy += trend[i].first * trend[i].second; }
      const double slope = (k * sxy - sx * sy) / (k * sxx - sx * sx);
      h << ",\"trend\":{\"logLogSlope\":" << fmt(slope) << ",\"points\":" << k << ",\"note\":\"least-squares slope of log NashConv (or its lower-bound estimate) on log sampled deals over the last evaluations; descriptive only, not a convergence guarantee\"}";
    }
    h << ",\"limitations\":" << LIMITS << "}\n";
    return h.str();
  };
  int exitCode = 0;
  for (;;) {
    Json ib(infoText(m)); const long long updates = (long long)jnum(jget(ib.v, "iterations"), 0), deals = (long long)jnum(jget(ib.v, "trainingDeals"), 0);
    long long goal = std::min<long long>(std::max(nextEval, updates + 1), (long long)maxUpdates);
    if (updates >= (long long)maxUpdates) break;
    // training segment, stopped early by the elapsed-time, deal or memory limits
    stop = 0; std::atomic<bool> segDone{false}; std::atomic<int> why{0};
    const double remaining = maxSeconds - trainSeconds;
    if (std::isfinite(maxDeals) && maxDeals < 1e18) { const double perUpdate = updates > 0 ? (double)deals / (double)updates : 1; goal = std::min<long long>(goal, updates + std::max(1LL, (long long)((maxDeals - (double)deals) / std::max(1.0, perUpdate)))); }
    std::thread watch([&] { const double until = nowSeconds() + remaining; while (!segDone.load()) { if (nowSeconds() >= until) { why = 1; __atomic_store_n(&stop, 1, __ATOMIC_RELAXED); break; } if (currentRssMiB() > rssLimit) { why = 2; __atomic_store_n(&stop, 1, __ATOMIC_RELAXED); break; } std::this_thread::sleep_for(std::chrono::milliseconds(2)); } });
    const double t0 = nowSeconds(); const int ok = mw_train(m, goal - updates, (int)threads, &stop, nullptr, nullptr, err, sizeof err); const double dt = nowSeconds() - t0;
    segDone = true; watch.join(); trainSeconds += dt;
    if (!ok) { stopReason = "training error"; stopDetail = err; exitCode = 1; break; }
    Json ia(infoText(m)); const long long u2 = (long long)jnum(jget(ia.v, "iterations"), 0), d2 = (long long)jnum(jget(ia.v, "trainingDeals"), 0);
    const bool limit = jget(ia.v, "limitReached") && jget(ia.v, "limitReached")->num != 0;
    // checkpoint + analytics row
    unsigned char *buf = nullptr; const size_t len = mw_export(m, &buf);
    emana::Study cur = buf && len ? emana::parse(buf, len) : emana::Study{};
    char name[64]; std::snprintf(name, sizeof name, "checkpoint-%08lld.state", u2); const std::string ck = (std::filesystem::path(dir) / name).string();
    bool saved = false; if (buf && len) { SaveReport rep; saveWithReport(ck.c_str(), [&](FILE *f) { return std::fwrite(buf, 1, len, f) == len; }, rep); saved = rep.ok; }
    std::free(buf);
    if (saved && keep == "last" && !lastCkpt.empty() && lastCkpt != ck) std::filesystem::remove(lastCkpt, ec);
    if (saved) lastCkpt = ck;
    Eval e; const double e0 = nowSeconds();
    if (evalMethod != "none") e = evaluate(m, evalMethod, (long long)samples, (unsigned long long)evalSeed + 7919ULL * (unsigned long long)evalIndex, (long long)timeMs, maxVisits, (int)std::min(64.0, threads));
    const double evalSeconds = nowSeconds() - e0;
    std::ostringstream r;
    const double segDeals = (double)(d2 - deals), segSec = dt;
    r << "{\"index\":" << evalIndex << ",\"updates\":" << u2 << ",\"trainingDeals\":" << d2 << ",\"stateVisits\":" << (long long)jnum(jget(ia.v, "stateVisits"), 0) << ",\"trainSeconds\":" << fmt(trainSeconds) << ",\"evalSeconds\":" << fmt(evalSeconds);
    r << ",\"dealsPerSecond\":" << fmt(segSec > 0 ? segDeals / segSec : NAN) << ",\"updatesPerSecond\":" << fmt(segSec > 0 ? (double)(u2 - updates) / segSec : NAN) << ",\"rssMiB\":" << fmt(currentRssMiB()) << ",\"peakRssMiB\":" << fmt(peakRssMiB());
    r << ",\"tableMiB\":" << fmt(jnum(jget(ia.v, "tableMiB"), NAN)) << ",\"rows\":" << (long long)jnum(jget(ia.v, "rows"), 0) << ",\"bettingStates\":" << (long long)jnum(jget(ia.v, "states"), 0) << ",\"limitReached\":" << (limit ? "true" : "false");
    r << ",\"checkpoint\":{\"file\":" << jsonEsc(saved ? std::filesystem::path(ck).filename().string() : "") << ",\"saved\":" << (saved ? "true" : "false") << ",\"sha256\":\"" << cur.fileSha256 << "\",\"strategyHash\":\"" << (cur.ok ? emana::strategyHash(cur) : "") << "\"}";
    double change = NAN;
    if (havePrevious && cur.ok) { const auto d = emana::distance(previous, cur, n); change = d.weightedTv;
      r << ",\"strategyChange\":{\"weightedTv\":" << fmt(d.weightedTv) << ",\"meanTv\":" << fmt(d.meanTv) << ",\"maxTv\":" << fmt(d.maxTv) << ",\"newRows\":" << d.onlyB << ",\"commonRows\":" << d.common << ",\"metric\":\"total variation of the normalised average strategy against the previous evaluation, weighted by average-strategy mass\"}"; }
    else r << ",\"strategyChange\":null";
    double fallbackShare = NAN;
    if (evalMethod != "none" && e.status == 200) {
      double lk = 0, fb = 0, sets = 0, fsets = 0; for (auto &s : e.seats) { lk += s.lookups; fb += s.fallback; sets += s.sets; fsets += s.fallbackSets; }
      fallbackShare = lk > 0 ? fb / lk : NAN;
      const double z = emana::normalQuantile(0.975);
      r << ",\"coverage\":{\"policyLookups\":" << fmt(lk) << ",\"fallbackLookups\":" << fmt(fb) << ",\"fallbackShare\":" << fmt(fallbackShare) << ",\"distinctInformationSetsSum\":" << fmt(sets) << ",\"distinctFallbackInformationSetsSum\":" << fmt(fsets) << ",\"storedRows\":" << cur.rows.size() << ",\"kind\":\"exact counts of the evaluation's policy lookups (per-seat sums); storedRows is the exact number of trained information-set rows\"}";
      r << ",\"evaluation\":{\"method\":\"" << e.method << "\",\"mode\":\"" << e.mode << "\",\"class\":" << jsonEsc(e.cls) << ",\"seed\":" << (long long)evalSeed + 7919LL * evalIndex << ",\"samples\":" << (e.method == "exact" ? 0 : e.samples) << ",\"nashConv\":" << fmt(e.nashConv) << ",\"nashConvCi95\":" << (e.nashSe > 0 ? "[" + fmt(e.nashConv - z * e.nashSe) + "," + fmt(e.nashConv + z * e.nashSe) + "]" : "null") << ",\"exploitability\":" << fmt(e.exploitability) << ",\"seats\":" << seatsJson(e, spec.v, n, pre) << ",\"attempts\":[" << e.attempts << "]}";
      if (std::isfinite(e.nashConv) && e.nashConv > 0) trend.push_back({std::log((double)std::max(1LL, d2)), std::log(e.nashConv)});
      lastNash = e.nashConv;
    } else r << ",\"coverage\":{\"storedRows\":" << cur.rows.size() << "},\"evaluation\":" << (evalMethod == "none" ? "null" : "{\"error\":" + jsonEsc(e.error) + ",\"attempts\":[" + e.attempts + "]}");
    r << "}";
    rows.push_back(r.str());
    csv << evalIndex << "," << u2 << "," << d2 << "," << fmt(trainSeconds) << "," << fmt(evalSeconds) << "," << fmt(segSec > 0 ? segDeals / segSec : NAN) << "," << fmt(currentRssMiB()) << "," << fmt(peakRssMiB()) << "," << fmt(jnum(jget(ia.v, "tableMiB"), NAN)) << "," << cur.rows.size() << "," << (long long)jnum(jget(ia.v, "states"), 0) << "," << (cur.ok ? emana::strategyHash(cur) : "") << "," << fmt(change) << "," << e.method << ",\"" << e.mode << "\"," << fmt(e.nashConv);
    { const double z = emana::normalQuantile(0.975); csv << "," << (e.nashSe > 0 ? fmt(e.nashConv - z * e.nashSe) : "") << "," << (e.nashSe > 0 ? fmt(e.nashConv + z * e.nashSe) : "") << "," << fmt(fallbackShare); }
    for (int s = 0; s < n; s++) { if ((size_t)s < e.seats.size()) csv << "," << fmt(e.seats[(size_t)s].gain) << "," << fmt(e.seats[(size_t)s].lo) << "," << fmt(e.seats[(size_t)s].hi); else csv << ",,,"; }
    csv << "\n";
    if (cur.ok) { previous = std::move(cur); havePrevious = true; }
    evalIndex++;
    writeAtomic((std::filesystem::path(dir) / "analytics.json").string(), header("running"));
    writeAtomic((std::filesystem::path(dir) / "analytics.csv").string(), csv.str());
    std::fprintf(stderr, "monitor: updates %lld deals %lld train %.2fs eval %.2fs %s %s\n", u2, d2, trainSeconds, evalSeconds, e.method.c_str(), fmt(e.nashConv).c_str());
    // stopping rules
    if (limit) { stopReason = "memory budget"; stopDetail = "the table budget was reached (limitReached); the last committed update is kept"; break; }
    if (why == 1) { stopReason = "maximum elapsed training time"; break; }
    if (why == 2) { stopReason = "process memory limit"; stopDetail = "resident memory exceeded rssMiB; the update in progress was discarded and the committed state kept"; break; }
    if ((double)d2 >= maxDeals) { stopReason = "maximum sampled deals"; break; }
    if (u2 >= (long long)maxUpdates) { stopReason = "maximum updates"; break; }
    if (std::isfinite(target) && e.status == 200) {
      if (e.mode == "exactBestResponse" && e.nashConv <= target) { stopReason = "quality target"; certified = true; stopDetail = "exact NashConv inside the abstraction is at or below the target (an exact statement for this abstraction, not for unrestricted poker)"; break; }
      if (e.mode == "sampledOneDecisionDeviation") {   // alpha spending: evaluation k may stop at level 0.05 / 2^(k+1) (sum <= 0.05)
        const double alpha = 0.05 / std::pow(2.0, evalIndex), z = emana::normalQuantile(1 - alpha), ucb = e.nashConv + z * e.nashSe;
        if (ucb <= target) { stopReason = "quality target (sampled)"; stopDetail = "the one-sided upper confidence bound (alpha spending 0.05/2^k) of the summed sampled one-decision deviation gains is at or below the target; this bounds an ESTIMATED LOWER BOUND of NashConv and does not verify equilibrium"; break; }
      }
    }
    // adaptive schedule: geometric growth, stretched so that evaluation time stays within `share` of training time
    long long next = (long long)std::ceil((double)u2 * growth); if (next <= u2) next = u2 + 1;
    const double segRate = segSec > 0 ? (double)(u2 - updates) / segSec : 0;
    if (segRate > 0 && evalSeconds > 0) { const long long need = u2 + (long long)std::ceil(segRate * evalSeconds / share); if (need > next) next = need; }
    lastUpdates = u2; lastTrain = trainSeconds; nextEval = next;
  }
  (void)lastUpdates; (void)lastTrain; (void)lastNash;
  writeAtomic((std::filesystem::path(dir) / "analytics.json").string(), header(exitCode ? "failed" : "finished"));
  writeAtomic((std::filesystem::path(dir) / "analytics.csv").string(), csv.str());
  std::printf("{\"analytics\":%s,\"evaluations\":%zu,\"stop\":%s,\"finalCheckpoint\":%s}\n", jsonEsc((std::filesystem::path(dir) / "analytics.json").string()).c_str(), rows.size(), jsonEsc(stopReason).c_str(), jsonEsc(lastCkpt).c_str());
  mw_free(m); return exitCode;
}
} // namespace mwa
