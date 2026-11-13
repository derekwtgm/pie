// EightMax 4.7 independent reference suite driver.
// Build: g++ -std=c++20 -O2 -o refsuite source/reference/refmain.cpp
// usage: refsuite selftest            -> JSON on stdout, exit 1 on any failed check
//        refsuite unbiased [N]        -> statistical unbiasedness tests of sampled estimators
//        refsuite study [seeds] [scale] -> 10-seed convergence comparison (equal iterations / equal time, Holm)
//        refsuite fullwidth           -> deterministic CFR / CFR+ / LCFR / DCFR comparison
#include "refcfr.hpp"
#include <cstdio>
#include <sstream>
#include <iomanip>
using namespace ref;

static std::string num(double x) { if (!std::isfinite(x)) return "null"; std::ostringstream s; s << std::setprecision(10) << x; return s.str(); }
struct Checks {
  int passed = 0, failed = 0; std::ostringstream js; bool first = true;
  void add(const std::string &name, bool ok, const std::string &detail) {
    (ok ? passed : failed)++;
    js << (first ? "" : ",\n") << " {\"check\":\"" << name << "\",\"ok\":" << (ok ? "true" : "false") << ",\"detail\":\"" << detail << "\"}"; first = false;
    std::fprintf(stderr, "%s %s %s\n", ok ? "PASS" : "FAIL", name.c_str(), detail.c_str());
  }
};
static double now() { return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count(); }

static Profile kuhnEquilibrium(const Game &g, double alpha) {
  // Kuhn (1950) family; ranks 0=J,1=Q,2=K; infoset names "player:card:history".
  Profile s = uniform(g);
  auto set = [&](const std::string &k, double pBetOrCall) { auto it = g.setIndex.find(k); if (it == g.setIndex.end()) throw std::logic_error("missing " + k); s[(size_t)it->second] = {1 - pBetOrCall, pBetOrCall}; };
  set("0:0:", alpha); set("0:1:", 0); set("0:2:", 3 * alpha);
  set("0:0:kb", 0); set("0:1:kb", alpha + 1.0 / 3); set("0:2:kb", 1);
  set("1:0:k", 1.0 / 3); set("1:1:k", 0); set("1:2:k", 1);
  set("1:0:b", 0); set("1:1:b", 1.0 / 3); set("1:2:b", 1);
  return s;
}

