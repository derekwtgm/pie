// EightMax 5.11: counter-based 64-bit TRAINING random streams ("trainingStreams":"philox64" in a protocol-4 spec).
//
// What 5.10 and earlier do (and what a spec without the key, and every state trained by them, still does)
// -------------------------------------------------------------------------------------------------
// The deal stream and the action streams are instances of one 32-bit generator (struct Rng, mw.cpp): the state s
// advances by s += 0x6d2b79f5 (mod 2^32) and the output is a hash of s. Every stream therefore walks the SAME cycle
// of 2^32 states and differs from another only in where it starts:
//   - one deal stream per state, consumed sequentially: after 2^32 draws it repeats exactly;
//   - "shared" action streams: one more such stream;
//   - "deal" action streams: stream (update t, deal d) starts at seed ^ (t+1)*0x9e3779b1 ^ (d+1)*0x85ebca6b
//     (mod 2^32): two different (t, d) can start at the same state (then they are the SAME stream), and two streams
//     whose starts are a few steps apart share all but those few numbers.
// The 10,000,000-update limit of one state (MW_MAX_UPDATES) existed because of this. tools/streams511_overlap.c
// counts the coincidences of the 5.10 "deal" streams (MATHEMATICAL-VALIDATION-5.11.md, section 2).
//
// What 5.11 does when the spec says "trainingStreams":"philox64"
// -----------------------------------------------------------
// Every random number of the training has an ADDRESS, and the address is the 256-bit counter of Philox4x64-10
// (Salmon, Moraes, Dror & Shaw, SC 2011; the generator of Random123, numpy.random.Philox and C++26
// std::philox4x64; the 5.9 evaluation streams use the same function, response59.hpp):
//     key     = (trainingSeed, DOMAIN)        a 64-bit seed; DOMAIN = TRAIN for training, RESPONSE + seat for the
//                                             training of a 5.8/5.9 response
//     counter = (j, t, d, purpose)            j = 0, 1, 2, ...: the j-th group of four numbers of the stream
//       purpose 1  cards:   the hands and board of deal d (position in the update, 0..63) of update t
//       purpose 2  actions: the sampled actions of the traversals of that deal (all seats, in seat order)
//       purpose 3  Latin:   the permutation of seat d in epoch t (chanceSampling "latin")
// t is the number of COMMITTED updates before the update (0-based). The four counter words are the four address
// fields, each in a 64-bit word of its own: nothing is packed, hashed or truncated.
//
// THEOREM (no overlap within a state). For a fixed key, Philox4x64-10 is a bijection of the 256-bit counters (ten
// rounds; a round maps (c0,c1,c2,c3) to (hi(M1*c2)^c1^k0, lo(M1*c2), hi(M0*c0)^c3^k1, lo(M0*c0)) with M0, M1 odd,
// so c0 and c2 are recovered from the low products by the inverses of M0 and M1 modulo 2^64, and then c1, c3 by
// exclusive or). Two different addresses (purpose, t, d, j) are two different counters, hence receive two different
// 256-bit blocks, and each address is used at most once in the life of a state: t is the committed update count,
// which only grows; a rolled-back update is REPEATED with the same t and therefore with the same numbers (it is the
// same computation again, not a second use of the stream for something else). Hence: no number of one stream is a
// number of another stream, no stream repeats, and no stream can run out before 2^64 groups of four (the engine
// aborts instead of wrapping j; reaching it would take centuries). This holds for any number of updates, which is
// why the 10,000,000-update limit does not apply to these states (limit: MW_MAX_UPDATES_WIDE, set by exact integer
// counters, not by the generator).
// The streams are pure functions of (seed, address): a state needs no stored generator state, its header carries
// none, and stopping and continuing cannot change a number.
//
// NOT a theorem (for this or any pseudo-random generator): that the numbers behave as independent uniform variables,
// and anything about two different SEEDS (two keys are two members of a family of bijections with no proven
// relation). Those rest on the published empirical record of Philox4x64-10 (TestU01 BigCrush) and on the tests of
// this release (reference vectors, an independent implementation, moments, convergence against 5.10).
//
// Numbers: 53 random bits, (x >> 11) * 2^-53, uniform on the multiples of 2^-53 in [0, 1) (5.10: 32 bits).
#pragma once
#include <cstdint>
#include <cstdlib>
#include <vector>
#include <array>
#include <mutex>
namespace em511 {
constexpr const char *ALGORITHM = "streams-5.11-philox4x64-v1";
constexpr uint64_t DOMAIN_TRAIN = 0x454d35313174726eULL;      // "EM511trn"
constexpr uint64_t DOMAIN_RESPONSE = 0x454d353131727300ULL;   // "EM511rs" + seat in the low byte
enum : uint64_t { CARDS = 1, ACTIONS = 2, LATIN = 3 };
// The largest number of committed updates of a state with these streams: 64 deals per update must keep the deal
// count an exact integer of a JSON number (below 2^53). floor((2^53 - 1) / 64).
constexpr long long MAX_UPDATES = 140737488355327LL;
inline void mulhilo(uint64_t a, uint64_t b, uint64_t &hi, uint64_t &lo) { const unsigned __int128 p = (unsigned __int128)a * b; lo = (uint64_t)p; hi = (uint64_t)(p >> 64); }
constexpr uint64_t M0 = 0xD2E7470EE14C6C93ULL, M1 = 0xCA5A826395121157ULL, W0 = 0x9E3779B97F4A7C15ULL, W1 = 0xBB67AE8584CAA73BULL;
inline void round(uint64_t c[4], const uint64_t k[2]) {
  uint64_t hi0, lo0, hi1, lo1; mulhilo(M0, c[0], hi0, lo0); mulhilo(M1, c[2], hi1, lo1);
  const uint64_t c1 = c[1], c3 = c[3]; c[0] = hi1 ^ c1 ^ k[0]; c[1] = lo1; c[2] = hi0 ^ c3 ^ k[1]; c[3] = lo0;
}
// out = Philox4x64-10(counter, key)
inline void block(const uint64_t ctr[4], const uint64_t key[2], uint64_t out[4]) {
  uint64_t c[4] = {ctr[0], ctr[1], ctr[2], ctr[3]}, k[2] = {key[0], key[1]};
  round(c, k);
  for (int r = 1; r < 10; r++) { k[0] += W0; k[1] += W1; round(c, k); }
  out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; out[3] = c[3];
}
// The inverse map (used only by the self-test: block and unblock compose to the identity in both orders).
inline uint64_t inverse64(uint64_t a) { uint64_t x = a; for (int i = 0; i < 6; i++) x *= 2 - a * x; return x; }
inline void unblock(const uint64_t out[4], const uint64_t key[2], uint64_t ctr[4]) {
  const uint64_t I0 = inverse64(M0), I1 = inverse64(M1);
  uint64_t c[4] = {out[0], out[1], out[2], out[3]};
  for (int r = 9; r >= 0; r--) {
    const uint64_t k0 = key[0] + (uint64_t)r * W0, k1 = key[1] + (uint64_t)r * W1;
    const uint64_t in2 = c[1] * I1, in0 = c[3] * I0; uint64_t hi0, lo0, hi1, lo1; mulhilo(M0, in0, hi0, lo0); mulhilo(M1, in2, hi1, lo1);
    const uint64_t in1 = c[0] ^ hi1 ^ k0, in3 = c[2] ^ hi0 ^ k1;
    c[0] = in0; c[1] = in1; c[2] = in2; c[3] = in3;
  }
  ctr[0] = c[0]; ctr[1] = c[1]; ctr[2] = c[2]; ctr[3] = c[3];
}
// Validation only (mwcli --selftest511, mw_streams511_audit): every counter a training call hands to the generator.
struct Audit { std::mutex mu; std::vector<std::array<uint64_t, 4>> used; void add(const uint64_t c[4]) { std::lock_guard<std::mutex> lock(mu); used.push_back({c[0], c[1], c[2], c[3]}); } };
// The key of a state's streams. on == false: the 32-bit streams of 5.10.
struct Key { bool on = false; uint64_t k[2] = {0, 0}; Audit *audit = nullptr; };
} // namespace em511
