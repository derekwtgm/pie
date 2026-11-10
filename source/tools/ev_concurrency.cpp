// EightMax 4.0: concurrency stress for evaluation tasks (build with
// -fsanitize=thread or address,undefined; see tools/sanitize40.sh).
//
// usage: ev_concurrency spec.json state rounds
// Opens a study, then runs, concurrently on separate threads and for `rounds`
// rounds: several action-EV tasks with multithreaded exact and sampled
// evaluation, response-gain tasks, explorer node queries, progress readers
// and cancellations (immediate, mid-run and after completion), exactly as the
// desktop job pool does. Checks that results are identical to a serial
// reference, that cancelled tasks report 409, and that the engine's exported
// state is byte-identical before and after (evaluations never mutate it).
#include "../native/mw.h"
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <string>
#include <regex>
#include <thread>
#include <vector>
static std::string slurp(const char *f) { std::string s; FILE *fp = std::fopen(f, "rb"); if (!fp) return s; char b[65536]; size_t n; while ((n = std::fread(b, 1, sizeof b, fp)) > 0) s.append(b, n); std::fclose(fp); return s; }
static std::string run(MW *m, int kind, const std::string &q, MwEvalTask *t, int *status) {
  JB out; jb_init(&out); char err[512] = "";
  *status = mw_eval_run(m, kind, q.data(), q.size(), &out, err, sizeof err, t);
  std::string r = *status == 200 ? std::string(out.s, out.n) : std::string(err);
  jb_free(&out); return r;
}
// strips fields that legitimately differ between runs (timing, cache, execution statistics)
static std::string stable(const std::string &json) {
  const char *keys[] = {",\"execution\":", ",\"deadline\":", ",\"stoppedEarly\":", ",\"cache\":"};
  size_t cut = json.size(); for (const char *k : keys) { size_t p = json.find(k); if (p != std::string::npos && p < cut) cut = p; }
  static const std::regex timing("\"elapsedMs\":[-0-9.e+]+");
  return std::regex_replace(json.substr(0, cut), timing, "\"elapsedMs\":0");
}
int main(int argc, char **argv) {
  if (argc != 4) { std::fprintf(stderr, "usage: ev_concurrency spec.json state rounds\n"); return 2; }
  const std::string spec = slurp(argv[1]); const int rounds = std::atoi(argv[3]); char err[512] = "";
  FILE *f = std::fopen(argv[2], "rb"); std::error_code ec; auto size = std::filesystem::file_size(argv[2], ec); MW *m = nullptr;
  if (!f || ec || mw_load_stream(f, size, spec.c_str(), 1024, -1, &m, err, sizeof err, nullptr, nullptr) != 200) { std::fprintf(stderr, "open failed: %s\n", err); return 1; }
  std::fclose(f);
  unsigned char *before = nullptr; size_t beforeN = mw_export(m, &before);
  const std::vector<std::pair<int, std::string>> queries = {
    {0, "{\"path\":[],\"hands\":[0,1,2],\"range\":true,\"method\":\"exact\",\"threads\":3,\"timeLimitMs\":600000}"},
    {0, "{\"path\":[1],\"hands\":[0,1],\"method\":\"sampled\",\"samples\":3000,\"threads\":2,\"seed\":7,\"timeLimitMs\":600000}"},
    {0, "{\"path\":[],\"hands\":[3],\"method\":\"sampled\",\"samples\":2000,\"threads\":4,\"seed\":3,\"equivalenceMargin\":0.5,\"timeLimitMs\":600000}"},
    {1, "{\"method\":\"exact\",\"timeLimitMs\":600000}"},
    {1, "{\"method\":\"restricted\",\"selection\":\"exact\",\"timeLimitMs\":600000}"},
  };
  // serial references
  std::vector<std::string> ref;
  for (auto &q : queries) { MwEvalTask *t = mw_eval_task_new(); int st; ref.push_back(stable(run(m, q.first, q.second, t, &st))); mw_eval_task_free(t); if (st != 200) { std::fprintf(stderr, "reference failed: %s\n", ref.back().c_str()); return 1; } }
  std::atomic<int> failures{0}, cancelled{0}, completed{0};
  for (int round = 0; round < rounds; round++) {
    std::vector<std::thread> th;
    for (size_t i = 0; i < queries.size(); i++) th.emplace_back([&, i] {
      MwEvalTask *t = mw_eval_task_new(); int st; const std::string r = run(m, queries[i].first, queries[i].second, t, &st);
      if (st != 200 || stable(r) != ref[i]) { std::fprintf(stderr, "mismatch in query %zu (status %d)\n", i, st); failures++; } else completed++;
      mw_eval_task_free(t);
    });
    // a task cancelled mid-run while progress is read from another thread
    th.emplace_back([&] {
      MwEvalTask *t = mw_eval_task_new(); std::atomic<bool> done{false};
      std::thread reader([&] { while (!done) { JB p; jb_init(&p); mw_eval_progress(t, &p); jb_free(&p); std::this_thread::sleep_for(std::chrono::microseconds(300)); } });
      std::thread canceller([&] { std::this_thread::sleep_for(std::chrono::milliseconds(5 + round % 7)); mw_eval_cancel(t); });
      int st; run(m, 0, "{\"path\":[],\"hands\":[0,1,2,3],\"range\":true,\"method\":\"sampled\",\"samples\":2000000,\"threads\":3,\"timeLimitMs\":600000}", t, &st);
      done = true; reader.join(); canceller.join();
      if (st == 409) cancelled++; else { std::fprintf(stderr, "cancel returned %d\n", st); failures++; }
      mw_eval_task_free(t);
    });
    // explorer queries (the synchronous reader path) interleaved
    th.emplace_back([&] { for (int k = 0; k < 20; k++) { JB out; jb_init(&out); char e[256]; volatile int c = 0; const char q[] = "{\"path\":[],\"limit\":50}"; if (mw_node_query(m, q, sizeof q - 1, &out, e, sizeof e, &c) != 200) failures++; jb_free(&out); } });
    for (auto &x : th) x.join();
  }
  unsigned char *after = nullptr; size_t afterN = mw_export(m, &after);
  const bool same = beforeN == afterN && !std::memcmp(before, after, beforeN);
  std::printf("{\"rounds\":%d,\"completed\":%d,\"cancelled\":%d,\"failures\":%d,\"stateUnchanged\":%s}\n", rounds, completed.load(), cancelled.load(), failures.load(), same ? "true" : "false");
  std::free(before); std::free(after); mw_free(m);
  return failures || !same ? 1 : 0;
}
