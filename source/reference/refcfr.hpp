// EightMax 4.7 independent reference algorithms (Priority 1 / 2 / 3 / 14).
// Shares no code with the engine. Explicit-tree implementations of:
//   * exact expected values, reach probabilities, exact counterfactual regrets,
//   * exact unilateral best response of every player and NashConv,
//   * full-width CFR family: vanilla CFR, CFR+ (RM+, alternating, linear averaging
//     with an optional delay), linear CFR, discounted CFR (alpha, beta, gamma),
//   * external-sampling MCCFR with the same estimator as the EightMax engine
//     (opponent sampling q = (1-eps) sigma + eps/k, regret weight pi_-i/q_-i,
//     stochastically weighted averaging own * sigma / q_-i, optional linear
//     weighting, RM+, DCFR) and the candidate variance reductions:
//       - "terminal baseline": exact contribution of terminal opponent actions,
//       - "own-chance enumeration": the traverser's private-card chance node is
//         enumerated (conditional probabilities) instead of sampled.
#pragma once
#include "refgames.hpp"
#include <random>
#include <chrono>
namespace ref {

struct Rng {   // xoshiro256** seeded by splitmix64 (independent of the engine's generator)
  uint64_t s[4];
  explicit Rng(uint64_t seed) { for (auto &x : s) { seed += 0x9e3779b97f4a7c15ULL; uint64_t z = seed; z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL; z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL; x = z ^ (z >> 31); } }
  static uint64_t rotl(uint64_t x, int k) { return (x << k) | (x >> (64 - k)); }
  uint64_t next() { const uint64_t r = rotl(s[1] * 5, 7) * 9, t = s[1] << 17; s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3]; s[2] ^= t; s[3] = rotl(s[3], 45); return r; }
  double uniform() { return (double)(next() >> 11) * (1.0 / 9007199254740992.0); }
  int pick(const double *p, int k) { double u = uniform(), c = 0; for (int a = 0; a < k; a++) { c += p[a]; if (u < c) return a; } return k - 1; }
};

using Profile = std::vector<std::vector<double>>;   // per infoset, action probabilities

inline Profile uniform(const Game &g) { Profile p(g.sets.size()); for (size_t i = 0; i < g.sets.size(); i++) p[i].assign((size_t)g.sets[i].k, 1.0 / g.sets[i].k); return p; }
inline Profile randomProfile(const Game &g, uint64_t seed) {
  Rng r(seed); Profile p(g.sets.size());
  for (size_t i = 0; i < g.sets.size(); i++) { double s = 0; for (int a = 0; a < g.sets[i].k; a++) { double x = 0.05 + r.uniform(); p[i].push_back(x); s += x; } for (double &x : p[i]) x /= s; }
  return p;
}

