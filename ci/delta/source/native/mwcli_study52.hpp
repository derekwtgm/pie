// EightMax 5.2: mwcli --study fixture.json out.json [variants=all|a,b] [seeds=N|a,b,c] [budgets=a,b,c] [threads=N]
//               [memoryMiB=X] [timeLimitSeconds=S] [quiet=1]
// Runs a decision study (study52.hpp), writes the "EightMax study result" document to out.json (atomically:
// a temporary file in the same folder is renamed over it) and prints a readable table. Every number in the
// table is read back from the document that was written. Exit codes: 0 ok, 1 refused/failed, 2 usage, 4 save failed.
#ifndef EM_MWCLI_STUDY52_HPP
#define EM_MWCLI_STUDY52_HPP
namespace st52 {
static bool listArg(const std::string &v, std::string &json) {
  json = "["; size_t i = 0; bool any = false;
  while (i <= v.size()) { size_t j = v.find(',', i); if (j == std::string::npos) j = v.size(); const std::string t = v.substr(i, j - i); if (t.empty() || t.find_first_not_of("0123456789") != std::string::npos || t.size() > 10) return false; json += (any ? "," : "") + t; any = true; i = j + 1; }
  json += "]"; return any;
}
static const JV *g(const JV *v, const char *k) { return v && v->type == J_OBJ ? jget(v, k) : nullptr; }
static double n(const JV *v, double d = NAN) { return v && v->type == J_NUM ? v->num : d; }
static const char *s(const JV *v) { return v && v->type == J_STR ? v->str : ""; }
static void progressLine(void *, const char *json) {
  char e[64] = ""; JV *p = json_parse(json, std::strlen(json), e, sizeof e); if (!p) return;
  if(*s(g(p,"phase")) && std::strcmp(s(g(p,"phase")),"beforeTraining")){json_free(p);return;}
  std::fprintf(stderr, "study: variant %s (%d/%d), seed %d/%d, budget %d/%d (%.0f deals), %.1f s elapsed\n", s(g(p, "variant")), (int)n(g(p, "variantIndex")) + 1, (int)n(g(p, "variants")), (int)n(g(p, "seedIndex")) + 1, (int)n(g(p, "seeds")), (int)n(g(p, "budgetIndex")) + 1, (int)n(g(p, "budgets")), n(g(p, "budgetDeals")), n(g(p, "elapsedSeconds")));
  json_free(p);
}
static void printSummary(const JV *r) {
  const JV *fx = g(r, "fixture"), *run = g(r, "run"), *vars = g(r, "variants");
  std::printf("Study: %s (%s)\nUncertainty values printed as nan are unavailable, never zero.\nBuild %s, %d seeds, %d worker threads requested, %.1f s, process peak RSS %.0f MiB%s%s\n", s(g(fx, "title")), s(g(fx, "id")), s(g(r, "build")), g(run, "seeds") ? g(run, "seeds")->n : 0, (int)n(g(run, "threadsRequested")), n(g(run, "elapsedSeconds")), n(g(run, "processPeakRssMiB")),
    g(run, "stoppedByTimeLimit") && g(run, "stoppedByTimeLimit")->num != 0 ? " [stopped by the time limit: later budgets or seeds are missing]" : "", g(run, "stoppedByUser") && g(run, "stoppedByUser")->num != 0 ? " [stopped by the user]" : "");
  for (int i = 0; vars && i < vars->n; i++) {
    const JV *v = vars->items[i], *d = g(v, "decision"), *u = g(v, "utility"), *qm = g(v, "qualityMetric"), *bs = g(v, "budgets");
    std::printf("\nVariant %s%s%s\n  Hero %s at seat %d; EV in %s (%s); quality metric: %s (%s)\n", s(g(v, "name")), *s(g(v, "change")) ? ": " : "", s(g(v, "change")), s(g(d, "hand")), (int)n(g(d, "seat")), s(g(u, "unit")), s(g(u, "model")), s(g(qm, "kind")), s(g(qm, "name")));
    for (int b = 0; bs && b < bs->n; b++) {
      const JV *x = bs->items[b], *acts = g(x, "actions"), *gap = g(x, "gap"), *q = g(x, "quality");
      std::printf("  %10.0f deals | completed %d/%d seeds (%d action evaluations) | train %.2f s, EV %.2f s, quality %.2f s | peak RSS %.0f MiB\n", n(g(x, "budgetDeals")), (int)n(g(x,"completedSeeds")),(int)n(g(x,"requestedSeeds")),(int)n(g(x,"evaluatedSeeds")), n(g(x, "trainingSecondsMean")), n(g(x, "evSecondsMean")), n(g(x, "qualitySecondsMean")), n(g(x, "processPeakRssMiB")));
      for (int a = 0; acts && a < acts->n; a++) { const JV *f = g(acts->items[a], "frequency"), *ev = g(acts->items[a], "ev");
        std::printf("      %-22s frequency %6.2f%% (sd %5.2f%%)   EV %+9.4f (sd %.4f, evaluation se %.4f)\n", s(g(acts->items[a], "label")), 100 * n(g(f, "mean")), 100 * n(g(f, "sdAcrossSeeds")), n(g(ev, "mean")), n(g(ev, "sdAcrossSeeds")), n(g(acts->items[a], "evEvaluationStdErrOfMean"))); }
      if (gap && gap->type == J_OBJ) { const JV *ci = g(gap, "ci95");
        std::printf("      gap %s - %s = %+.4f %s", s(g(gap, "higher")), s(g(gap, "lower")), n(g(gap, "mean")), s(g(gap, "unit")));
        const JV *cc = g(gap, "conditionalEvaluationCi95");
        if (cc && cc->type == J_ARR && cc->n == 2) std::printf(", measured strategies (calibrated simultaneous 95%%) [%+.4f, %+.4f]", n(cc->items[0]), n(cc->items[1]));
        else std::printf(", measured strategies: NOT CALIBRATED (%s)", s(g(gap, "conditionalUncalibratedReason")));
        if (ci && ci->type == J_ARR && ci->n == 2) std::printf(", across trainings (model-based simultaneous 95%%) [%+.4f, %+.4f]", n(ci->items[0]), n(ci->items[1]));
        std::printf("; evaluation se %.4f, between-training sd %.4f\n", n(g(gap, "evaluationStdErrOfMean")), n(g(gap, "betweenStrategySd"))); }
      if (q && q->type == J_OBJ) std::printf("      quality %.5f %s (sd %.5f, evaluation se %.5f) [%s]\n", n(g(q, "mean")), s(g(u, "unit")), n(g(q, "sdAcrossSeeds")), n(g(q, "evaluationStdErrOfMean")), s(g(qm, "kind")));
      std::printf("      %s: %s%s\n", s(g(x, "verdict")), s(g(x, "verdictText")), g(x, "meetsTolerance") && g(x, "meetsTolerance")->num != 0 ? " [meets the declared tolerance]" : "");
      if (const JV *rep = g(g(x, "confidence"), "replication")) {   // 5.6: what the number of trainings supports
        const JV *ba = g(x, "bestAction");
        std::printf("      across trainings (%d trainings, %s evaluation): %s: %s\n", (int)n(g(rep, "trainings")), s(g(g(x, "confidence"), "evaluationKind")), s(g(rep, "verdict")), s(g(rep, "verdictText")));
        std::printf("      best action declared: %s (%s)\n", ba && g(ba, "declared") && g(ba, "declared")->num != 0 ? "YES" : "no", s(g(ba, "reason")));
      }
    }
    std::printf("  => %s\n", s(g(v, "toleranceSummary")));
  }
  if (const JV *ws = g(r, "statisticalWarnings")) if (ws->type == J_ARR && ws->n) {   // 5.6
    std::printf("\nWhat this study does not establish\n");
    for (int i = 0; i < ws->n; i++) std::printf("  - [%s] %s\n", s(g(ws->items[i], "code")), s(g(ws->items[i], "text")));
  }
  const JV *sens = g(r, "sensitivity"), *cs = g(sens, "comparisons");
  if (cs) { std::printf("\nSensitivity (baseline: %s)\n", s(g(sens, "baseline")));
    for (int i = 0; i < cs->n; i++) { const JV *c = cs->items[i]; if (!g(c, "budgetDeals")) { std::printf("  %s: %s\n", s(g(c, "variant")), s(g(c, "note"))); continue; }
      std::printf("  %s (%s), at %.0f deals: leader by frequency %s -> %s (changed in %d of %d seeds); largest mean frequency change %.1f%%%s\n", s(g(c, "variant")), s(g(c, "change")), n(g(c, "budgetDeals")), s(g(c, "baselineLeaderByFrequency")), s(g(c, "variantLeaderByFrequency")), (int)n(g(c, "seedsWhereLeaderByFrequencyChanged")), (int)n(g(c, "pairedSeeds")), 100 * n(g(c, "largestMeanFrequencyChange")),
        g(c, "shiftWhileNearlyTied") && g(c, "shiftWhileNearlyTied")->num != 0 ? " [frequencies shift while the leading actions stay nearly tied]" : "");
      const JV *ad = g(c, "addedActions"); for (int k = 0; ad && k < ad->n; k++) { const JV *adv = g(ad->items[k], "advantageOverBestOriginal"), *ci = g(adv, "ci95");
        std::printf("      added %s: frequency %.1f%%", s(g(ad->items[k], "label")), 100 * n(g(ad->items[k], "frequency"))); if (adv) { std::printf(", EV advantage over %s %+.4f %s", s(g(adv, "bestOriginalAction")), n(g(adv, "mean")), s(g(adv, "unit"))); if (ci && ci->type == J_ARR && ci->n == 2) std::printf(" [%+.4f, %+.4f]", n(ci->items[0]), n(ci->items[1])); } std::printf("\n"); } } }
}
static int run(int argc, char **argv) {
  if (argc < 4) { std::fprintf(stderr, "usage: mwcli --study fixture.json out.json [variants=all|a,b] [seeds=N|a,b,c] [budgets=a,b,c] [threads=N] [memoryMiB=X] [timeLimitSeconds=S] [preset=quick|standard|deep|research] [processingMode=cpu|auto|hybrid|gpu] [evaluationSamples=N] [qualitySamples=N]\n"
    "       [checkpoint=DIR|off] [resume=1] [replaceCheckpoint=1] [checkpointSeconds=S] [checkpointUpdates=N] [checkpointStages=0|1] [parallelSeeds=N|auto] [processMemoryMiB=X] [evaluationMemoryMiB=X] [requireComplete=1] [opponentEnumeration=none|river|river-shared|river-cross] [estimator=external|rbes] [trainingStreams=5.10|philox64] [quiet=1]\n"); return 2; }
  std::vector<unsigned char> fx = slurp(argv[2]); if (fx.empty()) { std::fprintf(stderr, "error: cannot read study fixture '%s'\n", argv[2]); return 2; }
  std::string opt = "{", trainerOpt, ckDir, presetName = "fixture"; bool quiet = false, ckGiven = false, resume = false, requireComplete = false; auto add = [&](const std::string &kv) { opt += (opt.size() > 1 ? "," : "") + kv; };
  for (int i = 4; i < argc; i++) {
    const std::string a = argv[i]; const size_t eq = a.find('='); if (eq == std::string::npos) { std::fprintf(stderr, "error: expected key=value, got '%s'\n", argv[i]); return 2; }
    const std::string k = a.substr(0, eq), v = a.substr(eq + 1); std::string list; double x = 0;
if (k == "variants" || k == "preset" || k == "processingMode") { if (v.empty() || v.find_first_of("\"\\") != std::string::npos) { std::fprintf(stderr, "error: bad variants\n"); return 2; } add("\""+k+"\":\"" + v + "\""); if (k == "preset") presetName = v; }
    else if (k == "seeds") { if (v.find(',') == std::string::npos && v.size() <= 4 && listArg(v, list)) add("\"seeds\":" + v); else if (listArg(v, list)) add("\"seeds\":" + list); else { std::fprintf(stderr, "error: seeds must be a count or a comma-separated list of whole numbers\n"); return 2; } }
    else if (k == "budgets") { if (!listArg(v, list)) { std::fprintf(stderr, "error: budgets must be a comma-separated list of sampled-deal counts\n"); return 2; } add("\"budgets\":" + list); }
    else if (k == "checkpoint") { if (v.empty() || v.find_first_of("\"") != std::string::npos) { std::fprintf(stderr, "error: bad checkpoint directory\n"); return 2; } ckDir = v; ckGiven = true; }
    else if (k == "resume" || k == "replaceCheckpoint" || k == "checkpointStages") { if (v != "0" && v != "1") { std::fprintf(stderr, "error: %s must be 0 or 1\n", k.c_str()); return 2; } add("\"" + k + "\":" + (v == "1" ? "true" : "false")); if (k == "resume") resume = v == "1"; }
    else if (k == "requireComplete") requireComplete = v != "0";
    else if (k == "parallelSeeds" && v == "auto") add("\"parallelSeeds\":\"auto\"");
    else if (k == "threads" || k == "memoryMiB" || k == "timeLimitSeconds" || k == "evaluationSamples" || k == "qualitySamples" || k == "checkpointSeconds" || k == "checkpointUpdates" || k == "parallelSeeds" || k == "processMemoryMiB" || k == "evaluationMemoryMiB") { if (!numberArg(v.c_str(), x) && !((k == "timeLimitSeconds" || k == "checkpointSeconds" || k == "checkpointUpdates" || k == "processMemoryMiB" || k == "evaluationMemoryMiB") && v == "0")) { std::fprintf(stderr, "error: %s must be a number\n", k.c_str()); return 2; } char b[64]; std::snprintf(b, sizeof b, "\"%s\":%.17g", k.c_str(), x); add(b); }
    else if (k == "opponentEnumeration") { if (v != "none" && v != "river" && v != "river-shared" && v != "river-cross") { std::fprintf(stderr, "error: opponentEnumeration must be none, river, river-shared or river-cross\n"); return 2; } trainerOpt += (trainerOpt.empty() ? "" : ",") + std::string("\"opponentEnumeration\":\"") + v + "\""; }   // 5.5 experimental trainer option
    else if (k == "estimator") { if (v != "external" && v != "rbes") { std::fprintf(stderr, "error: estimator must be external or rbes\n"); return 2; } trainerOpt += (trainerOpt.empty() ? "" : ",") + std::string("\"estimator\":\"") + v + "\""; }   // 5.10 experimental estimator
    else if (k == "trainingStreams") { if (v != "5.10" && v != "philox64") { std::fprintf(stderr, "error: trainingStreams must be 5.10 or philox64\n"); return 2; } add("\"trainingStreams\":\"" + v + "\""); }   // 5.11
    else if (k == "quiet") quiet = v != "0";
    else { std::fprintf(stderr, "error: unknown option '%s'\n", k.c_str()); return 2; }
  }
  if (!trainerOpt.empty()) add("\"trainer\":{" + trainerOpt + "}");
  // 5.5: automatic study checkpoints. Longer presets (standard, deep, research) checkpoint by default into
  // "<out.json>.checkpoint"; checkpoint=DIR chooses the directory for any study and checkpoint=off disables it.
  if (!ckGiven && (presetName == "standard" || presetName == "deep" || presetName == "research" || resume)) ckDir = std::string(argv[3]) + ".checkpoint";
  if (ckDir == "off") ckDir.clear();
  if (!ckDir.empty()) { std::string esc; for (char c : ckDir) { if (c == '\\') esc += "\\\\"; else esc += c; } add("\"checkpoint\":\"" + esc + "\""); }
  opt += "}";
  mw_study_identity(EM_VERSION, EM_BUILD_ID);
  JB out; jb_init(&out); char err[768] = "";
  // 5.5 (tests): EM_STUDY_CANCEL_AFTER_MS=N raises the study's cancellation flag N ms after it starts, as the
  // desktop's Cancel button does; the study stops cooperatively, commits its checkpoint and writes its partial result.
  static volatile int cancelFlag = 0; long long cancelAfter = -1; std::atomic<bool> finished{false}; std::thread canceller;
  if (const char *c = std::getenv("EM_STUDY_CANCEL_AFTER_MS")) { if (!wholeArg(c, 0, 3600000, cancelAfter)) { std::fprintf(stderr, "error: bad EM_STUDY_CANCEL_AFTER_MS\n"); return 2; } }
  if (cancelAfter >= 0) canceller = std::thread([&] { const auto until = std::chrono::steady_clock::now() + std::chrono::milliseconds(cancelAfter); while (!finished.load() && std::chrono::steady_clock::now() < until) std::this_thread::sleep_for(std::chrono::milliseconds(1)); if (!finished.load()) __atomic_store_n(&cancelFlag, 1, __ATOMIC_RELAXED); });
  const int st = mw_study_run((const char *)fx.data(), fx.size(), opt.c_str(), opt.size(), &out, err, sizeof err, cancelAfter >= 0 ? &cancelFlag : nullptr, quiet ? nullptr : progressLine, nullptr);
  finished = true; if (canceller.joinable()) canceller.join();
  if (st != 200) { std::fprintf(stderr, "error %d: %s\n", st, err); jb_free(&out); return st == 409 ? 5 : 1; }
  SaveReport rep; saveWithReport(argv[3], [&](FILE *f) { return std::fwrite(out.s, 1, out.n, f) == out.n; }, rep);
  if (!rep.ok) { std::fprintf(stderr, "error: cannot write '%s': %s\n", argv[3], rep.text().c_str()); jb_free(&out); return 4; }
  // the table is printed from the bytes that were written
  std::vector<unsigned char> back = slurp(argv[3]); char pe[256] = ""; JV *r = json_parse((const char *)back.data(), back.size(), pe, sizeof pe);
  if (!r) { std::fprintf(stderr, "error: the written result does not parse: %s\n", pe); jb_free(&out); return 4; }
  printSummary(r);
  const JV *cp = g(r, "completion"), *ckp = g(g(r, "run"), "checkpoint"); const bool complete = g(cp, "complete") && g(cp, "complete")->num != 0;
  std::printf("\nCompletion: %s (%d of %d measurements)%s\n", complete ? "COMPLETE" : "INCOMPLETE", (int)n(g(cp, "pointsCompleted")), (int)n(g(cp, "pointsRequested")), complete ? "" : " - rankings and tolerance claims are withheld for budgets with missing seeds");
  if (g(ckp, "enabled") && g(ckp, "enabled")->num != 0) { std::printf("Checkpoint: %s (%d commits, %d engine states written%s)%s\n", s(g(ckp, "directory")), (int)n(g(ckp, "commits")), (int)n(g(ckp, "engineStateWrites")), g(ckp, "resumed") && g(ckp, "resumed")->num != 0 ? ", resumed" : "", complete ? "" : " - resume with the same command plus resume=1");
    const JV *w = g(ckp, "warnings"); for (int i = 0; w && i < w->n; i++) std::printf("  checkpoint warning: %s\n", s(w->items[i])); }
  json_free(r); jb_free(&out);
  std::printf("\nResult written to %s\n", argv[3]);
  return requireComplete && !complete ? 3 : 0;
}
}  // namespace st52
#endif
