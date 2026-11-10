// EightMax 3.8: native-backed strategy explorer for external-sampling studies.
// Included by mw.cpp after mw_root_policy().
//
// mw_node_query() answers one request about one decision point of a live or
// restored native study without exporting the state. It walks a validated
// action path from the root through the betting rules (Rules::advance /
// nextStreet, the same functions training uses), looks up the committed state
// id of every step in the state table, and reads only the strategy rows of the
// selected node: one row per hand key of the acting seat (at most 1,326).
//
// Reported strategies, never substituted for one another:
//   average  - the stored average-strategy sums of the row, normalized. This is
//              the strategy the solver outputs. null when the row is missing or
//              its sums are zero.
//   current  - regret matching of the stored cumulative regrets (CFR+/DCFR
//              rows store the clipped/discounted values; DCFR rows are reported
//              as stored, i.e. discounted through their last update). Uniform
//              when every regret is non-positive, exactly as training does; null
//              when the row is missing.
// Grouped studies (Compact/Detailed hand groups, turn representatives) share
// one row among the hands of a group; each hand reports its group key and the
// shared row, so frequencies are labelled as group strategies.
// Range reach of a seat at the node = combo weight * product of that seat's
// average-strategy probabilities for the actions it took on the path (uniform
// where a row has no average, flagged per hand), zero for board-blocked hands.
// Action EVs are not part of the stored state and are never reported.
namespace {
namespace es {
struct QueryError { int status; std::string message; };
inline const char *streetName(int length) { return length == 0 ? "preflop" : length == 3 ? "flop" : length == 4 ? "turn" : "river"; }
inline int cardsAtStreet(int length) { return length == 0 ? 0 : length; }
// Non-mutating version of worldGroups() for one seat and hand.
inline bool groupKeyAt(const MW &m, const GroupKeys &G, const std::vector<std::vector<uint32_t>> &start, int seat, int index, const int *cards, int length, uint32_t &out) {
  const Hand &h = m.hands[(size_t)seat][(size_t)index];
  std::string key; unsigned long long num; int previous = -1;
  for (int i = 0; i < G.nl; i++) {
    const int L = G.lengths[i]; if (L > length) break;
    uint32_t id;
    if (L == G.start) id = start[(size_t)seat][(size_t)index];
    else {
      int all[7]; std::copy_n(cards, L, all); all[L] = h.a; all[L + 1] = h.b;
      G.signal(key, num, seat, h.a, h.b, h.id, cards, L, evalAny(all, L + 2), previous);
      auto it = G.index.find(key); if (it == G.index.end()) return false;
      id = it->second;
    }
    previous = (int)id; if (L == length) { out = id; return true; }
  }
  return false;
}
struct Lookup { long long row = -1; int hand = 0; uint32_t code = 0; bool key = false; };
inline Lookup rowOf(const MW &m, const Game &g, int state, int seat, int index, const int *cards, int length) {
  Lookup r; const Hand &h = m.hands[(size_t)seat][(size_t)index];
  r.hand = h.strategyHand; r.code = cardsCode(cards, length);
  if (g.groups.on) { r.hand = 0; if (!groupKeyAt(m, g.groups, g.startKey, seat, index, cards, length, r.code)) return r; }
  else if (!m.turnGroups.empty()) {
    const int slot = length == 5 ? cards[4] + 1 : 0;
    const int id = m.turnGroups[(size_t)seat][(size_t)slot * m.hands[(size_t)seat].size() + (size_t)index];
    r.hand = id % 2048; r.code = cardsCode(cards, 4) + (uint32_t)(id / 2048);
  }
  r.key = true; r.row = state >= 0 ? m.findRow(rowKey((uint32_t)state, r.hand, r.code)) : -1; return r;
}
inline bool averageOf(const MW &m, long long row, int k, double *p) {
  if (row < 0) return false; const double *avg = m.vals.data() + m.rows[(size_t)row].off + k; double t = 0;
  for (int a = 0; a < k; a++) t += avg[a];
  if (!(t > 0)) return false;
  for (int a = 0; a < k; a++) p[a] = avg[a] / t; return true;
}
inline bool currentOf(const MW &m, long long row, int k, double *p) {
  if (row < 0) return false; const double *reg = m.vals.data() + m.rows[(size_t)row].off; double t = 0;
  for (int a = 0; a < k; a++) { p[a] = jsMax0(reg[a]); t += p[a]; }
  for (int a = 0; a < k; a++) p[a] = t ? p[a] / t : 1.0 / k; return true;
}
inline const char *actionName(const BS &s, int a) {
  const bool call = s.facing && a == 1 && s.to[a] <= s.price + 1e-9;
  if (s.facing) return a == 0 ? "Fold" : call ? "Call" : s.to[a] >= s.behind[s.actor] + s.put[s.actor] - 1e-9 ? "All-in" : "Raise to";
  if (a == 0) return "Check";
  return s.to[a] >= s.behind[s.actor] + s.put[s.actor] - 1e-9 ? "All-in" : "Bet to";
}
inline void seatArray(JB *o, const char *name, const double *v, int n) { jb_printf(o, ",\"%s\":[", name); for (int p = 0; p < n; p++) { if (p) jb_putc(o, ','); jb_num(o, v[p], 10); } jb_putc(o, ']'); }
struct Step { int seat, slot, state, length; };
} // namespace es
} // namespace

