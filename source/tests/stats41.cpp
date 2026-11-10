// EightMax 4.1: independent statistical simulations for action-EV comparisons
// (native/action_stats.hpp). Every scenario has KNOWN true action values; each
// replication draws n common-random-number samples (one k-vector per sample,
// as the sampler in action_ev.hpp produces), accumulates running sums exactly
// like Moments, and classifies with (a) the 4.1 procedure and (b) the 4.0 rule
// (each action vs the highest estimate, unadjusted 95% normal interval; TOST
// with 90% intervals for equivalence). Reported per scenario:
//   familyErrorRate   share of replications with AT LEAST ONE false claim
//                     (supportedBest for an action that is not the unique best,
//                     differenceSupported for an action that is best or tied,
//                     practicallyEquivalent for an action |D_a| >= margin)
//   coverage          share where every D_a = mu_a - max_{b!=a} mu_b lies in its
//                     simultaneous interval
//   power             share where the truly best action is supportedBest (when
//                     a unique best exists)
//   winnersCurse      mean (estimate - truth) of D at the highest estimate
// with Wilson 95% intervals for every rate. Output: one JSON document.
// Build: g++ -std=c++20 -O2 -I native tests/stats41.cpp -o stats41
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>
#include "action_stats.hpp"
using namespace emstats;
struct Rng { uint64_t s; double u() { return unif(s); } double z() { double v[2]; normals(s, v, 2); return v[0]; } };
struct Scenario {
  std::string name, kind; int k; std::vector<double> mu, sigma; double rho; long long n; int reps; double margin = NAN;
  double jackpot = 0;   // "rare": X_a = jackpot * [U < p_a] + noise, mu = jackpot * p_a
};
struct Rate { long long hit = 0, of = 0; void add(bool h) { hit += h; of++; } };
static void wilson(FILE *f, const char *name, const Rate &r) {
  const double n = (double)r.of, p = n ? r.hit / n : NAN, z = 1.959963984540054, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * std::sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  std::fprintf(f, "\"%s\":{\"rate\":%.5f,\"ci95\":[%.5f,%.5f],\"count\":%lld,\"of\":%lld}", name, p, c - h, c + h, r.hit, r.of);
}
// true D_a and whether a is the unique best
static void truth(const std::vector<double> &mu, double *D) { const int k = (int)mu.size(); for (int a = 0; a < k; a++) { double o = -INFINITY; for (int b = 0; b < k; b++) if (b != a) o = std::max(o, mu[b]); D[a] = mu[a] - o; } }
struct Sums { int k; long long n = 0; double s[MAXK] = {}, ss[MAXK][MAXK] = {};
  void add(const double *v) { n++; for (int a = 0; a < k; a++) { s[a] += v[a]; for (int b = 0; b < k; b++) ss[a][b] += v[a] * v[b]; } }
  void moments(double *mean, double cov[MAXK][MAXK]) const { for (int a = 0; a < k; a++) { mean[a] = s[a] / n; for (int b = 0; b < k; b++) cov[a][b] = covFromSums(n, s[a], s[b], ss[a][b]); } } };
