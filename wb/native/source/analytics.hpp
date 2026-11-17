// EightMax 4.7 training analytics (Priorities 4, 6, 7, 8): canonical reading of EMMW4
// external-sampling checkpoints, strategy identity and distances, spec compatibility.
//
// A checkpoint numbers its betting states in first-visit order, which depends on the
// random stream. Two checkpoints of the SAME game are therefore compared through a
// canonical row key that does not depend on that numbering:
//   betting path (action slots from the root, 7 = next street) | hand index | public cards
// (grouped studies store the hand-group key text instead of hand|cards). The average
// strategy of a row is its average-strategy accumulator normalised to sum 1 (uniform if
// the accumulator is zero, exactly as the evaluators substitute it); the current strategy
// is regret matching of the stored regrets.
//
// Strategy hash: SHA-256 over the rows sorted by canonical key, each row = key, k and the
// IEEE 754 bytes of the normalised average strategy. Equal hashes mean equal average
// strategies at every stored row (independent of state numbering, counters and regrets).
#pragma once
#include "sha256_portable.hpp"
#include "json.h"
#include <string>
#include <vector>
#include <map>
#include <unordered_map>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <cstdint>
namespace emana {

struct Row { std::string key; int seat = 0, length = 0, k = 0; std::vector<double> regret, average; double mass = 0; };
struct Study {
  bool ok = false; std::string error;
  long long iterations = 0, trainingDeals = 0, stateVisits = 0; std::string studyId; uint32_t rng = 0, actionRng = 0;
  bool rowSync = false, rowKeys = false; size_t states = 0, bytes = 0;
  std::vector<Row> rows; double totalMass = 0;
  std::string fileSha256;
};

inline uint32_t rd32(const unsigned char *p) { uint32_t v; std::memcpy(&v, p, 4); return v; }
inline uint16_t rd16(const unsigned char *p) { uint16_t v; std::memcpy(&v, p, 2); return v; }

// Parses an EMMW4 file image (raw, as written by mwcli / the host). Never throws on bad input.
inline Study parse(const unsigned char *b, size_t n) {
  Study s; s.bytes = n;
  { emsha::Sha256 h; h.add(b, n); s.fileSha256 = h.hex(); }
  auto bad = [&](const char *why) { s.ok = false; s.error = why; s.rows.clear(); return s; };
  if (n < 20 || std::memcmp(b, "EMMW4\0\0\0", 8)) return bad("not an EMMW4 external-sampling checkpoint");
  const uint32_t hl = rd32(b + 8); if ((size_t)hl + 16 > n) return bad("truncated header");
  char err[256] = ""; JV *h = json_parse((const char *)b + 12, hl, err, sizeof err); if (!h) return bad("unreadable header");
  s.iterations = (long long)jnum(jget(h, "iterations"), 0); s.trainingDeals = (long long)jnum(jget(h, "trainingDeals"), 0);
  s.stateVisits = (long long)jnum(jget(h, "stateVisits"), 0); s.rng = (uint32_t)jnum(jget(h, "rng"), 0); s.actionRng = (uint32_t)jnum(jget(h, "actionRng"), 0);
  if (const char *id = jstr(jget(h, "studyId"))) s.studyId = id;
  s.rowSync = jnum(jget(h, "rowSync"), 0) != 0; s.rowKeys = jnum(jget(h, "rowKeys"), 0) != 0;
  json_free(h);
  size_t o = 12 + hl;
  const uint32_t sc = rd32(b + o); o += 4;
  if ((size_t)sc * 9 > n - o) return bad("truncated state table");
  std::vector<uint32_t> parent(sc); std::vector<uint8_t> slot(sc), actor(sc), length(sc);
  for (uint32_t i = 0; i < sc; i++) { parent[i] = rd32(b + o); slot[i] = b[o + 4]; actor[i] = b[o + 6]; length[i] = b[o + 7]; o += 9; }
  s.states = sc;
  std::vector<std::string> path(sc); std::vector<char> done(sc, 0);
  // parents always precede children (ids are assigned in first-visit order)
  for (uint32_t i = 0; i < sc; i++) {
    if (i == 0 || parent[i] == 0xffffffffu) { done[i] = 1; continue; }
    if (parent[i] >= i || !done[parent[i]]) return bad("state table is not in parent-first order");
    path[i] = path[parent[i]] + (path[parent[i]].empty() ? "" : ".") + std::to_string(slot[i]); done[i] = 1;
  }
  if (n - o < 4) return bad("truncated row count");
  const uint32_t rc = rd32(b + o); o += 4;
  s.rows.reserve(rc);
  for (uint32_t r = 0; r < rc; r++) {
    Row row; if (n - o < 6) return bad("truncated row");
    const uint32_t st = rd32(b + o); o += 4; if (st >= sc) return bad("row refers to an unknown state");
    if (s.rowKeys) {
      const uint16_t kl = rd16(b + o); o += 2; if (n - o < (size_t)kl + 1) return bad("truncated row key");
      row.key = path[st] + "|g:" + std::string((const char *)b + o, kl); o += kl;
    } else {
      if (n - o < 8) return bad("truncated row");
      const uint16_t hand = rd16(b + o); o += 2; char cards[32]; std::snprintf(cards, sizeof cards, "%u,%u,%u,%u,%u", b[o], b[o + 1], b[o + 2], b[o + 3], b[o + 4]); o += 5;
      row.key = path[st] + "|" + std::to_string(hand) + "|" + cards;
    }
    row.k = b[o]; o += 1; if (row.k < 1 || row.k > 16 || n - o < 16 * (size_t)row.k + (s.rowSync ? 4 : 0)) return bad("truncated row values");
    row.seat = actor[st]; row.length = length[st];
    row.regret.resize((size_t)row.k); row.average.resize((size_t)row.k);
    std::memcpy(row.regret.data(), b + o, 8 * (size_t)row.k); std::memcpy(row.average.data(), b + o + 8 * row.k, 8 * (size_t)row.k); o += 16 * (size_t)row.k;
    if (s.rowSync) o += 4;
    for (double x : row.average) row.mass += x > 0 ? x : 0;
    s.totalMass += row.mass;
    s.rows.push_back(std::move(row));
  }
  if (o != n) return bad("trailing bytes after the last row");
  std::sort(s.rows.begin(), s.rows.end(), [](const Row &a, const Row &b2) { return a.key < b2.key; });
  for (size_t i = 1; i < s.rows.size(); i++) if (s.rows[i].key == s.rows[i - 1].key) return bad("duplicate canonical row key");
  s.ok = true; return s;
}
inline void normalised(const std::vector<double> &acc, std::vector<double> &out) {
  double t = 0; for (double x : acc) t += x > 0 ? x : 0;
  out.resize(acc.size()); for (size_t a = 0; a < acc.size(); a++) out[a] = t > 0 ? (acc[a] > 0 ? acc[a] : 0) / t : 1.0 / (double)acc.size();
}
inline std::string strategyHash(const Study &s) {
  emsha::Sha256 h; std::vector<double> p;
  for (const Row &r : s.rows) { normalised(r.average, p); h.add(r.key.data(), r.key.size()); const uint8_t k = (uint8_t)r.k; h.add(&k, 1); h.add(p.data(), 8 * p.size()); }
  return h.hex();
}
inline double tv(const std::vector<double> &a, const std::vector<double> &b) { double d = 0; for (size_t i = 0; i < a.size(); i++) d += std::fabs(a[i] - b[i]); return 0.5 * d; }

struct Distance {
  size_t rowsA = 0, rowsB = 0, common = 0, onlyA = 0, onlyB = 0, kMismatch = 0;
  double jaccard = 0;
  // average strategy, total variation per row on rows stored in both
  double meanTv = 0, maxTv = 0, weightedTv = 0, currentMeanTv = 0;
  // union of rows with the evaluators' uniform substitution for missing rows
  double unionWeightedTv = 0;
  std::string maxTvKey; int maxTvSeat = -1;
  std::vector<double> seatWeightedTv; std::vector<size_t> seatCommon;
};
// Weights: each study's average-strategy mass share of the row, averaged over the two studies
// (accumulator scales differ between studies with different update counts or weighting).
inline Distance distance(const Study &A, const Study &B, int seats) {
  Distance d; d.rowsA = A.rows.size(); d.rowsB = B.rows.size(); d.seatWeightedTv.assign((size_t)std::max(1, seats), 0); d.seatCommon.assign((size_t)std::max(1, seats), 0);
  std::vector<double> sw((size_t)std::max(1, seats), 0); double wsum = 0, uw = 0; std::vector<double> pa, pb, ca, cb;
  size_t i = 0, j = 0;
  auto share = [](const Study &s, const Row &r) { return s.totalMass > 0 ? r.mass / s.totalMass : 0.0; };
  auto uniform = [](int k) { return std::vector<double>((size_t)k, 1.0 / k); };
  while (i < A.rows.size() || j < B.rows.size()) {
    const bool takeA = j >= B.rows.size() || (i < A.rows.size() && A.rows[i].key < B.rows[j].key);
    const bool takeB = i >= A.rows.size() || (j < B.rows.size() && B.rows[j].key < A.rows[i].key);
    if (takeA) { const Row &r = A.rows[i++]; d.onlyA++; normalised(r.average, pa); const double w = 0.5 * share(A, r); d.unionWeightedTv += w * tv(pa, uniform(r.k)); uw += w; continue; }
    if (takeB) { const Row &r = B.rows[j++]; d.onlyB++; normalised(r.average, pb); const double w = 0.5 * share(B, r); d.unionWeightedTv += w * tv(pb, uniform(r.k)); uw += w; continue; }
    const Row &ra = A.rows[i++], &rb = B.rows[j++];
    if (ra.k != rb.k) { d.kMismatch++; continue; }
    d.common++; normalised(ra.average, pa); normalised(rb.average, pb);
    const double t = tv(pa, pb), w = 0.5 * (share(A, ra) + share(B, rb));
    d.meanTv += t; d.weightedTv += w * t; wsum += w; d.unionWeightedTv += w * t; uw += w;
    if (t > d.maxTv || d.maxTvKey.empty()) { d.maxTv = t; d.maxTvKey = ra.key; d.maxTvSeat = ra.seat; }
    if (ra.seat < seats) { d.seatWeightedTv[(size_t)ra.seat] += w * t; sw[(size_t)ra.seat] += w; d.seatCommon[(size_t)ra.seat]++; }
    normalised(ra.regret, ca); normalised(rb.regret, cb); d.currentMeanTv += tv(ca, cb);
  }
  if (d.common) { d.meanTv /= (double)d.common; d.currentMeanTv /= (double)d.common; }
  if (wsum > 0) d.weightedTv /= wsum;
  if (uw > 0) d.unionWeightedTv /= uw;
  for (size_t s = 0; s < sw.size(); s++) if (sw[s] > 0) d.seatWeightedTv[s] /= sw[s];
  const size_t uni = d.common + d.onlyA + d.onlyB + d.kMismatch; d.jaccard = uni ? (double)d.common / (double)uni : 1.0;
  return d;
}

// ---- spec game identity: two studies are comparable only if every game-defining field is equal.
inline const char *const IDENTITY_KEYS[] = {"protocol", "algorithm", "n", "board", "anteOf", "hands", "rules", "icm", "groupKeys", "turnGroups", "riverGroups", "abstraction"};
inline const char *const TRAINER_KEYS[] = {"weighting", "regretMatching", "dcfrAlpha", "dcfrBeta", "dcfrGamma", "dcfrEager", "batchDeals", "batchSchedule", "actionStreams", "terminalBaseline", "terminalExpectation", "chanceSampling", "opponentExploration", "ownHandEnumeration", "stratified", "updates"};
inline void canon(std::string &o, const JV *v) {
  if (!v || v->type == J_NULL) { o += "null"; return; }
  if (v->type == J_BOOL) { o += v->num != 0 ? "true" : "false"; return; }
  if (v->type == J_NUM) { char b[40]; std::snprintf(b, sizeof b, "%.17g", v->num); o += b; return; }
  if (v->type == J_STR) { o += '"'; o += v->str; o += '"'; return; }
  if (v->type == J_ARR) { o += '['; for (int i = 0; i < v->n; i++) { if (i) o += ','; canon(o, v->items[i]); } o += ']'; return; }
  std::vector<int> idx((size_t)v->n); for (int i = 0; i < v->n; i++) idx[(size_t)i] = i;
  std::sort(idx.begin(), idx.end(), [&](int a, int b) { return std::strcmp(v->keys[a], v->keys[b]) < 0; });
  o += '{'; bool first = true; for (int i : idx) { if (!first) o += ','; first = false; o += '"'; o += v->keys[i]; o += "\":"; canon(o, v->items[i]); } o += '}';
}
struct Compat { bool compatible = true; std::vector<std::string> differing, trainerDiffering; std::string identityA, identityB; };
inline Compat compatibility(const JV *a, const JV *b) {
  Compat c;
  for (const char *k : IDENTITY_KEYS) { std::string x, y; canon(x, jget(a, k)); canon(y, jget(b, k)); c.identityA += k + std::string("=") + x + ";"; c.identityB += k + std::string("=") + y + ";"; if (x != y) { c.compatible = false; c.differing.push_back(k); } }
  for (const char *k : TRAINER_KEYS) { std::string x, y; canon(x, jget(a, k)); canon(y, jget(b, k)); if (x != y) c.trainerDiffering.push_back(k); }
  { std::string x, y; canon(x, jget(a, "actionSeed")); canon(y, jget(b, "actionSeed")); if (x != y) c.trainerDiffering.push_back("actionSeed (random seed)"); }
  return c;
}
inline std::string gameHash(const JV *spec) { std::string t; for (const char *k : IDENTITY_KEYS) { t += k; t += '='; canon(t, jget(spec, k)); t += ';'; } emsha::Sha256 h; h.add(t.data(), t.size()); return h.hex().substr(0, 16); }

// ---- statistics
inline double normalQuantile(double p) {   // Acklam (|relative error| < 1.2e-9)
  static const double a[] = {-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00};
  static const double b[] = {-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01};
  static const double c[] = {-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00};
  static const double d[] = {7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00};
  if (p <= 0) return -INFINITY;
  if (p >= 1) return INFINITY;
  if (p < 0.02425) { const double q = std::sqrt(-2 * std::log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - 0.02425) return -normalQuantile(1 - p);
  const double q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
// Standard seat labels for a preflop root (last n of UTG ... BB); "seat k" otherwise.
inline std::string seatLabel(int seat, int n, bool preflop) {
  static const char *names[] = {"UTG", "UTG+1", "MP", "HJ", "CO", "BTN", "SB", "BB"};
  if (preflop && n >= 2 && n <= 8) return n == 2 ? (seat == 0 ? "SB (button)" : "BB") : names[8 - n + seat];
  return "seat " + std::to_string(seat + 1);
}
inline const char *stageName(int boardLength) { return boardLength == 0 ? "preflop" : boardLength == 3 ? "flop" : boardLength == 4 ? "turn" : "river"; }

} // namespace emana