static int selftest() {
  Checks c;
  Game k2 = kuhn(2), k3 = kuhn(3), le = leduc(), pc = pushfold3(false), pi = pushfold3(true), wr = weightedRiver();
  const Game *all[] = {&k2, &k3, &le, &pc, &pi, &wr};
  for (const Game *g : all) {
    size_t term = 0; double worst = 0;
    for (const Node &x : g->nodes) if (x.type == 2) { term++; double s = 0; for (double u : x.util) s += u; worst = std::max(worst, std::fabs(s - (g->name == "pf3icm" ? 1.0 : 0.0))); }
    c.add(g->name + " utilities conserved at every terminal (chips sum 0 / ICM sum = prize pool)", worst < 1e-12, "nodes " + std::to_string(g->nodes.size()) + " infosets " + std::to_string(g->sets.size()) + " terminals " + std::to_string(term) + " max deviation " + num(worst));
  }
  c.add("kuhn2 has 12 information sets", k2.sets.size() == 12, std::to_string(k2.sets.size()));
  c.add("leduc2 has 288 information sets", le.sets.size() == 288, std::to_string(le.sets.size()));
  for (double alpha : {0.0, 1.0 / 6, 1.0 / 3}) {
    Profile s = kuhnEquilibrium(k2, alpha); Exploit e = evaluate(k2, s);
    c.add("kuhn2 analytic equilibrium alpha=" + num(alpha) + ": value -1/18, NashConv 0", std::fabs(e.value[0] + 1.0 / 18) < 1e-12 && e.nashConv < 1e-12, "value " + num(e.value[0]) + " NashConv " + num(e.nashConv));
  }
  { // perturbing the equilibrium must create a positive gain for the opponent
    Profile s = kuhnEquilibrium(k2, 0); s[(size_t)k2.setIndex.at("1:1:b")] = {0.2, 0.8}; Exploit e = evaluate(k2, s);
    c.add("kuhn2 perturbed equilibrium has a positive best-response gain", e.gain[0] > 1e-3, "gain " + num(e.gain[0]));
  }
  { // random profiles: unilateral gains are non-negative and BR >= value
    bool ok = true; double minGain = 1e9;
    for (const Game *g : all) for (uint64_t sd = 1; sd <= 20; sd++) { Exploit e = evaluate(*g, randomProfile(*g, sd)); for (int p = 0; p < g->n; p++) { minGain = std::min(minGain, e.best[(size_t)p] - e.value[(size_t)p]); ok &= e.best[(size_t)p] >= e.value[(size_t)p] - 1e-12; } }
    c.add("best response >= policy value (120 random profiles, 6 games)", ok, "min (BR - value) " + num(minGain));
  }
  { // side pots: chip conservation and caps on 20,000 random showdowns, 2-6 players
    Rng r(7); bool ok = true; double worst = 0;
    for (int it = 0; it < 20000; it++) {
      const int n = 2 + (int)(r.uniform() * 5); std::vector<double> con((size_t)n); std::vector<bool> live((size_t)n); std::vector<int> st((size_t)n); int nl = 0;
      for (int i = 0; i < n; i++) { con[(size_t)i] = std::floor(r.uniform() * 6) * 0.5; live[(size_t)i] = r.uniform() < 0.7 && con[(size_t)i] > 0; nl += live[(size_t)i]; st[(size_t)i] = (int)(r.uniform() * 4); }
      if (!nl) { live[0] = true; con[0] = std::max(con[0], 0.5); }
      auto got = settle(con, live, st); double a = 0, b = 0; for (int i = 0; i < n; i++) { a += con[(size_t)i]; b += got[(size_t)i]; }
      worst = std::max(worst, std::fabs(a - b));
      for (int i = 0; i < n; i++) { if (!live[(size_t)i] && got[(size_t)i] > 0) ok = false; double cap = 0; for (int j = 0; j < n; j++) cap += std::min(con[(size_t)j], con[(size_t)i]);
        if (got[(size_t)i] > cap + 1e-12) { bool topLive = true; for (int j = 0; j < n; j++) if (live[(size_t)j] && con[(size_t)j] > con[(size_t)i]) topLive = false; if (!topLive) ok = false; } }
    }
    c.add("side pots: chips conserved, folded players win nothing, winnings capped by matched contributions", ok && worst < 1e-12, "20,000 random showdowns, max |paid in - paid out| " + num(worst));
  }
  { // ICM: equal stacks split equally; 3-player closed form; payouts conserved
    auto e = icm({10, 10, 10, 10}, {0.5, 0.3, 0.2, 0}); bool eq = true; for (double x : e) eq &= std::fabs(x - 0.25) < 1e-15;
    c.add("ICM: equal stacks give equal equity", eq, num(e[0]));
    const double s[3] = {50, 30, 20}, P[3] = {50, 30, 20}, T = 100; double cf[3];
    for (int i = 0; i < 3; i++) { double first = s[i] / T, second = 0; for (int j = 0; j < 3; j++) if (j != i) second += s[j] / T * s[i] / (T - s[j]); cf[i] = first * P[0] + second * P[1] + (1 - first - second) * P[2]; }
    auto m = icm({50, 30, 20}, {50, 30, 20}); double d = 0; for (int i = 0; i < 3; i++) d = std::max(d, std::fabs(m[(size_t)i] - cf[i]));
    c.add("ICM: three-player Malmuth-Harville closed form", d < 1e-12, "values " + num(m[0]) + " " + num(m[1]) + " " + num(m[2]) + " max diff " + num(d));
    Rng r(9); double worst = 0;
    for (int it = 0; it < 2000; it++) { const int n = 2 + (int)(r.uniform() * 5); std::vector<double> ch((size_t)n), st((size_t)n); for (int i = 0; i < n; i++) { st[(size_t)i] = 1 + r.uniform() * 20; ch[(size_t)i] = r.uniform() < 0.3 ? 0 : 1 + r.uniform() * 30; } if (ch[0] == 0) ch[0] = 1;
      std::vector<double> pay = {0.5, 0.3, 0.2}; auto v = icmWithBusts(ch, st, pay); double sum = 0; for (double x : v) sum += x; double pool = 0; for (size_t i = 0; i < pay.size() && i < (size_t)n; i++) pool += pay[i]; worst = std::max(worst, std::fabs(sum - pool)); }
    c.add("ICM with busted players: prize pool conserved (2,000 random tables)", worst < 1e-12, "max deviation " + num(worst));
  }
  { // exact counterfactual regrets equal a finite-difference definition on kuhn3
    Profile s = randomProfile(k3, 3), R, A; exactIncrements(k3, s, 1, R, A);
    auto base = values(k3, s); double worst = 0;
    // sum_a sigma(a) R(I,a) = 0 for every infoset (regret of the policy against itself)
    for (size_t I = 0; I < k3.sets.size(); I++) if (k3.sets[I].player == 1) { double z = 0; for (int a = 0; a < k3.sets[I].k; a++) z += s[I][(size_t)a] * R[I][(size_t)a]; worst = std::max(worst, std::fabs(z)); }
    c.add("exact counterfactual regrets: sum_a sigma(a) R(I,a) = 0 (kuhn3)", worst < 1e-12, "max " + num(worst));
    (void)base;
  }
  // ---- full-width CFR family convergence on known games
  auto run = [&](const Game &g, Options o, int iters) { Solver sv(g, o); for (int i = 0; i < iters; i++) sv.iterate(); return evaluate(g, sv.average()); };
  { Options o; Exploit e = run(k2, o, 4000); c.add("vanilla CFR, kuhn2, 4,000 iterations: value -1/18 +- 0.002, NashConv < 0.005", std::fabs(e.value[0] + 1.0 / 18) < 0.002 && e.nashConv < 0.005, "value " + num(e.value[0]) + " NashConv " + num(e.nashConv)); }
  { Options o; o.plus = true; Exploit e = run(le, o, 1000); c.add("CFR+, leduc2, 1,000 iterations: value -0.0856 +- 0.002, NashConv < 0.01", std::fabs(e.value[0] + 0.0856) < 0.002 && e.nashConv < 0.01, "value " + num(e.value[0]) + " NashConv " + num(e.nashConv)); }
  { Options o; o.dcfr = true; Exploit e = run(le, o, 1000); c.add("DCFR(1.5,0,2), leduc2, 1,000 iterations: NashConv < 0.01", e.nashConv < 0.01, "value " + num(e.value[0]) + " NashConv " + num(e.nashConv)); }
  { Options o; o.linear = true; Exploit e = run(le, o, 1000); c.add("linear CFR, leduc2, 1,000 iterations: NashConv < 0.02", e.nashConv < 0.02, "NashConv " + num(e.nashConv)); }
  { Options o; Exploit a = run(k3, o, 100), b = run(k3, o, 3000); c.add("vanilla CFR, kuhn3 (3 players): NashConv decreases 100 -> 3,000 iterations and is < 0.01", b.nashConv < a.nashConv && b.nashConv < 0.01, num(a.nashConv) + " -> " + num(b.nashConv)); }
  { Options o; o.plus = true; Exploit a = run(pi, o, 50), b = run(pi, o, 2000); c.add("CFR+, pf3icm (3 players, ICM): NashConv decreases and is < 1e-3 at 2,000 iterations", b.nashConv < a.nashConv && b.nashConv < 1e-3, num(a.nashConv) + " -> " + num(b.nashConv)); }
  { Options o; o.plus = true; Exploit b = run(wr, o, 2000); c.add("CFR+, wr2 (weighted ranges, card removal): NashConv < 1e-3", b.nashConv < 1e-3, num(b.nashConv)); }
  { Options o; o.algo = "es"; o.linear = true; o.seed = 5; Exploit a = run(le, o, 2000), b = run(le, o, 100000); c.add("ES-MCCFR (engine estimator), leduc2: NashConv decreases 2k -> 100k iterations, value near -0.0856", b.nashConv < a.nashConv && std::fabs(b.value[0] + 0.0856) < 0.02, num(a.nashConv) + " -> " + num(b.nashConv) + " value " + num(b.value[0])); }
  { Options o; o.algo = "es"; o.linear = true; o.enumerateOwnChance = true; o.seed = 5; Exploit a = run(le, o, 2000), b = run(le, o, 50000); c.add("ES-MCCFR own-chance enumeration, leduc2: NashConv decreases 2k -> 50k iterations, value near -0.0856", b.nashConv < a.nashConv && std::fabs(b.value[0] + 0.0856) < 0.02, num(a.nashConv) + " -> " + num(b.nashConv) + " value " + num(b.value[0])); }
  { // determinism: same seed -> identical tables
    Options o; o.algo = "es"; o.linear = true; o.seed = 11; Solver a(k3, o), b(k3, o); for (int i = 0; i < 3000; i++) { a.iterate(); b.iterate(); }
    c.add("ES-MCCFR is a deterministic function of its seed", a.reg == b.reg && a.avg == b.avg, "kuhn3, 3,000 iterations");
  }
  std::printf("{\"suite\":\"reference-selftest\",\"passed\":%d,\"failed\":%d,\"checks\":[\n%s\n]}\n", c.passed, c.failed, c.js.str().c_str());
  return c.failed ? 1 : 0;
}

