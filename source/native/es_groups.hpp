// EightMax 3.3: native Compact and Detailed hand groups for external sampling
// (flop and preflop starts, and turn starts above the 3.2 representative-table
// limit). Included by mw_es.hpp.
//
// The keys reproduce lib_wide.js seatKey() exactly:
//   signal = 256 + combo id   on the starting street when the seat's range has <= 12 hands
//          = 169-class index   preflop (EM.CLS)
//          = strengthGroup()   Compact (lib_wide.js)
//          = handFeatures().key Detailed (lib_information.js)
//   Compact key  = previous * 2048 + signal          (previous = 0 on the starting street)
//   Detailed key = previous + '/' + signal           (text)
// Only the strategy lookup is grouped. Deals, card removal, weighted sampling,
// runouts, showdowns, side pots, chip EV and ICM always use the physical hands.
// Keys are interned into a per-study dictionary; a row is (betting state, key id).
// The dictionary is charged to the table budget and truncated on rollback. EMMW4
// states written in this mode (header "rowKeys":1) carry the key text, so the
// JavaScript and native tables exchange rows without any representative mapping.
// (included inside namespace es by mw_es.hpp)
#pragma once
inline int classOf(int c1, int c2) {   // lib_cards.js classOf
  int r1 = c1 >> 2, r2 = c2 >> 2; const bool suited = (c1 & 3) == (c2 & 3);
  if (r1 < r2) std::swap(r1, r2);
  const int hi = 12 - r1, lo = 12 - r2;
  if (r1 == r2) return hi * 13 + hi;
  return suited ? hi * 13 + lo : lo * 13 + hi;
}
inline int comboId(int a, int b) { if (a > b) std::swap(a, b); return a * 51 - a * (a - 1) / 2 + (b - a - 1); }
inline void base36(std::string &out, unsigned long long x) {
  char tmp[24]; int n = 0; do { const int d = (int)(x % 36); tmp[n++] = (char)(d < 10 ? '0' + d : 'a' + d - 10); x /= 36; } while (x);
  while (n) out += tmp[--n];
}
inline int popcount13(int m) { int p = 0; while (m) { m &= m - 1; p++; } return p; }
inline int evalAny(const int *cards, int count) {   // lib_eval.js evalCards
  int s[4] = {0, 0, 0, 0}; for (int i = 0; i < count; i++) s[cards[i] & 3] |= 1 << (cards[i] >> 2);
  return evalMasks(s[0], s[1], s[2], s[3]);
}
// lib_wide.js strengthGroup(h, cards, score)
inline int strengthGroup(int a, int b, const int *pub, int L, int score) {
  const int category = (int)((unsigned)score >> 26), detail = (int)(((unsigned)score >> 13) & 8191);
  const int bits = detail ? detail : (score & 8191); const int top = bits ? 31 - __builtin_clz((unsigned)bits) : -1;
  int suits[4] = {0, 0, 0, 0}, ranks = 0;
  for (int i = 0; i < L + 2; i++) { const int c = i < L ? pub[i] : i == L ? a : b; suits[c & 3]++; ranks |= 1 << (c >> 2); }
  const bool flushDraw = L < 5 && (suits[0] == 4 || suits[1] == 4 || suits[2] == 4 || suits[3] == 4);
  bool straightDraw = false;
  if (L < 5 && category < 4) for (int hi = 4; hi <= 13; hi++) {
    const int window = hi == 13 ? 0x100f : 31 << (hi - 4);
    if (popcount13(ranks & window) == 4) { straightDraw = true; break; }
  }
  return ((category * 5 + std::max(0, top) / 3) * 2 + (int)flushDraw) * 2 + (int)straightDraw;
}
// lib_information.js EM.handFeatures(h, board, score).key
inline void featureKey(std::string &out, int a, int b, const int *pub, int L, int score) {
  static const int windows[10] = {0x100f, 31, 31 << 1, 31 << 2, 31 << 3, 31 << 4, 31 << 5, 31 << 6, 31 << 7, 31 << 8};
  const int own[2] = {a, b}; int bs[4] = {0, 0, 0, 0}, os[4] = {0, 0, 0, 0}, ranks = 0, publicRanks = 0, ownRanks = 0;
  for (int i = 0; i < L; i++) { ranks |= 1 << (pub[i] >> 2); publicRanks |= 1 << (pub[i] >> 2); bs[pub[i] & 3]++; }
  for (int c : own) { ranks |= 1 << (c >> 2); ownRanks |= 1 << (c >> 2); os[c & 3]++; }
  int suitRanks[4]={};
  for(int i=0;i<L;i++)suitRanks[pub[i]&3]|=1<<(pub[i]>>2);
  int outs = 0, backdoor = 0, blockers = 0, connect = 0;
  for (int i = 0; i < 10; i++) {
    const int mask = windows[i], count = popcount13(ranks & mask), bc = popcount13(publicRanks & mask);
    connect = std::max(connect, bc);
    if (L < 5 && count == 4) outs |= mask & ~ranks;
    if (L == 3 && count == 3 && (ownRanks & mask)) backdoor |= 1 << i;
    if (bc >= 3) blockers |= ownRanks & mask;
  }
  std::string flush[4]; int nf = 0;
  for (int suit = 0; suit < 4; suit++) if (os[suit] && bs[suit]) {
    int top = -1; for (int c : own) if ((c & 3) == suit) top = std::max(top, c >> 2);
    const int higher=12-top-popcount13(suitRanks[suit]>>(top+1));
    std::string &e = flush[nf++];
    base36(e, (unsigned)bs[suit]); e += '.'; base36(e, (unsigned)os[suit]); e += '.'; base36(e, (unsigned)top); e += '.'; base36(e, (unsigned)higher);
  }
  for (int i = 1; i < nf; i++) for (int j = i; j > 0 && flush[j] < flush[j - 1]; j--) std::swap(flush[j], flush[j - 1]);   // JS default (code unit) order
  int counts[13] = {}; for (int i = 0; i < L; i++) counts[pub[i] >> 2]++;
  int shape[5], ns = 0; for (int r = 0; r < 13; r++) if (counts[r]) shape[ns++] = counts[r];
  for (int i = 1; i < ns; i++) for (int j = i; j > 0 && shape[j] > shape[j - 1]; j--) std::swap(shape[j], shape[j - 1]);
  int maxRank = -1, maxSuit = 0, high = 0;
  for (int i = 0; i < L; i++) { maxRank = std::max(maxRank, pub[i] >> 2); if ((pub[i] >> 2) >= 8) high++; }
  for (int s = 0; s < 4; s++) maxSuit = std::max(maxSuit, bs[s]);
  base36(out, (unsigned)classOf(a, b)); out += '.'; base36(out, (unsigned)score); out += '.'; base36(out, (unsigned)outs); out += '.';
  base36(out, (unsigned)backdoor); out += '.'; base36(out, (unsigned)blockers); out += ':';
  for (int i = 0; i < ns; i++) out += (char)('0' + shape[i]);
  out += '.'; out += std::to_string(maxRank); out += '.'; out += std::to_string(maxSuit); out += '.'; out += std::to_string(connect); out += '.'; out += std::to_string(high);
  out += ':'; for (int i = 0; i < nf; i++) { if (i) out += ','; out += flush[i]; }
}
struct GroupKeys {
  bool on = false, detailed = false;
  int lengths[4] = {}, nl = 0, start = 0;
  bool small[8] = {};
  // The unordered_map owns each string. Element addresses survive rehash.
  GroupKeys() = default;
  GroupKeys(const GroupKeys&) = delete;
  GroupKeys& operator=(const GroupKeys&) = delete;
  GroupKeys(GroupKeys&&) = default;
  GroupKeys& operator=(GroupKeys&&) = default;
  std::vector<const std::string*> text; std::vector<unsigned long long> number;   // by id
  std::unordered_map<std::string, uint32_t> index;
  double bytes = 0;
  static constexpr uint32_t MAX_IDS = 1u << 26;
  static double cost(const std::string &s) { return 96.0 + (double)s.size(); }
  // Returns the id of `key`, interning it within `room` bytes; UINT32_MAX when the budget or id space is full.
  uint32_t intern(const std::string &key, unsigned long long num, double &tableBytes, double budget) {
    auto it = index.find(key); if (it != index.end()) return it->second;
    const double c = cost(key);
    if (text.size() >= MAX_IDS || tableBytes + c > budget) return UINT32_MAX;
    const uint32_t id = (uint32_t)text.size(); auto entry = index.emplace(key, id).first;
    try {
      text.push_back(&entry->first);
      if (!detailed) number.push_back(num);
    } catch (...) {
      if (text.size() > id) text.pop_back();
      index.erase(entry);
      throw;
    }
    tableBytes += c; bytes += c; return id;
  }
  void truncate(size_t size) {
    while (text.size() > size) { const auto *key=text.back(); bytes -= cost(*key); text.pop_back(); index.erase(*key); if (!detailed) number.pop_back(); }
  }
  // Key of seat hand (a, b, combo id) at street L (public cards pub[0..L)) given the previous street's key id.
  void signal(std::string &out, unsigned long long &num, int seat, int a, int b, int id, const int *pub, int L, int score, int previous) const {
    out.clear();
    unsigned long long sig=0;
    const bool detailedFeature=detailed && L>0 && !(L==start && small[seat]);
    if (L == start && small[seat]) sig = 256 + (unsigned)id;
    else if (L == 0) sig = (unsigned)classOf(a, b);
    else if (!detailed) sig = (unsigned)strengthGroup(a, b, pub, L, score);
    if (!detailed) {
      num = (previous < 0 ? 0ULL : number[(size_t)previous]) * 2048ULL + sig;
      out = std::to_string(num);
    } else {
      num = 0;
      out = previous < 0 ? std::string("0") : *text[(size_t)previous];
      out += '/';
      if(detailedFeature)featureKey(out,a,b,pub,L,score);
      else out+=std::to_string(sig);
    }
  }
};
