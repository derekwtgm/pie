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
  uint32_t newRows = 0;   // 5.7: increments recorded since the caller last cleared it whose table row did not exist yet (see train())
  std::pmr::vector<BS> st; std::pmr::vector<const BS *> cur; std::pmr::vector<double> sig, samp, val;
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
  Walker(const MW &mm, const Game &gg,ScratchBudget &budget) : m(mm), g(gg),st(&budget),cur(&budget),sig(&budget),samp(&budget),val(&budget),edgeKeys(&budget),termKeys(&budget),vhand(&budget),vcw(&budget),vone(&budget),vscore(&budget),vsh(&budget) {
    if(const size_t e=edgeEntries(mm.budgetBytes)){edgeKeys.assign(e,UINT64_MAX);termKeys.assign(e,UINT64_MAX);edges.init(&budget,e);terms.init(&budget,e);edgeMask=e-1;}
    st.resize(MAX_DEPTH + 2); cur.assign(MAX_DEPTH + 2, nullptr); sig.resize((MAX_DEPTH + 2) * 8); samp.resize((MAX_DEPTH + 2) * 8); val.resize((MAX_DEPTH + 2) * 8);
    if (!m.tournament.start.empty()) m.tournament.prepare(icm,m.budgetBytes);
  }
  int child(int ref, int slot, const BS &c) {
    if (c.kind == 2) { terminalKey = edgeKey(ref, slot); terminalRec = nullptr; return TERMINAL_REF; }
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
  // Returns the table row the strategy was read from (-1: none yet); 5.6 passes it to the merge as Inc::row.
  long long policy(int ref, int k, int hand, uint32_t code, double *s) const {
    long long r = ref >= 0 ? m.findRow(rowKey((uint32_t)ref, hand, code)) : -1;
    double tot = 0;
    if(r<0){std::fill_n(s,k,1.0/k);return r;}
    const double *regrets=m.vals.data()+m.rows[(size_t)r].off;
    for(int a=0;a<k;a++){s[a]=jsMax0(regrets[a]);tot+=s[a];}
    for (int a = 0; a < k; a++) s[a] = tot ? s[a] / tot : 1.0 / k;
    return r;
  }
  // 3.8: pot layouts of terminal betting states, reduced to the dealt seats
  // that can win them (ascending seat bitmask; folded and absent entries can
  // never collect a pot in payoff()/seatPayoff()). A layout depends only on the
  // betting path, so it is cached per committed (parent state, action) edge.
  // Seats are visited in the same ascending order and all additions happen in
  // the same order as in 3.7, so utilities are bit-identical.
  struct TermEntry { int np; CPot pot[MAX_CACHED_POTS]; };
  Raw<TermEntry> terms; uint64_t terminalKey = UINT64_MAX; CPot cpots[24];
  const TermRec *terminalRec = nullptr;   // 5.6: set with terminalKey when the terminal child came from Game::links
  int layout(const BS &t, uint64_t key, const CPot *&out, const TermRec *rec = nullptr) {
    if (rec) { out = rec->pot; return rec->np; }   // 5.6: the layout Rules::pots produced for this state when it was linked
    const size_t i = key != UINT64_MAX ? slotOf((int)(key / 8), (int)(key % 8)) : SIZE_MAX;
    TermEntry *e = i != SIZE_MAX ? &terms[i] : nullptr;
    if (e && termKeys[i] == key) { out = e->pot; return e->np; }
    const int np = g.rules.pots(t, pots);
    for (int q = 0; q < np; q++) cpots[q] = {pots[q].amount, pots[q].mask};
    if (e && np <= MAX_CACHED_POTS) { termKeys[i] = key; e->np = np; std::copy_n(cpots, np, e->pot); }
    out = cpots; return np;
  }
  const double *payoff(const BS &t, uint64_t key = UINT64_MAX, const TermRec *rec = nullptr) {
    const int n = m.n; const CPot *lay; const int np = layout(t, key, lay, rec);
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
  double seatPayoff(const BS &t, uint64_t key = UINT64_MAX, const TermRec *rec = nullptr){
    if(!m.tournament.start.empty())return payoff(t,key,rec)[player];
    double value=-t.total[player]-m.anteOf[player];
    const CPot *lay; const int count=layout(t,key,lay,rec),rank=u->w.score[player];
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
  // 4.7: the betting state of depth d+1 is referenced in place when the read-only state store
  // holds it (pointer into Game::store, which only grows between updates) instead of being
  // copied (about 430 bytes per visited state); otherwise it is built into st[d+1] as before.
  // Every value read is the same object content, so results are bit-identical.
  int descendP(int d,int ref,const BS &t,int a){
    // 5.6: direct child link of a stored state (see Game::links): the same stored child the hash lookup below
    // would return, or a terminal child built once by the same rules calls.
    if(ref>=0&&(size_t)ref<g.links.size()){
      const int32_t kid=g.links[(size_t)ref].kid[a];
      if(kid>=0){cur[(size_t)d+1]=&g.store[(size_t)kid];return kid;}
      if(kid<=-2){const TermRec &rec=g.terms[(size_t)(-(kid+2))];cur[(size_t)d+1]=&rec.state;terminalKey=edgeKey(ref,a);terminalRec=&rec;return TERMINAL_REF;}
    }
    BS &c=st[(size_t)d+1];
    if(ref>=0&&!g.store.empty()){
      const int id=g.states.find((uint32_t)ref,a);
      if(id>=0){
        if((size_t)id<g.store.size()){cur[(size_t)d+1]=&g.store[(size_t)id];return id;}
        if(a==CHANCE_SLOT)street(ref,t,c);else advance(ref,t,a,c);
        cur[(size_t)d+1]=&c;return id;
      }
    }
    if(a==CHANCE_SLOT)street(ref,t,c);else advance(ref,t,a,c);
    cur[(size_t)d+1]=&c;return child(ref,a,c);
  }
  static uint64_t edgeKey(int ref,int a){return ref>=0?(uint64_t)(uint32_t)ref*8+(unsigned)a:UINT64_MAX;}
  static int choose(const double *q, int k, Rng &r) {
    const double value = r.next(); double cumulative = 0;
    for (int a = 0; a < k; a++) { cumulative += q[a]; if (value < cumulative) return a; }
    return k - 1;
  }
  // lib_wide.js learn(): returns the sampled value for `player`.
  // ---- 5.6 experimental: shared traversal of a fully enumerated subgame (Game::enumShare) ----
  // Inside the enumerated final street no action is sampled, so one walk visits every node of the subgame for the
  // sampled deal and the utility of EVERY seat is known at every terminal. learnAll returns the vector of all
  // seats' values under the current strategies and writes, at each decision node of seat j,
  //   regret(a)  += step    * w * prod_{i != j} reach[i] / sp * (v_a[j] - v[j])
  //   average(a) += avgStep * w * reach[j] * sigma(a) / sp
  // reach[i] is seat i's own strategy probability along the path from the root and sp the probability with which
  // the path was SAMPLED (the product of q over the sampled decisions above the subgame; 1 when the whole game is
  // enumerated). Dividing by sp makes each increment an importance-sampled estimate of the default estimator's
  // target: summing over the paths to an information set with their sampling probabilities gives
  // prod_{i != j} reach[i] * (v_a - v) for regrets (the counterfactual regret) and reach[j] * sigma(a) for averages,
  // exactly the expectations of Walker::learn. q > 0 on every action (exploration floor), so no path has
  // probability zero. w (shareWeight) is 1 when one traversal serves all seats and 1/n when each of the n seats'
  // traversals updates all seats ("river-cross"), so the n estimates are averaged.
  std::pmr::vector<double> allOut, allV, allReach; double shareWeight = 1, seatReach[8] = {1, 1, 1, 1, 1, 1, 1, 1}; bool cross = false;
  void allBuffers() { if (allOut.empty()) { allOut.resize(((size_t)MAX_DEPTH + 2) * 8); allV.resize(((size_t)MAX_DEPTH + 2) * 64); allReach.resize(((size_t)MAX_DEPTH + 2) * 8); } }
  const double *learnAll(int d, int ref, const double *reach, double sp) {
    u->visits++;
    const BS &t = *cur[(size_t)d]; const int n = m.n; double *out = &allOut[(size_t)d * 8];
    if (t.kind == 2) {
      const double *v = payoff(t, ref == TERMINAL_REF ? terminalKey : UINT64_MAX, ref == TERMINAL_REF ? terminalRec : nullptr);
      std::copy_n(v, n, out); return out;
    }
    if (d + 1 >= MAX_DEPTH || u->overflow) { u->overflow = true; std::fill_n(out, n, 0.0); return out; }
    if (t.kind == 1) { const int r = descendP(d, ref, t, CHANCE_SLOT); return learnAll(d + 1, r, reach, sp); }
    const int k = t.k;
    if (k == 1) { const int r = descendP(d, ref, t, 0); return learnAll(d + 1, r, reach, sp); }
    double *s = &sig[(size_t)d * 8], *V = &allV[(size_t)d * 64], *cr = &allReach[((size_t)d + 1) * 8];
    const int j = t.actor, physical = u->w.seat[j];
    int hand = m.hands[(size_t)j][(size_t)physical].strategyHand; uint32_t code = u->code[t.length];
    if (g.groups.on) { hand = 0; code = u->gk[t.length][j]; }
    else if (!m.turnGroups.empty()) {
      const int slot = t.length == 5 ? u->w.cards[4] + 1 : 0;
      const int id = m.turnGroups[(size_t)j][(size_t)slot * m.hands[(size_t)j].size() + (size_t)physical];
      hand = id % 2048; code = u->code[4] + (uint32_t)(id / 2048);
    }
    const long long row = policy(ref, k, hand, code, s);
    std::copy_n(reach, n, cr);
    for (int a = 0; a < k; a++) {
      cr[j] = reach[j] * s[a];
      const int r = descendP(d, ref, t, a);
      const double *v = learnAll(d + 1, r, cr, sp);
      std::copy_n(v, n, V + (size_t)a * 8);
    }
    for (int i = 0; i < n; i++) { double mean = 0; for (int a = 0; a < k; a++) mean += s[a] * V[(size_t)a * 8 + (size_t)i]; out[i] = mean; }
    double others = 1; for (int i = 0; i < n; i++) if (i != j) others *= reach[i];
    const size_t off = u->vals.size();
    if (!u->room(0, 1, 2 * (size_t)k, g.unitLimitBytes)) { u->overflow = true; return out; }
    u->incs.push_back({ref, code, off, (int32_t)row, (uint16_t)hand, (uint8_t)k}); newRows += row < 0; u->vals.resize(off + 2 * (size_t)k);
    const double rw = step * shareWeight * others / sp, aw = avgStep * shareWeight * reach[j] / sp;
    for (int a = 0; a < k; a++) { u->vals[off + (size_t)a] = rw * (V[(size_t)a * 8 + (size_t)j] - out[j]); u->vals[off + (size_t)(k + a)] = aw * s[a]; }
    return out;
  }
  double learn(int d, int ref, double own, double opp, double sp) {
    // 5.6 "river-cross": the enumerated final street is walked once for all seats (see learnAll).
    if (cross && cur[(size_t)d]->kind == 0 && cur[(size_t)d]->length >= g.enumerateFrom) return learnAll(d, ref, seatReach, sp)[player];
    u->visits++;
    const BS &t = *cur[(size_t)d];
    const uint64_t tkey = ref == TERMINAL_REF ? terminalKey : UINT64_MAX;
    const TermRec *trec = ref == TERMINAL_REF ? terminalRec : nullptr;
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
      if(t.kind==2)return seatPayoff(t,tkey,trec);
    }
    if (d + 1 >= MAX_DEPTH || u->overflow) { u->overflow = true; return 0; }
    BS &c = st[(size_t)d + 1];
    if (t.kind == 1) { const int r = descendP(d, ref, t, CHANCE_SLOT); return learn(d + 1, r, own, opp, sp); }
    const int k = t.k;
    if (k == 1) { const int r = descendP(d, ref, t, 0); return learn(d + 1, r, own, opp, sp); }
    double *s = &sig[(size_t)d * 8], *q = &samp[(size_t)d * 8], *v = &val[(size_t)d * 8];
    const int physical=u->w.seat[t.actor];
    int hand=m.hands[t.actor][physical].strategyHand;uint32_t code=u->code[t.length];
    if(g.groups.on){ hand=0; code=u->gk[t.length][t.actor]; }
    else if(!m.turnGroups.empty()){
      const int slot=t.length==5?u->w.cards[4]+1:0;
      int id=m.turnGroups[t.actor][slot*m.hands[t.actor].size()+physical];
      hand=id%2048;code=u->code[4]+(uint32_t)(id/2048);
    }
    const long long row = policy(ref, k, hand, code, s);
    if (t.actor != player && g.enumerateFrom && t.length >= g.enumerateFrom) {
      // 5.5 experimental: exact expectation over this opponent's actions. No action is sampled here, so the
      // sampling reach `sp` is unchanged and the opponent reach carries sigma(a) into each child:
      //   regret increments below child a are scaled by opp*sigma(a)/sp   (= pi_-i/q_-i, as in the default)
      //   average increments are scaled by own/sp                         (independent of sigma(a), as in the default)
      // Zero-probability actions are still traversed: their regret increments are zero but the average-strategy
      // weight of the updating seat's information sets below must not depend on the opponent's strategy.
      double value = 0;
      for (int a = 0; a < k; a++) { const int r = descendP(d, ref, t, a); value += s[a] * learn(d + 1, r, own, opp * s[a], sp); }
      return value;
    }
    if (t.actor != player) {
      { const double floor = g.exploreMix / k;   // 5.10: the quotient of the 4.4 expression, computed once per node instead of once per action
        for (int b = 0; b < k; b++) q[b] = g.exploreKeep * s[b] + floor; }   // defaults 0.9 and 0.1: the 4.4 values, bit for bit
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
          const int r=descendP(d, ref, t, a);
          const double v=learn(d+1,r,own,opp*s[a],sp*q[a]);
          return known+s[a]/q[a]*(v-baseline);
        }
      }
      if(g.terminalExpectation && k==2 && t.facing){
        advance(ref,t,1,c);
        if(c.kind==2){const double called=seatPayoff(c,edgeKey(ref,1));advance(ref,t,0,c);
          if(c.kind==2){u->visits+=2;return s[0]*seatPayoff(c,edgeKey(ref,0))+s[1]*called;}}
      }
      const int r = descendP(d, ref, t, a);
      const double ratio = s[a] / q[a];
      if (!cross) return ratio * learn(d + 1, r, own, opp * s[a], sp * q[a]);
      const double keep = seatReach[t.actor]; seatReach[t.actor] = keep * s[a];   // 5.6 river-cross: per-seat reach for learnAll
      const double below = learn(d + 1, r, own, opp * s[a], sp * q[a]);
      seatReach[t.actor] = keep;
      return ratio * below;
    }
    const size_t off = u->vals.size();
    if (!u->room(0, 1, 2 * (size_t)k, g.unitLimitBytes)) { u->overflow = true; return 0; }
    u->incs.push_back({ref, code, off, (int32_t)row, (uint16_t)hand, (uint8_t)k}); newRows += row < 0; u->vals.resize(off + 2 * (size_t)k);
    double mean = 0;
    for (int a = 0; a < k; a++) {
      u->vals[off + (size_t)(k + a)] = avgStep * own * s[a] / sp;
      const int r = descendP(d, ref, t, a);
      if (cross) seatReach[player] = own * s[a];
      v[a] = learn(d + 1, r, own * s[a], opp, sp);
      mean += s[a] * v[a];
    }
    if (cross) seatReach[player] = own;
    for (int a = 0; a < k; a++) u->vals[off + (size_t)a] = step * opp / sp * (v[a] - mean);
    return mean;
  }
  void run(Unit &unit, int seat, Rng &r, double stp, double avgStp) {
    if (g.rbes) { runRB(unit, seat, r, stp, avgStp); return; }   // 5.10 experimental (es_rbes510_walk.hpp)
    if (g.ownHands) { runVec(unit, seat, r, stp, avgStp); return; }
    u = &unit; rng = &r; player = seat; step = stp; avgStep = avgStp;
    cur[0] = &g.rootState;   // 5.6: read in place (5.5 copied the root state into st[0] for every seat of every deal)
    cross = false;
    if (g.wholeGameEnumerated()) {   // 5.6 river-shared / river-cross on a final-street game: one walk for all seats
      allBuffers(); shareWeight = 1; const double ones[8] = {1, 1, 1, 1, 1, 1, 1, 1};
      learnAll(0, 0, ones, 1); return;
    }
    if (g.enumShare == 2) { allBuffers(); cross = true; shareWeight = 1.0 / m.n; std::fill_n(seatReach, 8, 1.0); }
    learn(0, 0, 1, 1, 1);
  }
  // ---- 4.7 experimental: own-hand enumeration (Game::ownHands) ----
  // One traversal per (deal, updating seat) carries a vector over the updating seat's compatible
  // hands. Opponent decisions are sampled once and shared by every hand (an opponent's information
  // never depends on the updating seat's hand), so each hand's increments are exactly the default
  // estimator's increments for that hand, and summing them with the conditional chance weights
  // vcw[h] = w(h) / sum_{compatible} w gives the conditional expectation over the updating seat's
  // hand given the sampled opponents' hands and board. Unbiasedness: E[increment | h_-p, board]
  // = sum_h P(h | h_-p, board) * increment(h); the deal (h_-p, board) is drawn by the unchanged
  // sampler, so its marginal is the default one. Memory: per-depth frames from the scratch budget.
  std::pmr::vector<int> vhand; std::pmr::vector<double> vcw, vone; std::pmr::vector<int> vscore, vsh;
  std::vector<std::pmr::vector<double>> frames; int vH = 0; std::pmr::memory_resource *vres = nullptr;
  std::vector<std::pmr::vector<long long>> rowFrames;   // 5.6: rows read by policy() at the updating seat's nodes, per depth
  long long *rowFrame(int d, size_t need) {
    if (rowFrames.size() < (size_t)MAX_DEPTH + 2) { rowFrames.reserve((size_t)MAX_DEPTH + 2); while (rowFrames.size() < (size_t)MAX_DEPTH + 2) rowFrames.emplace_back(vres); }
    auto &f = rowFrames[(size_t)d]; if (f.size() < need) f.resize(need); return f.data();
  }
  double *frame(int d, size_t need) {
    if (frames.size() < (size_t)MAX_DEPTH + 2) { frames.reserve((size_t)MAX_DEPTH + 2); while (frames.size() < (size_t)MAX_DEPTH + 2) frames.emplace_back(vres); }
    auto &f = frames[(size_t)d]; if (f.size() < need) f.resize(need); return f.data();
  }
  const double *learnVec(int d, int ref, const double *own, double opp, double sp) {
    u->visits++;
    const BS &t = *cur[(size_t)d]; const int H = vH;
    if (t.kind == 2) {
      const uint64_t tkey = ref == TERMINAL_REF ? terminalKey : UINT64_MAX;
      const TermRec *trec = ref == TERMINAL_REF ? terminalRec : nullptr;
      double *out = frame(d, (size_t)H); vecPayoff(t, tkey, out, trec); return out;
    }
    if (d + 1 >= MAX_DEPTH || u->overflow) { u->overflow = true; double *out = frame(d, (size_t)H); std::fill_n(out, H, 0.0); return out; }
    BS &c = st[(size_t)d + 1];
    if (t.kind == 1) { const int r = descendP(d, ref, t, CHANCE_SLOT); return learnVec(d + 1, r, own, opp, sp); }
    const int k = t.k;
    if (k == 1) { const int r = descendP(d, ref, t, 0); return learnVec(d + 1, r, own, opp, sp); }
    const uint32_t code = u->code[t.length];
    if (t.actor != player) {
      double *s = &sig[(size_t)d * 8], *q = &samp[(size_t)d * 8];
      const int hand = m.hands[t.actor][u->w.seat[t.actor]].strategyHand;
      policy(ref, k, hand, code, s);
      if (g.enumerateFrom && t.length >= g.enumerateFrom) {   // 5.5 experimental: vector form of the enumeration in learn()
        double *acc = frame(d, (size_t)H); std::fill_n(acc, H, 0.0);
        for (int a = 0; a < k; a++) { const int r = descendP(d, ref, t, a); const double *v = learnVec(d + 1, r, own, opp * s[a], sp); acc = frame(d, (size_t)H); for (int h = 0; h < H; h++) acc[h] += s[a] * v[h]; }
        return acc;
      }
      for (int b = 0; b < k; b++) q[b] = g.exploreKeep * s[b] + g.exploreMix / k;
      const int a = choose(q, k, *rng);
      if (g.terminalBaseline && t.facing) {   // vector form of the scalar terminal-baseline estimator in learn()
        advance(ref, t, 0, c);
        if (c.kind == 2) {
          double *f = frame(d, 3 * (size_t)H), *out = f, *base = f + H, *tmp = base + H;
          vecPayoff(c, edgeKey(ref, 0), base); std::copy_n(base, H, out); bool terminal = a == 0;
          u->visits++;
          for (int i = 1; i < k; i++) {
            advance(ref, t, i, c);
            if (c.kind == 2) { vecPayoff(c, edgeKey(ref, i), tmp); for (int h = 0; h < H; h++) out[h] += s[i] * (tmp[h] - base[h]); u->visits++; if (a == i) terminal = true; }
          }
          if (terminal) return out;
          const int r = descendP(d, ref, t, a);
          const double *v = learnVec(d + 1, r, own, opp * s[a], sp * q[a]);
          const double ratio = s[a] / q[a];
          for (int h = 0; h < H; h++) out[h] += ratio * (v[h] - base[h]);
          return out;
        }
      }
      const int r = descendP(d, ref, t, a);
      const double ratio = s[a] / q[a];
      const double *v = learnVec(d + 1, r, own, opp * s[a], sp * q[a]);
      double *out = frame(d, (size_t)H);
      for (int h = 0; h < H; h++) out[h] = ratio * v[h];
      return out;
    }
    double *f = frame(d, (size_t)H * (2 * (size_t)k + 2)), *out = f, *S = f + H, *V = S + (size_t)H * k, *CO = V + (size_t)H * k;
    { long long *rowOf = rowFrame(d, (size_t)H);
      for (int h = 0; h < H; h++) rowOf[h] = policy(ref, k, vsh[(size_t)h], code, S + (size_t)h * k); }
    if (!u->room(0, (size_t)H, 2 * (size_t)k * H, g.unitLimitBytes)) { u->overflow = true; std::fill_n(out, H, 0.0); return out; }
    for (int a = 0; a < k; a++) {
      for (int h = 0; h < H; h++) CO[h] = own[h] * S[(size_t)h * k + a];
      const int r = descendP(d, ref, t, a);
      const double *v = learnVec(d + 1, r, CO, opp, sp);
      std::copy_n(v, H, V + (size_t)a * H);
    }
    for (int h = 0; h < H; h++) {
      double mean = 0; for (int a = 0; a < k; a++) mean += S[(size_t)h * k + a] * V[(size_t)a * H + h];
      out[h] = mean;
      const size_t off = u->vals.size();
      { const long long vrow = rowFrame(d, (size_t)H)[h]; u->incs.push_back({ref, code, off, (int32_t)vrow, (uint16_t)vsh[(size_t)h], (uint8_t)k}); newRows += vrow < 0; } u->vals.resize(off + 2 * (size_t)k);
      const double rw = step * vcw[(size_t)h] * opp / sp, aw = avgStep * vcw[(size_t)h] * own[h] / sp;
      for (int a = 0; a < k; a++) { u->vals[off + (size_t)a] = rw * (V[(size_t)a * H + h] - mean); u->vals[off + (size_t)(k + a)] = aw * S[(size_t)h * k + a]; }
    }
    return out;
  }
  // Payoff of every enumerated hand of the updating seat at terminal state t.
  void vecPayoff(const BS &t, uint64_t key, double *out, const TermRec *rec = nullptr) {
    const int H = vH;
    if (!t.live[player]) { const double v = seatPayoff(t, key, rec); std::fill_n(out, H, v); return; }   // a folded seat's payoff does not depend on its hand
    const int keep = u->w.score[player];
    for (int h = 0; h < H; h++) { u->w.score[player] = vscore[(size_t)h]; out[h] = seatPayoff(t, key, rec); }
    u->w.score[player] = keep;
  }
  void runVec(Unit &unit, int seat, Rng &r, double stp, double avgStp) {
    u = &unit; rng = &r; player = seat; step = stp; avgStep = avgStp;
    if (!vres) vres = vhand.get_allocator().resource();
    uint8_t used[52] = {0};
    for (int i = 0; i < 5; i++) used[unit.w.cards[i]] = 1;
    for (int j = 0; j < m.n; j++) if (j != seat) { const Hand &h = m.hands[(size_t)j][(size_t)unit.w.seat[j]]; used[h.a] = used[h.b] = 1; }
    vhand.clear(); vcw.clear(); vscore.clear(); vsh.clear(); double tot = 0;
    const auto &range = m.hands[(size_t)seat];
    for (size_t i = 0; i < range.size(); i++) { const Hand &h = range[i]; if (used[h.a] || used[h.b] || !(h.w > 0)) continue; vhand.push_back((int)i); tot += h.w; }
    vH = (int)vhand.size();
    for (int i : vhand) { const Hand &h = range[(size_t)i]; vcw.push_back(h.w / tot); vsh.push_back(h.strategyHand); vscore.push_back(m.startLen == 5 ? h.riverScore : evalSeven(unit.w.cards, h.a, h.b)); }
    vone.assign((size_t)vH, 1.0);
    cur[0] = &g.rootState;
    learnVec(0, 0, vone.data(), 1, 1);
  }