// ---------------------------------------------------------------- unbiasedness
static int unbiased(long long N) {
  std::vector<Game> games = {kuhn(2), kuhn(3), leduc(), pushfold3(true), weightedRiver()};
  struct V { std::string name; Options o; };
  std::vector<V> vars;
  { Options o; o.algo = "es"; vars.push_back({"es-eps0.1", o}); }
  { Options o; o.algo = "es"; o.explore = 0.0; vars.push_back({"es-on-policy", o}); }
  { Options o; o.algo = "es"; o.terminalBaseline = true; vars.push_back({"es-terminal-baseline", o}); }
  { Options o; o.algo = "es"; o.enumerateOwnChance = true; vars.push_back({"es-own-chance-enumeration", o}); }
  { Options o; o.algo = "es"; o.enumerateOwnChance = true; o.terminalBaseline = true; vars.push_back({"es-own-enumeration+baseline", o}); }
  int failed = 0; bool first = true;
  std::printf("{\"suite\":\"reference-unbiasedness\",\"samplesPerPlayer\":%lld,\"familywiseAlpha\":0.001,\"method\":\"For a fixed random profile, the mean of N independent sampled increments of every (infoset, action) regret and average-strategy component is compared with the exact expectation (z = (mean - exact) / (sd / sqrt N)); Bonferroni over all components of the game and estimator. varianceRatio = total variance of the regret increments relative to es-eps0.1 (lower = less noise per traversal).\",\"results\":[\n", N);
  for (const Game &g : games) {
    Profile s = randomProfile(g, 42); double baseVar = 0;
    for (const V &v : vars) {
      double maxZ = 0, totalVar = 0; int comps = 0; double secs = 0;
      std::vector<double> sum, sq;
      for (int p = 0; p < g.n; p++) {
        Profile R, A; exactIncrements(g, s, p, R, A);
        Solver sv(g, v.o); sv.o.seed = 1000 + (uint64_t)p; sv.rng = Rng(sv.o.seed);
        // regret matching of reg must reproduce s: set regrets proportional to s
        for (size_t I = 0; I < g.sets.size(); I++) for (int a = 0; a < g.sets[I].k; a++) sv.reg[I][(size_t)a] = s[I][(size_t)a];
        const size_t m = g.sets.size() * 16; sum.assign(2 * m, 0); sq.assign(2 * m, 0); std::vector<double> one(2 * m, 0);
        const double t0 = now();
        for (long long it = 0; it < N; it++) {
          sv.buf.clear(); sv.es(0, p, 1, 1, 1, 1);
          for (const auto &x : sv.buf) for (int a = 0; a < g.sets[(size_t)x.I].k; a++) { one[(size_t)x.I * 16 + (size_t)a] += x.r[a]; one[m + (size_t)x.I * 16 + (size_t)a] += x.a[a]; }
          for (const auto &x : sv.buf) for (int a = 0; a < g.sets[(size_t)x.I].k; a++) for (size_t off : {(size_t)x.I * 16 + (size_t)a, m + (size_t)x.I * 16 + (size_t)a}) if (one[off] != 0) { sum[off] += one[off]; sq[off] += one[off] * one[off]; one[off] = 0; }
        }
        secs += now() - t0;
        for (size_t I = 0; I < g.sets.size(); I++) if (g.sets[I].player == p) for (int a = 0; a < g.sets[I].k; a++) for (int kind = 0; kind < 2; kind++) {
          const size_t off = (kind ? m : 0) + I * 16 + (size_t)a; const double exact = kind ? A[I][(size_t)a] : R[I][(size_t)a];
          const double mean = sum[off] / (double)N, var = std::max(0.0, sq[off] / (double)N - mean * mean) * (double)N / (double)(N - 1);
          if (!kind) totalVar += var;
          comps++;
          const double se = std::sqrt(var / (double)N);
          const double z = se > 0 ? (mean - exact) / se : (std::fabs(mean - exact) < 1e-12 ? 0 : 1e9);
          maxZ = std::max(maxZ, std::fabs(z));
        }
      }
      const double crit = normalQuantile(1 - 0.001 / (2.0 * comps));
      if (v.name == "es-eps0.1") baseVar = totalVar;
      const bool ok = maxZ < crit; failed += !ok;
      std::printf("%s {\"game\":\"%s\",\"estimator\":\"%s\",\"components\":%d,\"maxAbsZ\":%s,\"bonferroniCritical\":%s,\"unbiasedConsistent\":%s,\"totalRegretVariance\":%s,\"varianceRatio\":%s,\"seconds\":%s}", first ? "" : ",\n", g.name.c_str(), v.name.c_str(), comps, num(maxZ).c_str(), num(crit).c_str(), ok ? "true" : "false", num(totalVar).c_str(), num(baseVar > 0 ? totalVar / baseVar : NAN).c_str(), num(secs).c_str());
      first = false;
      std::fprintf(stderr, "%-8s %-28s max|z| %.2f crit %.2f var ratio %.3f %.1fs\n", g.name.c_str(), v.name.c_str(), maxZ, crit, baseVar > 0 ? totalVar / baseVar : NAN, secs);
    }
  }
  std::printf("\n],\"failed\":%d}\n", failed);
  return failed ? 1 : 0;
}

