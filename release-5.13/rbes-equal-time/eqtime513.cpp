// EightMax 5.13: "rbes" against the default trainer at EQUAL TRAINING TIME, on the user's PC.
//
// A separate tool built from the unchanged engine source of release 5.13 (native/mw.cpp, build e9ce3436fa829e47):
// it links the same engine objects as mwcli.exe and adds nothing to the engine. It exists because mwcli has no
// training mode that is stopped by the clock.
//
//   eqtime513 run [--quick] [--jobs N] [--out DIR]      the whole experiment (resumable: run it again)
//   eqtime513 --unit GAME SEED CPU DIR QUICK            one game x seed (started by "run"; not for direct use)
//   eqtime513 analyze DIR                               summary.json and summary.txt again from raw rows
//   eqtime513 reference DIR                             (development) writes the equal-deals reference values
//
// The plan (questions, games, seeds, budgets, statistic, decision rule) is the text PLAN below. It was written
// before any measurement on the target PC, is written to <out>/plan.json before the first unit starts, and a
// directory that holds another plan is refused.
#include "mw.h"
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>
#include <map>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
#include <algorithm>
#include <cpuid.h>
#ifdef _WIN32
#include <windows.h>
#include <direct.h>
#else
#include <sched.h>
#include <sys/stat.h>
#include <unistd.h>
#endif
using Clock = std::chrono::steady_clock;
static const char *ENGINE_BUILD = "e9ce3436fa829e47";
static const char *FEW[] = {"hu-river", "hu-turn", "river3-chip", "turn4", "flop6", "final8", "bubble4"};
static const char *RANGES[] = {"rg-hu-river", "rg-river3", "rg-hu-turn", "rg-turn3", "rg-turn4", "rg-icm3-river", "rg-bubble4", "rg-flop6c"};
static const char *TOURN[] = {"early3-flop", "mid3-turn", "short8-push", "bubble5-icm", "sidepot3-icm"};
// "wide" = the largest range of a seat has at least 10 hands (fixed in the plan; the hands are counted in the specs)
static const char *WIDE[] = {"rg-hu-river", "rg-river3", "rg-hu-turn", "rg-turn3", "rg-turn4", "rg-icm3-river"};
struct Config { std::vector<std::string> games; std::vector<int> seeds; std::vector<double> times; long long checkDeals; bool quick; };
static Config config(bool quick) {
  Config c; c.quick = quick;
  if (quick) { c.games = {"hu-river", "rg-turn4", "bubble4"}; c.seeds = {9001, 9002, 9003}; c.times = {0.1, 0.3, 1.0}; c.checkDeals = 2000; }
  else {
    for (auto g : FEW) c.games.push_back(g); for (auto g : RANGES) c.games.push_back(g); for (auto g : TOURN) c.games.push_back(g);
    for (int s = 5131; s <= 5150; s++) c.seeds.push_back(s); c.times = {1.0, 4.0, 16.0}; c.checkDeals = 20000;
  }
  return c;
}
static bool in(const char *const *a, size_t n, const std::string &g) { for (size_t i = 0; i < n; i++) if (g == a[i]) return true; return false; }
#define INSET(A, g) in(A, sizeof A / sizeof *A, g)
static const char *PLAN_TEXT =
  "EightMax 5.13, rbes against the default trainer at equal training time on the target PC. "
  "QUESTION: does the experimental estimator rbes reach a lower EXACT NashConv than the default trainer in the same wall-clock training time on this PC? "
  "PROGRAM: the engine of release 5.13 (build e9ce3436fa829e47), unchanged, linked into this tool. "
  "GAMES: the 20 reference games of the 5.10 experiment (tools/games510.js), each small enough for an exact best response of every seat, in the classes few hands (7), ranges (8) and tournament (5). "
  "The subclass WIDE is fixed here as the six games in which the largest range of a seat has at least 10 hands: rg-hu-river, rg-river3, rg-hu-turn, rg-turn3, rg-turn4, rg-icm3-river. "
  "ARMS: default (the spec as generated) and rbes (the same spec with estimator rbes); both with the 64-bit training streams of 5.11 (trainingStreams philox64), because a fast PC would reach the 10,000,000-update bound of the old streams inside the larger budgets. One thread, table limit 512 MiB. "
  "SEEDS: 5131 to 5150, the same for both arms (paired); none of them was used by an earlier experiment. "
  "BUDGETS: 1 s, 4 s and 16 s of training, each a fresh run stopped at the first 64-update boundary after the deadline; the clock starts after the engine is built. "
  "MEASURE: exact NashConv of the average strategy (the sum over the seats of the exact best-response gain), in BB or in the prize unit. For more than two seats NashConv is not exploitability. "
  "STATISTIC: per game and budget, the mean over seeds of ln(NashConv rbes / NashConv default), paired by seed, Student-t interval; a NashConv below 1e-12 counts as 1e-12. "
  "PRIMARY family: the 4 s budget, one interval per game, each at level 0.05/20. SECONDARY family: all three budgets of all games, 60 intervals, each at level 0.05/60. "
  "Verdicts: better (whole interval below 1), worse (above 1), unresolved. "
  "RULE, fixed before any measurement on the target PC. "
  "P1: the equal-deals check passes (after 20,000 sampled deals of seed 5131 both arms reproduce, in every game, the NashConv recorded from the Linux build, to the last bit); otherwise the run measures another program and nothing counts. "
  "P2: at least 18 of the 20 seeds are valid in both arms for every game of the subclass; otherwise the result is incomplete and nothing is decided. "
  "P3 (decision): rbes becomes the trainer that studies choose automatically for games in which the largest range of a seat has at least 10 hands IF, on the target PC, rbes is better in the primary family on at least 4 of the 6 WIDE games AND worse in no interval of either family on any WIDE game AND reaches the table limit in no run in which the default does not. "
  "P4: if P3 fails because of an interval that is worse, rbes stays opt-in and the games are named. If P3 fails only for lack of resolved intervals, the result is reported as unresolved and rbes stays opt-in. "
  "P5: the classes few hands, ranges and tournament are reported with the rule of 5.10 (recommended when better in the primary family on at least half of the class and worse in no secondary interval) as information; nothing outside WIDE changes a default. "
  "Whatever P3 says, an engine spec without an estimator key keeps training with the default trainer and writes the states it wrote before; rbes is never chosen where it is unsupported (DCFR, regret matching+, Latin or stratified deals, representative groups, batch schedules) and never by the JavaScript panel. "
  "STOPPING: every game x seed x arm x budget once; no interim analysis; an interrupted run is continued by starting it again (complete game x seed units are kept, a unit that was cut off is run again from its beginning). "
  "LIMITS: small games with exact evaluation only; the result says nothing direct about the shipped fixtures with hand groups, for which no exact NashConv exists. Several units run at once, each bound to its own processor; arms of one unit run one after the other on the same processor and the order of the arms alternates with the seed, so load does not favour an arm but adds noise.";
