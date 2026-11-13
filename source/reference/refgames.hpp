// EightMax 4.7 independent reference games (Priority 1 / 14).
//
// This file shares NO code with the EightMax engine (native/mw*.{cpp,hpp}). It builds
// small imperfect-information games as explicit trees so that every quantity
// (reach probabilities, counterfactual values, best responses, NashConv) can be
// computed by plain enumeration and used to check the training algorithms.
//
// Games:
//   kuhn2   - two-player Kuhn poker (game value for the first player = -1/18)
//   kuhn3   - three-player Kuhn poker (4-card deck, ante 1, one bet of 1)
//   leduc2  - two-player Leduc hold'em (6 cards, bets 2/4, two raises a round;
//             game value for the first player approx. -0.0856)
//   pf3chip - three-player push/fold with unequal stacks, blinds, side pots, chip EV
//   pf3icm  - the same game with Malmuth-Harville ICM payouts (non-zero-sum)
//   wr2     - two-player one-street game with WEIGHTED private ranges and card removal
#pragma once
#include <vector>
#include <string>
#include <map>
#include <array>
#include <cmath>
#include <cstdint>
#include <algorithm>
#include <functional>
#include <stdexcept>
namespace ref {

struct Node {
  int type = 2;               // 0 chance, 1 player, 2 terminal
  int player = -1;            // acting player (type 1)
  int infoset = -1;           // information-set index (type 1)
  int dealTo = -1;            // chance: player whose private card this deals (-1 public card)
  std::vector<int> child;     // children
  std::vector<double> prob;   // chance probabilities (type 0)
  std::vector<double> util;   // terminal utilities, one per player (type 2)
};
struct Infoset { int player = 0, k = 0; std::string name; };
struct Game {
  std::string name; int n = 2;
  std::vector<Node> nodes; std::vector<Infoset> sets; std::map<std::string, int> setIndex;
  bool zeroSum = true;
  int add(Node x) { nodes.push_back(std::move(x)); return (int)nodes.size() - 1; }
  int infoset(int player, int k, const std::string &key) {
    auto it = setIndex.find(key);
    if (it != setIndex.end()) { if (sets[(size_t)it->second].k != k || sets[(size_t)it->second].player != player) throw std::logic_error("infoset mismatch " + key); return it->second; }
    sets.push_back({player, k, key}); setIndex[key] = (int)sets.size() - 1; return (int)sets.size() - 1;
  }
  // Structural checks: chance probabilities sum to 1, every infoset has a consistent action count.
  void check() const {
    for (const Node &x : nodes) {
      if (x.type == 0) { double s = 0; for (double p : x.prob) { if (!(p > 0)) throw std::logic_error("chance prob"); s += p; } if (std::fabs(s - 1) > 1e-12) throw std::logic_error("chance sum"); }
      if (x.type == 1 && (int)x.child.size() != sets[(size_t)x.infoset].k) throw std::logic_error("k");
      if (x.type == 2 && (int)x.util.size() != n) throw std::logic_error("util size");
    }
  }
};

// ------------------------------------------------------------ Kuhn (n players)
// Deck of n+1 cards (ranks 0..n), ante 1 each, one betting round: until someone
// bets, a player may check (0) or bet 1 (1); after a bet every later player
// (wrapping round to those who checked before it) may fold (0) or call (1).
inline Game kuhn(int n) {
  Game g; g.name = n == 2 ? "kuhn2" : "kuhn" + std::to_string(n); g.n = n; g.zeroSum = true;
  const int deck = n + 1;
  std::function<int(std::vector<int>, std::string, int, int, std::vector<int>)> bet;
  // state: cards, history string, next player, bettor (-1 none), status per player (0 in, 1 folded, 2 called/bet)
  bet = [&](std::vector<int> cards, std::string h, int p, int bettor, std::vector<int> st) -> int {
    // terminal?
    int acted = (int)h.size();
    bool done = false;
    if (bettor < 0 && acted == n) done = true;
    if (bettor >= 0) { int pending = 0; for (int q = 0; q < n; q++) if (st[(size_t)q] == 0) pending++; if (!pending) done = true; }
    if (done) {
      Node t; t.type = 2; t.util.assign((size_t)n, 0);
      double pot = n; std::vector<int> in;
      for (int q = 0; q < n; q++) { if (bettor < 0 || st[(size_t)q] == 2) in.push_back(q); if (st[(size_t)q] == 2) pot += 1; }
      int best = in[0]; for (int q : in) if (cards[(size_t)q] > cards[(size_t)best]) best = q;
      for (int q = 0; q < n; q++) t.util[(size_t)q] = -1 - (st[(size_t)q] == 2 ? 1 : 0);
      t.util[(size_t)best] += pot;
      return g.add(t);
    }
    while (bettor >= 0 && st[(size_t)p] != 0) p = (p + 1) % n;
    Node d; d.type = 1; d.player = p;
    d.infoset = g.infoset(p, 2, std::to_string(p) + ":" + std::to_string(cards[(size_t)p]) + ":" + h);
    for (int a = 0; a < 2; a++) {
      std::vector<int> s2 = st; int b2 = bettor;
      if (bettor < 0) { if (a == 1) { b2 = p; s2[(size_t)p] = 2; for (int q = 0; q < n; q++) if (q != p) s2[(size_t)q] = 0; } else s2[(size_t)p] = 3; }
      else s2[(size_t)p] = a == 1 ? 2 : 1;
      if (bettor < 0 && a == 0) s2[(size_t)p] = 0;   // checked: still pending if someone bets later
      std::string h2 = h + (bettor < 0 ? (a ? "b" : "k") : (a ? "c" : "f"));
      d.child.push_back(-1);
      d.child.back() = 0;  // placeholder
      int c = bet(cards, h2, (p + 1) % n, b2, s2);
      d.child.back() = c;
    }
    return g.add(d);
  };
  // NOTE on status after a check: we store 0 ("pending") so that a later bet makes
  // the checker respond; before any bet, 'pending' players are counted by h.size().
  std::function<int(std::vector<int>, int)> dealt = [&](std::vector<int> cards, int p) -> int {
    if (p == n) return bet(cards, "", 0, -1, std::vector<int>((size_t)n, 0));
    Node c; c.type = 0; c.dealTo = p; int left = 0;
    for (int x = 0; x < deck; x++) if (std::find(cards.begin(), cards.end(), x) == cards.end()) left++;
    for (int x = 0; x < deck; x++) if (std::find(cards.begin(), cards.end(), x) == cards.end()) {
      auto c2 = cards; c2.push_back(x); c.prob.push_back(1.0 / left); c.child.push_back(dealt(c2, p + 1));
    }
    return g.add(c);
  };
  int root = dealt({}, 0);
  // root must be index 0 for the algorithms: rotate by relabelling.
  std::vector<int> map(g.nodes.size()); std::vector<Node> out; out.reserve(g.nodes.size());
  std::function<void(int)> order = [&](int x) { map[(size_t)x] = (int)out.size(); out.push_back(g.nodes[(size_t)x]); for (int c : g.nodes[(size_t)x].child) order(c); };
  order(root); for (Node &x : out) for (int &c : x.child) c = map[(size_t)c];
  g.nodes.swap(out); g.check(); return g;
}

// ------------------------------------------------------------ Leduc (2 players)
inline Game leduc() {
  Game g; g.name = "leduc2"; g.n = 2; g.zeroSum = true;
  // cards 0..5, rank = card/2 (J,Q,K)
  auto showdownOrBoard = [&](int c0, int c1, int board, double each) -> int {
    auto strength = [&](int c) { return (c / 2 == board / 2) ? 10 + c / 2 : c / 2; };
    const int s0 = strength(c0), s1 = strength(c1);
    Node t; t.type = 2; t.util = s0 > s1 ? std::vector<double>{each, -each} : s0 < s1 ? std::vector<double>{-each, each} : std::vector<double>{0, 0};
    return g.add(t);
  };
  // Build with explicit history threading for the board chance node.
  std::function<int(int, int, int, std::string, int, double, double, int, int)> r1;
  r1 = [&](int c0, int c1, int board, std::string h, int p, double in0, double in1, int raises, int acted) -> int {
    const bool second = board >= 0; const double size = second ? 4 : 2; const double gap = std::fabs(in0 - in1);
    Node d; d.type = 1; d.player = p; const int card = p ? c1 : c0;
    std::string key = std::to_string(p) + ":" + std::to_string(card / 2) + ":" + (second ? std::to_string(board / 2) : "-") + ":" + h;
    std::vector<int> acts; if (gap > 0) { acts = {0, 1}; if (raises < 2) acts.push_back(2); } else acts = {1, 2};
    d.infoset = g.infoset(p, (int)acts.size(), key);
    for (int a : acts) {
      double n0 = in0, n1 = in1; std::string h2 = h;
      if (a == 0) { Node t; t.type = 2; t.util = p == 0 ? std::vector<double>{-in0, in0} : std::vector<double>{in1, -in1}; d.child.push_back(g.add(t)); continue; }
      if (a == 1) {
        if (p == 0) n0 = in1; else n1 = in0; h2 += gap > 0 ? "c" : "k";
        const bool closes = gap > 0 || acted >= 1;
        if (closes && second) d.child.push_back(showdownOrBoard(c0, c1, board, n0));
        else if (closes) {
          Node c; c.type = 0; c.dealTo = -1;
          for (int b = 0; b < 6; b++) if (b != c0 && b != c1) { c.prob.push_back(0.25); c.child.push_back(r1(c0, c1, b, h2 + "/", 0, n0, n1, 0, 0)); }
          d.child.push_back(g.add(c));
        } else d.child.push_back(r1(c0, c1, board, h2, 1 - p, n0, n1, raises, acted + 1));
        continue;
      }
      if (p == 0) n0 = std::max(in0, in1) + size; else n1 = std::max(in0, in1) + size;
      h2 += gap > 0 ? "r" : "b";
      d.child.push_back(r1(c0, c1, board, h2, 1 - p, n0, n1, raises + 1, acted + 1));
    }
    return g.add(d);
  };
  Node deal0; deal0.type = 0; deal0.dealTo = 0;
  std::vector<int> kids;
  for (int c0 = 0; c0 < 6; c0++) {
    Node deal1; deal1.type = 0; deal1.dealTo = 1;
    for (int c1 = 0; c1 < 6; c1++) if (c1 != c0) { deal1.prob.push_back(0.2); deal1.child.push_back(r1(c0, c1, -1, "", 0, 1, 1, 0, 0)); }
    deal0.prob.push_back(1.0 / 6); deal0.child.push_back(g.add(deal1));
  }
  int root = g.add(deal0);
  std::vector<int> map(g.nodes.size(), -1); std::vector<Node> out; out.reserve(g.nodes.size());
  std::function<void(int)> order = [&](int x) { map[(size_t)x] = (int)out.size(); out.push_back(g.nodes[(size_t)x]); for (int c : g.nodes[(size_t)x].child) order(c); };
  order(root); for (Node &x : out) for (int &c : x.child) c = map[(size_t)c];
  g.nodes.swap(out); g.check(); return g;
}

// ------------------------------------------------------------ ICM (Malmuth-Harville)
// Independent of native/icm.hpp: direct recursion over finishing orders.
inline std::vector<double> icm(const std::vector<double> &chips, const std::vector<double> &pay) {
  const int n = (int)chips.size(); std::vector<double> eq((size_t)n, 0);
  std::function<void(std::vector<bool> &, int, double)> rec = [&](std::vector<bool> &used, int place, double prob) {
    if (place >= (int)pay.size() || place >= n) return;
    double rest = 0; int alive = 0; for (int i = 0; i < n; i++) if (!used[(size_t)i]) { rest += chips[(size_t)i]; alive++; }
    for (int i = 0; i < n; i++) if (!used[(size_t)i]) {
      double p = rest > 0 ? chips[(size_t)i] / rest : 0;
      if (rest <= 0) p = 1.0 / alive;   // nobody has chips (cannot happen for a finished hand)
      if (p <= 0) continue;
      eq[(size_t)i] += prob * p * pay[(size_t)place];
      used[(size_t)i] = true; rec(used, place + 1, prob * p); used[(size_t)i] = false;
    }
  };
  std::vector<bool> used((size_t)n, false); rec(used, 0, 1.0);
  // Busted players (0 chips) never win a place above a player with chips: they share
  // the remaining payouts, ordered by `chips` = 0 -> handled by caller via tie-break.
  return eq;
}
// Busted players: finish below every survivor; among themselves, the one who started the
// hand with more chips finishes higher (the usual tournament rule); equal starts split.
inline std::vector<double> icmWithBusts(const std::vector<double> &chips, const std::vector<double> &start, const std::vector<double> &pay) {
  const int n = (int)chips.size(); std::vector<int> alive, out;
  for (int i = 0; i < n; i++) (chips[(size_t)i] > 1e-12 ? alive : out).push_back(i);
  std::vector<double> a; for (int i : alive) a.push_back(chips[(size_t)i]);
  std::vector<double> top(pay.begin(), pay.begin() + std::min(pay.size(), alive.size()));
  std::vector<double> e = icm(a, top), res((size_t)n, 0);
  for (size_t j = 0; j < alive.size(); j++) res[(size_t)alive[j]] = e[j];
  std::sort(out.begin(), out.end(), [&](int x, int y) { return start[(size_t)x] > start[(size_t)y]; });
  size_t place = alive.size();
  for (size_t j = 0; j < out.size();) {
    size_t k = j; while (k < out.size() && start[(size_t)out[k]] == start[(size_t)out[j]]) k++;
    double share = 0; for (size_t q = j; q < k; q++) share += place + (q - j) < pay.size() ? pay[place + (q - j)] : 0;
    for (size_t q = j; q < k; q++) res[(size_t)out[q]] = share / (double)(k - j);
    place += k - j; j = k;
  }
  return res;
}

// ------------------------------------------------------------ side pots (independent)
// Returns the chips each player receives at showdown. contrib: total chips put in;
// live: still contesting; strength: higher wins, ties split equally.
inline std::vector<double> settle(const std::vector<double> &contrib, const std::vector<bool> &live, const std::vector<int> &strength) {
  const int n = (int)contrib.size(); std::vector<double> got((size_t)n, 0);
  std::vector<double> levels(contrib); std::sort(levels.begin(), levels.end()); levels.erase(std::unique(levels.begin(), levels.end()), levels.end());
  double prev = 0;
  for (double L : levels) {
    if (L <= prev) continue;
    double layer = 0; std::vector<int> elig;
    for (int i = 0; i < n; i++) if (contrib[(size_t)i] >= L) { layer += L - prev; if (live[(size_t)i]) elig.push_back(i); }
    else if (contrib[(size_t)i] > prev) { layer += contrib[(size_t)i] - prev; }
    if (elig.empty()) {   // uncalled layer nobody live paid into: goes back to the live player with the largest contribution
      int best = -1; for (int i = 0; i < n; i++) if (live[(size_t)i] && (best < 0 || contrib[(size_t)i] > contrib[(size_t)best])) best = i;
      if (best >= 0) got[(size_t)best] += layer;
    } else {
      int top = -1; for (int i : elig) top = std::max(top, strength[(size_t)i]);
      int c = 0; for (int i : elig) c += strength[(size_t)i] == top;
      for (int i : elig) if (strength[(size_t)i] == top) got[(size_t)i] += layer / c;
    }
    prev = L;
  }
  return got;
}

// ------------------------------------------------------------ 3-player push/fold
// Seats 0 (button), 1 (small blind 0.5), 2 (big blind 1). Each player is dealt one
// card from a deck of `ranks` ranks x 2 suits (strength = rank). Action order 0,1,2:
// before any shove: fold (0) / shove (1); after a shove: fold (0) / call all-in (1).
// If everyone folds to the big blind, it wins the blinds. Unequal stacks create side
// pots. Utility: chips won (chip EV) or ICM equity of final stacks.
inline Game pushfold3(bool useIcm, int ranks = 4, std::vector<double> stacks = {10, 6, 3}, std::vector<double> pay = {0.65, 0.35, 0.0}) {
  Game g; g.name = useIcm ? "pf3icm" : "pf3chip"; g.n = 3; g.zeroSum = !useIcm;
  const double blind[3] = {0, 0.5, 1};
  const int deck = 2 * ranks;
  std::function<int(std::array<int, 3>, int, std::string, std::array<int, 3>)> act;
  // status: 0 not yet acted, 1 folded, 2 all-in
  act = [&](std::array<int, 3> cards, int p, std::string h, std::array<int, 3> st) -> int {
    if (p == 3) {
      std::vector<double> contrib(3); std::vector<bool> live(3); std::vector<int> str(3); int in = 0;
      for (int i = 0; i < 3; i++) { live[(size_t)i] = st[(size_t)i] == 2; in += live[(size_t)i]; str[(size_t)i] = cards[(size_t)i] / 2; }
      for (int i = 0; i < 3; i++) contrib[(size_t)i] = st[(size_t)i] == 2 ? stacks[(size_t)i] : std::min(blind[i], stacks[(size_t)i]);
      if (in == 0) { live[2] = true; }   // all folded: the big blind collects
      std::vector<double> got = settle(contrib, live, str);
      Node t; t.type = 2; t.util.resize(3);
      std::vector<double> fin(3);
      for (int i = 0; i < 3; i++) fin[(size_t)i] = stacks[(size_t)i] - contrib[(size_t)i] + got[(size_t)i];
      if (useIcm) { auto e = icmWithBusts(fin, stacks, pay); for (int i = 0; i < 3; i++) t.util[(size_t)i] = e[(size_t)i]; }
      else for (int i = 0; i < 3; i++) t.util[(size_t)i] = fin[(size_t)i] - stacks[(size_t)i];
      return g.add(t);
    }
    bool shoved = false; for (int i = 0; i < p; i++) if (st[(size_t)i] == 2) shoved = true;
    if (p == 2 && !shoved) { auto s2 = st; s2[2] = 0; return act(cards, 3, h, s2); }   // folded to the big blind
    Node d; d.type = 1; d.player = p;
    d.infoset = g.infoset(p, 2, std::to_string(p) + ":" + std::to_string(cards[(size_t)p] / 2) + ":" + h);
    for (int a = 0; a < 2; a++) { auto s2 = st; s2[(size_t)p] = a ? 2 : 1; d.child.push_back(act(cards, p + 1, h + (a ? "s" : "f"), s2)); }
    return g.add(d);
  };
  std::function<int(std::array<int, 3>, int)> deal = [&](std::array<int, 3> cards, int p) -> int {
    if (p == 3) return act(cards, 0, "", {0, 0, 0});
    Node c; c.type = 0; c.dealTo = p; int left = deck - p;
    for (int x = 0; x < deck; x++) { bool used = false; for (int i = 0; i < p; i++) used |= cards[(size_t)i] == x; if (used) continue;
      auto c2 = cards; c2[(size_t)p] = x; c.prob.push_back(1.0 / left); c.child.push_back(deal(c2, p + 1)); }
    return g.add(c);
  };
  int root = deal({-1, -1, -1}, 0);
  std::vector<int> map(g.nodes.size()); std::vector<Node> out; out.reserve(g.nodes.size());
  std::function<void(int)> order = [&](int x) { map[(size_t)x] = (int)out.size(); out.push_back(g.nodes[(size_t)x]); for (int c : g.nodes[(size_t)x].child) order(c); };
  order(root); for (Node &x : out) for (int &c : x.child) c = map[(size_t)c];
  g.nodes.swap(out); g.check(); return g;
}

// ------------------------------------------------------------ weighted ranges, card removal
// Two players, each holding one card from 6 cards (ranks 0..2 x 2 suits). Player 0's
// range weights favour high cards, player 1's low cards; deals are drawn with
// probability proportional to w0(c0) w1(c1) over DISTINCT cards (card removal).
// Pot 2, one street: P0 checks or bets 2; P1 facing a bet folds or calls; after a
// check P1 checks or bets 2 and P0 folds or calls.
inline Game weightedRiver() {
  Game g; g.name = "wr2"; g.n = 2; g.zeroSum = true;
  const double w0[6] = {0.2, 0.2, 0.5, 0.5, 1.0, 1.0}, w1[6] = {1.0, 1.0, 0.6, 0.6, 0.3, 0.3};
  auto show = [&](int c0, int c1, double each) { Node t; t.type = 2; int r0 = c0 / 2, r1 = c1 / 2; t.util = r0 > r1 ? std::vector<double>{each, -each} : r0 < r1 ? std::vector<double>{-each, each} : std::vector<double>{0, 0}; return g.add(t); };
  auto term = [&](double u0) { Node t; t.type = 2; t.util = {u0, -u0}; return g.add(t); };
  auto betting = [&](int c0, int c1) {
    Node r; r.type = 1; r.player = 0; r.infoset = g.infoset(0, 2, "0:" + std::to_string(c0 / 2) + ":");
    { Node b; b.type = 1; b.player = 1; b.infoset = g.infoset(1, 2, "1:" + std::to_string(c1 / 2) + ":b");
      b.child = {term(1), show(c0, c1, 3)}; int bi = g.add(b);
      Node k; k.type = 1; k.player = 1; k.infoset = g.infoset(1, 2, "1:" + std::to_string(c1 / 2) + ":k");
      Node kb; kb.type = 1; kb.player = 0; kb.infoset = g.infoset(0, 2, "0:" + std::to_string(c0 / 2) + ":kb");
      kb.child = {term(-1), show(c0, c1, 3)}; int kbi = g.add(kb);
      k.child = {show(c0, c1, 1), kbi}; int ki = g.add(k);
      r.child = {ki, bi}; }
    return g.add(r);
  };
  double z = 0; for (int a = 0; a < 6; a++) for (int b = 0; b < 6; b++) if (a != b) z += w0[a] * w1[b];
  Node d0; d0.type = 0; d0.dealTo = 0;
  for (int a = 0; a < 6; a++) {
    double m = 0; for (int b = 0; b < 6; b++) if (b != a) m += w0[a] * w1[b];
    Node d1; d1.type = 0; d1.dealTo = 1;
    for (int b = 0; b < 6; b++) if (b != a) { d1.prob.push_back(w0[a] * w1[b] / m); d1.child.push_back(betting(a, b)); }
    d0.prob.push_back(m / z); d0.child.push_back(g.add(d1));
  }
  int root = g.add(d0);
  std::vector<int> map(g.nodes.size()); std::vector<Node> out;
  std::function<void(int)> order = [&](int x) { map[(size_t)x] = (int)out.size(); out.push_back(g.nodes[(size_t)x]); for (int c : g.nodes[(size_t)x].child) order(c); };
  order(root); for (Node &x : out) for (int &c : x.child) c = map[(size_t)c];
  g.nodes.swap(out); g.check(); return g;
}

} // namespace ref