// ---------------------------------------------------------------- convergence study
static int study(int nSeeds, double scale) {
  struct G { Game g; std::vector<long long> cps; };
  std::vector<G> games;
  auto sc = [&](std::vector<long long> v) { for (auto &x : v) x = std::max<long long>(1, (long long)(x * scale)); return v; };
  games.push_back({kuhn(2), sc({1000, 10000, 100000})});
  games.push_back({kuhn(3), sc({1000, 10000, 100000})});
  games.push_back({leduc(), sc({1000, 10000, 100000})});
  games.push_back({pushfold3(true), sc({1000, 10000, 100000})});
  games.push_back({weightedRiver(), sc({1000, 10000, 100000})});
  struct V { std::string name; Options o; };
  std::vector<V> vars;
  auto es = [](auto f) { Options o; o.algo = "es"; o.linear = true; f(o); return o; };
  vars.push_back({"default (linear, eps 0.1)", es([](Options &) {})});
  vars.push_back({"own-chance enumeration", es([](Options &o) { o.enumerateOwnChance = true; })});
  vars.push_back({"terminal baseline", es([](Options &o) { o.terminalBaseline = true; })});
  vars.push_back({"own enumeration + baseline", es([](Options &o) { o.enumerateOwnChance = true; o.terminalBaseline = true; })});
  vars.push_back({"regret matching+", es([](Options &o) { o.plus = true; })});
  vars.push_back({"DCFR(1.5,0,2)", es([](Options &o) { o.linear = false; o.dcfr = true; })});
  vars.push_back({"eps 0.05", es([](Options &o) { o.explore = 0.05; })});
  struct Row { double nc, secs; };
  std::vector<std::string> out; std::vector<double *> pvals; std::vector<std::pair<std::string, double>> allp;
  struct Cmp { std::string game, variant, kind; long long it; double meanDiff, ci, p, holm; int extrap; };
  std::vector<Cmp> cmps;
  std::ostringstream js; js << "{\"suite\":\"reference-convergence-study\",\"seeds\":" << nSeeds << ",\"metric\":\"NashConv of the average strategy (exact, sum of unilateral best-response gains; = 2 x exploitability for the two-player zero-sum games)\",\"games\":[";
  bool fg = true;
  for (auto &G : games) {
    std::vector<std::vector<std::vector<Row>>> res(vars.size(), std::vector<std::vector<Row>>((size_t)nSeeds));
    for (size_t v = 0; v < vars.size(); v++) for (int sd = 0; sd < nSeeds; sd++) {
      Options o = vars[v].o; o.seed = 1000003ULL * (uint64_t)(sd + 1) + 17; Solver s(G.g, o); double secs = 0; long long done = 0;
      for (long long cp : G.cps) { const double t0 = now(); while (done < cp) { s.iterate(); done++; } secs += now() - t0; res[v][(size_t)sd].push_back({evaluate(G.g, s.average()).nashConv, secs}); }
    }
    js << (fg ? "" : ",") << "\n {\"game\":\"" << G.g.name << "\",\"players\":" << G.g.n << ",\"infosets\":" << G.g.sets.size() << ",\"variants\":["; fg = false;
    for (size_t v = 0; v < vars.size(); v++) {
      js << (v ? "," : "") << "\n  {\"name\":\"" << vars[v].name << "\",\"checkpoints\":[";
      for (size_t c = 0; c < G.cps.size(); c++) {
        std::vector<double> x; double t = 0; for (int sd = 0; sd < nSeeds; sd++) { x.push_back(std::log(res[v][(size_t)sd][c].nc)); t += res[v][(size_t)sd][c].secs; }
        double m = 0; for (double y : x) m += y; m /= nSeeds; double sdv = 0; for (double y : x) sdv += (y - m) * (y - m); sdv = std::sqrt(sdv / (nSeeds - 1));
        std::vector<double> raw; for (int sd = 0; sd < nSeeds; sd++) raw.push_back(res[v][(size_t)sd][c].nc); std::sort(raw.begin(), raw.end());
        js << (c ? "," : "") << "{\"iterations\":" << G.cps[c] << ",\"geoMeanNashConv\":" << num(std::exp(m)) << ",\"logCi95\":" << num(tCritical(nSeeds - 1) * sdv / std::sqrt(nSeeds)) << ",\"medianNashConv\":" << num(nSeeds % 2 ? raw[(size_t)nSeeds / 2] : 0.5 * (raw[(size_t)nSeeds / 2 - 1] + raw[(size_t)nSeeds / 2])) << ",\"meanSeconds\":" << num(t / nSeeds) << "}";
        std::fprintf(stderr, "%-7s %-28s it %-8lld NashConv %.3e  %.3fs\n", G.g.name.c_str(), vars[v].name.c_str(), G.cps[c], std::exp(m), t / nSeeds);
      }
      js << "]}";
    }
    js << "]}";
    // paired comparisons with the default: equal iterations and equal time (log NashConv)
    for (size_t v = 1; v < vars.size(); v++) for (size_t c = 0; c < G.cps.size(); c++) {
      for (int kind = 0; kind < 2; kind++) {
        std::vector<double> d; int ex = 0;
        for (int sd = 0; sd < nSeeds; sd++) {
          const double base = std::log(res[0][(size_t)sd][c].nc);
          double val;
          if (!kind) val = std::log(res[v][(size_t)sd][c].nc);
          else {   // variant's log NashConv at the default's elapsed time (piecewise linear in log time)
            const double T = std::log(res[0][(size_t)sd][c].secs); const auto &r = res[v][(size_t)sd];
            std::vector<std::pair<double, double>> pts; for (auto &q : r) pts.push_back({std::log(q.secs), std::log(q.nc)});
            if (T <= pts[0].first) { val = pts[0].second; ex += T < pts[0].first; }
            else if (T >= pts.back().first) { val = pts.back().second; ex += T > pts.back().first; }
            else { size_t i = 1; while (pts[i].first < T) i++; const double f = (T - pts[i - 1].first) / (pts[i].first - pts[i - 1].first); val = pts[i - 1].second + f * (pts[i].second - pts[i - 1].second); }
          }
          d.push_back(val - base);
        }
        double m = 0; for (double y : d) m += y; m /= nSeeds; double s2 = 0; for (double y : d) s2 += (y - m) * (y - m); const double sd = std::sqrt(s2 / (nSeeds - 1)), se = sd / std::sqrt(nSeeds);
        const double t = se > 0 ? m / se : (m == 0 ? 0 : INFINITY);
        cmps.push_back({G.g.name, vars[v].name, kind ? "equal time" : "equal iterations", G.cps[c], m, tCritical(nSeeds - 1) * se, tPValue(t, nSeeds - 1), 1, ex});
      }
    }
  }
  // Holm over every comparison
  std::vector<size_t> ord(cmps.size()); for (size_t i = 0; i < ord.size(); i++) ord[i] = i;
  std::sort(ord.begin(), ord.end(), [&](size_t a, size_t b) { return cmps[a].p < cmps[b].p; });
  double run = 0; for (size_t r = 0; r < ord.size(); r++) { run = std::max(run, std::min(1.0, (double)(ord.size() - r) * cmps[ord[r]].p)); cmps[ord[r]].holm = run; }
  js << "],\"comparisons\":[";
  std::map<std::string, std::array<int, 3>> tally;
  for (size_t i = 0; i < cmps.size(); i++) {
    const auto &c = cmps[i]; const std::string verdict = c.holm < 0.05 ? (c.meanDiff < 0 ? "variant better" : "variant worse") : "no supported difference";
    auto &t = tally[c.variant + " | " + c.kind]; t[c.holm < 0.05 ? (c.meanDiff < 0 ? 0 : 1) : 2]++;
    js << (i ? "," : "") << "\n {\"game\":\"" << c.game << "\",\"variant\":\"" << c.variant << "\",\"comparison\":\"" << c.kind << "\",\"iterations\":" << c.it << ",\"meanLogRatio\":" << num(c.meanDiff) << ",\"ci95\":" << num(c.ci) << ",\"p\":" << num(c.p) << ",\"holmP\":" << num(c.holm) << ",\"extrapolatedSeeds\":" << c.extrap << ",\"verdict\":\"" << verdict << "\"}";
  }
  js << "],\"tally\":{";
  bool ft = true; for (auto &[k, t] : tally) { js << (ft ? "" : ",") << "\n \"" << k << "\":{\"better\":" << t[0] << ",\"worse\":" << t[1] << ",\"noSupportedDifference\":" << t[2] << "}"; ft = false; std::fprintf(stderr, "%-50s better %d worse %d n.s. %d\n", k.c_str(), t[0], t[1], t[2]); }
  js << "},\"multipleComparison\":\"Holm over " << cmps.size() << " paired t-tests on log NashConv (family-wise 5%)\"}\n";
  std::fputs(js.str().c_str(), stdout);
  return 0;
}

