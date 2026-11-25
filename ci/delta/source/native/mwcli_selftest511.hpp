// EightMax 5.11: mwcli --selftest511 <studies-dir> <work-dir> [all|streams|training|checkpoint|limits]
//
// What 5.11 added to the TRAINER, tested by the shipped program itself (nothing but mwcli is needed; "Run 5.11 focused
// validation.bat" runs it and validate_windows511.ps1 imports its report check by check): the counter-based 64-bit
// training streams ("trainingStreams":"philox64", streams511.hpp) and the removal of the 10,000,000-update limit for
// states trained with them.
//
//   streams     the generator and the address rule (mw_selftest511, in the engine), and what a training really draws:
//                 G1  Philox4x64-10 against the known-answer vectors of its reference implementation;
//                 G2  the same bits as the 5.9 evaluation generator (a second source text of the function);
//                 G3  the map counter -> block inverted in both directions (bijection for a fixed key);
//                 A1  the numbers of stream (purpose, t, d) are Philox((j, t, d, purpose), (seed, domain));
//                 A2  every block of a grid of addresses differs from every other;
//                 N1  numbers in [0, 1) on the 2^-53 grid, mean and variance of a million;
//                 L1  a stream without an address still draws the numbers of the 5.10 generator;
//                 U1  COUNTER AUDIT: every 256-bit counter handed to the generator during a real training is
//                     recorded: no counter occurs twice, every stream is j = 0, 1, 2, ... without a gap, every
//                     counter is a valid address, and there is exactly one card stream per sampled deal
//                     (one deal per update, frozen batches on three threads, ICM, preflop start, six players,
//                     Latin deals, the rbes estimator);
//                 U2  the same for a state whose update index is above 2^32 and for a training stopped and
//                     continued inside one engine.
//   training    the trainers as a user runs them (child processes of this program):
//                 D1  a spec that says "trainingStreams":"5.10" writes the states of the spec without the key, which
//                     are the states of 5.10 (--selftest510 D1 compares those with the hashes of the 5.9 program);
//                 W1  philox64: two runs give the same state; a frozen batch gives the same state on 1 and 3 threads
//                     and with the 5.6 batch update;
//                 W2  philox64: stopped after a third and continued = uninterrupted, byte for byte;
//                 W3  philox64: the saved states have the SHA-256 recorded from the Linux build of this release
//                     (the streams and the training are deterministic across platforms and compilers);
//                 W4  the information of a philox64 state names the streams, its seed and its update limit, and the
//                     state is not the 5.10 state of the same spec;
//                 W5  "trainingSeed": a 64-bit seed; seeds that differ only above bit 32 train different states; the
//                     default seed is the spec's actionSeed;
//                 W6  reference fixtures: exact NashConv of the strategy trained with philox64 after a fixed budget
//                     equals the value recorded at release (a regression check; one seed, no convergence claim);
//                 W7  the trained response (5.8/5.9) of a philox64 state runs and every confidence statement holds
//                     against the exact values;
//                 W8  a decision study records the training streams of every variant; trainingStreams=5.10 and
//                     trainingStreams=philox64 select them.
//   checkpoint  a state continues only under the streams, and the seed, that trained it:
//                 C1  a 5.10 state is refused by a philox64 engine, a philox64 state by a 5.10 engine, and a
//                     philox64 state by an engine of another seed, each with a reason, exit 1 and no output file;
//                 C2  a philox64 state names "trainingStreams" and "trainingSeed" in its header, carries NO "rng" and
//                     "actionRng" (every earlier program version requires them and therefore refuses the state) and
//                     has its own study identifier; a 5.10 state has the 5.10 header;
//                 C3  a compressed (EMZ1) philox64 state restores and continues to the uninterrupted state.
//   limits      the 10,000,000-update limit:
//                 L1  a 5.10 state keeps it: 10,000,001 updates are refused before anything is trained, and a state
//                     at 10,000,000 updates is not continued;
//                 L2  a philox64 state has none: 10,000,100 updates are trained, the state is continued to
//                     10,000,200 and equals the uninterrupted run to 10,000,200, whose SHA-256 is the recorded one;
//                 L3  update indices above 2^32: a state that starts at update 4,294,967,303 trains, stops and
//                     continues to the state of the uninterrupted run, whose SHA-256 is the recorded one;
//                 L4  what is refused before anything is trained: an unknown "trainingStreams", a "trainingSeed"
//                     without philox64 or malformed, philox64 for an enumerated (protocol 1) spec, a philox64 spec
//                     that starts after update 0 with a 32-bit generator state, more than 10,000,000 updates with
//                     DCFR, and more than 140,737,488,355,327 updates;
//                 L5  studies: a budget of 10,000,001 deals at one deal per update is accepted with philox64 and
//                     refused with trainingStreams=5.10 (the 5.10 message), before any training.
//
// Everything is written inside <work-dir>. Statuses as in --selftest58: passed, failed, untested (never counted as
// passed). The report is <work-dir>/selftest511.json. Exit status: 0 every check passed, 1 a check failed or is
// untested, 2 usage or unreadable fixtures.
#pragma once
namespace st511 {
namespace fs = std::filesystem;
using st58::Report; using st58::fmt; using st58::sci; using st58::get; using st58::num; using st58::str; using st58::Doc; using st58::take; using st58::specOf;
using st510::isTrue; using st510::withOptions; using st510::writeText; using st510::Trained; using st510::train; using st510::exactNashConv; using st510::Golden; using st510::GOLDEN59; using st510::BATCH;
static const char *WIDE = "\"trainingStreams\":\"philox64\"";
// SHA-256 of saved states trained with the counter-based streams, recorded from the 5.11 Linux build:
// {fixture, updates, frozen batch on 3 threads, sha, extra spec options}.
struct Golden511 { const char *fixture; long long updates; bool batch; const char *sha; const char *options; };
static const Golden511 GOLDEN511[] = {
#include "selftest511_golden.hpp"
};
// Exact NashConv after a fixed budget with the counter-based streams, recorded from the 5.11 Linux build.
struct Reference511 { const char *fixture; long long updates; double nash; };
static const Reference511 REFERENCE511[] = {
#include "selftest511_reference.hpp"
};
// SHA-256 of the two long states of the limits section (L2, L3), recorded from the 5.11 Linux build.
static const char *const LIMIT511[] = {
#include "selftest511_limits.hpp"
};
// A spec whose state starts at update `start` with empty tables (one deal per update: deals == updates). A philox64
// state has no generator state, so the fixture's 32-bit "rng" and "actionRng" are set to 0 unless they are to be kept.
static std::string startingAt(std::string spec, long long start, bool keepGenerator = false) {
  const size_t st = spec.find("\"state\":{"); if (st == std::string::npos) return "";
  for (const char *k : {"\"iterations\":0", "\"trainingDeals\":0"}) {
    const size_t at = spec.find(k, st); if (at == std::string::npos) return "";
    spec.replace(at + std::strlen(k) - 1, 1, std::to_string(start));
  }
  if (!keepGenerator) for (const char *k : {"\"rng\":", "\"actionRng\":"}) {
    const size_t at = spec.find(k, st); if (at == std::string::npos) continue;
    size_t from = at + std::strlen(k), to = from; while (to < spec.size() && spec[to] >= '0' && spec[to] <= '9') to++;
    spec.replace(from, to - from, "0");
  }
  return spec;
}
// mwcli --selftest511 studies work record: writes the three recorded tables (selftest511_golden.hpp,
// selftest511_reference.hpp, selftest511_limits.hpp) into the work directory from THIS build. Used once, on Linux,
// when the release is made (tools/make_golden511.py); the release's self-test then compares every platform with them.
static int record(const std::string &studies, const std::string &work, const std::string &self);
static void streamsSection(Report &R, const std::string &studies) {
  const std::string sec = "streams";
  { JB b; jb_init(&b); mw_selftest511(&b); const std::string text = take(b); Doc d(text); const JV *cs = get(d.v, "checks");
    if (!cs || cs->type != J_ARR || cs->n == 0) R.add(sec, "G1", "the engine's checks of the training streams", "untested", "mw_selftest511 returned no checks");
    else for (int i = 0; i < cs->n; i++) R.check(sec, str(get(cs->items[i], "id")), str(get(cs->items[i], "name")), isTrue(get(cs->items[i], "passed")), str(get(cs->items[i], "detail"))); }
  struct Case { const char *fixture, *options, *label; long long updates; int threads; };
  const Case cases[] = {
    {"known-akq-river", "", "one deal per update, two players, river", 20000, 1},
    {"flop3-kings-small", "\"batchDeals\":64,\"actionStreams\":\"deal\"", "frozen batches of 64 on three threads", 200, 3},
    {"icm8-bb-call-small", "", "ICM, preflop start", 3000, 1},
    {"btn25-open-small", "", "chip EV, preflop start", 3000, 1},
    {"flop6-jack-small", "\"estimator\":\"rbes\"", "six players, the rbes estimator", 1500, 1},
    {"flop3-kings-small", "\"chanceSampling\":\"latin\"", "Latin deals", 3000, 1},
    {"flop3-kings", "\"batchDeals\":64,\"actionStreams\":\"deal\"", "Compact hand groups, frozen batches on three threads", 40, 3},
  };
  int good = 0, total = 0; std::string detail; long long blocksAll = 0;
  for (const Case &c : cases) {
    total++; std::string why; const std::string base = specOf((fs::path(studies) / (std::string(c.fixture) + ".emfix.json")).string(), why);
    if (base.empty()) { detail += std::string(c.fixture) + ": " + why + "; "; continue; }
    const std::string text = withOptions(base, std::string(WIDE) + (*c.options ? std::string(",") + c.options : "")); char err[512] = "";
    MW *m = mw_create(text.c_str(), text.size(), 512, err, sizeof err);
    if (!m) { detail += std::string(c.fixture) + " (" + c.label + "): the engine was not built: " + err + "; "; continue; }
    const int began = mw_streams511_audit_begin(m); const int trained = mw_train(m, c.updates, c.threads, nullptr, nullptr, nullptr, err, sizeof err);
    JB a; jb_init(&a); const int ended = mw_streams511_audit_end(m, &a); const std::string out = take(a);
    JB ib; jb_init(&ib); mw_info(m, &ib); const std::string info = take(ib); mw_free(m);
    Doc d(out), di(info); const long long blocks = (long long)num(get(d.v, "blocks"), -1), distinct = (long long)num(get(d.v, "distinct"), -2), dup = (long long)num(get(d.v, "duplicates"), -1), gaps = (long long)num(get(d.v, "gaps"), -1), oor = (long long)num(get(d.v, "outOfRange"), -1);
    const long long cardStreams = (long long)num(get(get(d.v, "streamsByPurpose"), "cards"), -1), deals = (long long)num(get(di.v, "trainingDeals"), -2), its = (long long)num(get(di.v, "iterations"), -1), latin = (long long)num(get(get(d.v, "byPurpose"), "latin"), -1);
    const bool wantLatin = std::strstr(c.options, "latin") != nullptr;
    const bool ok = began && trained && ended && its == c.updates && blocks > 0 && distinct == blocks && dup == 0 && gaps == 0 && oor == 0 && cardStreams == deals && (wantLatin ? latin > 0 : latin == 0);
    good += ok; blocksAll += std::max(0LL, blocks);
    detail += std::string(c.fixture) + " (" + c.label + "): " + std::to_string(deals) + " deals, " + std::to_string(blocks) + " counters, " + std::to_string(distinct) + " distinct, " + std::to_string(gaps) + " gaps, " + std::to_string(oor) + " invalid, card streams " + std::to_string(cardStreams) + (ok ? "" : std::string(" [NOT AS REQUIRED] ") + err) + "; ";
  }
  R.check(sec, "U1", "counter audit: every counter a training hands to the generator is recorded; no counter occurs twice, every stream is j = 0, 1, 2, ... without a gap, every counter is a valid address, one card stream per sampled deal (seven configurations)", good == total && total > 0,
          std::to_string(good) + " of " + std::to_string(total) + " configurations, " + std::to_string(blocksAll) + " counters in all; " + detail);
  { // U2
    std::string why; const std::string base = specOf((fs::path(studies) / "flop3-kings-small.emfix.json").string(), why); const long long start = 4294967303LL;
    const std::string text = base.empty() ? "" : startingAt(withOptions(base, WIDE), start); char err[512] = "";
    MW *m = text.empty() ? nullptr : mw_create(text.c_str(), text.size(), 512, err, sizeof err);
    if (!m) R.add(sec, "U2", "counter audit above update 2^32 and across a stop", "untested", base.empty() ? why : text.empty() ? "the fixture's state object has no zero counters to replace" : std::string("the engine was not built: ") + err);
    else {
      mw_streams511_audit_begin(m); const int t1 = mw_train(m, 400, 1, nullptr, nullptr, nullptr, err, sizeof err), t2 = t1 ? mw_train(m, 600, 1, nullptr, nullptr, nullptr, err, sizeof err) : 0;
      JB a; jb_init(&a); mw_streams511_audit_end(m, &a); const std::string out = take(a); mw_free(m); Doc d(out);
      const long long blocks = (long long)num(get(d.v, "blocks"), -1), distinct = (long long)num(get(d.v, "distinct"), -2), gaps = (long long)num(get(d.v, "gaps"), -1), oor = (long long)num(get(d.v, "outOfRange"), -1), cardStreams = (long long)num(get(get(d.v, "streamsByPurpose"), "cards"), -1);
      const double largest = num(get(d.v, "largestUpdateIndex"), -1);
      R.check(sec, "U2", "counter audit for a state that starts at update 4,294,967,303 (above 2^32), trained in two calls of one engine: no counter twice, no gap, every counter a valid address, 1000 card streams, and the largest update index used is 4,294,968,302", t1 && t2 && blocks > 0 && distinct == blocks && gaps == 0 && oor == 0 && cardStreams == 1000 && largest == (double)(start + 999),
              std::to_string(blocks) + " counters, " + std::to_string(distinct) + " distinct, " + std::to_string(gaps) + " gaps, " + std::to_string(oor) + " invalid, card streams " + std::to_string(cardStreams) + ", largest update index " + fmt(largest) + " " + err);
    }
  }
}
static void trainingSection(Report &R, const std::string &studies, const std::string &work, const std::string &self) {
  const std::string sec = "training"; std::error_code ec;
  auto fixture = [&](const std::string &name, const std::string &options, const std::string &tag, std::string &why) -> std::string {
    const std::string spec = specOf((fs::path(studies) / (name + ".emfix.json")).string(), why); if (spec.empty()) return "";
    const std::string path = (fs::path(work) / (name + "-" + tag + ".spec.json")).string(); if (!writeText(path, withOptions(spec, options))) { why = "cannot write " + path; return ""; } return path;
  };
  auto state = [&](const std::string &tag) { return (fs::path(work) / (tag + ".state")).string(); };
  auto join = [](const std::string &a, const std::string &b) { return a.empty() ? b : b.empty() ? a : a + "," + b; };
  const std::vector<std::pair<std::string, std::string>> fixed = {{"EIGHTMAX_THREAD_CHOICE", "fixed"}};
  { // D1: the explicit "5.10" is the absent key
    int same = 0, total = 0; std::string detail;
    for (const Golden &gld : GOLDEN59) {
      total++; std::string why; const std::string sp = fixture(gld.fixture, join("\"trainingStreams\":\"5.10\"", gld.batch ? BATCH : ""), "d1", why);
      if (sp.empty()) { detail += std::string(gld.fixture) + ": " + why + "; "; continue; }
      const Trained t = train(self, work, sp, gld.updates, gld.batch ? 3 : 1, state("d1"), "", "512", fixed);
      if (t.ok && t.sha == gld.sha) same++; else detail += std::string(gld.fixture) + (gld.batch ? " (batch)" : "") + ": " + (t.ok ? "state " + t.sha.substr(0, 16) + " instead of " + std::string(gld.sha).substr(0, 16) : "exit " + std::to_string(t.exitCode) + " " + t.err) + "; ";
      fs::remove(sp, ec);
    }
    R.check(sec, "D1", "a spec with \"trainingStreams\":\"5.10\" writes the states of 5.10 and 5.9 (SHA-256 of the saved state against the hashes recorded from the unchanged 5.9 program, which --selftest510 D1 compares with the spec without the key)", same == total && total > 0,
            std::to_string(same) + " of " + std::to_string(total) + " states identical" + (detail.empty() ? "" : "; " + detail));
  }
  { // W1, W2
    struct F { const char *name, *options; long long updates, batchUpdates; };
    const F fx[] = {{"flop3-kings-small", "", 9000, 150}, {"flop6-jack-small", "", 6000, 90}, {"icm8-bb-call-small", "", 9000, 150}, {"flop3-kings", "", 1500, 30}, {"flop3-kings-small", "\"estimator\":\"rbes\"", 6000, 100}};
    int ok1 = 0, n1 = 0, ok2 = 0, n2 = 0; std::string d1, d2;
    for (const F &f : fx) {
      std::string why; const std::string o = join(WIDE, f.options), sp = fixture(f.name, o, "w1", why), spb = fixture(f.name, join(o, BATCH), "w1b", why);
      if (sp.empty() || spb.empty()) { n1++; n2++; d1 += std::string(f.name) + ": " + why + "; "; continue; }
      const Trained a = train(self, work, sp, f.updates, 1, state("w1a")), a2 = train(self, work, sp, f.updates, 1, state("w1b"));
      const Trained b1 = train(self, work, spb, f.batchUpdates, 1, state("w1c"), "", "512", fixed), b3 = train(self, work, spb, f.batchUpdates, 3, state("w1d"), "", "512", fixed),
                    legacy = train(self, work, spb, f.batchUpdates, 3, state("w1e"), "", "512", {{"EIGHTMAX_LEGACY_BATCH", "1"}});
      n1++; const bool same = a.ok && a2.ok && b1.ok && b3.ok && legacy.ok && a.sha == a2.sha && b1.sha == b3.sha && b1.sha == legacy.sha; ok1 += same;
      if (!same) d1 += std::string(f.name) + ": repeat " + (a.sha == a2.sha ? "same" : "DIFFERENT") + ", 3 threads " + (b1.sha == b3.sha ? "same" : "DIFFERENT") + ", 5.6 batch " + (b1.sha == legacy.sha ? "same" : "DIFFERENT") + " " + a.err + b1.err + "; ";
      const long long third = f.updates / 3; const Trained p = train(self, work, sp, third, 1, state("w2p")), c = p.ok ? train(self, work, sp, f.updates - third, 1, state("w2c"), state("w2p")) : Trained{};
      const long long bthird = f.batchUpdates / 3; const Trained bp = train(self, work, spb, bthird, 2, state("w2bp"), "", "512", fixed), bc = bp.ok ? train(self, work, spb, f.batchUpdates - bthird, 3, state("w2bc"), state("w2bp"), "512", fixed) : Trained{};
      n2++; const bool cont = p.ok && c.ok && bp.ok && bc.ok && c.sha == a.sha && bc.sha == b1.sha; ok2 += cont;
      if (!cont) d2 += std::string(f.name) + ": one deal per update " + (c.sha == a.sha ? "same" : "DIFFERENT") + ", frozen batches " + (bc.sha == b1.sha ? "same" : "DIFFERENT") + " " + p.err + c.err + bp.err + bc.err + "; ";
      fs::remove(sp, ec); fs::remove(spb, ec);
    }
    R.check(sec, "W1", "philox64: two runs give the same state; a frozen batch gives the same state on 1 and 3 threads and with the 5.6 batch update", ok1 == n1 && n1 > 0, std::to_string(ok1) + " of " + std::to_string(n1) + " configurations (exact cards, six players, ICM preflop, Compact hand groups, the rbes estimator)" + (d1.empty() ? "" : "; " + d1));
    R.check(sec, "W2", "philox64: stopped after a third and continued = uninterrupted, byte for byte (one deal per update; frozen batches stopped on 2 threads and continued on 3)", ok2 == n2 && n2 > 0, std::to_string(ok2) + " of " + std::to_string(n2) + " configurations" + (d2.empty() ? "" : "; " + d2));
  }
  { // W3
    int same = 0, total = 0; std::string detail;
    for (const Golden511 &gld : GOLDEN511) {
      total++; std::string why; const std::string sp = fixture(gld.fixture, join(join(WIDE, gld.options), gld.batch ? BATCH : ""), "w3", why);
      if (sp.empty()) { detail += std::string(gld.fixture) + ": " + why + "; "; continue; }
      const Trained t = train(self, work, sp, gld.updates, gld.batch ? 3 : 1, state("w3"), "", "512", fixed);
      if (t.ok && t.sha == gld.sha) same++; else detail += std::string(gld.fixture) + (gld.batch ? " (batch)" : "") + (*gld.options ? std::string(" ") + gld.options : "") + ": " + (t.ok ? "state " + t.sha.substr(0, 16) + " instead of " + std::string(gld.sha).substr(0, 16) : "exit " + std::to_string(t.exitCode) + " " + t.err) + "; ";
      fs::remove(sp, ec);
    }
    R.check(sec, "W3", "philox64: the saved states have the SHA-256 recorded from the Linux build of this release (the streams and the training are deterministic across platforms and compilers of the release)", same == total && total > 0, std::to_string(same) + " of " + std::to_string(total) + " states identical" + (detail.empty() ? "" : "; " + detail));
  }
  { // W4, W5
    std::string why; const std::string sw = fixture("flop3-kings-small", WIDE, "w4", why), sl = fixture("flop3-kings-small", "", "w4l", why);
    if (sw.empty() || sl.empty()) { R.add(sec, "W4", "the information of a philox64 state", "untested", why); R.add(sec, "W5", "the training seed", "untested", why); }
    else {
      const Trained w = train(self, work, sw, 3000, 1, state("w4")), l = train(self, work, sl, 3000, 1, state("w4l")); Doc dw(w.out), dl(l.out);
      const std::string id = str(get(dw.v, "trainingStreams")), seed = str(get(dw.v, "trainingSeed")), inTrainer = str(get(get(dw.v, "trainer"), "trainingStreams")); const double maxU = num(get(dw.v, "maxUpdates"), -1);
      const double actionSeed = [&] { std::string y; const std::string spec = specOf((fs::path(studies) / "flop3-kings-small.emfix.json").string(), y); Doc s(spec); return num(get(s.v, "actionSeed"), -1); }();
      char want[17]; std::snprintf(want, sizeof want, "%016llx", (unsigned long long)actionSeed);
      R.check(sec, "W4", "the information of a philox64 state names the streams, the seed and the update limit; the 5.10 state of the same spec names none and is another state", w.ok && l.ok && id == MW_STREAMS511 && inTrainer == MW_STREAMS511 && seed == want && maxU == (double)MW_MAX_UPDATES_WIDE && w.sha != l.sha && !get(dl.v, "trainingStreams") && !get(dl.v, "maxUpdates") && !get(get(dl.v, "trainer"), "trainingStreams"),
              "trainingStreams " + id + ", trainingSeed " + seed + " (the spec's actionSeed is " + want + "), maxUpdates " + fmt(maxU) + "; 5.10 state " + (w.sha != l.sha ? "differs" : "IS THE SAME") + " " + w.err + l.err);
      const std::string s1 = fixture("flop3-kings-small", join(WIDE, "\"trainingSeed\":\"100000001\""), "w5a", why), s2 = fixture("flop3-kings-small", join(WIDE, "\"trainingSeed\":\"200000001\""), "w5b", why),
                        s3 = fixture("flop3-kings-small", join(WIDE, "\"trainingSeed\":\"1\""), "w5c", why), s4 = fixture("flop3-kings-small", join(WIDE, std::string("\"trainingSeed\":\"") + (want + 8) + "\""), "w5d", why);
      const Trained a = train(self, work, s1, 3000, 1, state("w5a")), b = train(self, work, s2, 3000, 1, state("w5b")), c = train(self, work, s3, 3000, 1, state("w5c")), e = train(self, work, s4, 3000, 1, state("w5d")), a2 = train(self, work, s1, 3000, 1, state("w5e"));
      Doc da(a.out);
      R.check(sec, "W5", "\"trainingSeed\" is a 64-bit seed: seeds 0x100000001, 0x200000001 and 0x1 (equal in their low 32 bits) train three different states, each reproducibly; the spec's actionSeed written as trainingSeed gives the state of the spec without it", a.ok && b.ok && c.ok && e.ok && a2.ok && a.sha != b.sha && a.sha != c.sha && b.sha != c.sha && a.sha == a2.sha && e.sha == w.sha && str(get(da.v, "trainingSeed")) == "0000000100000001",
              std::string("three seeds: ") + (a.sha != b.sha && a.sha != c.sha && b.sha != c.sha ? "three states" : "STATES COINCIDE") + "; repeated: " + (a.sha == a2.sha ? "same" : "DIFFERENT") + "; explicit default seed: " + (e.sha == w.sha ? "the default state" : "DIFFERENT") + "; reported seed " + str(get(da.v, "trainingSeed")) + " " + a.err + b.err + c.err + e.err);
      for (const std::string &x : {sw, sl, s1, s2, s3, s4}) fs::remove(x, ec);
    }
  }
  { // W6
    int okc = 0, total = 0; std::string detail;
    for (const Reference511 &ref : REFERENCE511) {
      total++; std::string why; const std::string sp = fixture(ref.fixture, WIDE, "w6", why);
      if (sp.empty()) { detail += std::string(ref.fixture) + ": " + why + "; "; continue; }
      const Trained a = train(self, work, sp, ref.updates, 1, state("w6")); double nc = NAN; if (a.ok) nc = exactNashConv(self, work, sp, state("w6"), why);
      const bool good = std::isfinite(nc) && std::fabs(nc - ref.nash) <= 1e-9 * std::max({1.0, std::fabs(nc), std::fabs(ref.nash)}); okc += good;
      detail += std::string(ref.fixture) + " after " + std::to_string(ref.updates) + " deals: exact NashConv " + sci(nc) + (good ? "" : " (recorded " + sci(ref.nash) + ") " + why + a.err) + "; ";
      fs::remove(sp, ec);
    }
    R.check(sec, "W6", "reference fixtures: the exact NashConv of the strategy trained with philox64 after a fixed budget equals the value recorded at release (a regression check; the numbers are one seed each and no convergence claim)", okc == total && total > 0, std::to_string(okc) + " of " + std::to_string(total) + " fixtures reproduce the recorded value; " + detail);
  }
  { // W7
    std::string why; const std::string sp = fixture("flop3-kings-small", WIDE, "w7", why);
    if (sp.empty()) R.add(sec, "W7", "the trained response of a philox64 state", "untested", why);
    else {
      const Trained a = train(self, work, sp, 20000, 1, state("w7")); const std::string q = (fs::path(work) / "w7-request.json").string();
      writeText(q, "{\"responseDeals\":20000,\"samples\":102400,\"seed\":511,\"exact\":true}");
      const ckpt::Run r = a.ok ? ckpt::spawn({self, "--response", sp, state("w7"), q, "512"}, work, 1800) : ckpt::Run{}, r2 = a.ok ? ckpt::spawn({self, "--response", sp, state("w7"), q, "512"}, work, 1800) : ckpt::Run{};
      Doc d(r.out), d2(r2.out); const JV *S = get(d.v, "summary"), *ag = get(S, "againstExact"), *seats = get(d.v, "seats");
      const bool holds = isTrue(get(ag, "simultaneousHolds")) && isTrue(get(ag, "simultaneousNashConvBoundHolds")) && isTrue(get(ag, "pooledAllSeatsHolds")) && isTrue(get(ag, "pooledBestSubsetHolds"));
      const double b1 = num(get(get(S, "simultaneous"), "nashConvLowerBound")), b2 = num(get(get(get(d2.v, "summary"), "simultaneous"), "nashConvLowerBound"));
      R.check(sec, "W7", "the trained response (5.8/5.9) of a state trained with philox64 runs with counter-based streams of its own key domain, twice to the same bound, and every confidence statement holds against the exact values of the same responses", a.ok && r.exitCode == 0 && r2.exitCode == 0 && seats && seats->type == J_ARR && seats->n == 3 && holds && std::memcmp(&b1, &b2, 8) == 0 && std::isfinite(b1),
              a.ok ? "exit " + std::to_string(r.exitCode) + "; exact NashConv " + sci(num(get(S, "exactNashConv"))) + "; simultaneous bound " + sci(b1) + " (second run " + (std::memcmp(&b1, &b2, 8) == 0 ? "the same bits" : "DIFFERENT") + "); statements hold: " + (holds ? "yes" : "NO") + " " + r.err.substr(0, 200) : "training failed: " + a.err);
      fs::remove(sp, ec); fs::remove(q, ec);
    }
  }
  { // W8
    const std::string fxp = (fs::path(studies) / "known-akq-river.emfix.json").string(); std::string detail; int good = 0;
    struct S { const char *option, *want; };
    const S runs[] = {{"", mw_study_default_wide() ? MW_STREAMS511 : "5.10 (32-bit)"}, {"trainingStreams=philox64", MW_STREAMS511}, {"trainingStreams=5.10", "5.10 (32-bit)"}};
    for (const S &s : runs) {
      const std::string out = (fs::path(work) / "w8-study.json").string(); fs::remove(out, ec);
      std::vector<std::string> a = {self, "--study", fxp, out, "seeds=2", "budgets=4000,20000", "checkpoint=off", "quiet=1"}; if (*s.option) a.push_back(s.option);
      const ckpt::Run r = ckpt::spawn(a, work, 1800); const std::vector<unsigned char> b = slurp(out.c_str()); const std::string text(b.begin(), b.end()); Doc d(text);
      const std::string got = str(get(get(get(d.v, "run"), "trainingStreams"), "streams")); const bool chosen = isTrue(get(get(get(d.v, "run"), "trainingStreams"), "chosenByTheStudy")), complete = text.find("\"complete\":true") != std::string::npos;
      const bool perPoint = (text.find(std::string("\"trainingStreams\":\"") + MW_STREAMS511 + "\"}") != std::string::npos) == (std::string(s.want) == MW_STREAMS511);
      const bool ok = r.exitCode == 0 && got == s.want && chosen == (*s.option != 0) && complete && perPoint; good += ok;
      detail += std::string(*s.option ? s.option : "no option") + ": " + (got.empty() ? "no record" : got) + (ok ? "" : " [exit " + std::to_string(r.exitCode) + ", expected " + s.want + (complete ? "" : ", incomplete") + (perPoint ? "" : ", per-point trainer objects disagree") + "] " + r.err.substr(0, 160)) + "; ";
      fs::remove(out, ec);
    }
    R.check(sec, "W8", "a decision study records the training streams of its variants (run.trainingStreams and every point's trainer object); trainingStreams=5.10 and trainingStreams=philox64 select them", good == 3, std::to_string(good) + " of 3 studies; " + detail);
  }
  for (const char *t : {"d1", "w1a", "w1b", "w1c", "w1d", "w1e", "w2p", "w2c", "w2bp", "w2bc", "w3", "w4", "w4l", "w5a", "w5b", "w5c", "w5d", "w5e", "w6", "w7"}) fs::remove(state(t), ec);
}
static void checkpointSection(Report &R, const std::string &studies, const std::string &work, const std::string &self) {
  const std::string sec = "checkpoint"; std::error_code ec; std::string why;
  const std::string base = specOf((fs::path(studies) / "flop3-kings-small.emfix.json").string(), why);
  if (base.empty()) { for (const char *id : {"C1", "C2", "C3"}) R.add(sec, id, "checkpoint rules of the training streams", "untested", why); return; }
  auto p = [&](const char *n) { return (fs::path(work) / n).string(); };
  const std::string sd = p("c-510.spec.json"), sw = p("c-wide.spec.json"), ss = p("c-seed.spec.json");
  writeText(sd, base); writeText(sw, withOptions(base, WIDE)); writeText(ss, withOptions(base, std::string(WIDE) + ",\"trainingSeed\":\"5eed\""));
  const Trained d = train(self, work, sd, 3000, 1, p("c-510.state")), w = train(self, work, sw, 3000, 1, p("c-wide.state")), s = train(self, work, ss, 3000, 1, p("c-seed.state"));
  if (!d.ok || !w.ok || !s.ok) { for (const char *id : {"C1", "C2", "C3"}) R.add(sec, id, "checkpoint rules of the training streams", "untested", "training failed: " + d.err + w.err + s.err); return; }
  { // C1
    struct X { const char *what; std::string spec, in; const char *expect; };
    const X xs[] = {{"a 5.10 state under philox64", sw, p("c-510.state"), "5.10 training streams"}, {"a philox64 state under the 5.10 streams", sd, p("c-wide.state"), "counter-based training streams"},
                    {"a philox64 state under another seed", ss, p("c-wide.state"), "different training seed"}, {"a state of that seed under the default seed", sw, p("c-seed.state"), "different training seed"}};
    int refused = 0; std::string detail;
    for (const X &x : xs) {
      const std::string out = p("c-refused.state"); fs::remove(out, ec);
      const Trained t = train(self, work, x.spec, 100, 1, out, x.in); const bool noFile = !fs::exists(out, ec);
      const bool good = !t.ok && t.exitCode == 1 && noFile && t.err.find("refused") != std::string::npos && t.err.find(x.expect) != std::string::npos;
      refused += good; detail += std::string(x.what) + ": exit " + std::to_string(t.exitCode) + (noFile ? ", nothing written" : ", A FILE WAS WRITTEN") + (good ? "" : " [" + t.err.substr(0, 200) + "]") + "; ";
    }
    R.check(sec, "C1", "a state continues only under the streams and the seed that trained it: every other continuation is refused with the reason, exit 1, and writes nothing", refused == 4, std::to_string(refused) + " of 4 refused; " + detail);
  }
  { // C2
    const ckpt::StateInfo a = ckpt::inspect(p("c-510.state")), b = ckpt::inspect(p("c-wide.state")), c = ckpt::inspect(p("c-seed.state"));
    const bool headers = a.validHeader && b.validHeader && c.validHeader && a.field("trainingStreams").empty() && a.field("trainingSeed").empty() && !a.field("rng").empty() && !a.field("actionRng").empty() &&
                         b.field("trainingStreams") == std::string("\"") + MW_STREAMS511 + "\"" && b.field("rng").empty() && b.field("actionRng").empty() && b.field("trainingSeed").size() == 18 &&
                         c.field("trainingSeed") == "\"0000000000005eed\"" && a.field("studyId") != b.field("studyId") && b.field("studyId") == c.field("studyId") && !a.field("studyId").empty();
    R.check(sec, "C2", "a philox64 state names its streams and seed in the header, carries no \"rng\" and no \"actionRng\" (earlier program versions require both and refuse the state) and has its own study identifier; a 5.10 state has the 5.10 header", headers,
            "5.10 state: trainingStreams " + (a.field("trainingStreams").empty() ? std::string("absent") : a.field("trainingStreams")) + ", rng " + a.field("rng") + ", study " + a.field("studyId") + "; philox64 state: " + b.field("trainingStreams") + ", seed " + b.field("trainingSeed") + ", rng " + (b.field("rng").empty() ? std::string("absent") : b.field("rng")) + ", study " + b.field("studyId") + "; other seed: " + c.field("trainingSeed"));
  }
  { // C3
    const ckpt::Run z = ckpt::spawn({self, "--compress", p("c-wide.state"), p("c-wide.emz")}, work, 600);
    const Trained cont = z.exitCode == 0 ? train(self, work, sw, 3000, 1, p("c-cont.state"), p("c-wide.emz")) : Trained{}, whole = train(self, work, sw, 6000, 1, p("c-whole.state"));
    R.check(sec, "C3", "a compressed (EMZ1) philox64 state restores and continues to the state of the uninterrupted run", z.exitCode == 0 && cont.ok && whole.ok && cont.sha == whole.sha,
            "compress exit " + std::to_string(z.exitCode) + "; continued from the compressed state: " + (cont.ok && whole.ok ? std::string(cont.sha == whole.sha ? "identical to the uninterrupted run" : "DIFFERENT") : "run failed: " + cont.err + whole.err));
  }
  for (const char *n : {"c-510.spec.json", "c-wide.spec.json", "c-seed.spec.json", "c-510.state", "c-wide.state", "c-seed.state", "c-refused.state", "c-wide.emz", "c-cont.state", "c-whole.state"}) fs::remove(p(n), ec);
}
static void limitsSection(Report &R, const std::string &studies, const std::string &work, const std::string &self) {
  const std::string sec = "limits"; std::error_code ec; std::string why;
  const std::string akq = specOf((fs::path(studies) / "known-akq-river.emfix.json").string(), why), base = specOf((fs::path(studies) / "flop3-kings-small.emfix.json").string(), why);
  if (akq.empty() || base.empty()) { for (const char *id : {"L1", "L2", "L3", "L4", "L5"}) R.add(sec, id, "limits of the training streams", "untested", why); return; }
  auto p = [&](const char *n) { return (fs::path(work) / n).string(); };
  const std::string sl = p("l-510.spec.json"), sw = p("l-wide.spec.json"); writeText(sl, akq); writeText(sw, withOptions(akq, WIDE));
  { // L1
    const std::string out = p("l1.state"); fs::remove(out, ec);
    const Trained over = train(self, work, sl, 10000001, 1, out); const bool noFile = !fs::exists(out, ec);
    const Trained full = train(self, work, sl, 10000000, 1, p("l1-full.state")); const Trained more = full.ok ? train(self, work, sl, 1, 1, out, p("l1-full.state")) : Trained{}; const bool noFile2 = !fs::exists(out, ec);
    R.check(sec, "L1", "a 5.10 state keeps the 10,000,000-update limit: 10,000,001 updates are refused before anything is trained (exit 2, no file), 10,000,000 are trained, and that state is not continued by one more update (exit 1, no file)",
            !over.ok && over.exitCode == 2 && noFile && over.err.find("10,000,000") != std::string::npos && full.ok && full.deals == 10000000 && !more.ok && more.exitCode == 1 && noFile2 && more.err.find("10 million") != std::string::npos,
            "10,000,001 updates: exit " + std::to_string(over.exitCode) + (noFile ? ", nothing written" : ", A FILE WAS WRITTEN") + "; 10,000,000 updates: " + (full.ok ? "trained" : "FAILED " + full.err) + "; one more: exit " + std::to_string(more.exitCode) + (noFile2 ? ", nothing written" : ", A FILE WAS WRITTEN") + " [" + more.err.substr(0, 120) + "]");
    fs::remove(p("l1-full.state"), ec);
  }
  { // L2
    const Trained a = train(self, work, sw, 10000100, 1, p("l2-a.state")); const Trained b = a.ok ? train(self, work, sw, 100, 1, p("l2-b.state"), p("l2-a.state")) : Trained{}; const Trained c = train(self, work, sw, 10000200, 1, p("l2-c.state"));
    const ckpt::StateInfo h = ckpt::inspect(p("l2-c.state"));
    R.check(sec, "L2", "a philox64 state has no 10,000,000-update limit: 10,000,100 updates are trained, the state is continued to 10,000,200 and equals the uninterrupted run to 10,000,200, whose SHA-256 is the one recorded from the Linux build",
            a.ok && b.ok && c.ok && a.deals == 10000100 && b.deals == 10000200 && b.sha == c.sha && h.field("iterations") == "10000200" && c.sha == LIMIT511[0],
            a.ok && b.ok && c.ok ? "updates in the header " + h.field("iterations") + "; continued " + (b.sha == c.sha ? "= uninterrupted" : "DIFFERS from uninterrupted") + "; state " + c.sha.substr(0, 16) + (c.sha == LIMIT511[0] ? " = recorded" : std::string(" instead of ") + std::string(LIMIT511[0]).substr(0, 16)) : "a run failed: " + a.err + b.err + c.err);
    for (const char *n : {"l2-a.state", "l2-b.state", "l2-c.state"}) fs::remove(p(n), ec);
  }
  { // L3
    const long long start = 4294967303LL; const std::string text = startingAt(withOptions(base, WIDE), start), sp = p("l3.spec.json");
    if (text.empty() || !writeText(sp, text)) R.add(sec, "L3", "update indices above 2^32", "untested", "the fixture's state object has no zero counters to replace");
    else {
      const Trained a = train(self, work, sp, 1000, 1, p("l3-a.state")); const Trained b = a.ok ? train(self, work, sp, 2000, 1, p("l3-b.state"), p("l3-a.state")) : Trained{}; const Trained c = train(self, work, sp, 3000, 1, p("l3-c.state"));
      const ckpt::StateInfo h = ckpt::inspect(p("l3-c.state"));
      R.check(sec, "L3", "update indices above 2^32: a philox64 state that starts at update 4,294,967,303 trains 3000 updates, stopped after 1000 and continued = uninterrupted, and the state has the SHA-256 recorded from the Linux build",
              a.ok && b.ok && c.ok && b.sha == c.sha && h.field("iterations") == "4294970303" && c.sha == LIMIT511[1],
              a.ok && b.ok && c.ok ? "updates in the header " + h.field("iterations") + "; continued " + (b.sha == c.sha ? "= uninterrupted" : "DIFFERS from uninterrupted") + "; state " + c.sha.substr(0, 16) + (c.sha == LIMIT511[1] ? " = recorded" : std::string(" instead of ") + std::string(LIMIT511[1]).substr(0, 16)) : "a run failed: " + a.err + b.err + c.err);
      for (const char *n : {"l3.spec.json", "l3-a.state", "l3-b.state", "l3-c.state"}) fs::remove(p(n), ec);
    }
  }
  { // L4
    struct B { std::string spec; long long updates; int exitCode; const char *what; };
    std::string enumerated = base; { const size_t at = enumerated.find("\"protocol\":4"); if (at != std::string::npos) enumerated.replace(at, 12, "\"protocol\":1"); }
    const std::string started = startingAt(withOptions(base, WIDE), 5, true);
    const std::vector<B> bad = {
      {withOptions(base, "\"trainingStreams\":\"xorshift\""), 100, 1, "an unknown trainingStreams"}, {withOptions(base, "\"trainingStreams\":64"), 100, 1, "a trainingStreams that is no text"},
      {withOptions(base, "\"trainingSeed\":\"1\""), 100, 1, "a trainingSeed without philox64"}, {withOptions(base, "\"trainingStreams\":\"5.10\",\"trainingSeed\":\"1\""), 100, 1, "a trainingSeed with the 5.10 streams"},
      {withOptions(base, std::string(WIDE) + ",\"trainingSeed\":\"12345678901234567\""), 100, 1, "a trainingSeed of 17 digits"}, {withOptions(base, std::string(WIDE) + ",\"trainingSeed\":\"0x1F\""), 100, 1, "a trainingSeed that is not lower-case hexadecimal"},
      {withOptions(base, std::string(WIDE) + ",\"trainingSeed\":7"), 100, 1, "a trainingSeed that is a number"},
      {withOptions(enumerated, WIDE), 100, 1, "philox64 for an enumerated (protocol 1) spec"}, {started, 100, 1, "a philox64 spec that starts at update 5 with a 32-bit generator state"},
      {withOptions(akq, std::string(WIDE) + ",\"weighting\":\"dcfr\""), 10000001, 2, "10,000,001 updates with DCFR"}, {withOptions(akq, WIDE), MW_MAX_UPDATES_WIDE + 1, 2, "140,737,488,355,328 updates"},
    };
    int refused = 0; std::string notRefused;
    for (const B &b : bad) {
      const std::string sp = p("l4.spec.json"), out = p("l4.state"); fs::remove(out, ec); writeText(sp, b.spec);
      const Trained t = b.spec.empty() ? Trained{} : train(self, work, sp, b.updates, 1, out); const bool good = !b.spec.empty() && !t.ok && t.exitCode == b.exitCode && !fs::exists(out, ec) && !t.err.empty();
      refused += good; if (!good) notRefused += std::string(notRefused.empty() ? "" : "; ") + b.what + " -> exit " + std::to_string(t.exitCode) + " " + t.err.substr(0, 100);
      fs::remove(sp, ec);
    }
    // the largest bound is accepted as a request (a memory or time stop would end it; here the engine is asked for 0 more)
    char err[256] = ""; const std::string wide = withOptions(akq, WIDE); MW *m = mw_create(wide.c_str(), wide.size(), 64, err, sizeof err);
    const bool bound = m && mw_max_updates(m) == MW_MAX_UPDATES_WIDE && !mw_train(m, MW_MAX_UPDATES_WIDE + 1, 1, nullptr, nullptr, nullptr, err, sizeof err) && std::strstr(err, "140,737,488,355,327"); if (m) mw_free(m);
    const std::string dc = withOptions(akq, std::string(WIDE) + ",\"weighting\":\"dcfr\""); MW *md = mw_create(dc.c_str(), dc.size(), 64, err, sizeof err); const bool dcfrBound = md && mw_max_updates(md) == MW_MAX_UPDATES; if (md) mw_free(md);
    R.check(sec, "L4", "refused before anything is trained: an unknown or malformed trainingStreams or trainingSeed, philox64 for an enumerated spec, a philox64 spec that starts after update 0 with a 32-bit generator state, more than 10,000,000 updates with DCFR, more than 140,737,488,355,327 updates",
            refused == (int)bad.size() && bound && dcfrBound, std::to_string(refused) + " of " + std::to_string(bad.size()) + " refused with the expected exit status and no output; engine bounds: philox64 " + (bound ? "140,737,488,355,327" : "WRONG") + ", philox64 with DCFR " + (dcfrBound ? "10,000,000" : "WRONG") + (notRefused.empty() ? "" : "; NOT as required: " + notRefused));
  }
  { // L5
    const std::string fxp = (fs::path(studies) / "known-akq-river.emfix.json").string(), o1 = p("l5-wide.json"), o2 = p("l5-510.json"); fs::remove(o1, ec); fs::remove(o2, ec);
    const ckpt::Run a = ckpt::spawn({self, "--study", fxp, o1, "quiet=1", "seeds=1", "budgets=10000001", "timeLimitSeconds=0.2", "checkpoint=off", "trainingStreams=philox64", "evaluationSamples=64", "qualitySamples=64"}, work, 600);
    const ckpt::Run b = ckpt::spawn({self, "--study", fxp, o2, "quiet=1", "seeds=1", "budgets=10000001", "timeLimitSeconds=0.2", "checkpoint=off", "trainingStreams=5.10"}, work, 600);
    const bool wrote = fs::exists(o1, ec), none = !fs::exists(o2, ec);
    R.check(sec, "L5", "studies: a budget of 10,000,001 deals at one deal per update is accepted with philox64 (the study starts; its time limit ends it) and refused with trainingStreams=5.10 before any training, with the 5.10 message",
            a.exitCode == 0 && wrote && b.exitCode == 1 && none && b.err.find("10 million iteration limit") != std::string::npos && b.err.find("Nothing was trained") != std::string::npos,
            "philox64: exit " + std::to_string(a.exitCode) + (wrote ? ", result written" : ", NO RESULT") + " " + a.err.substr(0, 120) + "; 5.10: exit " + std::to_string(b.exitCode) + (none ? ", nothing written" : ", A RESULT WAS WRITTEN") + " [" + b.err.substr(0, 110) + "]");
    fs::remove(o1, ec); fs::remove(o2, ec);
  }
  fs::remove(sl, ec); fs::remove(sw, ec); fs::remove(p("l1.state"), ec); fs::remove(p("l4.state"), ec);
}
static int record(const std::string &studies, const std::string &work, const std::string &self) {
  std::error_code ec; std::string golden, reference, limits, why; int bad = 0;
  auto p = [&](const char *n) { return (fs::path(work) / n).string(); };
  auto join = [](const std::string &a, const std::string &b) { return a.empty() ? b : b.empty() ? a : a + "," + b; };
  auto esc = [](const char *o) { std::string e; for (const char *c = o; *c; c++) { if (*c == '"' || *c == '\\') e += '\\'; e += *c; } return e; };
  const std::vector<std::pair<std::string, std::string>> fixed = {{"EIGHTMAX_THREAD_CHOICE", "fixed"}};
  for (const Golden511 &g : GOLDEN511) {
    const std::string spec = specOf((fs::path(studies) / (std::string(g.fixture) + ".emfix.json")).string(), why), sp = p("record.spec.json");
    writeText(sp, withOptions(spec, join(join(WIDE, g.options), g.batch ? BATCH : "")));
    const Trained t = spec.empty() ? Trained{} : train(self, work, sp, g.updates, g.batch ? 3 : 1, p("record.state"), "", "512", fixed); bad += !t.ok;
    golden += std::string("{\"") + g.fixture + "\", " + std::to_string(g.updates) + ", " + (g.batch ? "true" : "false") + ", \"" + (t.ok ? t.sha : "FAILED") + "\", \"" + esc(g.options) + "\"},\n";
  }
  for (const Reference511 &r : REFERENCE511) {
    const std::string spec = specOf((fs::path(studies) / (std::string(r.fixture) + ".emfix.json")).string(), why), sp = p("record.spec.json");
    writeText(sp, withOptions(spec, WIDE));
    const Trained t = spec.empty() ? Trained{} : train(self, work, sp, r.updates, 1, p("record.state")); const double nc = t.ok ? exactNashConv(self, work, sp, p("record.state"), why) : NAN; bad += !std::isfinite(nc);
    reference += std::string("{\"") + r.fixture + "\", " + std::to_string(r.updates) + ", " + fmt(nc) + "},\n";
  }
  { const std::string akq = specOf((fs::path(studies) / "known-akq-river.emfix.json").string(), why), base = specOf((fs::path(studies) / "flop3-kings-small.emfix.json").string(), why), sp = p("record.spec.json");
    writeText(sp, withOptions(akq, WIDE)); const Trained a = train(self, work, sp, 10000200, 1, p("record.state"));
    writeText(sp, startingAt(withOptions(base, WIDE), 4294967303LL)); const Trained b = train(self, work, sp, 3000, 1, p("record.state")); bad += !a.ok + !b.ok;
    limits = "\"" + a.sha + "\",\n\"" + b.sha + "\"\n"; }
  fs::remove(p("record.spec.json"), ec); fs::remove(p("record.state"), ec);
  writeText(p("selftest511_golden.hpp"), golden); writeText(p("selftest511_reference.hpp"), reference); writeText(p("selftest511_limits.hpp"), limits);
  std::printf("{\"recorded\":%d,\"failed\":%d}\n", (int)(std::size(GOLDEN511) + std::size(REFERENCE511) + 2), bad);
  return bad ? 1 : 0;
}
static int run(int argc, char **argv) {
  if (argc < 4 || argc > 5) { std::fprintf(stderr, "usage: mwcli --selftest511 studies-dir work-dir [all|streams|training|checkpoint|limits]\n"); return 2; }
  const std::string studies = argv[2], work = argv[3], section = argc > 4 ? argv[4] : "all";
  if (section == "record") { std::error_code e2; fs::create_directories(work, e2); return record(fs::absolute(studies, e2).string(), fs::absolute(work, e2).string(), ckpt::selfPath(argv[0])); }
  if (section != "all" && section != "streams" && section != "training" && section != "checkpoint" && section != "limits") { std::fprintf(stderr, "error: the section must be all, streams, training, checkpoint or limits\n"); return 2; }
  std::error_code ec; fs::create_directories(work, ec);
  if (!fs::is_directory(studies, ec) || !fs::is_directory(work, ec)) { std::fprintf(stderr, "error: studies-dir and work-dir must be directories\n"); return 2; }
  mw_study_identity(EM_VERSION, EM_BUILD_ID);
  Report R; const auto t0 = std::chrono::steady_clock::now(); const std::string S = fs::absolute(studies, ec).string(), W = fs::absolute(work, ec).string(), self = ckpt::selfPath(argv[0]);
  if (section == "all" || section == "streams") streamsSection(R, S);
  if (section == "all" || section == "training") trainingSection(R, S, W, self);
  if (section == "all" || section == "checkpoint") checkpointSection(R, S, W, self);
  if (section == "all" || section == "limits") limitsSection(R, S, W, self);
  const double secs = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
  std::string o = std::string("{\"tool\":\"mwcli selftest511\",\"version\":\"") + EM_VERSION + "\",\"build\":\"" + EM_BUILD_ID + "\",\"section\":\"" + section + "\",\"studyDefaultStreams\":\"" + (mw_study_default_wide() ? MW_STREAMS511 : "5.10 (32-bit)") + "\",\"passed\":" + std::to_string(R.passed) + ",\"failed\":" + std::to_string(R.failed) +
                  ",\"untested\":" + std::to_string(R.untested) + ",\"seconds\":" + fmt(secs) + ",\"checks\":[";
  for (size_t i = 0; i < R.checks.size(); i++) { const st58::Check &c = R.checks[i]; o += std::string(i ? "," : "") + "{\"section\":" + mwa::jsonEsc(c.section) + ",\"id\":" + mwa::jsonEsc(c.id) + ",\"name\":" + mwa::jsonEsc(c.name) + ",\"status\":" + mwa::jsonEsc(c.status) + ",\"detail\":" + mwa::jsonEsc(c.detail) + "}"; }
  o += "]}";
  const std::string report = (fs::path(work) / "selftest511.json").string();
  { FILE *f = std::fopen(report.c_str(), "wb"); if (f) { std::fwrite(o.data(), 1, o.size(), f); std::fclose(f); } }
  std::printf("{\"tool\":\"mwcli selftest511\",\"build\":\"%s\",\"section\":\"%s\",\"passed\":%d,\"failed\":%d,\"untested\":%d,\"report\":%s}\n", EM_BUILD_ID, section.c_str(), R.passed, R.failed, R.untested, mwa::jsonEsc(report).c_str());
  return R.failed || R.untested ? 1 : 0;
}
}