// Expected utility vector of every node under a profile.
inline std::vector<std::vector<double>> values(const Game &g, const Profile &s) {
  std::vector<std::vector<double>> v(g.nodes.size());
  for (size_t x = g.nodes.size(); x-- > 0;) {   // children have larger indices (pre-order)
    const Node &d = g.nodes[x]; v[x].assign((size_t)g.n, 0);
    if (d.type == 2) { v[x] = d.util; continue; }
    for (size_t a = 0; a < d.child.size(); a++) { const double p = d.type == 0 ? d.prob[a] : s[(size_t)d.infoset][a]; for (int q = 0; q < g.n; q++) v[x][(size_t)q] += p * v[(size_t)d.child[a]][(size_t)q]; }
  }
  return v;
}
// reach[x][q] = product of player q's action probabilities on the path; chance[x] = chance product.
inline void reaches(const Game &g, const Profile &s, std::vector<std::vector<double>> &reach, std::vector<double> &chance) {
  reach.assign(g.nodes.size(), std::vector<double>((size_t)g.n, 1.0)); chance.assign(g.nodes.size(), 1.0);
  for (size_t x = 0; x < g.nodes.size(); x++) {
    const Node &d = g.nodes[x];
    for (size_t a = 0; a < d.child.size(); a++) {
      const size_t c = (size_t)d.child[a]; reach[c] = reach[x]; chance[c] = chance[x];
      if (d.type == 0) chance[c] *= d.prob[a]; else if (d.type == 1) reach[c][(size_t)d.player] *= s[(size_t)d.infoset][a];
    }
  }
}
// Exact counterfactual regrets R(I,a) = sum_{h in I} pi_c pi_-i (v_i(ha) - v_i(h)) and exact
// average-strategy increments A(I,a) = sum_{h in I} pi_c(h) pi_i(h) sigma(I,a) (the expectation
// of the stochastically weighted average increment, whose 1/q_-i weight cancels opponent sampling).
inline void exactIncrements(const Game &g, const Profile &s, int player, Profile &R, Profile &A) {
  auto v = values(g, s); std::vector<std::vector<double>> reach; std::vector<double> ch; reaches(g, s, reach, ch);
  R.assign(g.sets.size(), {}); A.assign(g.sets.size(), {});
  for (size_t i = 0; i < g.sets.size(); i++) { R[i].assign((size_t)g.sets[i].k, 0); A[i].assign((size_t)g.sets[i].k, 0); }
  for (size_t x = 0; x < g.nodes.size(); x++) {
    const Node &d = g.nodes[x]; if (d.type != 1 || d.player != player) continue;
    double opp = ch[x]; for (int q = 0; q < g.n; q++) if (q != player) opp *= reach[x][(size_t)q];
    for (size_t a = 0; a < d.child.size(); a++) {
      R[(size_t)d.infoset][a] += opp * (v[(size_t)d.child[a]][(size_t)player] - v[x][(size_t)player]);
      A[(size_t)d.infoset][a] += ch[x] * reach[x][(size_t)player] * s[(size_t)d.infoset][a];
    }
  }
}
// Exact unilateral best-response value of `player` against the other players' fixed strategies.
inline double bestResponse(const Game &g, const Profile &s, int player, std::vector<int> *choice = nullptr) {
  std::vector<std::vector<double>> reach; std::vector<double> ch; reaches(g, s, reach, ch);
  std::vector<std::vector<int>> members(g.sets.size());
  for (size_t x = 0; x < g.nodes.size(); x++) if (g.nodes[x].type == 1 && g.nodes[x].player == player) members[(size_t)g.nodes[x].infoset].push_back((int)x);
  std::vector<int> decided(g.sets.size(), -1); std::vector<double> memo(g.nodes.size(), NAN);
  std::function<double(int)> val;
  std::function<int(int)> decide = [&](int I) {
    if (decided[(size_t)I] >= 0) return decided[(size_t)I];
    const int k = g.sets[(size_t)I].k; std::vector<double> tot((size_t)k, 0);
    for (int x : members[(size_t)I]) { double w = ch[(size_t)x]; for (int q = 0; q < g.n; q++) if (q != player) w *= reach[(size_t)x][(size_t)q];
      for (int a = 0; a < k; a++) tot[(size_t)a] += w * val(g.nodes[(size_t)x].child[(size_t)a]); }
    int best = 0; for (int a = 1; a < k; a++) if (tot[(size_t)a] > tot[(size_t)best] + 1e-15) best = a;
    return decided[(size_t)I] = best;
  };
  val = [&](int x) -> double {
    if (!std::isnan(memo[(size_t)x])) return memo[(size_t)x];
    const Node &d = g.nodes[(size_t)x]; double r = 0;
    if (d.type == 2) r = d.util[(size_t)player];
    else if (d.type == 0) for (size_t a = 0; a < d.child.size(); a++) r += d.prob[a] * val(d.child[a]);
    else if (d.player == player) r = val(d.child[(size_t)decide(d.infoset)]);
    else for (size_t a = 0; a < d.child.size(); a++) r += s[(size_t)d.infoset][a] * val(d.child[a]);
    return memo[(size_t)x] = r;
  };
  const double r = val(0);
  if (choice) { choice->assign(g.sets.size(), -1); for (size_t I = 0; I < g.sets.size(); I++) if (g.sets[I].player == player && !members[I].empty()) (*choice)[I] = decide((int)I); }
  return r;
}
struct Exploit { std::vector<double> value, best, gain; double nashConv = 0; };
inline Exploit evaluate(const Game &g, const Profile &s) {
  Exploit e; auto v = values(g, s); e.value = v[0];
  for (int p = 0; p < g.n; p++) { e.best.push_back(bestResponse(g, s, p)); e.gain.push_back(std::max(0.0, e.best.back() - e.value[(size_t)p])); e.nashConv += e.gain.back(); }
  return e;
}

