// EightMax 4.1: multiplicity- and selection-adjusted comparisons of sampled
// action EVs. Self-contained (no engine types) so tests/stats41.cpp exercises
// exactly this code in its coverage and false-positive simulations.
//
// SAMPLING DESIGN (action_ev.hpp). Every sample is one independently drawn
// world (private hands of the other seats from their reach weights, board
// runout, sampled future actions) in which EVERY legal action is evaluated:
// common random numbers. Sample i yields a vector X_i = (v_1,i .. v_k,i); the
// X_i are i.i.d. (fixed 256-sample blocks with independent streams), every
// action has the same sample count n, and the estimates are correlated through
// Sigma = Cov(X_i). Unequal per-action sample counts do not occur in this
// design (they would need Welch-type pairing and are rejected by the caller).
//
// WHAT 4.0 DID. Each action a was compared with the action b^ that had the
// highest estimate, using an unadjusted 95% normal interval for the paired
// difference. With k actions that is up to k-1 tests at 5% each, and b^ is
// chosen on the same samples, so "b^ is better than a" was overstated: with
// four equal actions the 4.0 rule made at least one false claim in 20-21% of
// runs, with eight equal actions in 50% (tests/stats41.cpp, 2,000 replications;
// nominal 5%). Measured for this procedure: 4.3-5.9% in the same scenarios
// (8 actions: 5.9%, Wilson 95% CI 5.0-7.1%, i.e. at most slightly above nominal
// from estimating the covariance), simultaneous coverage 94.0-97.9%.
//
// WHAT 4.1 DOES (alpha = 0.05 family-wise):
//  1. Simultaneous two-sided intervals for ALL m = k(k-1)/2 pairwise
//     differences mu_a - mu_b:  dhat_ab +/- c * se_ab, where se_ab uses the
//     paired variance (covariance included) and c is the 1 - alpha quantile of
//     max_ab |T_ab| for T ~ multivariate t(df = n - 1) with the estimated
//     correlation of the pairwise statistics (single-step max-|t| method).
//     c is simulated deterministically (fixed seed, 20,000 draws) and taken at
//     an upper order statistic (+2 binomial standard errors), so Monte Carlo
//     error makes it conservative, not liberal. Cost: < 2 ms for k = 8.
//  2. Comparisons with the best of the others (Hsu's MCB form):
//     D_a = mu_a - max_{b != a} mu_b satisfies, on the same joint event,
//        min_b (dhat_ab - c se_ab)  <=  D_a  <=  min_b (dhat_ab + c se_ab).
//     These hold simultaneously for every a WHICHEVER action is truly best, so
//     they account for selecting the highest estimate.
//  3. Classification per action (first match):
//        insufficientSamples   n < minSamples, or a non-finite variance
//        supportedBest         lower bound of D_a > 0: better than every other
//                              action, family-wise 95%
//        practicallyEquivalent only with equivalenceMargin delta: the
//                              simultaneous interval for D_a lies in (-delta, delta)
//                              (intersection-union; with simultaneous bounds
//                              this is a valid level-alpha equivalence claim for
//                              all actions jointly; it is conservative)
//        differenceSupported   upper bound of D_a < 0: lower than some other
//                              action, family-wise 95%
//        highestEstimate       the largest estimate, advantage NOT established
//        differenceUncertain   none of the above: ordering not established;
//                              NOT evidence of equality
//  4. Holm step-down adjusted p-values over all m pairs (normal reference),
//     reported for each action against the highest estimate. Holm needs no
//     correlation assumption; it is a cross-check, the classes use (1)-(2).
// Normal/t approximations: the intervals rely on the central limit theorem.
// For rare, large payoffs (e.g. a 1-in-500 jackpot) coverage at small n can be
// below nominal; tests/stats41.cpp measures this and minSamples guards it.
// SEQUENTIAL USE. Sampling stops at a sample target, a deadline or a budget,
// never on the observed values, so fixed-n intervals apply to the samples that
// were taken. Repeatedly re-running until an interval excludes zero is NOT
// covered; the simulation shows how much that inflates errors (see
// sequentialPeekBonferroni below for the spending rule a caller must use).
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>
namespace emstats {
constexpr int MAXK = 8;
struct Result {
  int k = 0, best = 0, pairs = 0, supportedBest = -1, draws = 0; long long n = 0;
  double crit = NAN;                        // simultaneous critical value
  double est[MAXK] = {}, lo[MAXK] = {}, hi[MAXK] = {};   // D_a estimate and simultaneous bounds
  double holmP[MAXK] = {};                  // Holm-adjusted p vs the highest estimate (best: 1)
  double pairLo[MAXK][MAXK] = {}, pairHi[MAXK][MAXK] = {};
  const char *cls[MAXK] = {};
  bool supported[MAXK] = {}, equivalent[MAXK] = {};
};
inline uint64_t splitmix(uint64_t &s) { uint64_t z = (s += 0x9E3779B97F4A7C15ULL); z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL; z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL; return z ^ (z >> 31); }
inline double unif(uint64_t &s) { return ((splitmix(s) >> 11) + 0.5) * (1.0 / 9007199254740992.0); }
inline void normals(uint64_t &s, double *z, int n) {
  for (int i = 0; i < n; i += 2) { const double u = unif(s), v = unif(s), r = std::sqrt(-2 * std::log(u)); z[i] = r * std::cos(6.283185307179586 * v); if (i + 1 < n) z[i + 1] = r * std::sin(6.283185307179586 * v); }
}
inline double normalSf(double x) { return 0.5 * std::erfc(x / 1.4142135623730951); }   // P(Z > x)
// Sample covariance from running sums (same formula as action_ev.hpp Moments).
inline double covFromSums(long long n, double sa, double sb, double sab) { if (n < 2) return NAN; return (sab - sa * sb / (double)n) / (double)(n - 1); }
// Simulated 1 - alpha quantile of max |T_ab| over pairs with nonzero se.
inline double maxTCritical(int k, const double cov[MAXK][MAXK], long long n, double alpha, int draws, uint64_t seed) {
  // Cholesky of cov + tiny jitter (cov may be singular: identical actions).
  double L[MAXK][MAXK] = {}, tr = 0; for (int a = 0; a < k; a++) tr += cov[a][a];
  const double jitter = 1e-12 * std::max(tr, 1e-300);
  for (int i = 0; i < k; i++) for (int j = 0; j <= i; j++) {
    double s = cov[i][j] + (i == j ? jitter : 0); for (int p = 0; p < j; p++) s -= L[i][p] * L[j][p];
    L[i][j] = i == j ? std::sqrt(std::max(s, 0.0)) : (L[j][j] > 0 ? s / L[j][j] : 0);
  }
  int pa[MAXK * MAXK], pb[MAXK * MAXK], m = 0; double inv[MAXK * MAXK];
  for (int a = 0; a < k; a++) for (int b = a + 1; b < k; b++) { const double v = cov[a][a] + cov[b][b] - 2 * cov[a][b]; if (v > 1e-300) { pa[m] = a; pb[m] = b; inv[m] = 1 / std::sqrt(v); m++; } }
  if (!m) return 0;
  const double df = std::max(1.0, (double)n - 1);
  std::vector<double> mx((size_t)draws); double z[MAXK + 2], x[MAXK];
  for (int d = 0; d < draws; d++) {
    normals(seed, z, k + 1);
    for (int i = 0; i < k; i++) { double s = 0; for (int p = 0; p <= i; p++) s += L[i][p] * z[p]; x[i] = s; }
    // chi^2_df / df by Wilson-Hilferty (multivariate t: Z / sqrt(W/df))
    const double h = 2.0 / (9.0 * df), w = std::pow(std::max(1e-6, 1 - h + z[k] * std::sqrt(h)), 3.0), scale = 1 / std::sqrt(w);
    double best = 0; for (int q = 0; q < m; q++) best = std::max(best, std::fabs(x[pa[q]] - x[pb[q]]) * inv[q]);
    mx[(size_t)d] = best * scale;
  }
  // conservative order statistic: (1 - alpha) quantile + 2 binomial SEs
  const double idx = draws * (1 - alpha) + 2 * std::sqrt(draws * alpha * (1 - alpha));
  const size_t at = (size_t)std::min<double>(draws - 1, std::ceil(idx));
  std::nth_element(mx.begin(), mx.begin() + (long)at, mx.end());
  return mx[at];
}
// mean[a], cov[a][b] (sample covariance of the per-sample action values), n samples.
// margin: NaN when no equivalence test is requested.
inline Result compare(int k, long long n, const double *mean, const double cov[MAXK][MAXK], double margin, long long minSamples, double alpha = 0.05, int draws = 20000, uint64_t seed = 0x5EED41ULL) {
  Result r; r.k = k; r.n = n; r.draws = draws; r.pairs = k * (k - 1) / 2;
  for (int a = 1; a < k; a++) if (mean[a] > mean[r.best]) r.best = a;
  bool finite = n >= 2;
  for (int a = 0; a < k && finite; a++) for (int b = 0; b < k; b++) finite &= std::isfinite(cov[a][b]);
  const bool enough = finite && n >= minSamples && k >= 2;
  r.crit = enough ? maxTCritical(k, cov, n, alpha, draws, seed ^ (uint64_t)k * 0x100000001B3ULL) : NAN;
  const bool hasMargin = std::isfinite(margin);
  // pairwise simultaneous intervals and two-sided normal p-values
  double p[MAXK * MAXK]; int pa[MAXK * MAXK], pb[MAXK * MAXK], m = 0;
  for (int a = 0; a < k; a++) for (int b = 0; b < k; b++) {
    if (a == b) continue;
    const double d = mean[a] - mean[b], v = finite ? std::max(0.0, cov[a][a] + cov[b][b] - 2 * cov[a][b]) / (double)n : NAN, se = std::sqrt(v);
    r.pairLo[a][b] = d - r.crit * se; r.pairHi[a][b] = d + r.crit * se;
    if (se == 0 && enough) { r.pairLo[a][b] = r.pairHi[a][b] = d; }   // deterministic difference (identical worlds)
    if (a < b) { pa[m] = a; pb[m] = b; p[m] = se > 0 ? 2 * normalSf(std::fabs(d) / se) : (d == 0 ? 1.0 : 0.0); m++; }
  }
  // Holm step-down over all m pairs
  double adj[MAXK * MAXK]; int ord[MAXK * MAXK]; for (int i = 0; i < m; i++) ord[i] = i;
  std::sort(ord, ord + m, [&](int x, int y) { return p[x] < p[y]; });
  double run = 0; for (int i = 0; i < m; i++) { run = std::max(run, std::min(1.0, (m - i) * p[ord[i]])); adj[ord[i]] = run; }
  for (int a = 0; a < k; a++) {
    r.holmP[a] = 1;
    if (a != r.best) for (int q = 0; q < m; q++) if ((pa[q] == a && pb[q] == r.best) || (pb[q] == a && pa[q] == r.best)) r.holmP[a] = adj[q];
    double lo = INFINITY, hi = INFINITY, others = -INFINITY;
    for (int b = 0; b < k; b++) if (b != a) { lo = std::min(lo, r.pairLo[a][b]); hi = std::min(hi, r.pairHi[a][b]); others = std::max(others, mean[b]); }
    r.est[a] = mean[a] - others; r.lo[a] = lo; r.hi[a] = hi;
    if (!enough) { r.cls[a] = "insufficientSamples"; continue; }
    r.supported[a] = hi < 0;
    r.equivalent[a] = hasMargin && lo > -margin && hi < margin;
    if (lo > 0) { r.cls[a] = "supportedBest"; r.supportedBest = a; }
    else if (r.equivalent[a]) r.cls[a] = "practicallyEquivalent";
    else if (r.supported[a]) r.cls[a] = "differenceSupported";
    else if (a == r.best) r.cls[a] = "highestEstimate";
    else r.cls[a] = "differenceUncertain";
  }
  return r;
}
// Error-spending rule for a caller that inspects results L times and stops
// early (e.g. "run until the interval excludes zero"): use alpha_j = alpha *
// 6 / (pi^2 j^2) at look j (union bound; sums to alpha over any number of
// looks). Provided for documentation and the simulation; the native sampler
// itself never stops on observed values.
inline double sequentialPeekAlpha(double alpha, int look) { return alpha * 6.0 / (9.869604401089358 * (double)look * (double)look); }
} // namespace emstats