#include "es_rbes510_walk.hpp"
};
// 5.6: the flop index is computed once per deal with a three-element sorting network; 5.5 called cardsCode() for
// each street, which sorted the flop with std::sort three times. The integer codes are the same (see cardsCode).
inline void codes(Unit &u, int n) {
  (void)n; const int *cards = u.w.cards;
  int a = cards[0], b = cards[1], c = cards[2];
  if (a > b) std::swap(a, b);
  if (b > c) std::swap(b, c);
  if (a > b) std::swap(a, b);
  auto c2 = [](long x) { return x < 2 ? 0L : x * (x - 1) / 2; };
  auto c3 = [](long x) { return x < 3 ? 0L : x * (x - 1) / 2 * (x - 2) / 3; };
  const uint32_t flop = (uint32_t)((long)a + c2(b) + c3(c));
  u.code[0] = 0; u.code[3] = flop * 53 * 53; u.code[4] = (flop * 53 + (uint32_t)(cards[3] + 1)) * 53;
  u.code[5] = (flop * 53 + (uint32_t)(cards[3] + 1)) * 53 + (uint32_t)(cards[4] + 1);
}
// 3.3: grouped key ids of every seat at every street of this deal (main thread, in deal order).
inline bool worldGroups(MW &m, GroupKeys &G,const std::vector<std::vector<uint32_t>> &start, const World &w,uint32_t (&ids)[6][8]) {
  std::string key; unsigned long long num;
  for (int p = 0; p < m.n; p++) {
    const Hand &h = m.hands[(size_t)p][(size_t)w.seat[p]];
    int previous = -1;
    for (int i = 0; i < G.nl; i++) {
      const int L = G.lengths[i]; uint32_t id; size_t slots = 0; const long long ci = G.cacheIndex(L, w.cards, slots);
      if (L == G.start) id = start[(size_t)p][(size_t)w.seat[p]];
      else if ((id = G.cached(p, i, ci, w.seat[p])) != UINT32_MAX) G.idCache.hits++;   // 5.10: the identifier this function computed for this hand and board before
      else {
        int cards[7]; std::copy_n(w.cards, L, cards); cards[L] = h.a; cards[L + 1] = h.b;
        const int score = evalAny(cards, L + 2);
        // 5.6: Compact keys are looked up by number first (see GroupKeys::findNumber); a miss takes the 5.5 path.
        id = G.detailed ? UINT32_MAX : G.findNumber(G.compactNumber(p, h.a, h.b, h.id, w.cards, L, score, previous));
        if (id == UINT32_MAX) {
          G.signal(key, num, p, h.a, h.b, h.id, w.cards, L, score, previous);
          id = G.intern(key, num, m.bytes, m.budgetBytes);
          if (id == UINT32_MAX) return false;
          if (!G.detailed) G.rememberNumber(num, id);
        }
        G.remember(p, i, ci, slots, w.seat[p], m.hands[(size_t)p].size(), id);
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
// ---- 5.10 RB-ES: the row keys of EVERY hand of a seat's range (es_rbes510.hpp) ----
// Exact abstraction: the row of a hand is (betting state, strategy hand, card code of the street); the strategy hand
// is a property of the range, so one static entry per seat serves every street and deal.
inline const RbEntry *rbExactEntry(const MW &m, Game &g, int seat) {
  auto &slot = g.rbMemo.exact[seat]; if (slot) return slot.get();
  auto e = std::make_unique<RbEntry>(); const auto &range = m.hands[(size_t)seat];
  e->idx.resize(range.size()); std::unordered_map<int, uint16_t> seen;
  for (size_t i = 0; i < range.size(); i++) {
    const int sh = range[i].strategyHand; auto it = seen.find(sh);
    if (it == seen.end()) { it = seen.emplace(sh, (uint16_t)e->hand.size()).first; e->hand.push_back((uint16_t)sh); }
    e->idx[i] = it->second;
  }
  slot = std::move(e); return slot.get();
}
// Grouped keys of `seat` at street index li for the public cards of world w, given the entry of the previous street
// (nullptr on the starting street). The key of a hand is the key worldGroups() computes for it: the same signal, the
// same chaining to the previous street's key, the same dictionary. New keys are interned here, on the calling thread,
// in hand order; callers run in deal order, so identifiers never depend on the number of threads. False: the
// dictionary does not fit the table budget.
inline bool rbGroupEntry(MW &m, Game &g, int seat, int li, const World &w, const RbEntry *prev, RbEntry &e) {
  GroupKeys &G = g.groups; const int L = G.lengths[li]; const auto &range = m.hands[(size_t)seat];
  e.idx.assign(range.size(), RB_NONE); e.code.clear(); e.hand.clear();
  std::unordered_map<uint32_t, uint16_t> seen; std::string key; unsigned long long num;
  uint64_t pub = 0; for (int i = 0; i < L; i++) pub |= 1ULL << w.cards[i];
  for (size_t i = 0; i < range.size(); i++) {
    const Hand &h = range[i]; if (((pub >> h.a) & 1) || ((pub >> h.b) & 1)) continue;
    uint32_t id;
    if (L == G.start) id = g.startKey[(size_t)seat][i];
    else {
      const int previous = prev ? (int)prev->code[prev->idx[i]] : -1;
      int cards[7]; std::copy_n(w.cards, L, cards); cards[L] = h.a; cards[L + 1] = h.b;
      const int score = evalAny(cards, L + 2);
      id = G.detailed ? UINT32_MAX : G.findNumber(G.compactNumber(seat, h.a, h.b, h.id, w.cards, L, score, previous));
      if (id == UINT32_MAX) {
        G.signal(key, num, seat, h.a, h.b, h.id, w.cards, L, score, previous);
        id = G.intern(key, num, m.bytes, m.budgetBytes);
        if (id == UINT32_MAX) return false;
        if (!G.detailed) G.rememberNumber(num, id);
      }
    }
    auto it = seen.find(id);
    if (it == seen.end()) { if (e.code.size() >= RB_NONE) return false; it = seen.emplace(id, (uint16_t)e.code.size()).first; e.code.push_back(id); e.hand.push_back(0); }
    e.idx[i] = it->second;
  }
  return true;
}
// The entries of every seat and street for one deal (serial, in deal order). Streets at most two public cards after
// the starting street are served from the cache (built on first use); others are built for this deal.
// Scores and score order of a seat's whole range on the deal's board, when the board is one of at most 2704 (two
// cards after the starting street; a river start has one board). Hands that share a card with the board keep score
// -1 and are left out of the order.
inline const RbScores *rbScoreEntry(const MW &m, Game &g, int seat, const World &w) {
  RbKeyMemo &M = g.rbMemo; const int extra = 5 - m.startLen;
  if (extra > 2) return nullptr;
  const size_t slots = extra == 0 ? 1 : extra == 1 ? 52 : 2704;
  const size_t index = extra == 0 ? 0 : extra == 1 ? (size_t)w.cards[4] : (size_t)w.cards[3] * 52 + (size_t)w.cards[4];
  auto &tab = M.scores[seat];
  if (tab.empty()) { if (!(M.bytes < M.limitBytes)) return nullptr; tab.resize(slots); M.bytes += (double)slots * sizeof(void *); }
  if (!tab[index]) {
    if (!(M.bytes < M.limitBytes)) return nullptr;
    auto e = std::make_unique<RbScores>(); const auto &range = m.hands[(size_t)seat];
    uint64_t pub = 0; for (int i = 0; i < 5; i++) pub |= 1ULL << w.cards[i];
    e->score.assign(range.size(), -1); std::vector<std::pair<int, int>> order;
    for (size_t i = 0; i < range.size(); i++) {
      const Hand &h = range[i]; if (((pub >> h.a) & 1) || ((pub >> h.b) & 1) || !(h.w > 0)) continue;
      e->score[i] = m.startLen == 5 ? h.riverScore : evalSeven(w.cards, h.a, h.b); order.emplace_back(e->score[i], (int)i);
    }
    std::sort(order.begin(), order.end()); e->order.reserve(order.size()); for (const auto &o : order) e->order.push_back((uint16_t)o.second);
    M.bytes += (double)sizeof(RbScores) + (double)range.size() * 4 + (double)order.size() * 2 + 64;
    tab[index] = std::move(e);
  }
  return tab[index].get();
}
inline bool rbPrepareDeal(MW &m, Game &g, const Unit &u, RbDeal &rd) {
  for (int p = 0; p < m.n; p++) rd.scores[p] = rbScoreEntry(m, g, p, u.w);
  if (!g.groups.on) { for (int p = 0; p < m.n; p++) rd.entry[p][0] = rbExactEntry(m, g, p); return true; }
  GroupKeys &G = g.groups; RbKeyMemo &M = g.rbMemo;
  for (int p = 0; p < m.n; p++) {
    const RbEntry *prev = nullptr;
    for (int li = 0; li < G.nl; li++) {
      const int L = G.lengths[li], extra = L - G.start;
      long long index = -1; size_t slots = 0;
      if (extra == 0) { index = 0; slots = 1; }
      else if (G.start >= 3 && extra == 1) { index = u.w.cards[G.start]; slots = 52; }
      else if (G.start >= 3 && extra == 2) { index = (long long)u.w.cards[G.start] * 52 + u.w.cards[G.start + 1]; slots = 2704; }
      const RbEntry *e = nullptr;
      if (index >= 0) {
        auto &tab = M.table[p][li];
        if (tab.empty() && M.bytes < M.limitBytes) { tab.resize(slots); M.bytes += (double)slots * sizeof(void *); }
        if (!tab.empty()) {
          if (!tab[(size_t)index] && M.bytes < M.limitBytes) {
            auto fresh = std::make_unique<RbEntry>();
            if (!rbGroupEntry(m, g, p, li, u.w, prev, *fresh)) return false;
            M.bytes += (double)sizeof(RbEntry) + (double)fresh->idx.size() * 2 + (double)fresh->code.size() * 6 + 64; M.entries++; M.built++;
            tab[(size_t)index] = std::move(fresh);
          }
          e = tab[(size_t)index].get();
        }
      }
      if (!e) {
        if (!rd.owned[p][li]) rd.owned[p][li] = std::make_unique<RbEntry>();
        if (!rbGroupEntry(m, g, p, li, u.w, prev, *rd.owned[p][li])) return false;
        M.built++; e = rd.owned[p][li].get();
      }
      rd.entry[p][li] = e; prev = e;
    }
  }
  return true;
}
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
  const int B = m.batchStart ? m.batchDeals : m.curBatch;   // 5.1: with a warm-up schedule, deal-weighted (divide by the full batch)
  for (const Inc &inc : u.incs) {
    const int sid = inc.ref >= 0 ? inc.ref : resolved[(size_t)(-inc.ref - 1)];
    const long long r = inc.row >= 0 ? inc.row : m.getOrCreate(rowKey((uint32_t)sid, inc.hand, inc.code), sid, inc.k);
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
// 5.10 RB-ES, one deal per update: merge() for an update whose increments are known to belong to the linear or
// uniform default update rule (no DCFR, no regret matching+; the estimator is refused with them). One seat of one
// deal writes hundreds of rows, so the per-value work of merge() matters here: the finiteness of every stored sum
// is tested once at the end (a non-finite value propagates into the test word), and the update is rolled back by
// the journal exactly as merge() would have left it. 1: ok, 0: budget, -1: non-finite.
inline int mergeRB(MW &m, Game &g, Unit &u, Update &update) {
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
  double z = 0;
  for (const Inc &inc : u.incs) {
    const int sid = inc.ref >= 0 ? inc.ref : resolved[(size_t)(-inc.ref - 1)];
    const long long r = inc.row >= 0 ? inc.row : m.getOrCreate(rowKey((uint32_t)sid, inc.hand, inc.code), sid, inc.k);
    if (r < 0) return 0;
    MW::RowMeta &rm = m.rows[(size_t)r]; update.touch((size_t)r, true); rm.visited = 1;
    double *v = &m.vals[rm.off]; const double *x = &u.vals[inc.off]; const int k2 = 2 * inc.k;
    for (int a = 0; a < k2; a++) { const double s = (v[a] + x[a]) + 0.0; v[a] = s; z += s * 0.0; }
  }
  return z == 0 ? 1 : -1;
}
// ---- 5.7: frozen batches (several deals per update) ----
// Through 5.6 only the traversal of a frozen batch used several threads: the deals were prepared and the increments
// merged on the calling thread. 5.7 splits both so that the order-dependent part stays serial and everything else
// runs on the workers, without changing one stored bit:
//   deals      sampled in deal order (the deal stream is consumed in order)                      serial
//   prepare    showdown scores, card codes, hand-group keys and the ids of those that exist      parallel
//   fixup      hand-group keys that are not in the dictionary yet: interned in deal order        serial
//   traverse   as before; each worker also notes, per deal, the first non-finite increment       parallel
//   resolve    new betting states and new table rows, created in deal order                      serial
//   accumulate increments added to the batch delta; table rows are partitioned among the         parallel
//              threads, and each thread walks the deals in order, so every row receives its
//              additions in the order of 5.6 (floating-point sums are order-dependent)
//   apply      delta added to the table, row by row (rows are independent)                       parallel
// Identifiers (group ids, state ids, row indices, value offsets) are assigned by the serial stages in the order 5.6
// assigned them, and each value is produced by the same operations in the same order, so the saved state is
// byte-identical for every thread count and identical to 5.6 (validation/5.7/identity).

// Hand groups of one deal of a frozen batch, in two steps.
// prepareGroups (any thread; the dictionary is only read): for every seat and street the key itself is computed
// (the number of a Compact key, the text of a Detailed key; both follow from the previous street's KEY, which is
// known even when that key has no id yet) and looked up. Keys that are found get their id; the others are kept.
// internGroups (calling thread, in deal order): the kept keys are interned in the order worldGroups() reaches them
// (seat, then street), so a new key receives the id 5.6 gave it and a full dictionary stops the update at the same
// deal. An id found by prepareGroups is the id worldGroups() returns: ids are never reassigned while a call runs.
struct GroupPrep {
  unsigned long long num[8][4] = {}; bool miss[8][4] = {}; bool anyMiss = false;
  bool uncached[8][4] = {}; bool anyUncached = false;   // 5.10: computed here, to be written to GroupKeys::idCache by the calling thread
  std::vector<std::string> text;   // Detailed keys only: [seat * 4 + street index]
};
inline void prepareGroups(const MW &m, const GroupKeys &G, const std::vector<std::vector<uint32_t>> &start, const World &w, uint32_t (&ids)[6][8], GroupPrep &gp) {
  gp.anyMiss = false; gp.anyUncached = false;
  if (G.detailed && gp.text.size() < 32) gp.text.resize(32);
  for (int p = 0; p < m.n; p++) {
    const Hand &h = m.hands[(size_t)p][(size_t)w.seat[p]];
    bool hasPrev = false; unsigned long long prevNum = 0; const std::string *prevText = nullptr;
    for (int i = 0; i < G.nl; i++) {
      const int L = G.lengths[i]; uint32_t id; gp.miss[p][i] = false; gp.uncached[p][i] = false; size_t slots = 0;
      if (L == G.start) {
        id = start[(size_t)p][(size_t)w.seat[p]];
        if (G.detailed) prevText = G.text[(size_t)id]; else prevNum = G.number[(size_t)id];
      } else if ((id = G.cached(p, i, G.cacheIndex(L, w.cards, slots), w.seat[p])) != UINT32_MAX) {
        // 5.10: cached identifier (read only here); the next street chains to this key through the dictionary
        if (G.detailed) prevText = G.text[(size_t)id]; else prevNum = G.number[(size_t)id];
      } else {
        int cards[7]; std::copy_n(w.cards, L, cards); cards[L] = h.a; cards[L + 1] = h.b;
        const int score = evalAny(cards, L + 2);
        if (!G.detailed) {
          const unsigned long long num = (hasPrev ? prevNum : 0ULL) * 2048ULL + G.compactSignal(p, h.a, h.b, h.id, w.cards, L, score);
          id = G.findNumber(num); gp.num[p][i] = num; prevNum = num;
        } else {
          std::string &key = gp.text[(size_t)p * 4 + (size_t)i];
          G.detailedText(key, hasPrev ? prevText : nullptr, p, h.a, h.b, h.id, w.cards, L, score);
          const auto it = G.index.find(key); id = it == G.index.end() ? UINT32_MAX : it->second; prevText = &key;
        }
        if (id == UINT32_MAX) { gp.miss[p][i] = true; gp.anyMiss = true; }
        gp.uncached[p][i] = true; gp.anyUncached = true;
      }
      ids[L][p] = id; hasPrev = true;
    }
  }
}
inline bool internGroups(MW &m, GroupKeys &G, uint32_t (&ids)[6][8], const GroupPrep &gp) {
  std::string key;
  for (int p = 0; p < m.n; p++) for (int i = 0; i < G.nl; i++) if (gp.miss[p][i]) {
    uint32_t id;
    if (!G.detailed) { const unsigned long long num = gp.num[p][i]; key = std::to_string(num); id = G.intern(key, num, m.bytes, m.budgetBytes); if (id != UINT32_MAX) G.rememberNumber(num, id); }
    else id = G.intern(gp.text[(size_t)p * 4 + (size_t)i], 0, m.bytes, m.budgetBytes);
    if (id == UINT32_MAX) return false;
    ids[G.lengths[i]][p] = id;
  }
  return true;
}
// 5.10: the identifiers prepareGroups() computed (and internGroups() completed) for one deal go into the cache; called
// by the thread that runs the serial stages, after the deal's keys all have identifiers.
inline void cacheGroups(const MW &m, GroupKeys &G, const World &w, const uint32_t (&ids)[6][8], const GroupPrep &gp) {
  for (int p = 0; p < m.n; p++) for (int i = 0; i < G.nl; i++) if (gp.uncached[p][i]) {
    size_t slots = 0; const int L = G.lengths[i]; const long long ci = G.cacheIndex(L, w.cards, slots);
    G.remember(p, i, ci, slots, w.seat[p], m.hands[(size_t)p].size(), ids[L][p]);
  }
}
// Per-deal notes of a frozen batch. Kept outside Unit so that the transient-memory accounting of a deal is unchanged.
struct UnitNote { int firstBad = -1; uint32_t newRows = 0; };
// Index of the first increment of a deal with a non-finite value (-1: none). 5.6 made this test while merging, one
// value at a time. Every element of Unit::vals belongs to an increment, and x * 0.0 is 0 for a finite x and NaN
// otherwise, so one pass over the array answers "all finite"; only a deal that fails is searched for the place.
inline int firstNonFinite(const Unit &u) {
  const double *v = u.vals.data(); const size_t nv = u.vals.size(); size_t j = 0;
  double z0 = 0, z1 = 0, z2 = 0, z3 = 0;   // four sums: the additions do not wait for one another
  for (; j + 4 <= nv; j += 4) { z0 += v[j] * 0.0; z1 += v[j + 1] * 0.0; z2 += v[j + 2] * 0.0; z3 += v[j + 3] * 0.0; }
  for (; j < nv; j++) z0 += v[j] * 0.0;
  if ((z0 + z1) + (z2 + z3) == 0) return -1;
  for (size_t i = 0; i < u.incs.size(); i++) { const Inc &inc = u.incs[i]; const double *x = &u.vals[inc.off]; for (int a = 0; a < 2 * inc.k; a++) if (!std::isfinite(x[a])) return (int)i; }
  return -1;
}
// The order-dependent part of merge() for one deal of a frozen batch: betting states and table rows that did not
// exist during traversal get their identifiers, in the order merge() assigned them, and each increment's row is
// written back to Inc::row. Returns what merge() would have returned for this deal (1 ok, 0 budget, -1 non-finite);
// `done` is the number of increments merge() would have reached before returning.
inline int resolveUnit(MW &m, Game &g, Unit &u, const UnitNote &note, size_t &done) {
  done = 0;
  if (u.pending.empty() && !note.newRows && note.firstBad < 0) { done = u.incs.size(); return 1; }
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
  const size_t ni = u.incs.size();
  for (size_t i = 0; i < ni; i++) {
    Inc &inc = u.incs[i];
    if (inc.row < 0) {
      const int sid = inc.ref >= 0 ? inc.ref : resolved[(size_t)(-inc.ref - 1)];
      const long long r = m.getOrCreate(rowKey((uint32_t)sid, inc.hand, inc.code), sid, inc.k);
      if (r < 0) { done = i; return 0; }
      inc.row = (int32_t)r;
    }
    if ((int)i == note.firstBad) { done = i + 1; return -1; }
  }
  done = ni; return 1;
}
// Which thread of `parts` merges table row r. Blocks of 16 consecutive rows stay together (their metadata and values
// are adjacent in memory); the blocks are spread by a hash because the first rows of a table are the most visited.
inline unsigned rowPart(uint32_t r, unsigned parts) { return (unsigned)(StateTable::mix((uint64_t)(r >> 4) + 1) % parts); }
inline double now() { return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count(); }
inline int train(MW *m, long long iterations, int threads, volatile int *stop, mw_progress_fn progress, void *ctx, char *err, int errlen) {
  Game &g = *m->es;
  const int Bmax = m->batchDeals, n = m->n;   // 5.1: buffers are sized for the largest batch; B is set per update
  const bool parallel = Bmax > 1 && g.perDealStreams;
  const size_t cap=(size_t)m->budgetBytes;
  const size_t icmBytes=m->tournament.start.empty()?0:Tournament::workspaceBytes(m->tournament.start.size(),m->budgetBytes);
  const size_t fixed=sizeof(Walker)+icmBytes+512;
  const size_t cacheBytes=Walker::edgeEntries(m->budgetBytes)*(sizeof(Walker::Edge)+sizeof(Walker::TermEntry)+16);
  const size_t perWorker=fixed+cacheBytes+(MAX_DEPTH+2)*(sizeof(BS)+3*8*sizeof(double))+4096;
  const int affordable=(int)std::min<size_t>(Bmax,cap/perWorker);
  const int T=parallel ? std::max(1,std::min(threads,affordable)) : 1;
  m->lastThreads = T;
  auto failMsg = [&](const char *msg) { if (err && errlen > 0) snprintf(err, (size_t)errlen, "%s", msg); return 0; };
  try {
    if (cap < fixed*T+Bmax*sizeof(Unit)) throw std::bad_alloc();
    ScratchBudget budget(cap-fixed*T-Bmax*sizeof(Unit),g.scratchPeak);
    Workers pool(T);
    ScoreSchedule scorer; beginScoringCall(*m, iterations, "external sampling");
    const bool cpuMode=m->mode=="cpu";
    const bool routeBatchAtMax=!cpuMode && Bmax*n>=128 && m->startLen!=5;
    m->route=routeBatchAtMax?"CPU (external sampling traversal)":"CPU (external sampling traversal; small batch or CPU scoring)";

    g.setStoreCap(m->budgetBytes); g.extendStore(m->stateVisits);
    std::vector<std::unique_ptr<Walker>> walkers;
    for (int i = 0; i < T; i++) walkers.emplace_back(new Walker(*m, g, budget));
    std::vector<Unit> units;units.reserve(Bmax);
    for(int i=0;i<Bmax;i++)units.emplace_back(budget);
    // 5.10 RB-ES: per deal, the row keys of every hand of every seat (rbPrepareDeal, serial) and the vectors of the
    // seat being traversed (built by the traversing thread). Empty unless the estimator is selected.
    std::vector<RbDeal> rbDeals(g.rbes ? (size_t)Bmax : 0);
    struct RbTotals { Game &g; std::vector<std::unique_ptr<Walker>> &w; ~RbTotals() { if (!g.rbes) return; for (auto &x : w) { g.rbStats.seatWalks += x->rbSeatWalks; g.rbStats.hands += x->rbHandsCarried; g.rbStats.rows += x->rbRowsWritten; g.rbStats.exactTerminals += x->rbExactTerminals; g.rbStats.sampled += x->rbSampled; g.rbStats.unsampled += x->rbUnsampled; } } } rbTotals{g, walkers};
    // Waking helper threads costs tens of microseconds. A batch is split only
    // when the previous batch's measured state visits make it worthwhile.
    // Results are identical either way.
    double visitsPerDeal = 1e9;
    // 5.7 frozen batches: per-deal notes and hand-group keys, and per-thread lists of touched rows (see above
    // prepareGroups). EIGHTMAX_LEGACY_BATCH=1 selects the 5.6 update for comparisons; the states are the same.
    static const bool legacyBatch = [] { const char *v = std::getenv("EIGHTMAX_LEGACY_BATCH"); return v && *v && *v != '0'; }();
    // EIGHTMAX_THREAD_CHOICE=fixed: every update uses all the threads of the call (validation: each thread count is
    // then really exercised; otherwise the measured choice may settle on fewer threads than were offered).
    static const bool fixedThreads = [] { const char *v = std::getenv("EIGHTMAX_THREAD_CHOICE"); return v && !std::strcmp(v, "fixed"); }();
    DealQueue queue(T);
    std::vector<UnitNote> notes((size_t)Bmax); std::vector<GroupPrep> preps(g.groups.on && Bmax > 1 ? (size_t)Bmax : 0); std::vector<std::vector<int32_t>> rowLists((size_t)T);
    int usedThreads = 1;
    struct PoolStats { Game &g; Workers &pool; MW *m; int &used; ~PoolStats() { g.stages.dispatches += pool.dispatches; g.stages.parks += pool.parks.load(); m->lastThreads = used; } } poolStats{g, pool, m, usedThreads};
    g.unitLimitBytes = (size_t)(m->budgetBytes / 4 / Bmax);
    const int seatPasses = g.wholeGameEnumerated() ? 1 : n;   // 5.6: a shared walk of a final-street game updates every seat at once
    std::pmr::vector<Update::Undo> journal(&budget);   // 5.6: one journal for the whole call (see es_transaction.hpp)
    // 5.6: with one deal per update the deal, traversal and merge stages are timed on the profiled updates only
    // (1 in 16, as scoring has been since 3.3) and the totals are scaled by updates / timed updates when the call
    // ends. 5.5 read the clock 3n + 2 times per deal, a measurable share of a deal that takes about a microsecond.
    // The seconds reported for such runs are therefore estimates; frozen batches are timed in full as before.
    struct StageClock {
      Game &g; double deal = 0, traverse = 0, merge = 0; long long timed = 0, all = 0;
      ~StageClock() { if (!timed) return; const double f = (double)all / (double)timed; g.secDeal += deal * f; g.secTraverse += traverse * f; g.secMerge += merge * f; }
    } sampled{g};
    for (long long it = 0; it < iterations && !m->limitReached; it++) {
      if (stop && __atomic_load_n(stop, __ATOMIC_RELAXED)) break;
      const int B = m->batchAt(m->iterations); m->curBatch = B;   // deterministic: depends only on committed updates
      const bool routeBatch = !cpuMode && B * n >= 128 && m->startLen != 5;   // 5.6: mode string compared once per call
      const bool parallel = B > 1 && g.perDealStreams;
      if (g.dcfr) {   // before the journal: the schedule is deterministic and kept on rollback
        // The discount tables grow by 48 bytes per iteration and are charged to the table budget.
        const size_t before = g.schedule.bytes();
        if (!g.schedule.extend(m->iterations, m->budgetBytes - m->bytes + (double)before)) { m->limitReached = true; break; }
        m->bytes += (double)g.schedule.bytes() - (double)before;
      }
      Update update(*m,journal); bool groupFull = false; const bool profiled = (m->iterations & 15) == 0;
      const bool timed = profiled || B > 1;
      // 5.1: with a warm-up schedule each update is weighted by its deals: increments are divided by the
      // full batch size (merge) and linear weighting counts committed deals in full batches, so a 4-deal
      // warm-up update carries 4/64 of a full update (an update-count weight overweighted the warm-up).
      const double step = m->linear ? (m->batchStart ? (double)(m->dealsBefore(m->iterations) + B) / Bmax : (double)(m->iterations + 1)) : 1.0;
      const double avgStep = m->linear ? step : g.dcfrEager ? 1.0 : g.dcfr ? g.schedule.averageWeight((double)(m->iterations + 1)) : 1.0;
      double t0 = timed ? now() : 0;
      long long visits = 0; int status = 1;
      if (B == 1) {
        Unit &u = units[0]; u.clear();
        if (!m->deal(u.w,0)) return failMsg("Compatible hands are too rare to sample reliably. Review overlapping ranges or use exact deals.");
        g.attempts++;
        // 3.3 profile: the scoring stage is timed on one update in 16 only, so the
        // clock reads do not slow down cheap deals (they cost about 1 us on small games).
        if (!routeBatch && profiled) { const double s0 = now(); m->score(u.w); g.secScore += now() - s0; } else if (!routeBatch) m->score(u.w);
        codes(u, n);
        if (g.groups.on && !groupCodes(*m, g, u)) groupFull = true;
        if (g.rbes && !groupFull) { if (!rbPrepareDeal(*m, g, u, rbDeals[0])) groupFull = true; walkers[0]->rbDeal = &rbDeals[0]; }
        if(routeBatch && !groupFull){
          const double start=profiled?now():0;
          scorer.run(*m,units,(size_t)B);
          if(profiled)g.secScore+=now()-start;
        }
        double t1 = timed ? now() : 0;
        sampled.all++; if (timed) { sampled.timed++; sampled.deal += t1 - t0; }
        if (groupFull) status = 0;
        Rng own{deriveSeed(g.actionSeed, m->iterations, 0)};
        if (m->wide.on) own.address(m->wide, em511::ACTIONS, (uint64_t)m->iterations, 0);   // 5.11
        Rng &r = g.perDealStreams || m->wide.on ? own : g.actionRng;
        for (int p = 0; p < seatPasses && status == 1; p++) {
          if (g.onlySeat >= 0 && p != g.onlySeat) continue;   // 5.8 trained response: one seat learns
          double a = timed ? now() : 0;
          u.pending.clear(); u.incs.clear(); u.vals.clear();
          walkers[0]->run(u, p, r, step, avgStep);
          double b = timed ? now() : 0; sampled.traverse += b - a;
          if (u.overflow) { status = 0; break; }
          status = g.rbes ? mergeRB(*m, g, u, update) : merge(*m, g, u, true, update); visits += u.visits; u.visits = 0;
          if (timed) sampled.merge += now() - b;
        }
      } else if (legacyBatch) {
        // The 5.6 frozen batch, kept for comparison (EIGHTMAX_LEGACY_BATCH=1): serial preparation and merge.
        for (int d = 0; d < B; d++) {
          Unit &u = units[(size_t)d]; u.clear();
          if (!m->deal(u.w,d)) return failMsg("Compatible hands are too rare to sample reliably. Review overlapping ranges or use exact deals.");
          g.attempts++;
          if (!routeBatch && profiled) { const double s0 = now(); m->score(u.w); g.secScore += now() - s0; } else if (!routeBatch) m->score(u.w);
          codes(u, n);
          if (g.groups.on && !groupCodes(*m, g, u)) { groupFull = true; break; }
          if (g.rbes && !rbPrepareDeal(*m, g, u, rbDeals[(size_t)d])) { groupFull = true; break; }
        }
        if(routeBatch && !groupFull){
          const double start=profiled?now():0;
          scorer.run(*m,units,(size_t)B);
          if(profiled)g.secScore+=now()-start;
        }
        double t1 = now(); g.secDeal += t1 - t0;
        if (groupFull) status = 0;
        else {
          std::atomic<int> next{0}; std::atomic<bool> oom{false};
          auto job = [&](int index) {
            try {
              for (;;) {
                const int d = next.fetch_add(1);
                if (d >= B) break;
                Unit &u = units[(size_t)d];
                Rng own{deriveSeed(g.actionSeed, m->iterations, d)};
                if (m->wide.on) own.address(m->wide, em511::ACTIONS, (uint64_t)m->iterations, (uint64_t)d);   // 5.11
                Rng &r = g.perDealStreams || m->wide.on ? own : g.actionRng;
                if (g.rbes) walkers[(size_t)index]->rbDeal = &rbDeals[(size_t)d];
                for (int p = 0; p < seatPasses && !u.overflow; p++) if (g.onlySeat < 0 || p == g.onlySeat) walkers[(size_t)index]->run(u, p, r, step, avgStep);
              }
            } catch (const std::bad_alloc &) { oom = true; }
          };
          double a = now();
          const bool split = parallel && T > 1 && visitsPerDeal * B >= 2000.0;
          pool.run(job, split ? T : 1);
          if (split) usedThreads = std::max(usedThreads, T);
          double b = now(); g.secTraverse += b - a;
          if (oom) throw std::bad_alloc();
          for (int d = 0; d < B; d++) if (units[(size_t)d].overflow) { status = 0; break; }
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
      } else {
        // ---- 5.7 frozen batch (stages described above prepareGroups) ----
        const int use = !parallel ? 1 : fixedThreads ? T : g.tuner.choose(T);
        usedThreads = std::max(usedThreads, use);
        std::atomic<bool> oom{false};
        // deals, in order. A deal that cannot be sampled ends the update as in 5.6, where the deals before it had
        // already been prepared; so they are prepared here too, and a full group dictionary still takes precedence.
        const long long attemptsBefore = g.attempts; int dealt = 0;
        for (; dealt < B; dealt++) { Unit &u = units[(size_t)dealt]; u.clear(); if (!m->deal(u.w, dealt)) break; g.attempts++; }
        const double tDeal = now();
        // prepare (parallel): nothing here writes shared data; the group dictionary is only read.
        const bool spreadPrepare = use > 1 && (fixedThreads || g.prepareSwitch.choose());
        const int usePrepare = spreadPrepare ? use : 1;
        queue.reset(dealt, usePrepare);
        auto prepare = [&](int index) {
          try {
            for (;;) {
              const int d = queue.take(index);
              if (d < 0) break;
              Unit &u = units[(size_t)d];
              if (!routeBatch) m->score(u.w);
              codes(u, n);
              if (g.groups.on) prepareGroups(*m, g.groups, g.startKey, u.w, u.gk, preps[(size_t)d]);
            }
          } catch (const std::bad_alloc &) { oom = true; }
        };
        pool.run(prepare, usePrepare);
        if (oom) throw std::bad_alloc();
        const double tPrepare = now();
        if (use > 1 && !fixedThreads) g.prepareSwitch.record(spreadPrepare, tPrepare - tDeal, (double)dealt);
        // fixup (serial, deal order): deals with a hand group that has to be interned.
        if (g.groups.on) for (int d = 0; d < dealt; d++) if (preps[(size_t)d].anyMiss) {
          g.stages.fixedDeals++;
          if (!internGroups(*m, g.groups, units[(size_t)d].gk, preps[(size_t)d])) { groupFull = true; g.attempts = attemptsBefore + d + 1; break; }
        }
        if (g.groups.on && !groupFull) for (int d = 0; d < dealt; d++) if (preps[(size_t)d].anyUncached) cacheGroups(*m, g.groups, units[(size_t)d].w, units[(size_t)d].gk, preps[(size_t)d]);   // 5.10
        // 5.10 RB-ES: the keys of every hand of every seat, in deal order (new keys are interned here; see rbPrepareDeal).
        if (g.rbes && !groupFull) for (int d = 0; d < dealt; d++) if (!rbPrepareDeal(*m, g, units[(size_t)d], rbDeals[(size_t)d])) { groupFull = true; g.attempts = attemptsBefore + d + 1; break; }
        if (!groupFull && dealt < B) return failMsg("Compatible hands are too rare to sample reliably. Review overlapping ranges or use exact deals.");
        if(routeBatch && !groupFull){
          const double start=profiled?now():0;
          scorer.run(*m,units,(size_t)B);
          if(profiled)g.secScore+=now()-start;
        }
        const double t1 = now();
        g.secDeal += t1 - t0; g.stages.deal += tDeal - t0; g.stages.prepare += tPrepare - tDeal; g.stages.fixup += t1 - tPrepare;
        if (groupFull) status = 0;
        else {
          // traverse (parallel)
          queue.reset(B, use);
          auto job = [&](int index) {
            try {
              Walker &walker = *walkers[(size_t)index];
              for (;;) {
                const int d = queue.take(index);
                if (d < 0) break;
                Unit &u = units[(size_t)d];
                Rng own{deriveSeed(g.actionSeed, m->iterations, d)};
                if (m->wide.on) own.address(m->wide, em511::ACTIONS, (uint64_t)m->iterations, (uint64_t)d);   // 5.11
                Rng &r = g.perDealStreams || m->wide.on ? own : g.actionRng;
                walker.newRows = 0;
                if (g.rbes) walker.rbDeal = &rbDeals[(size_t)d];
                for (int p = 0; p < seatPasses && !u.overflow; p++) if (g.onlySeat < 0 || p == g.onlySeat) walker.run(u, p, r, step, avgStep);
                if (!u.overflow) { notes[(size_t)d].newRows = walker.newRows; notes[(size_t)d].firstBad = firstNonFinite(u); }
              }
            } catch (const std::bad_alloc &) { oom = true; }
          };
          pool.run(job, use);
          const double b = now(); g.secTraverse += b - t1; g.stages.traverse += b - t1;
          if (oom) throw std::bad_alloc();
          for (int d = 0; d < B; d++) if (units[(size_t)d].overflow) { status = 0; break; }
          m->touched.clear();
          // resolve (serial, deal order)
          int failedDeal = -1; size_t failedDone = 0;
          for (int d = 0; d < B && status == 1; d++) {
            size_t done; status = resolveUnit(*m, g, units[(size_t)d], notes[(size_t)d], done); visits += units[(size_t)d].visits;
            if (status != 1) { failedDeal = d; failedDone = done; }
          }
          const double tResolve = now(); g.stages.resolve += tResolve - b;
          if (status != 1 && failedDeal >= 0) {
            // 5.6 had merged the deals before the failing one: rows that existed before this update keep the
            // `visited` mark that merge gave them (everything else of the update is rolled back).
            for (int d = 0; d <= failedDeal; d++) { const Unit &u = units[(size_t)d]; const size_t end = d < failedDeal ? u.incs.size() : failedDone;
              for (size_t i = 0; i < end; i++) { const int32_t r = u.incs[i].row; if (r >= 0 && (size_t)r < update.rows) m->rows[(size_t)r].visited = 1; } }
          }
          if (status == 1) {
            const int Bdiv = m->batchStart ? m->batchDeals : m->curBatch;   // as in merge()
            const bool spreadMerge = use > 1 && (fixedThreads || g.mergeSwitch.choose());
            const int useMerge = spreadMerge ? use : 1;
            const unsigned parts = (unsigned)useMerge; std::atomic<bool> bad{false};
            for (unsigned t = 0; t < parts; t++) rowLists[t].clear();
            // accumulate (parallel by row partition; deals in order within each partition), then the finiteness test
            auto accumulate = [&](int index) {
              std::vector<int32_t> &list = rowLists[(size_t)index];
              try {
                for (int d = 0; d < B; d++) {
                  const Unit &u = units[(size_t)d];
                  for (const Inc &inc : u.incs) {
                    const uint32_t r = (uint32_t)inc.row;
                    if (parts > 1 && rowPart(r, parts) != (unsigned)index) continue;
                    MW::RowMeta &rm = m->rows[(size_t)r];
                    if (!rm.marked) { list.push_back((int32_t)r); rm.marked = 1; }
                    rm.visited = 1;
                    const size_t o = rm.off; const double *x = &u.vals[inc.off]; const int k = inc.k;
                    for (int a = 0; a < k; a++) {
                      double &dr = m->delta[o + (size_t)a], &da = m->delta[o + (size_t)(k + a)];
                      dr = (dr + 0.0 / Bdiv) + x[a] / Bdiv;
                      da = (da + x[k + a] / Bdiv) + 0.0 / Bdiv;
                    }
                  }
                }
                for (int32_t r : list) {
                  const auto &rm = m->rows[(size_t)r];
                  double pos = 1, neg = 1; if (g.dcfr) dcfrFactors(*m, g, rm, pos, neg);
                  for (size_t j = rm.off; j < rm.off + 2*rm.k; ++j) {
                    double v = m->vals[j]; if (g.dcfr && j < rm.off + (size_t)rm.k) v = v > 0 ? v * pos : v < 0 ? v * neg : v;
                    if (!std::isfinite(v+m->delta[j])) { bad = true; break; }
                  }
                }
              } catch (const std::bad_alloc &) { oom = true; }
            };
            pool.run(accumulate, useMerge);
            // The rows touched by this update, for commit and rollback (Update reads m->touched).
            size_t moved = 0, movedList = 0;
            try { for (; movedList < parts; movedList++, moved = 0) for (; moved < rowLists[movedList].size(); moved++) m->touched.push_back(rowLists[movedList][moved]); }
            catch (const std::bad_alloc &) {
              for (unsigned t = (unsigned)movedList; t < parts; t++) for (size_t i = t == movedList ? moved : 0; i < rowLists[t].size(); i++) {
                MW::RowMeta &rm = m->rows[(size_t)rowLists[t][i]]; std::fill_n(&m->delta[rm.off], 2 * (size_t)rm.k, 0.0); rm.marked = 0; }
              throw;
            }
            const double tAccumulate = now(); g.stages.accumulate += tAccumulate - tResolve;
            if (oom) throw std::bad_alloc();
            if (bad) return failMsg("Non-finite batch strategy value");
            auto apply = [&](int index) {
              for (int32_t r : rowLists[(size_t)index]) {
                MW::RowMeta &rm = m->rows[(size_t)r]; const size_t o = rm.off;
                if (g.dcfr) catchUp(*m, g, rm);
                for (int x = 0; x < 2 * rm.k; x++) {
                  const double v = m->vals[o + (size_t)x] + m->delta[o + (size_t)x];
                  m->vals[o + (size_t)x] = x < rm.k && m->plus ? jsMax0(v) : v; m->delta[o + (size_t)x] = 0;
                }
                rm.marked = 0;
              }
            };
            pool.run(apply, useMerge);
            const double tApply = now(); g.stages.apply += tApply - tAccumulate;
            if (use > 1 && !fixedThreads) { double incs = 0; for (int d = 0; d < B; d++) incs += (double)units[(size_t)d].incs.size(); g.mergeSwitch.record(spreadMerge, tApply - tResolve, incs); }
          }
          const double tEnd = now();
          g.secMerge += tEnd - b;
          g.stages.updates++; if (use > 1) g.stages.threadUpdates++;
          if (parallel && !fixedThreads && status == 1) g.tuner.record(tEnd - t0, visits);
        }
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