// ------------------------------------------------------------ solver tables
struct Options {
  std::string algo = "cfr";          // cfr | es
  bool plus = false;                 // regret matching+ (clip regrets at 0)
  bool linear = false;               // weight iteration t's regret and average increments by t
  int averageDelay = 0;              // CFR+: average weight max(t - delay, 0)
  bool dcfr = false; double alpha = 1.5, beta = 0, gamma = 2;
  double explore = 0.1;              // ES opponent exploration eps
  bool terminalBaseline = false;     // ES variance reduction
  bool enumerateOwnChance = false;   // ES variance reduction (Rao-Blackwellised own private card)
  uint64_t seed = 1;
};
struct Solver {
  const Game &g; Options o; Rng rng; long long t = 0, traversals = 0;
  Profile reg, avg;
  Solver(const Game &gg, Options oo) : g(gg), o(oo), rng(oo.seed) {
    reg.resize(g.sets.size()); avg.resize(g.sets.size());
    for (size_t i = 0; i < g.sets.size(); i++) { reg[i].assign((size_t)g.sets[i].k, 0); avg[i].assign((size_t)g.sets[i].k, 0); }
    dreg = reg; davg = avg;
  }
  void current(int I, double *out) const {
    const auto &r = reg[(size_t)I]; double s = 0; const int k = (int)r.size();
    for (int a = 0; a < k; a++) { out[a] = r[(size_t)a] > 0 ? r[(size_t)a] : 0; s += out[a]; }
    for (int a = 0; a < k; a++) out[a] = s > 0 ? out[a] / s : 1.0 / k;
  }
  Profile currentProfile() const { Profile p(g.sets.size()); for (size_t i = 0; i < g.sets.size(); i++) { p[i].resize(reg[i].size()); current((int)i, p[i].data()); } return p; }
  Profile average() const {
    Profile p(g.sets.size());
    for (size_t i = 0; i < g.sets.size(); i++) { double s = 0; for (double x : avg[i]) s += x; p[i].resize(avg[i].size()); for (size_t a = 0; a < avg[i].size(); a++) p[i][a] = s > 0 ? avg[i][a] / s : 1.0 / (double)avg[i].size(); }
    return p;
  }
  // ---- full-width CFR (alternating updates) ----
  double cfr(int x, int i, std::vector<double> &pi, double pc, double wr, double wa) {
    const Node &d = g.nodes[(size_t)x];
    if (d.type == 2) return d.util[(size_t)i];
    if (d.type == 0) { double v = 0; for (size_t a = 0; a < d.child.size(); a++) v += d.prob[a] * cfr(d.child[a], i, pi, pc * d.prob[a], wr, wa); return v; }
    const int k = (int)d.child.size(), p = d.player; double sig[16], va[16], v = 0; current(d.infoset, sig);
    const double old = pi[(size_t)p];
    for (int a = 0; a < k; a++) { pi[(size_t)p] = old * sig[a]; va[a] = cfr(d.child[(size_t)a], i, pi, pc, wr, wa); v += sig[a] * va[a]; }
    pi[(size_t)p] = old;
    if (p == i) {
      double opp = pc; for (int q = 0; q < g.n; q++) if (q != i) opp *= pi[(size_t)q];
      // Buffered: the policy must stay fixed for the whole traversal, and RM+ clips the
      // infoset's summed increment, not each history's (applied in flush()).
      auto &r = dreg[(size_t)d.infoset]; auto &s = davg[(size_t)d.infoset];
      for (int a = 0; a < k; a++) { r[(size_t)a] += wr * opp * (va[a] - v); s[(size_t)a] += wa * old * sig[a]; }
    }
    return v;
  }
  Profile dreg, davg;
  void flush() {
    for (size_t i = 0; i < reg.size(); i++) for (size_t a = 0; a < reg[i].size(); a++) {
      double v = reg[i][a] + dreg[i][a]; reg[i][a] = o.plus && v < 0 ? 0 : v; avg[i][a] += davg[i][a]; dreg[i][a] = 0; davg[i][a] = 0; }
  }
  // ---- external sampling (increments are buffered and applied after each traversal,
  //      as in the engine: the policy is fixed during one traversal) ----
  struct Inc { int I; double r[16], a[16]; };
  std::vector<Inc> buf;
  double es(int x, int i, double own, double opp, double sp, double cw) {
    const Node &d = g.nodes[(size_t)x];
    if (d.type == 2) return d.util[(size_t)i];
    if (d.type == 0) {
      if (o.enumerateOwnChance && d.dealTo == i) { double v = 0; for (size_t a = 0; a < d.child.size(); a++) v += d.prob[a] * es(d.child[a], i, own, opp, sp, cw * d.prob[a]); return v; }
      const int a = rng.pick(d.prob.data(), (int)d.prob.size()); return es(d.child[(size_t)a], i, own, opp, sp, cw);
    }
    const int k = (int)d.child.size(); double sig[16]; current(d.infoset, sig);
    if (d.player != i) {
      double q[16]; for (int a = 0; a < k; a++) q[a] = (1 - o.explore) * sig[a] + o.explore / k;
      const int a = rng.pick(q, k);
      if (o.terminalBaseline) {
        int first = -1; for (int b = 0; b < k; b++) if (g.nodes[(size_t)d.child[(size_t)b]].type == 2) { first = b; break; }
        if (first >= 0) {
          const double base = g.nodes[(size_t)d.child[(size_t)first]].util[(size_t)i]; double known = base;
          for (int b = 0; b < k; b++) if (b != first && g.nodes[(size_t)d.child[(size_t)b]].type == 2) known += sig[b] * (g.nodes[(size_t)d.child[(size_t)b]].util[(size_t)i] - base);
          if (g.nodes[(size_t)d.child[(size_t)a]].type == 2) return known;
          const double v = es(d.child[(size_t)a], i, own, opp * sig[a], sp * q[a], cw);
          return known + sig[a] / q[a] * (v - base);
        }
      }
      return sig[a] / q[a] * es(d.child[(size_t)a], i, own, opp * sig[a], sp * q[a], cw);
    }
    double va[16], v = 0; Inc inc; inc.I = d.infoset;
    for (int a = 0; a < k; a++) { inc.a[a] = cw * own * sig[a] / sp; va[a] = es(d.child[(size_t)a], i, own * sig[a], opp, sp, cw); v += sig[a] * va[a]; }
    for (int a = 0; a < k; a++) inc.r[a] = cw * opp / sp * (va[a] - v);
    buf.push_back(inc);
    return v;
  }
  void apply(double wr, double wa) {
    for (const Inc &x : buf) for (size_t a = 0; a < reg[(size_t)x.I].size(); a++) { dreg[(size_t)x.I][a] += wr * x.r[a]; davg[(size_t)x.I][a] += wa * x.a[a]; }
    for (const Inc &x : buf) { auto &r = reg[(size_t)x.I], &dr = dreg[(size_t)x.I], &s = avg[(size_t)x.I], &da = davg[(size_t)x.I];
      for (size_t a = 0; a < r.size(); a++) { const double v = r[a] + dr[a]; r[a] = o.plus && v < 0 ? 0 : v; s[a] += da[a]; dr[a] = 0; da[a] = 0; } }
    buf.clear();
  }
  void discount() {   // DCFR, after iteration t (1-based)
    const double T = (double)t, pa = std::pow(T, o.alpha), pb = std::pow(T, o.beta), pos = pa / (pa + 1), neg = pb / (pb + 1), av = std::pow(T / (T + 1), o.gamma);
    for (size_t i = 0; i < reg.size(); i++) for (size_t a = 0; a < reg[i].size(); a++) { double &r = reg[i][a]; r *= r > 0 ? pos : neg; avg[i][a] *= av; }
  }
  void iterate() {
    const long long T = t + 1;
    const double wr = o.linear ? (double)T : 1.0;
    const double wa = o.dcfr ? 1.0 : o.linear ? (double)T : o.plus && o.algo == "cfr" ? (double)std::max<long long>(T - o.averageDelay, 0) : 1.0;
    for (int i = 0; i < g.n; i++) {
      if (o.algo == "cfr") { std::vector<double> pi((size_t)g.n, 1.0); cfr(0, i, pi, 1.0, wr, wa); flush(); }
      else { buf.clear(); es(0, i, 1, 1, 1, 1); apply(wr, wa); traversals++; }
    }
    t++;
    if (o.dcfr) discount();
  }
};