static std::string slurp(const std::string &p) { std::ifstream f(p, std::ios::binary); return std::string{std::istreambuf_iterator<char>(f), {}}; }
static bool exists(const std::string &p) { std::ifstream f(p); return f.good(); }
static void makeDir(const std::string &p) {
#ifdef _WIN32
  _mkdir(p.c_str());
#else
  mkdir(p.c_str(), 0777);
#endif
}
static std::string cpuName() {
  unsigned a, b, c, d; char s[49] = {}; if (__get_cpuid_max(0x80000000u, nullptr) < 0x80000004u) return "unknown";
  for (unsigned i = 0; i < 3; i++) { __get_cpuid(0x80000002u + i, &a, &b, &c, &d); std::memcpy(s + 16 * i, &a, 4); std::memcpy(s + 16 * i + 4, &b, 4); std::memcpy(s + 16 * i + 8, &c, 4); std::memcpy(s + 16 * i + 12, &d, 4); }
  std::string r = s; while (!r.empty() && r.front() == ' ') r.erase(r.begin()); while (!r.empty() && r.back() == ' ') r.pop_back(); return r;
}
static void bindCpu(int cpu) {
  if (cpu < 0) return;
#ifdef _WIN32
  SetProcessAffinityMask(GetCurrentProcess(), (DWORD_PTR)1 << cpu);
#else
  cpu_set_t s; CPU_ZERO(&s); CPU_SET(cpu, &s); sched_setaffinity(0, sizeof s, &s);
#endif
}
static std::string exeDir(const char *argv0) {
#ifdef _WIN32
  char buf[4096]; DWORD n = GetModuleFileNameA(nullptr, buf, sizeof buf); std::string p(buf, n);
#else
  char buf[4096]; ssize_t n = readlink("/proc/self/exe", buf, sizeof buf); std::string p = n > 0 ? std::string(buf, n) : std::string(argv0);
#endif
  size_t k = p.find_last_of("/\\"); return k == std::string::npos ? "." : p.substr(0, k);
}
static std::string exePath(const char *argv0) {
#ifdef _WIN32
  char buf[4096]; DWORD n = GetModuleFileNameA(nullptr, buf, sizeof buf); return std::string(buf, n);
#else
  char buf[4096]; ssize_t n = readlink("/proc/self/exe", buf, sizeof buf); return n > 0 ? std::string(buf, n) : std::string(argv0);
#endif
}
// ---- one training run and its exact NashConv ----
struct Deadline { Clock::time_point end; volatile int stop; long long iterations, deals; bool timed; };
static void tick(void *ctx, long long iterations, long long deals) {
  auto &d = *static_cast<Deadline *>(ctx); d.iterations = iterations; d.deals = deals;
  if (d.timed && Clock::now() >= d.end) d.stop = 1;
}
static std::string armSpec(const std::string &spec, bool rbes) {
  size_t k = spec.find('{'); std::string add = "\"trainingStreams\":\"philox64\","; if (rbes) add += "\"estimator\":\"rbes\",";
  return spec.substr(0, k + 1) + add + spec.substr(k + 1);
}
struct Run { bool ok = false; std::string error; double seconds = 0, nashConv = 0; long long iterations = 0, deals = 0; bool limit = false; double gainSeconds = 0; };
static Run runOne(const std::string &spec, bool rbes, double seconds, long long updates) {
  Run r; char err[512] = ""; std::string s = armSpec(spec, rbes);
  MW *m = mw_create(s.data(), s.size(), 512, err, sizeof err);
  if (!m) { r.error = std::string("create: ") + err; return r; }
  const auto begin = Clock::now(); Deadline d{begin + std::chrono::microseconds((long long)(seconds * 1e6)), 0, 0, 0, updates == 0};
  if (!mw_train(m, updates ? updates : mw_max_updates(m), 1, &d.stop, tick, &d, err, sizeof err)) { r.error = std::string("train: ") + err; mw_free(m); return r; }
  r.seconds = std::chrono::duration<double>(Clock::now() - begin).count();
  JB info; jb_init(&info); mw_info(m, &info); std::string it(info.s, info.n); jb_free(&info);
  auto field = [&](const std::string &doc, const char *key, size_t from = 0) -> double {
    std::string k = std::string("\"") + key + "\":"; size_t p = doc.find(k, from); if (p == std::string::npos) return NAN; return em_parse_double(doc.c_str() + p + k.size(), nullptr);
  };
  r.iterations = (long long)field(it, "iterations"); r.deals = (long long)field(it, "trainingDeals"); r.limit = it.find("\"limitReached\":true") != std::string::npos;
  const char *q = "{\"method\":\"exact\",\"policy\":\"average\",\"device\":\"cpu\",\"threads\":1,\"timeLimitMs\":3600000,\"maxVisits\":2000000000,\"memoryMiB\":2048}";
  JB out; jb_init(&out); volatile int cancel = 0; const auto g0 = Clock::now();
  const int status = mw_response_gain(m, q, std::strlen(q), &out, err, sizeof err, &cancel);
  r.gainSeconds = std::chrono::duration<double>(Clock::now() - g0).count();
  if (status != 200) { r.error = std::string("gain: ") + err; jb_free(&out); mw_free(m); return r; }
  std::string doc(out.s, out.n); jb_free(&out); mw_free(m);
  size_t seats = doc.find("\"seats\":["); if (seats == std::string::npos) { r.error = "gain: no seats"; return r; }
  double sum = 0; int n = 0; size_t p = seats;
  for (;;) {
    size_t b = doc.find("\"bestResponseValue\":", p); if (b == std::string::npos) break;
    size_t open = doc.rfind('{', b), close = doc.find('}', b); size_t v = doc.find("\"policyValue\":", open);
    if (v == std::string::npos || v > close) { r.error = "gain: seat without policyValue"; return r; }
    sum += em_parse_double(doc.c_str() + b + 20, nullptr) - em_parse_double(doc.c_str() + v + 14, nullptr); n++; p = b + 20;
  }
  if (!n || !std::isfinite(sum)) { r.error = "gain: no values"; return r; }
  r.nashConv = sum; r.ok = true; return r;
}
static std::string hex(double v) { unsigned long long u; std::memcpy(&u, &v, 8); char b[20]; std::snprintf(b, sizeof b, "%016llx", u); return b; }
static std::string row(const std::string &game, int seed, const char *arm, const char *kind, double budget, const Run &r) {
  char b[900];
  if (!r.ok) std::snprintf(b, sizeof b, "{\"game\":\"%s\",\"seed\":%d,\"arm\":\"%s\",\"kind\":\"%s\",\"budget\":%g,\"error\":\"%s\"}", game.c_str(), seed, arm, kind, budget, r.error.c_str());
  else std::snprintf(b, sizeof b, "{\"game\":\"%s\",\"seed\":%d,\"arm\":\"%s\",\"kind\":\"%s\",\"budget\":%g,\"nashConv\":%.17g,\"bits\":\"%s\",\"trainSeconds\":%.4f,\"iterations\":%lld,\"deals\":%lld,\"limitReached\":%s,\"gainSeconds\":%.3f}",
                     game.c_str(), seed, arm, kind, budget, r.nashConv, hex(r.nashConv).c_str(), r.seconds, r.iterations, r.deals, r.limit ? "true" : "false", r.gainSeconds);
  return b;
}
static int unit(const std::string &dir, const std::string &game, int seed, int cpu, const std::string &out, bool quick) {
  bindCpu(cpu); Config c = config(quick);
  std::string spec = slurp(dir + "/eqtime-specs/" + game + "-" + std::to_string(seed) + ".json");
  if (spec.empty()) { std::fprintf(stderr, "no spec for %s seed %d\n", game.c_str(), seed); return 2; }
  std::string rows; const bool rbesFirst = seed % 2 == 1;
  if (seed == c.seeds[0]) for (int a = 0; a < 2; a++) rows += row(game, seed, a ? "rbes" : "default", "deals", (double)c.checkDeals, runOne(spec, a, 0, c.checkDeals)) + "\n";
  for (double t : c.times) for (int k = 0; k < 2; k++) { const bool rbes = (k == 0) == rbesFirst; rows += row(game, seed, rbes ? "rbes" : "default", "time", t, runOne(spec, rbes, t, 0)) + "\n"; }
  std::string f = out + "/units/" + game + "-" + std::to_string(seed) + ".jsonl", tmp = f + ".tmp";
  { std::ofstream o(tmp, std::ios::binary); o << rows; if (!o.good()) return 3; }
  std::remove(f.c_str()); return std::rename(tmp.c_str(), f.c_str()) ? 3 : 0;
}
// ---- statistics ----
static double betacf(double a, double b, double x) {
  double qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap; d = 1 / (std::fabs(d) > 1e-300 ? d : 1e-300); double h = d;
  for (int m = 1; m < 400; m++) {
    int m2 = 2 * m; double aa = m * (b - m) * x / ((qam + m2) * (a + m2)); d = 1 + aa * d; d = 1 / (std::fabs(d) > 1e-300 ? d : 1e-300); c = 1 + aa / c; if (std::fabs(c) < 1e-300) c = 1e-300; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2)); d = 1 + aa * d; d = 1 / (std::fabs(d) > 1e-300 ? d : 1e-300); c = 1 + aa / c; if (std::fabs(c) < 1e-300) c = 1e-300; double de = d * c; h *= de;
    if (std::fabs(de - 1) < 1e-15) break;
  }
  return h;
}
static double tCdf(double t, double df) {
  double x = df / (df + t * t), a = df / 2, b = 0.5;
  double bt = x > 0 && x < 1 ? std::exp(std::lgamma(a + b) - std::lgamma(a) - std::lgamma(b) + a * std::log(x) + b * std::log(1 - x)) : 0;
  double ib = x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
  return t >= 0 ? 1 - ib / 2 : ib / 2;
}
static double tQuantile(double p, double df) { double lo = 0, hi = 1000; for (int i = 0; i < 200; i++) { double mid = (lo + hi) / 2; (tCdf(mid, df) < p ? lo : hi) = mid; } return (lo + hi) / 2; }
struct Cell { double nc = NAN; long long deals = 0; double seconds = 0; bool limit = false, ok = false; std::string bits; };
struct Contrast { int n = 0; double ratio = NAN, lo = NAN, hi = NAN; std::string verdict = "no data"; int lower = 0, higher = 0; double medDefault = NAN, medRbes = NAN, dealRatio = NAN; };
static double median(std::vector<double> v) { if (v.empty()) return NAN; std::sort(v.begin(), v.end()); size_t n = v.size(); return n % 2 ? v[n / 2] : (v[n / 2 - 1] + v[n / 2]) / 2; }
static double numberAt(const std::string &l, const char *key) { std::string k = std::string("\"") + key + "\":"; size_t p = l.find(k); return p == std::string::npos ? NAN : em_parse_double(l.c_str() + p + k.size(), nullptr); }
static std::string stringAt(const std::string &l, const char *key) { std::string k = std::string("\"") + key + "\":\""; size_t p = l.find(k); if (p == std::string::npos) return ""; size_t e = l.find('"', p + k.size()); return l.substr(p + k.size(), e - p - k.size()); }
static int analyze(const std::string &dir, const std::string &out, bool quick) {
  Config c = config(quick); std::map<std::string, Cell> cells; int rowsN = 0, errors = 0; std::string raw, errorText;
  for (auto &g : c.games) for (int s : c.seeds) {
    std::ifstream f(out + "/units/" + g + "-" + std::to_string(s) + ".jsonl"); std::string l;
    while (std::getline(f, l)) { if (l.size() < 5) continue; raw += l + "\n"; rowsN++;
      std::string key = g + "|" + std::to_string(s) + "|" + stringAt(l, "arm") + "|" + stringAt(l, "kind") + "|" + std::to_string(numberAt(l, "budget"));
      Cell x; if (l.find("\"error\"") != std::string::npos) { errors++; if (errorText.size() < 1500) errorText += l + "\n"; }
      else { x.ok = true; x.nc = numberAt(l, "nashConv"); x.deals = (long long)numberAt(l, "deals"); x.seconds = numberAt(l, "trainSeconds"); x.limit = l.find("\"limitReached\":true") != std::string::npos; x.bits = stringAt(l, "bits"); }
      cells[key] = x; }
  }
  { std::ofstream o(out + "/raw.jsonl", std::ios::binary); o << raw; }
  auto cell = [&](const std::string &g, int s, const char *arm, const char *kind, double b) -> const Cell * { auto it = cells.find(g + "|" + std::to_string(s) + "|" + arm + "|" + kind + "|" + std::to_string(b)); return it == cells.end() || !it->second.ok ? nullptr : &it->second; };
  // P1: equal-deals check against the values recorded from the Linux build
  std::string ref = slurp(dir + (quick ? "/eqtime-specs/reference-quick.txt" : "/eqtime-specs/reference.txt")); int checked = 0, same = 0; std::string differing;
  for (auto &g : c.games) for (const char *arm : {"default", "rbes"}) {
    const Cell *x = cell(g, c.seeds[0], arm, "deals", (double)c.checkDeals); std::string key = g + " " + arm + " "; size_t p = ref.find(key);
    if (p == std::string::npos) continue; checked++; std::string want = ref.substr(p + key.size(), 16);
    if (x && x->bits == want) same++; else differing += g + "/" + arm + " ";
  }
  const bool p1 = checked == (int)c.games.size() * 2 && same == checked;
  const double levelP = 0.05 / c.games.size(), levelS = 0.05 / (c.games.size() * c.times.size()); const double primary = quick ? c.times.back() : 4.0;
  auto contrast = [&](const std::string &g, double b, double level) {
    Contrast r; std::vector<double> d, nd, nr, dr;
    for (int s : c.seeds) { const Cell *x = cell(g, s, "rbes", "time", b), *y = cell(g, s, "default", "time", b); if (!x || !y) continue;
      d.push_back(std::log(std::max(x->nc, 1e-12) / std::max(y->nc, 1e-12))); nd.push_back(y->nc); nr.push_back(x->nc); if (y->deals > 0) dr.push_back((double)x->deals / y->deals); }
    r.n = (int)d.size(); if (r.n < 3) return r;
    double mean = 0; for (double v : d) mean += v; mean /= r.n; double ss = 0; for (double v : d) ss += (v - mean) * (v - mean); double sd = std::sqrt(ss / (r.n - 1)), se = sd / std::sqrt((double)r.n);
    double q = sd > 0 ? tQuantile(1 - level / 2, r.n - 1) : 0, lo = mean - q * se, hi = mean + q * se;
    r.ratio = std::exp(mean); r.lo = std::exp(lo); r.hi = std::exp(hi); r.verdict = sd == 0 && mean == 0 ? "identical" : hi < 0 ? "better" : lo > 0 ? "worse" : "unresolved";
    for (double v : d) { r.lower += v < 0; r.higher += v > 0; } r.medDefault = median(nd); r.medRbes = median(nr); r.dealRatio = median(dr); return r;
  };
  std::string js = "{\"tool\":\"eqtime513\",\"engineBuild\":\"" + std::string(ENGINE_BUILD) + "\",\"quick\":" + (quick ? "true" : "false") + ",\"rows\":" + std::to_string(rowsN) + ",\"errors\":" + std::to_string(errors);
  js += ",\"equalDealsCheck\":{\"compared\":" + std::to_string(checked) + ",\"identical\":" + std::to_string(same) + ",\"passed\":" + (p1 ? "true" : "false") + ",\"differing\":\"" + differing + "\"},\"contrasts\":[";
  std::string txt; char b[700];
  std::snprintf(b, sizeof b, "EightMax 5.13: rbes against the default trainer at equal training time%s\nEngine build %s. Processor: %s (%u logical).\nRows %d, errors %d.\nP1 equal-deals check (the program is the program that was validated): %d of %d values identical to the Linux build: %s\n\n",
                quick ? "  [QUICK TRIAL - NOT A RESULT]" : "", ENGINE_BUILD, cpuName().c_str(), std::thread::hardware_concurrency(), rowsN, errors, same, checked, p1 ? "PASSED" : "FAILED");
  txt += b; if (!differing.empty()) txt += "  differing: " + differing + "\n";
  if (!errorText.empty()) txt += "First error rows:\n" + errorText + "\n";
  std::snprintf(b, sizeof b, "Ratio = geometric mean over seeds of NashConv(rbes) / NashConv(default); below 1 favours rbes.\nPrimary family: %g s, level 0.05/%d per game. Secondary: every budget, level 0.05/%d.\n\n%-14s %-10s %6s %5s %8s %19s %-10s %-10s %9s %11s %11s\n",
                primary, (int)c.games.size(), (int)(c.games.size() * c.times.size()), "game", "class", "budget", "seeds", "ratio", "primary interval", "primary", "secondary", "deals r/d", "NC default", "NC rbes");
  txt += b; bool first = true;
  struct Tally { int games = 0, better = 0, worseP = 0, worseS = 0, unresolved = 0, minSeeds = 1000; }; std::map<std::string, Tally> tally; int limitR = 0, limitD = 0; std::string worseList;
  for (auto &g : c.games) {
    const char *cls = INSET(FEW, g) ? "few hands" : INSET(RANGES, g) ? "ranges" : "tournament"; const bool wide = INSET(WIDE, g);
    for (double t : c.times) {
      Contrast s = contrast(g, t, levelS), p = t == primary ? contrast(g, t, levelP) : Contrast();
      for (int sd : c.seeds) { const Cell *x = cell(g, sd, "rbes", "time", t), *y = cell(g, sd, "default", "time", t); if (x && x->limit && !(y && y->limit)) limitR++; if (y && y->limit && !(x && x->limit)) limitD++; }
      for (const char *k : {cls, wide ? "WIDE" : ""}) { if (!*k) continue; Tally &T = tally[k];
        if (t == primary) { T.games++; T.better += p.verdict == "better"; T.worseP += p.verdict == "worse"; T.unresolved += p.verdict == "unresolved"; T.minSeeds = std::min(T.minSeeds, p.n); }
        T.worseS += s.verdict == "worse"; }
      if (wide && (s.verdict == "worse" || p.verdict == "worse")) worseList += g + "@" + std::to_string((int)t) + "s ";
      char iv[40] = "-"; if (t == primary) std::snprintf(iv, sizeof iv, "[%.3f, %.3f]", p.lo, p.hi);
      std::snprintf(b, sizeof b, "%-14s %-10s %5gs %5d %8.3f %19s %-10s %-10s %9.3f %11.3g %11.3g\n", g.c_str(), wide ? "WIDE" : cls, t, s.n, s.ratio, iv, t == primary ? p.verdict.c_str() : "", s.verdict.c_str(), s.dealRatio, s.medDefault, s.medRbes); txt += b;
      std::snprintf(b, sizeof b, "%s{\"game\":\"%s\",\"class\":\"%s\",\"wide\":%s,\"budget\":%g,\"seeds\":%d,\"ratio\":%.6g,\"secondary\":{\"interval\":[%.6g,%.6g],\"verdict\":\"%s\"},\"lowerInSeeds\":%d,\"higherInSeeds\":%d,\"medianNashConvDefault\":%.6g,\"medianNashConvRbes\":%.6g,\"medianDealsRatio\":%.4g",
                    first ? "" : ",", g.c_str(), cls, wide ? "true" : "false", t, s.n, s.ratio, s.lo, s.hi, s.verdict.c_str(), s.lower, s.higher, s.medDefault, s.medRbes, s.dealRatio); js += b; first = false;
      if (t == primary) { std::snprintf(b, sizeof b, ",\"primary\":{\"interval\":[%.6g,%.6g],\"verdict\":\"%s\"}", p.lo, p.hi, p.verdict.c_str()); js += b; }
      js += "}";
    }
  }
  js += "],\"classes\":{"; txt += "\n"; first = true;
  for (auto &kv : tally) { const Tally &T = kv.second; const bool rec = 2 * T.better >= T.games && T.worseS == 0;
    std::snprintf(b, sizeof b, "%-10s: %d games; primary better %d, unresolved %d, worse %d; secondary worse %d; fewest valid seeds %d%s\n", kv.first.c_str(), T.games, T.better, T.unresolved, T.worseP, T.worseS, T.minSeeds, kv.first == "WIDE" ? "" : rec ? "; recommended by the 5.10 rule (information)" : "; not recommended by the 5.10 rule (information)"); txt += b;
    std::snprintf(b, sizeof b, "%s\"%s\":{\"games\":%d,\"primaryBetter\":%d,\"primaryUnresolved\":%d,\"primaryWorse\":%d,\"secondaryWorse\":%d,\"fewestValidSeeds\":%d}", first ? "" : ",", kv.first.c_str(), T.games, T.better, T.unresolved, T.worseP, T.worseS, T.minSeeds); js += b; first = false; }
  const Tally W = tally["WIDE"]; const int need = quick ? 1 : 4, needSeeds = quick ? 3 : 18; std::string decision;
  const bool p2 = W.games > 0 && W.minSeeds >= needSeeds;
  if (quick) decision = "QUICK TRIAL: no decision. This run only shows that the tool works on this PC.";
  else if (!p1) decision = "P1 FAILED: the equal-deals check did not reproduce the Linux values. Nothing is decided.";
  else if (!p2) decision = "P2 FAILED: fewer than 18 valid seeds in a WIDE game. Incomplete; nothing is decided.";
  else if (W.worseP + W.worseS > 0) decision = "P4: rbes is WORSE in at least one interval of a WIDE game (" + worseList + "). rbes stays opt-in.";
  else if (limitR > 0) decision = "P3 not met: rbes reached the table limit in " + std::to_string(limitR) + " run(s) in which the default did not. rbes stays opt-in.";
  else if (W.better >= need) decision = "P3 MET: rbes is better in the primary family on " + std::to_string(W.better) + " of " + std::to_string(W.games) + " WIDE games and worse in no interval. By the rule, rbes becomes the trainer that studies choose automatically for games in which a seat holds at least 10 hands.";
  else decision = "P4: unresolved (better on " + std::to_string(W.better) + " of " + std::to_string(W.games) + " WIDE games, " + std::to_string(need) + " needed; worse nowhere). rbes stays opt-in.";
  txt += "\nDECISION BY THE RULE OF THE PLAN: " + decision + "\n\nNo percentage of GTO follows from any of this. The games are small reference games with exact evaluation.\n";
  js += "},\"tableLimit\":{\"rbesOnly\":" + std::to_string(limitR) + ",\"defaultOnly\":" + std::to_string(limitD) + "},\"decision\":\"" + decision + "\",\"processor\":\"" + cpuName() + "\",\"logicalProcessors\":" + std::to_string(std::thread::hardware_concurrency()) + "}\n";
  { std::ofstream o(out + "/summary.json", std::ios::binary); o << js; } { std::ofstream o(out + "/summary.txt", std::ios::binary); o << txt; }
  std::printf("\n%s", txt.c_str()); return 0;
}
int main(int argc, char **argv) {
  std::string dir = exeDir(argv[0]);
  if (argc == 7 && !std::strcmp(argv[1], "--unit")) return unit(dir, argv[2], std::atoi(argv[3]), std::atoi(argv[4]), argv[5], std::atoi(argv[6]) != 0);
  if (argc >= 3 && !std::strcmp(argv[1], "analyze")) return analyze(dir, argv[2], exists(std::string(argv[2]) + "/QUICK"));
  if (argc >= 3 && !std::strcmp(argv[1], "reference")) {   // development: the values of the equal-deals check
    for (int quick = 0; quick < 2; quick++) { Config c = config(quick); std::string t;
      for (auto &g : c.games) { std::string spec = slurp(dir + "/eqtime-specs/" + g + "-" + std::to_string(c.seeds[0]) + ".json");
        for (int a = 0; a < 2; a++) { Run r = runOne(spec, a, 0, c.checkDeals); if (!r.ok) { std::fprintf(stderr, "%s: %s\n", g.c_str(), r.error.c_str()); return 1; } t += g + " " + (a ? "rbes" : "default") + " " + hex(r.nashConv) + " " + std::to_string(r.nashConv) + "\n"; } }
      std::ofstream o(std::string(argv[2]) + (quick ? "/reference-quick.txt" : "/reference.txt"), std::ios::binary); o << t; }
    return 0;
  }
  if (argc < 2 || std::strcmp(argv[1], "run")) { std::fprintf(stderr, "usage: eqtime513 run [--quick] [--jobs N] [--out DIR]\n"); return 2; }
  bool quick = false; int jobs = 0; std::string out;
  for (int i = 2; i < argc; i++) { if (!std::strcmp(argv[i], "--quick")) quick = true; else if (!std::strcmp(argv[i], "--jobs") && i + 1 < argc) jobs = std::atoi(argv[++i]); else if (!std::strcmp(argv[i], "--out") && i + 1 < argc) out = argv[++i]; else { std::fprintf(stderr, "unknown argument %s\n", argv[i]); return 2; } }
  if (out.empty()) out = dir + (quick ? "/rbes-equal-time-quick" : "/rbes-equal-time-results");
  const unsigned logical = std::max(1u, std::thread::hardware_concurrency());
  // at most six units at a time and never more than a quarter of the logical processors, each on its own even-numbered processor: the PC stays usable
  if (jobs <= 0) jobs = (int)std::max(1u, std::min(6u, logical / 4)); if (jobs > 16) jobs = 16;
  Config c = config(quick); makeDir(out); makeDir(out + "/units");
  std::string plan = std::string("{\"tool\":\"eqtime513\",\"engineBuild\":\"") + ENGINE_BUILD + "\",\"quick\":" + (quick ? "true" : "false") + ",\"plan\":\"" + PLAN_TEXT + "\"}\n";
  if (exists(out + "/plan.json")) { if (slurp(out + "/plan.json") != plan) { std::fprintf(stderr, "%s holds another plan: not continued. Choose another --out.\n", out.c_str()); return 1; } }
  else { std::ofstream o(out + "/plan.json", std::ios::binary); o << plan; }
  if (quick) { std::ofstream o(out + "/QUICK"); o << "quick trial\n"; }
  struct U { std::string g; int s; }; std::vector<U> todo; int have = 0;
  for (int s : c.seeds) for (auto &g : c.games) { if (exists(out + "/units/" + g + "-" + std::to_string(s) + ".jsonl")) have++; else todo.push_back({g, s}); }
  double perUnit = 0; for (double t : c.times) perUnit += 2 * t;
  std::printf("EightMax 5.13 rbes equal-time comparison%s\nProcessor: %s, %u logical processors; %d unit(s) at a time.\n%d units done earlier, %d to run; about %.0f minutes of training plus the exact evaluations (which take about as long again).\nResults: %s\n\n",
              quick ? " (QUICK TRIAL)" : "", cpuName().c_str(), logical, jobs, have, (int)todo.size(), todo.size() * perUnit / jobs / 60.0, out.c_str()); std::fflush(stdout);
  { std::ofstream o(out + "/machine.txt", std::ios::app); o << "processor: " << cpuName() << "; logical processors: " << logical << "; jobs: " << jobs << "; units to run: " << todo.size() << "\n"; }
  std::atomic<size_t> next{0}; std::atomic<int> done{0}, failed{0}; std::mutex io; const auto t0 = Clock::now(); std::string exe = exePath(argv[0]);
  std::vector<std::thread> pool;
  for (int j = 0; j < jobs; j++) pool.emplace_back([&, j] {
    for (;;) { size_t i = next++; if (i >= todo.size()) return;
      const int cpu = jobs == 1 && logical < 4 ? -1 : (2 * j < (int)logical ? 2 * j : j);
      std::string cmd = "\"" + exe + "\" --unit " + todo[i].g + " " + std::to_string(todo[i].s) + " " + std::to_string(cpu) + " \"" + out + "\" " + (quick ? "1" : "0");
#ifdef _WIN32
      cmd = "\"" + cmd + "\"";
#endif
      const int rc = std::system(cmd.c_str()); if (rc) failed++; const int d = ++done;
      std::lock_guard<std::mutex> l(io); const double el = std::chrono::duration<double>(Clock::now() - t0).count();
      std::printf("  %4d / %d  %-14s seed %d%s   elapsed %.1f min, about %.1f min left\n", d, (int)todo.size(), todo[i].g.c_str(), todo[i].s, rc ? "  FAILED TO RUN" : "", el / 60, el / d * (todo.size() - d) / 60); std::fflush(stdout); }
  });
  for (auto &t : pool) t.join();
  if (failed) std::printf("\n%d unit(s) did not run. Start the launcher again to retry them.\n", failed.load());
  const int rc = analyze(dir, out, quick); return failed ? 1 : rc;
}