static void draw(const Scenario &S, Rng &g, double *v) {
  if (S.kind == "rare") { const double u = g.u(); for (int a = 0; a < S.k; a++) v[a] = S.jackpot * (u < S.mu[a] / S.jackpot) + S.sigma[a] * g.z(); return; }
  const double z0 = g.z(); for (int a = 0; a < S.k; a++) v[a] = S.mu[a] + S.sigma[a] * (std::sqrt(S.rho) * z0 + std::sqrt(1 - S.rho) * g.z());
}
// 4.0 rule on the same moments
static void rule40(int k, long long n, const double *mean, const double cov[MAXK][MAXK], double margin, bool *supported, bool *equivalent, int &best) {
  best = 0; for (int a = 1; a < k; a++) if (mean[a] > mean[best]) best = a;
  for (int a = 0; a < k; a++) {
    supported[a] = equivalent[a] = false; if (a == best) continue;
    const double se = std::sqrt(std::max(0.0, cov[a][a] + cov[best][best] - 2 * cov[a][best]) / n), d = mean[a] - mean[best];
    supported[a] = d + 1.96 * se < 0;
    equivalent[a] = std::isfinite(margin) && d - 1.6448536269514722 * se > -margin && d + 1.6448536269514722 * se < margin;
  }
}
static void run(FILE *f, const Scenario &S, bool first, uint64_t seed) {
  Rng g{seed}; double D[MAXK]; std::vector<double> mu = S.mu; truth(mu, D);
  int trueBest = -1; for (int a = 0; a < S.k; a++) if (D[a] > 0) trueBest = a;
  Rate fwe, fwe40, cover, power, power40, anyClaim, anyClaim40; double curse = 0, curse40 = 0; double critSum = 0;
  for (int r = 0; r < S.reps; r++) {
    Sums sm; sm.k = S.k; double v[MAXK];
    for (long long i = 0; i < S.n; i++) { draw(S, g, v); sm.add(v); }
    double mean[MAXK], cov[MAXK][MAXK]; sm.moments(mean, cov);
    const Result R = compare(S.k, S.n, mean, cov, S.margin, 16, 0.05, 20000, 0x5EED41ULL + (uint64_t)r);
    critSum += R.crit;
    bool wrong = false, ok = true, claim = false;
    for (int a = 0; a < S.k; a++) {
      if (R.supportedBest == a && !(D[a] > 0)) wrong = true;
      if (R.supported[a] && !(D[a] < 0)) wrong = true;
      if (R.equivalent[a] && !(std::fabs(D[a]) < S.margin)) wrong = true;
      claim |= R.supportedBest == a || R.supported[a] || R.equivalent[a];
      ok &= R.lo[a] <= D[a] && D[a] <= R.hi[a];
    }
    fwe.add(wrong); cover.add(ok); anyClaim.add(claim); if (trueBest >= 0) power.add(R.supportedBest == trueBest);
    curse += R.est[R.best] - D[R.best];
    bool s40[MAXK], e40[MAXK]; int b40; rule40(S.k, S.n, mean, cov, S.margin, s40, e40, b40);
    bool wrong40 = false, claim40 = false;
    for (int a = 0; a < S.k; a++) {
      if (s40[a] && !(mu[a] < mu[b40])) wrong40 = true;
      if (e40[a] && !(std::fabs(mu[a] - mu[b40]) < S.margin)) wrong40 = true;
      claim40 |= s40[a] || e40[a];
    }
    // 4.0 called the highest estimate "best" with no qualification; a "best"
    // claim counts as power only when every other action was flagged lower.
    bool all40 = true; for (int a = 0; a < S.k; a++) if (a != b40) all40 &= s40[a];
    fwe40.add(wrong40); anyClaim40.add(claim40); if (trueBest >= 0) power40.add(b40 == trueBest && all40);
    curse40 += (mean[b40] - [&] { double o = -INFINITY; for (int b = 0; b < S.k; b++) if (b != b40) o = std::max(o, mean[b]); return o; }()) - D[b40];
  }
  std::fprintf(f, "%s{\"name\":\"%s\",\"kind\":\"%s\",\"actions\":%d,\"samplesPerReplication\":%lld,\"replications\":%d,\"trueMeans\":[", first ? "" : ",\n", S.name.c_str(), S.kind.c_str(), S.k, S.n, S.reps);
  for (int a = 0; a < S.k; a++) std::fprintf(f, "%s%.6g", a ? "," : "", S.mu[a]);
  std::fprintf(f, "],\"correlation\":%.3g,\"margin\":", S.rho); if (std::isfinite(S.margin)) std::fprintf(f, "%.6g", S.margin); else std::fprintf(f, "null");
  std::fprintf(f, ",\"meanCriticalValue\":%.4f,\"v41\":{", critSum / S.reps); wilson(f, "familyErrorRate", fwe); std::fprintf(f, ","); wilson(f, "simultaneousCoverage", cover); std::fprintf(f, ","); wilson(f, "anyClaim", anyClaim);
  if (trueBest >= 0) { std::fprintf(f, ","); wilson(f, "powerSupportedBest", power); }
  std::fprintf(f, ",\"winnersCurseMean\":%.6g},\"v40rule\":{", curse / S.reps); wilson(f, "familyErrorRate", fwe40); std::fprintf(f, ","); wilson(f, "anyClaim", anyClaim40);
  if (trueBest >= 0) { std::fprintf(f, ","); wilson(f, "powerAllOthersLower", power40); }
  std::fprintf(f, ",\"winnersCurseMean\":%.6g}}", curse40 / S.reps);
  std::fflush(f);
}
// Data-dependent stopping: look every `step` samples, stop at the first look
// where any difference is claimed. Fixed alpha at every look vs the spending rule.
static void sequential(FILE *f, int k, int reps, int looks, long long step, bool spend, uint64_t seed) {
  Rng g{seed}; Rate fwe;
  for (int r = 0; r < reps; r++) {
    Sums sm; sm.k = k; double v[MAXK]; bool claimed = false;
    for (int j = 1; j <= looks && !claimed; j++) {
      for (long long i = 0; i < step; i++) { const double z0 = g.z(); for (int a = 0; a < k; a++) v[a] = 0.7 * z0 + 0.714 * g.z(); sm.add(v); }
      double mean[MAXK], cov[MAXK][MAXK]; sm.moments(mean, cov);
      const Result R = compare(k, sm.n, mean, cov, NAN, 16, spend ? sequentialPeekAlpha(0.05, j) : 0.05, 4000, 77 + (uint64_t)j);
      for (int a = 0; a < k; a++) claimed |= R.supportedBest == a || R.supported[a];
    }
    fwe.add(claimed);
  }
  std::fprintf(f, ",\n{\"name\":\"sequential peeking, %d equal actions, %d looks every %lld samples, %s\",\"kind\":\"sequential\",\"actions\":%d,\"replications\":%d,\"v41\":{", k, looks, step, spend ? "alpha spending 6a/(pi^2 j^2)" : "fixed alpha 0.05 at every look", k, reps);
  wilson(f, "familyErrorRate", fwe); std::fprintf(f, "}}"); std::fflush(f);
}
int main(int argc, char **argv) {
  const bool quick = argc > 1 && !std::strcmp(argv[1], "--quick");
  const int R = quick ? 400 : 2000;
  std::vector<Scenario> S = {
    {"4 equal actions, correlated 0.8", "normal", 4, {1, 1, 1, 1}, {1, 1, 1, 1}, 0.8, 1000, R},
    {"4 equal actions, independent", "normal", 4, {1, 1, 1, 1}, {1, 1, 1, 1}, 0.0, 1000, R},
    {"8 equal actions, correlated 0.5", "normal", 8, {0, 0, 0, 0, 0, 0, 0, 0}, {1, 1, 1, 1, 1, 1, 1, 1}, 0.5, 1000, R},
    {"2 equal actions", "normal", 2, {0, 0}, {1, 1}, 0.9, 1000, R},
    {"3 actions, small difference 0.02", "normal", 3, {0.02, 0, 0}, {1, 1, 1}, 0.9, 2000, R},
    {"3 actions, large difference 0.3", "normal", 3, {0.3, 0, -0.1}, {1, 1, 1}, 0.5, 1000, R},
    {"4 actions, unequal variances", "normal", 4, {0.05, 0, 0, -0.05}, {0.5, 1, 2, 4}, 0.3, 2000, R},
    {"5 actions, two tied best", "normal", 5, {0.1, 0.1, 0, -0.1, -0.2}, {1, 1, 1, 1, 1}, 0.6, 2000, R},
    {"small samples n=100, 4 equal", "normal", 4, {0, 0, 0, 0}, {1, 1, 1, 1}, 0.5, 100, R},
    {"equivalence, equal values, margin 0.1", "normal", 3, {0, 0, 0}, {1, 1, 1}, 0.9, 5000, R, 0.1},
    {"equivalence at the margin boundary (true gap = margin)", "normal", 2, {0.1, 0}, {1, 1}, 0.9, 5000, R, 0.1},
    {"rare large payoff p=0.002 vs 0.002, n=1000", "rare", 3, {1, 1, 1}, {0.05, 0.05, 0.05}, 0, 1000, R},
    {"rare large payoff p=0.002 vs 0.002, n=20000", "rare", 3, {1, 1, 1}, {0.05, 0.05, 0.05}, 0, 20000, quick ? 200 : 600},
  };
  S[11].jackpot = S[12].jackpot = 500;
  std::printf("{\"generator\":\"tests/stats41.cpp\",\"familyConfidence\":0.95,\"scenarios\":[\n");
  for (size_t i = 0; i < S.size(); i++) run(stdout, S[i], i == 0, 1000 + i);
  sequential(stdout, 3, quick ? 200 : 800, 30, 100, false, 9001);
  sequential(stdout, 3, quick ? 200 : 800, 30, 100, true, 9002);
  std::printf("\n]}\n");
  return 0;
}