// ---------------------------------------------------------------- statistics
inline double normalQuantile(double p) {   // Acklam's rational approximation (|rel err| < 1.2e-9)
  static const double a[] = {-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00};
  static const double b[] = {-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01};
  static const double c[] = {-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00};
  static const double d[] = {7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00};
  const double pl = 0.02425;
  if (p < pl) { const double q = std::sqrt(-2 * std::log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) return -normalQuantile(1 - p);
  const double q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
inline double tCritical(int df) {   // two-sided 95%
  static const double t[] = {0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086};
  return df <= 20 ? t[df] : 1.96 + 2.5 / df;
}
// Two-sided p-value of Student t via the regularized incomplete beta function.
inline double betacf(double a, double b, double x) {
  double c = 1, d = 1 - (a + b) * x / (a + 1); d = 1 / d; double h = d;
  for (int m = 1; m < 300; m++) { const int m2 = 2 * m; double aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2)); d = 1 + aa * d; c = 1 + aa / c; d = 1 / d; h *= d * c;
    aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1)); d = 1 + aa * d; c = 1 + aa / c; d = 1 / d; const double del = d * c; h *= del; if (std::fabs(del - 1) < 1e-15) break; }
  return h;
}
inline double ibeta(double a, double b, double x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const double bt = std::exp(std::lgamma(a + b) - std::lgamma(a) - std::lgamma(b) + a * std::log(x) + b * std::log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
inline double tPValue(double t, int df) { if (!std::isfinite(t)) return 0; return ibeta(df / 2.0, 0.5, df / (df + t * t)); }

} // namespace ref
