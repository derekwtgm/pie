// EightMax 3.1: external-sampling training, EMMW4 state export/import and the
// protocol-4 spec parser. Included by mw.cpp after struct MW (see mw_es.hpp).
#pragma once
#include <climits>
namespace {
namespace es {
constexpr int TERMINAL_REF = INT_MAX;
#include "es_transaction.hpp"
struct Walker {
  const MW &m; const Game &g;
  Unit *u = nullptr; Rng *rng = nullptr; int player = 0; double step = 1, avgStep = 1;
  std::pmr::vector<BS> st; std::pmr::vector<double> sig, samp, val;
  struct Edge;
  Tournament::Workspace icm; double util[8] = {}; LPot pots[24];
  // 3.8: per-worker direct-mapped cache of committed betting transitions,
  // keyed by (committed parent state id, action slot). A betting state depends
  // only on the action path, never on cards, so a hit returns the identical
  // BS that Rules::advance/nextStreet would rebuild, plus the child's committed
  // state id once known. 3.7 cached only the first 64 parents and only for
  // four or more seats. Committed ids are never renumbered while a Walker
  // lives: states are appended during merges and a rollback ends train().
  //
  // Only the key arrays are initialized. Payload slots are raw storage from the
  // scratch budget and are written before they are first read (a key match
  // implies a prior store), so pages a short run never touches are never
  // faulted in. Zero-filling multi-megabyte caches cost more than they saved
  // on runs of a few milliseconds.
  template<class T> struct Raw {
    std::pmr::memory_resource *r=nullptr; T *p=nullptr; size_t n=0;
    void init(std::pmr::memory_resource *res,size_t count){r=res;n=count;p=count?static_cast<T*>(r->allocate(count*sizeof(T),alignof(T))):nullptr;}
    ~Raw(){if(p)r->deallocate(p,n*sizeof(T),alignof(T));}
    T &operator[](size_t i){return p[i];}
  };
  struct Edge {int id;BS state;};
  std::pmr::vector<uint64_t> edgeKeys,termKeys; Raw<Edge> edges; size_t edgeMask=0;
  static size_t edgeEntries(double budgetBytes){
#ifdef EM_EDGE_ENTRIES
    if(budgetBytes>=8*1048576.0)return EM_EDGE_ENTRIES;
#endif
    // Measured (validation/3.8/cache-tuning.json): 512 hashed entries were
    // neutral on short multiway runs dominated by first-time states and kept
    // the gain on long heads-up/three-way runs; 1,024-8,192 entries thrashed
    // L1/L2 on those short runs.
    return budgetBytes>=8*1048576.0?512:0;
  }
  // Index of the cache slot of (ref, a), or SIZE_MAX when uncacheable.
  // Four or more seats: 3.7's direct map of the first 64 committed parents
  // (the hot top of a wide tree; no conflicts). Two or three seats: hashed
  // over every committed parent, which measured faster on deep narrow trees
  // (validation/3.8/native-timing*.json).
  size_t slotOf(int ref,int a) const {
    if(ref<0||!edgeMask)return SIZE_MAX;
    if(m.n>=4)return (unsigned)ref<64?(size_t)ref*8+(unsigned)a:SIZE_MAX;
    return StateTable::mix((uint64_t)(uint32_t)ref*8+(unsigned)a)&edgeMask;
  }
  void advance(int ref,const BS &t,int a,BS &next){
    const size_t i=slotOf(ref,a);
    if(i==SIZE_MAX){g.rules.advance(t,a,next);return;}
    const uint64_t key=(uint64_t)(uint32_t)ref*8+(unsigned)a;
    if(edgeKeys[i]==key){next=edges[i].state;return;}
    g.rules.advance(t,a,next);edgeKeys[i]=key;edges[i].id=-1;edges[i].state=next;
  }
  void street(int ref,const BS &t,BS &next){
    const size_t i=slotOf(ref,CHANCE_SLOT);
    if(i==SIZE_MAX){g.rules.nextStreet(t,next);return;}
    const uint64_t key=(uint64_t)(uint32_t)ref*8+CHANCE_SLOT;
    if(edgeKeys[i]==key){next=edges[i].state;return;}
    g.rules.nextStreet(t,next);edgeKeys[i]=key;edges[i].id=-1;edges[i].state=next;
  }
  Walker(const MW &mm, const Game &gg,ScratchBudget &budget) : m(mm), g(gg),st(&budget),sig(&budget),samp(&budget),val(&budget),edgeKeys(&budget),termKeys(&budget) {
    if(const size_t e=edgeEntries(mm.budgetBytes)){edgeKeys.assign(e,UINT64_MAX);termKeys.assign(e,UINT64_MAX);edges.init(&budget,e);terms.init(&budget,e);edgeMask=e-1;}
    st.resize(MAX_DEPTH + 2); sig.resize((MAX_DEPTH + 2) * 8); samp.resize((MAX_DEPTH + 2) * 8); val.resize((MAX_DEPTH + 2) * 8);
    if (!m.tournament.start.empty()) m.tournament.prepare(icm,m.budgetBytes);
  }
  int child(int ref, int slot, const BS &c) {
    if (c.kind == 2) { terminalKey = edgeKey(ref, slot); return TERMINAL_REF; }
    if (ref >= 0) {
      const size_t i=slotOf(ref,slot);const uint64_t key=(uint64_t)(uint32_t)ref*8+(unsigned)slot;
      const bool cached=i!=SIZE_MAX&&edgeKeys[i]==key;
      if(cached&&edges[i].id>=0)return edges[i].id;
      int id = g.states.find((uint32_t)ref, slot);
      if (id >= 0) { if(cached)edges[i].id=id; return id; }
    }
    if (!u->room(1, 0, 0, g.unitLimitBytes)) { u->overflow = true; return 0; }
    u->pending.push_back({ref, slot, (uint8_t)c.kind, (uint8_t)std::max(0, c.actor), (uint8_t)c.length, (uint8_t)c.k});
    return -(int)u->pending.size();
  }
  void policy(int ref, int k, int hand, uint32_t code, double *s) const {
    long long r = ref >= 0 ? m.findRow(rowKey((uint32_t)ref, hand, code)) : -1;
    double tot = 0;
    if(r<0){std::fill_n(s,k,1.0/k);return;}
    const double *regrets=m.vals.data()+m.rows[(size_t)r].off;
    for(int a=0;a<k;a++){s[a]=jsMax0(regrets[a]);tot+=s[a];}
    for (int a = 0; a < k; a++) s[a] = tot ? s[a] / tot : 1.0 / k;
  }
  // 3.8: pot layouts of terminal betting states, reduced to the dealt seats
  // that can win them (ascending seat bitmask; folded and absent entries can
  // never collect a pot in payoff()/seatPayoff()). A layout depends only on the
  // betting path, so it is cached per committed (parent state, action) edge.
  // Seats are visited in the same ascending order and all additions happen in
  // the same order as in 3.7, so utilities are bit-identical.
  struct CPot { double amount; uint32_t mask; };
  static constexpr int MAX_CACHED_POTS = 12;
  struct TermEntry { int np; CPot pot[MAX_CACHED_POTS]; };
  Raw<TermEntry> terms; uint64_t terminalKey = UINT64_MAX; CPot cpots[24];
  int layout(const BS &t, uint64_t key, const CPot *&out) {
    const size_t i = key != UINT64_MAX ? slotOf((int)(key / 8), (int)(key % 8)) : SIZE_MAX;
    TermEntry *e = i != SIZE_MAX ? &terms[i] : nullptr;
    if (e && termKeys[i] == key) { out = e->pot; return e->np; }
    const int np = g.rules.pots(t, pots);
    for (int q = 0; q < np; q++) cpots[q] = {pots[q].amount, pots[q].mask};
    if (e && np <= MAX_CACHED_POTS) { termKeys[i] = key; e->np = np; std::copy_n(cpots, np, e->pot); }
    out = cpots; return np;
  }
  const double *payoff(const BS &t, uint64_t key = UINT64_MAX) {
    const int n = m.n; const CPot *lay; const int np = layout(t, key, lay);
    const bool tour = !m.tournament.start.empty();
    for (int p = 0; p < n; p++) util[p] = tour ? t.behind[p] : -t.total[p] - m.anteOf[(size_t)p];
    for (int q = 0; q < np; q++) {
      const CPot &pot = lay[q]; double top = -INFINITY; int count = 0;
      for (uint32_t x = pot.mask; x; x &= x - 1) { const int e = std::countr_zero(x); double v = u->w.score[e]; if (v > top) { top = v; count = 1; } else if (v == top) count++; }
      if (!count) continue;
      const double share = pot.amount / count;
      for (uint32_t x = pot.mask; x; x &= x - 1) { const int e = std::countr_zero(x); if (u->w.score[e] == top) util[e] += share; }
    }
    if (tour) m.tournament.evaluate(util, n, icm);
    return util;
  }
  double seatPayoff(const BS &t, uint64_t key = UINT64_MAX){
    if(!m.tournament.start.empty())return payoff(t,key)[player];
    double value=-t.total[player]-m.anteOf[player];
    const CPot *lay; const int count=layout(t,key,lay),rank=u->w.score[player];
    for(int q=0;q<count;q++){const auto &pot=lay[q];int ties=0;bool eligible=false,lost=false;
      for(uint32_t x=pot.mask;x;x&=x-1){const int seat=std::countr_zero(x);
        if(u->w.score[seat]>rank){lost=true;break;}
        eligible|=seat==player;ties+=u->w.score[seat]==rank;
      }
      if(eligible&&!lost)value+=pot.amount/ties;
    }return value;
  }
  // Child state and reference after action slot `a` (CHANCE_SLOT: next street).
  int descend(int ref,const BS &t,int a,BS &c){
    if(ref>=0&&!g.store.empty()){
      const int id=g.states.find((uint32_t)ref,a);
      if(id>=0){
        if((size_t)id<g.store.size()){c=g.store[(size_t)id];return id;}
        if(a==CHANCE_SLOT)street(ref,t,c);else advance(ref,t,a,c);
        return id;
      }
    }
    if(a==CHANCE_SLOT)street(ref,t,c);else advance(ref,t,a,c);
    return child(ref,a,c);
  }
  static uint64_t edgeKey(int ref,int a){return ref>=0?(uint64_t)(uint32_t)ref*8+(unsigned)a:UINT64_MAX;}
  static int choose(const double *q, int k, Rng &r) {
    const double value = r.next(); double cumulative = 0;
    for (int a = 0; a < k; a++) { cumulative += q[a]; if (value < cumulative) return a; }
    return k - 1;
  }
  // lib_wide.js learn(): returns the sampled value for `player`.
  double learn(int d, int ref, double own, double opp, double sp) {
    u->visits++;
    BS &t = st[(size_t)d];
    const uint64_t tkey = ref == TERMINAL_REF ? terminalKey : UINT64_MAX;
    if (t.kind == 2 || (g.terminalExpectation && !t.live[player] && m.tournament.start.empty())) {
      // A folded player only receives chips if an unmatched top contribution
      // is returned. A covering contribution rules that out.
      if (!t.live[player] && m.tournament.start.empty()) {
        const auto paid=[&](int seat){return g.rules.prior[seat]+t.total[seat]+(g.rules.pre?g.rules.ownAnte[seat]:0);};
        const double wager=paid(player);
        for(int seat=0;seat<m.n;++seat)
          if(seat!=player && paid(seat)>=wager)
            return -t.total[player]-m.anteOf[player];
      }
      if(t.kind==2)return seatPayoff(t,tkey);
    }
    if (d + 1 >= MAX_DEPTH || u->overflow) { u->overflow = true; return 0; }
    BS &c = st[(size_t)d + 1];
    if (t.kind == 1) { const int r = descend(ref, t, CHANCE_SLOT, c); return learn(d + 1, r, own, opp, sp); }
    const int k = t.k;
    if (k == 1) { const int r = descend(ref, t, 0, c); return learn(d + 1, r, own, opp, sp); }
    double *s = &sig[(size_t)d * 8], *q = &samp[(size_t)d * 8], *v = &val[(size_t)d * 8];
    const int physical=u->w.seat[t.actor];
    int hand=m.hands[t.actor][physical].strategyHand;uint32_t code=u->code[t.length];
    if(g.groups.on){ hand=0; code=u->gk[t.length][t.actor]; }
    else if(!m.turnGroups.empty()){
      const int slot=t.length==5?u->w.cards[4]+1:0;
      int id=m.turnGroups[t.actor][slot*m.hands[t.actor].size()+physical];
      hand=id%2048;code=u->code[4]+(uint32_t)(id/2048);
    }
    policy(ref, k, hand, code, s);
    if (t.actor != player) {
      for (int b = 0; b < k; b++) q[b] = g.exploreKeep * s[b] + g.exploreMix / k;   // defaults 0.9 and 0.1: the 4.4 expression, bit for bit
      const int a = choose(q, k, *rng);
      // Condition on terminal siblings. Only the sampled unresolved action carries
      // a residual. The importance weight and descendant reach are unchanged.
      if(g.terminalBaseline && t.facing){
        advance(ref,t,0,c);
        if(c.kind==2){
          const double baseline=seatPayoff(c,edgeKey(ref,0));double known=baseline;bool terminal=a==0;
          u->visits++;
          for(int i=1;i<k;i++){
            advance(ref,t,i,c);
            if(c.kind==2){known+=s[i]*(seatPayoff(c,edgeKey(ref,i))-baseline);u->visits++;if(a==i)terminal=true;}
          }
          if(terminal)return known;
          const int r=descend(ref,t,a,c);
          const double v=learn(d+1,r,own,opp*s[a],sp*q[a]);
          return known+s[a]/q[a]*(v-baseline);
        }
      }
      if(g.terminalExpectation && k==2 && t.facing){
        advance(ref,t,1,c);
        if(c.kind==2){const double called=seatPayoff(c,edgeKey(ref,1));advance(ref,t,0,c);
          if(c.kind==2){u->visits+=2;return s[0]*seatPayoff(c,edgeKey(ref,0))+s[1]*called;}}
      }
      const int r = descend(ref, t, a, c);
      const double ratio = s[a] / q[a];
      return ratio * learn(d + 1, r, own, opp * s[a], sp * q[a]);
    }
    const size_t off = u->vals.size();
    if (!u->room(0, 1, 2 * (size_t)k, g.unitLimitBytes)) { u->overflow = true; return 0; }
    u->incs.push_back({ref, hand, code, k, off}); u->vals.resize(off + 2 * (size_t)k);
    double mean = 0;
    for (int a = 0; a < k; a++) {
      u->vals[off + (size_t)(k + a)] = avgStep * own * s[a] / sp;
      const int r = descend(ref, t, a, c);
      v[a] = learn(d + 1, r, own * s[a], opp, sp);
      mean += s[a] * v[a];
    }
    for (int a = 0; a < k; a++) u->vals[off + (size_t)a] = step * opp / sp * (v[a] - mean);
    return mean;
  }
  void run(Unit &unit, int seat, Rng &r, double stp, double avgStp) {
    u = &unit; rng = &r; player = seat; step = stp; avgStep = avgStp;
    st[0] = g.rootState;
    learn(0, 0, 1, 1, 1);
  }
};
inline void codes(Unit &u, int n) {
  (void)n; for (int L : {0, 3, 4, 5}) u.code[L] = cardsCode(u.w.cards, L);
}
// 3.3: grouped key ids of every seat at every street of this deal (main thread, in deal order).
inline bool worldGroups(MW &m, GroupKeys &G,const std::vector<std::vector<uint32_t>> &start, const World &w,uint32_t (&ids)[6][8]) {
  std::string key; unsigned long long num;
  for (int p = 0; p < m.n; p++) {
    const Hand &h = m.hands[(size_t)p][(size_t)w.seat[p]];
    int previous = -1;
    for (int i = 0; i < G.nl; i++) {
      const int L = G.lengths[i]; uint32_t id;
      if (L == G.start) id = start[(size_t)p][(size_t)w.seat[p]];
      else {
        int cards[7]; std::copy_n(w.cards, L, cards); cards[L] = h.a; cards[L + 1] = h.b;
        G.signal(key, num, p, h.a, h.b, h.id, w.cards, L, evalAny(cards, L + 2), previous);
        id = G.intern(key, num, m.bytes, m.budgetBytes);
        if (id == UINT32_MAX) return false;
      }
      ids[L][p] = id; previous = (int)id;
    }
  }
  return true;
}
inline bool groupCodes(MW &m,Game &g,Unit &u){return worldGroups(m,g.groups,g.startKey,u.w,u.gk);}
// Starting-street keys depend on the seat's hand only; computed once per study.
inline bool groupStartInto(const MW &m, GroupKeys &G, std::vector<std::vector<uint32_t>> &startKey, double &bytes, double budget) {
  std::string key; unsigned long long num;
  startKey.assign((size_t)m.n, {});
  for (int p = 0; p < m.n; p++) for (const Hand &h : m.hands[(size_t)p]) {
    int cards[7]; std::copy_n(m.board, G.start, cards); cards[G.start] = h.a; cards[G.start + 1] = h.b;
    G.signal(key, num, p, h.a, h.b, h.id, m.board, G.start, G.start ? evalAny(cards, G.start + 2) : 0, -1);
    const uint32_t id = G.intern(key, num, bytes, budget);
    if (id == UINT32_MAX) return false;
    startKey[(size_t)p].push_back(id);
  }
  return true;
}
inline bool groupStart(MW &m, Game &g) { return groupStartInto(m, g.groups, g.startKey, m.bytes, m.budgetBytes); }
// 3.3 DCFR: bring a row's regrets from its discount iteration to the current one
// (identical to catchUp() in lib_wide.js). Averages need no discount: iteration
// t's average contribution is weighted by t^gamma instead.
inline void dcfrFactors(const MW &m, const Game &g, const MW::RowMeta &rm, double &pos, double &neg) {
  pos = g.schedule.ratio(0, rm.sync, m.iterations); neg = g.schedule.ratio(1, rm.sync, m.iterations);
}
inline void catchUp(MW &m, const Game &g, MW::RowMeta &rm) {
  if (rm.sync == (uint32_t)m.iterations) return;
  double pos, neg; dcfrFactors(m, g, rm, pos, neg);
  for (int a = 0; a < rm.k; a++) { double &v = m.vals[rm.off + (size_t)a]; v = v > 0 ? v * pos : v < 0 ? v * neg : v; }
  rm.sync = (uint32_t)m.iterations;
}
// 1: ok, 0: budget, -1: non-finite
inline int merge(MW &m, Game &g, Unit &u, bool immediate, Update &update) {
  std::pmr::vector<int> resolved(u.pending.size(), -1, u.pending.get_allocator().resource());
  for (size_t i = 0; i < u.pending.size(); i++) {
    const Pending &p = u.pending[i];
    const int par = p.parentRef >= 0 ? p.parentRef : resolved[(size_t)(-p.parentRef - 1)];
    if (par < 0) return 0;
    int id = g.states.find((uint32_t)par, p.slot);
    if (id < 0) id = g.states.add((uint32_t)par, p.slot, p.kind, p.actor, p.length, p.k, m.bytes, m.budgetBytes);
    if (id < 0) return 0;
    resolved[i] = id;
  }
  const int B = m.batchDeals;
  for (const Inc &inc : u.incs) {
    const int sid = inc.ref >= 0 ? inc.ref : resolved[(size_t)(-inc.ref - 1)];
    const long long r = m.getOrCreate(rowKey((uint32_t)sid, inc.hand, inc.code), sid, inc.k);
    if (r < 0) return 0;
    MW::RowMeta &rm = m.rows[(size_t)r]; update.touch((size_t)r, immediate); rm.visited = 1;
    const size_t o = rm.off; const double *x = &u.vals[inc.off]; const int k = inc.k;
    for (int a = 0; a < 2 * k; a++) if (!std::isfinite(x[a])) return -1;
    if (immediate && g.dcfr) catchUp(m, g, rm);
    if (immediate) {
      for (int a = 0; a < k; a++) {
        double v = m.vals[o + (size_t)a] + 0.0; if (m.plus) v = jsMax0(v);
        v = v + x[a]; if (m.plus) v = jsMax0(v);
        if (!std::isfinite(v) || !std::isfinite(m.vals[o + k + a] + x[k+a])) return -1;
        m.vals[o + (size_t)a] = v;
        m.vals[o + (size_t)(k + a)] = (m.vals[o + (size_t)(k + a)] + x[k + a]) + 0.0;
      }
    } else {
      for (int a = 0; a < k; a++) {
        double &dr = m.delta[o + (size_t)a], &da = m.delta[o + (size_t)(k + a)];
        dr = (dr + 0.0 / B) + x[a] / B;
        da = (da + x[k + a] / B) + 0.0 / B;
      }
    }
  }
  return 1;
}
inline double now() { return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count(); }
inline int train(MW *m, long long iterations, int threads, volatile int *stop, mw_progress_fn progress, void *ctx, char *err, int errlen) {
  Game &g = *m->es;
  const int B = m->batchDeals, n = m->n;
  const bool parallel = B > 1 && g.perDealStreams;
  const size_t cap=(size_t)m->budgetBytes;
  const size_t icmBytes=m->tournament.start.empty()?0:Tournament::workspaceBytes(m->tournament.start.size(),m->budgetBytes);
  const size_t fixed=sizeof(Walker)+icmBytes+512;
  const size_t cacheBytes=Walker::edgeEntries(m->budgetBytes)*(sizeof(Walker::Edge)+sizeof(Walker::TermEntry)+16);
  const size_t perWorker=fixed+cacheBytes+(MAX_DEPTH+2)*(sizeof(BS)+3*8*sizeof(double))+4096;
  const int affordable=(int)std::min<size_t>(B,cap/perWorker);
  const int T=parallel ? std::max(1,std::min(threads,affordable)) : 1;
  m->lastThreads = T;
  auto failMsg = [&](const char *msg) { if (err && errlen > 0) snprintf(err, (size_t)errlen, "%s", msg); return 0; };
  try {
    if (cap < fixed*T+B*sizeof(Unit)) throw std::bad_alloc();
    ScratchBudget budget(cap-fixed*T-B*sizeof(Unit),g.scratchPeak);
    Workers pool(T);
    ScoreSchedule scorer;
    const bool routeBatch=m->mode!="cpu" && B*n>=128 && m->startLen!=5;
    m->route=routeBatch?"CPU (external sampling traversal)":"CPU (external sampling traversal; small batch or CPU scoring)";

    g.setStoreCap(m->budgetBytes); g.extendStore(m->stateVisits);
    std::vector<std::unique_ptr<Walker>> walkers;
    for (int i = 0; i < T; i++) walkers.emplace_back(new Walker(*m, g, budget));
    std::vector<Unit> units;units.reserve(B);
    for(int i=0;i<B;i++)units.emplace_back(budget);
    // Waking helper threads costs tens of microseconds. A batch is split only
    // when the previous batch's measured state visits make it worthwhile.
    // Results are identical either way.
    double visitsPerDeal = 1e9;
    g.unitLimitBytes = (size_t)(m->budgetBytes / 4 / B);
    for (long long it = 0; it < iterations && !m->limitReached; it++) {
      if (stop && __atomic_load_n(stop, __ATOMIC_RELAXED)) break;
      if (g.dcfr) {   // before the journal: the schedule is deterministic and kept on rollback
        // The discount tables grow by 48 bytes per iteration and are charged to the table budget.
        const size_t before = g.schedule.bytes();
        if (!g.schedule.extend(m->iterations, m->budgetBytes - m->bytes + (double)before)) { m->limitReached = true; break; }
        m->bytes += (double)g.schedule.bytes() - (double)before;
      }
      Update update(*m,budget); bool groupFull = false; const bool profiled = (m->iterations & 15) == 0;
      const double step = m->linear ? (double)(m->iterations + 1) : 1.0;
      const double avgStep = m->linear ? step : g.dcfrEager ? 1.0 : g.dcfr ? g.schedule.averageWeight((double)(m->iterations + 1)) : 1.0;
      double t0 = now();
      for (int d = 0; d < B; d++) {
        Unit &u = units[(size_t)d]; u.clear();
        if (!m->deal(u.w,d)) return failMsg("Compatible hands are too rare to sample reliably. Review overlapping ranges or use exact deals.");
        g.attempts++;
        // 3.3 profile: the scoring stage is timed on one update in 16 only, so the
        // clock reads do not slow down cheap deals (they cost about 1 us on small games).
        if (!routeBatch && profiled) { const double s0 = now(); m->score(u.w); g.secScore += now() - s0; } else if (!routeBatch) m->score(u.w);
        codes(u, n);
        if (g.groups.on && !groupCodes(*m, g, u)) { groupFull = true; break; }
      }
      if(routeBatch && !groupFull){
        const double start=profiled?now():0;
        scorer.run(*m,units,(size_t)B);
        if(profiled)g.secScore+=now()-start;
      }
      double t1 = now(); g.secDeal += t1 - t0;
      long long visits = 0; int status = groupFull ? 0 : 1;
      if (status == 0) {}
      else if (B == 1) {
        Unit &u = units[0];
        Rng own{deriveSeed(g.actionSeed, m->iterations, 0)};
        Rng &r = g.perDealStreams ? own : g.actionRng;
        for (int p = 0; p < n && status == 1; p++) {
          double a = now();
          u.pending.clear(); u.incs.clear(); u.vals.clear();
          walkers[0]->run(u, p, r, step, avgStep);
          double b = now(); g.secTraverse += b - a;
          if (u.overflow) { status = 0; break; }
          status = merge(*m, g, u, true, update); visits += u.visits; u.visits = 0;
          g.secMerge += now() - b;
        }
      } else {
        std::atomic<int> next{0}; std::atomic<bool> oom{false};
        auto job = [&](int index) {
          try {
            for (;;) {
              const int d = parallel ? next.fetch_add(1) : next++;
              if (d >= B) break;
              Unit &u = units[(size_t)d];
              Rng own{deriveSeed(g.actionSeed, m->iterations, d)};
              Rng &r = g.perDealStreams ? own : g.actionRng;
              for (int p = 0; p < n && !u.overflow; p++) walkers[(size_t)index]->run(u, p, r, step, avgStep);
            }
          } catch (const std::bad_alloc &) { oom = true; }
        };
        double a = now();
        pool.run(job, parallel && T > 1 && visitsPerDeal * B >= 2000.0);
        m->lastThreads = parallel && T > 1 && visitsPerDeal * B >= 2000.0 ? T : 1;
        double b = now(); g.secTraverse += b - a;
        if (oom) throw std::bad_alloc();
        for (auto &u : units) if (u.overflow) { status = 0; break; }
        m->touched.clear();
        for (int d = 0; d < B && status == 1; d++) { status = merge(*m, g, units[(size_t)d], false, update); visits += units[(size_t)d].visits; }
        if (status == 1) {
          for (int32_t r : m->touched) {
            const auto &rm = m->rows[r];
            double pos = 1, neg = 1; if (g.dcfr) dcfrFactors(*m, g, rm, pos, neg);
            for (size_t j = rm.off; j < rm.off + 2*rm.k; ++j) {
              double v = m->vals[j]; if (g.dcfr && j < rm.off + (size_t)rm.k) v = v > 0 ? v * pos : v < 0 ? v * neg : v;
              if (!std::isfinite(v+m->delta[j])) return failMsg("Non-finite batch strategy value");
            }
          }
          for (int32_t r : m->touched) {
            MW::RowMeta &rm = m->rows[(size_t)r]; const size_t o = rm.off;
            if (g.dcfr) catchUp(*m, g, rm);
            for (int x = 0; x < 2 * rm.k; x++) {
              const double v = m->vals[o + (size_t)x] + m->delta[o + (size_t)x];
              m->vals[o + (size_t)x] = x < rm.k && m->plus ? jsMax0(v) : v; m->delta[o + (size_t)x] = 0;
            }
            rm.marked = 0;
          }
        } else for (int32_t r : m->touched) { MW::RowMeta &rm = m->rows[(size_t)r]; std::fill_n(&m->delta[rm.off], 2 * (size_t)rm.k, 0.0); rm.marked = 0; }
        g.secMerge += now() - b;
      }
      if (status < 0) return failMsg("Non-finite sampled CFR increment");
      if (status == 0) { m->limitReached = true; break; }
      update.commit();
      g.extendStore(m->stateVisits + visits);
      m->stateVisits += visits; visitsPerDeal = (double)visits / B;
      if (profiled) g.secProfiled += now() - t0;
      m->trainingDeals += B; m->iterations++;
      if (g.dcfrEager) {
        const double t = (double)m->iterations, pa = Dcfr::powExact(t, g.schedule.alpha), pb = Dcfr::powExact(t, g.schedule.beta);
        const double pos = pa / (pa + 1), neg = pb / (pb + 1), avg = std::pow(t / (t + 1), g.schedule.gamma);
        for (auto &rm : m->rows) {
          for (int a = 0; a < rm.k; a++) { double &v = m->vals[rm.off + (size_t)a]; v = v > 0 ? v * pos : v < 0 ? v * neg : v; m->vals[rm.off + (size_t)(rm.k + a)] *= avg; }
          rm.sync = (uint32_t)m->iterations;
        }
      }
      if (progress && (it & 63) == 63) progress(ctx, m->iterations, m->trainingDeals);
    }
  } catch (const std::system_error &e) {return failMsg(e.what());}
  catch (const std::bad_alloc &) { m->limitReached = true;  }
  if (progress) progress(ctx, m->iterations, m->trainingDeals);
  return 1;
}
inline void decodeCards(uint32_t code, int length, uint8_t out[5]) {
  std::fill_n(out, 5, 0);
  if (length < 3) return;
  const int river = (int)(code % 53), turn = (int)(code / 53 % 53); int flop = (int)(code / 2809);
  auto c = [](int x, int r) { long v = 1; for (int i = 0; i < r; i++) v = v * (x - i) / (i + 1); return x < r ? 0L : v; };
  int f[3];
  for (int r = 3; r >= 1; r--) { int x = r - 1; while (c(x + 1, r) <= flop) x++; f[r - 1] = x; flop -= (int)c(x, r); }
  out[0] = (uint8_t)(f[0] + 1); out[1] = (uint8_t)(f[1] + 1); out[2] = (uint8_t)(f[2] + 1);
  out[3] = (uint8_t)turn; out[4] = (uint8_t)river;
}
} // namespace es
} // namespace