static int fullwidth() {
  std::vector<Game> games = {kuhn(2), kuhn(3), leduc(), pushfold3(true), pushfold3(false), weightedRiver()};
  struct V { std::string name; Options o; };
  std::vector<V> vars;
  { Options o; vars.push_back({"CFR", o}); }
  { Options o; o.plus = true; vars.push_back({"CFR+ (delay 0)", o}); }
  { Options o; o.plus = true; o.averageDelay = 50; vars.push_back({"CFR+ (delay 50)", o}); }
  { Options o; o.linear = true; vars.push_back({"LCFR", o}); }
  { Options o; o.dcfr = true; vars.push_back({"DCFR(1.5,0,2)", o}); }
  { Options o; o.dcfr = true; o.alpha = 1; o.beta = 1; o.gamma = 2; vars.push_back({"DCFR(1,1,2)", o}); }
  std::printf("{\"suite\":\"reference-fullwidth\",\"metric\":\"exact NashConv of the average strategy\",\"results\":[");
  bool first = true;
  for (auto &g : games) for (auto &v : vars) {
    Solver s(g, v.o); std::printf("%s\n {\"game\":\"%s\",\"algorithm\":\"%s\",\"curve\":[", first ? "" : ",", g.name.c_str(), v.name.c_str()); first = false;
    long long done = 0; bool f2 = true; double secs = 0;
    for (long long cp : {10LL, 100LL, 1000LL, 3000LL}) { const double t0 = now(); while (done < cp) { s.iterate(); done++; } secs += now() - t0; Exploit e = evaluate(g, s.average());
      std::printf("%s{\"iterations\":%lld,\"nashConv\":%s,\"value0\":%s,\"seconds\":%s}", f2 ? "" : ",", cp, num(e.nashConv).c_str(), num(e.value[0]).c_str(), num(secs).c_str()); f2 = false;
      std::fprintf(stderr, "%-8s %-16s %5lld %.3e\n", g.name.c_str(), v.name.c_str(), cp, e.nashConv); }
    std::printf("]}");
  }
  std::printf("\n]}\n");
  return 0;
}

int main(int argc, char **argv) {
  const std::string cmd = argc > 1 ? argv[1] : "selftest";
  try {
    if (cmd == "selftest") return selftest();
    if (cmd == "unbiased") return unbiased(argc > 2 ? std::atoll(argv[2]) : 200000);
    if (cmd == "study") return study(argc > 2 ? std::atoi(argv[2]) : 10, argc > 3 ? std::atof(argv[3]) : 1.0);
    if (cmd == "fullwidth") return fullwidth();
  } catch (const std::exception &e) { std::fprintf(stderr, "error: %s\n", e.what()); return 2; }
  std::fprintf(stderr, "usage: refsuite selftest | unbiased [N] | study [seeds] [scale] | fullwidth\n"); return 2;
}