extern "C" int mw_node_query(MW *m, const char *json, size_t len, JB *out, char *err, int errlen, volatile int *cancel) {
  using namespace es;
  if (!m || !m->es) { fail(err, errlen, "The strategy explorer needs a native external-sampling study"); return 400; }
  const Game &g = *m->es; const int n = m->n;
  JV *req = json_parse(json && len ? json : "{}", json && len ? len : 2, err, errlen);
  if (!req) return 400;
  struct Free { JV *v; ~Free() { json_free(v); } } freeReq{req};
  try {
    auto ints = [&](const char *name, std::vector<int> &v, int lo, int hi, size_t max) {
      JV *a = jget(req, name); if (!a) return;
      if (a->type != J_ARR || (size_t)a->n > max) throw QueryError{400, std::string("Invalid ") + name};
      for (int i = 0; i < a->n; i++) { JV *x = a->items[i]; if (!isInt(x) || x->num < lo || x->num > hi) throw QueryError{400, std::string("Invalid ") + name}; v.push_back((int)x->num); }
    };
    std::vector<int> path, dealt; ints("path", path, 0, 7, MAX_DEPTH); ints("board", dealt, 0, 51, 5);
    const double offD = jnum(jget(req, "offset"), 0), limD = jnum(jget(req, "limit"), 1326);
    if (!(offD >= 0 && offD <= 1e6 && std::floor(offD) == offD) || !(limD >= 0 && limD <= 1326 && std::floor(limD) == limD)) throw QueryError{400, "offset must be >= 0 and limit 0 to 1326"};
    const double rangeD = jnum(jget(req, "rangeSeat"), -1);
    if (!(rangeD >= -1 && rangeD < n && std::floor(rangeD) == rangeD)) throw QueryError{400, "Invalid rangeSeat"};
    // Board: the study's fixed cards, then the requested dealt cards in order.
    int cards[5] = {0, 0, 0, 0, 0}; uint64_t used = 0; int known = m->startLen;
    for (int i = 0; i < m->startLen; i++) { cards[i] = m->board[i]; used |= 1ULL << cards[i]; }
    if ((int)dealt.size() > 5 - m->startLen) throw QueryError{400, "Too many board cards for this study"};
    for (int c : dealt) { if (used >> c & 1) throw QueryError{400, "Board cards must be distinct and differ from the study board"}; used |= 1ULL << c; }
    std::vector<BS> trail; trail.reserve(path.size() + 8); trail.push_back(g.rootState);
    std::vector<Step> steps; int state = 0; size_t pi = 0, di = 0; int needCards = 0;
    // Walk: decision nodes consume path entries, chance nodes consume board cards.
    for (;;) {
      if (cancel && __atomic_load_n(cancel, __ATOMIC_RELAXED)) throw QueryError{409, "Query cancelled"};
      const BS &t = trail.back();
      if (t.kind == 2) { if (pi < path.size()) throw QueryError{400, "The path continues past a terminal state (hand over)"}; break; }
      if (t.kind == 1) {
        const int next = t.length == 0 ? 3 : t.length + 1;
        const int need = (t.length == 0 ? 3 : 1);
        if ((int)(dealt.size() - di) < need) { if (pi < path.size()) throw QueryError{400, "Select the next board card(s) before continuing the path"}; needCards = need; break; }
        for (int j = 0; j < need; j++) cards[known++] = dealt[di++];
        if (m->startLen == 0 && next == 3) std::sort(cards, cards + 3);   // MW::deal() sorts a dealt flop
        BS c; g.rules.nextStreet(t, c);
        steps.push_back({-1, CHANCE_SLOT, state, t.length});
        state = state >= 0 ? g.states.find((uint32_t)state, CHANCE_SLOT) : -1; trail.push_back(c); continue;
      }
      if (pi >= path.size()) break;
      const int a = path[pi++];
      if (a >= t.k) throw QueryError{400, "Action " + std::to_string(a) + " is not in the solved abstraction at step " + std::to_string(pi) + " (" + std::to_string(t.k) + " legal actions). Unsolved branches are never synthesized."};
      BS c; g.rules.advance(t, a, c);
      steps.push_back({t.actor, a, state, t.length});
      state = state >= 0 && c.kind != 2 ? g.states.find((uint32_t)state, a) : -1; trail.push_back(c);
    }
    if (di < dealt.size()) throw QueryError{400, "More board cards were given than the path reaches"};
    const BS &t = trail.back();
    const int k = t.kind == 0 ? t.k : 0, actor = t.kind == 0 ? t.actor : -1;
    const int rangeSeat = rangeD >= 0 ? (int)rangeD : actor >= 0 ? actor : -1;
    // ---- study and node ----
    jb_printf(out, "{\"engine\":\"native external sampling\",\"study\":{\"players\":%d,\"startStreet\":\"%s\",\"updates\":%lld,\"sampledDeals\":%lld,\"rows\":%zu,\"states\":%zu,\"abstraction\":\"%s\",\"weighting\":\"%s\",\"regretMatching\":\"%s\",\"tournament\":%s}",
      n, streetName(m->startLen), m->iterations, m->trainingDeals, m->rows.size(), g.states.parent.size(),
      g.groups.on ? (g.groups.detailed ? "detailed groups" : "compact groups") : !m->turnGroups.empty() ? "turn representatives" : "exact cards",
      g.dcfr ? "dcfr" : m->linear ? "linear" : "uniform", m->plus ? "plus" : "standard", m->tournament.start.empty() ? "false" : "true");
    const bool visited = state >= 0 && t.kind != 2;
    jb_printf(out, ",\"node\":{\"kind\":\"%s\",\"street\":\"%s\",\"length\":%d,\"stateId\":%d,\"visited\":%s,\"actor\":%d,\"facing\":%s,\"price\":",
      t.kind == 0 ? "decision" : t.kind == 1 ? "chance" : "terminal", streetName(t.length), t.length, state, visited ? "true" : "false", actor, t.facing ? "true" : "false");
    jb_num(out, t.price, 10); jb_puts(out, ",\"pot\":"); jb_num(out, t.pot, 10);
    double prior[8], totalIn[8], liveF[8];
    for (int p = 0; p < n; p++) { prior[p] = g.rules.prior[p]; totalIn[p] = t.total[p]; liveF[p] = t.live[p]; }
    seatArray(out, "behind", t.behind, n); seatArray(out, "streetPut", t.put, n); seatArray(out, "committed", totalIn, n); seatArray(out, "prior", prior, n);
    jb_puts(out, ",\"live\":["); for (int p = 0; p < n; p++) jb_printf(out, "%s%s", p ? "," : "", liveF[p] ? "true" : "false"); jb_putc(out, ']');
    jb_puts(out, ",\"allIn\":["); for (int p = 0; p < n; p++) jb_printf(out, "%s%s", p ? "," : "", t.live[p] && t.behind[p] <= EPS ? "true" : "false"); jb_putc(out, ']');
    { double mo = 0; for (int p = 0; p < n; p++) if (t.live[p] && p != actor) mo = std::max(mo, t.behind[p]);
      jb_puts(out, ",\"effectiveStack\":"); if (actor >= 0) jb_num(out, std::min(t.behind[actor], mo), 10); else jb_puts(out, "null"); }
    jb_puts(out, ",\"board\":["); for (int i = 0; i < known; i++) jb_printf(out, "%s%d", i ? "," : "", cards[i]); jb_putc(out, ']');
    if (needCards) jb_printf(out, ",\"needsCards\":%d", needCards);
    if (t.kind == 2) {
      LPot pots[24]; const int np = g.rules.pots(t, pots);
      jb_puts(out, ",\"pots\":[");
      for (int q = 0; q < np; q++) { if (q) jb_putc(out, ','); jb_puts(out, "{\"amount\":"); jb_num(out, pots[q].amount, 10); jb_puts(out, ",\"eligible\":[");
        bool first = true; for (int j = 0; j < pots[q].count; j++) if (pots[q].seat[j] < n) { jb_printf(out, "%s%d", first ? "" : ",", pots[q].seat[j]); first = false; } jb_puts(out, "]}"); }
      jb_putc(out, ']');
    }
    jb_putc(out, '}');
    // ---- history ----
    jb_puts(out, ",\"history\":[");
    { int shown = m->startLen;
      for (size_t i = 0; i < steps.size(); i++) {
        if (i) jb_putc(out, ',');
        const Step &s = steps[i];
        if (s.seat < 0) { const int need = s.length == 0 ? 3 : 1; jb_printf(out, "{\"chance\":true,\"street\":\"%s\",\"cards\":[", streetName(s.length == 0 ? 3 : s.length + 1));
          for (int j = 0; j < need; j++) jb_printf(out, "%s%d", j ? "," : "", cards[shown + j]); shown += need; jb_puts(out, "]}"); continue; }
        const BS &b = trail[i]; jb_printf(out, "{\"seat\":%d,\"street\":\"%s\",\"slot\":%d,\"action\":\"%s\",\"to\":", s.seat, streetName(s.length), s.slot, actionName(b, s.slot)); jb_num(out, b.to[s.slot], 10);
        jb_printf(out, ",\"stateId\":%d}", s.state);
      } }
    jb_putc(out, ']');
    // ---- legal actions ----
    jb_puts(out, ",\"actions\":[");
    for (int a = 0; a < k; a++) {
      BS c; g.rules.advance(t, a, c);
      const int child = state >= 0 && c.kind != 2 ? g.states.find((uint32_t)state, a) : -1;
      jb_printf(out, "%s{\"slot\":%d,\"name\":\"%s\",\"to\":", a ? "," : "", a, actionName(t, a)); jb_num(out, t.to[a], 10);
      jb_printf(out, ",\"leadsTo\":\"%s\",\"childVisited\":%s}", c.kind == 2 ? "terminal" : c.kind == 1 ? "chance" : "decision", c.kind == 2 ? "null" : child >= 0 ? "true" : "false");
    }
    jb_puts(out, "],\"ev\":{\"available\":false,\"reason\":\"External-sampling checkpoints store cumulative regrets and average-strategy sums only; action EVs are not stored and are not estimated here.\"}");
    jb_puts(out, ",\"strategyKinds\":{\"average\":\"normalized stored average-strategy sums (solver output)\",\"current\":\"regret matching of stored cumulative regrets\"}");
    if (rangeSeat < 0) { jb_puts(out, ",\"hands\":null}"); return 200; }
    // ---- hands of the range seat ----
    const auto &range = m->hands[(size_t)rangeSeat]; const size_t N = range.size();
    const size_t off = (size_t)offD, lim = (size_t)limD;
    // reach: product over the seat's decisions on the path
    std::vector<double> reach(N); std::vector<uint8_t> approx(N, 0);
    std::vector<double> prob(8);
    for (size_t i = 0; i < N; i++) {
      if (!(i % 64) && cancel && __atomic_load_n(cancel, __ATOMIC_RELAXED)) throw QueryError{409, "Query cancelled"};
      const Hand &h = range[i];
      if ((used >> h.a & 1) || (used >> h.b & 1)) { reach[i] = 0; continue; }
      double r = h.w;
      for (size_t s = 0; s < steps.size() && r > 0; s++) {
        const Step &st = steps[s];
        if (st.seat < 0) continue;
        if (st.seat != rangeSeat) continue;
        const int kk = trail[s].k; const Lookup L = rowOf(*m, g, st.state, rangeSeat, (int)i, cards, st.length);
        if (averageOf(*m, L.row, kk, prob.data())) r *= prob[(size_t)st.slot]; else { r *= 1.0 / kk; approx[i] = 1; }
      }
      reach[i] = r;
    }
    double mass = 0; for (double r : reach) mass += r;
    std::vector<double> aggAvg(8, 0), aggCur(8, 0); double avgMass = 0, curMass = 0; size_t withRows = 0, blocked = 0;
    jb_printf(out, ",\"hands\":{\"seat\":%d,\"actingSeat\":%s,\"total\":%zu,\"offset\":%zu,\"items\":[", rangeSeat, rangeSeat == actor ? "true" : "false", N, off);
    bool first = true;
    for (size_t i = 0; i < N; i++) {
      const Hand &h = range[i]; const bool isBlocked = (used >> h.a & 1) || (used >> h.b & 1); blocked += isBlocked;
      double avg[8], cur[8]; bool hasAvg = false, hasCur = false; Lookup L;
      if (rangeSeat == actor && !isBlocked) {
        L = rowOf(*m, g, state, actor, (int)i, cards, t.length);
        hasAvg = averageOf(*m, L.row, k, avg); hasCur = currentOf(*m, L.row, k, cur); withRows += L.row >= 0;
        if (hasAvg) { for (int a = 0; a < k; a++) aggAvg[(size_t)a] += reach[i] * avg[a]; avgMass += reach[i]; }
        if (hasCur) { for (int a = 0; a < k; a++) aggCur[(size_t)a] += reach[i] * cur[a]; curMass += reach[i]; }
      }
      if (i < off || i >= off + lim) continue;
      if (!first) jb_putc(out, ','); first = false;
      jb_printf(out, "{\"i\":%zu,\"cards\":[%d,%d],\"weight\":", i, h.a, h.b); jb_num(out, h.w, 10);
      jb_printf(out, ",\"blocked\":%s,\"reach\":%.17g", isBlocked ? "true" : "false", reach[i]);
      jb_printf(out, ",\"reachUsesUniform\":%s", approx[i] ? "true" : "false");
      if (rangeSeat == actor && !isBlocked) {
        jb_printf(out, ",\"row\":%s,\"key\":{\"hand\":%d,\"code\":%u,\"found\":%s}", L.row >= 0 ? "true" : "false", L.hand, L.code, L.key ? "true" : "false");
        jb_puts(out, ",\"average\":"); if (hasAvg) { jb_putc(out, '['); for (int a = 0; a < k; a++) { if (a) jb_putc(out, ','); jb_printf(out, "%.17g", avg[a]); } jb_putc(out, ']'); } else jb_puts(out, "null");
        jb_puts(out, ",\"current\":"); if (hasCur) { jb_putc(out, '['); for (int a = 0; a < k; a++) { if (a) jb_putc(out, ','); jb_printf(out, "%.17g", cur[a]); } jb_putc(out, ']'); } else jb_puts(out, "null");
      }
      jb_putc(out, '}');
    }
    jb_puts(out, "]},\"aggregate\":{\"rangeMass\":"); jb_num(out, mass, 12);
    jb_puts(out, ",\"average\":"); if (avgMass > 0) { jb_putc(out, '['); for (int a = 0; a < k; a++) { if (a) jb_putc(out, ','); jb_printf(out, "%.17g", aggAvg[(size_t)a] / avgMass); } jb_putc(out, ']'); } else jb_puts(out, "null");
    jb_puts(out, ",\"current\":"); if (curMass > 0) { jb_putc(out, '['); for (int a = 0; a < k; a++) { if (a) jb_putc(out, ','); jb_printf(out, "%.17g", aggCur[(size_t)a] / curMass); } jb_putc(out, ']'); } else jb_puts(out, "null");
    jb_puts(out, ",\"averageCoveredMass\":"); jb_num(out, avgMass, 12);
    jb_printf(out, ",\"coverage\":{\"hands\":%zu,\"blocked\":%zu,\"withRows\":%zu}}}", N, blocked, withRows);
    return 200;
  } catch (const QueryError &e) { fail(err, errlen, e.message.c_str()); return e.status; }
  catch (const std::bad_alloc &) { fail(err, errlen, "Out of memory"); return 503; }
}
