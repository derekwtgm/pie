// EightMax 5.5: study-level checkpoints (automatic saving and resumption of decision studies).
// Included INSIDE namespace study52 by study52.hpp (after Point/pointW). See CHECKPOINT-RECOVERY-5.5.md.
//
// A checkpoint is a directory:
//   manifest.json        the committed description of the study so far (format below)
//   manifest.prev.json   the manifest committed before it (kept so one damaged manifest is recoverable)
//   job-V-S.gN.state     raw engine state (mw_write_stream, the existing EMMW4 solver checkpoint bytes) of
//                        variant V, seed S, generation N. The two newest generations of a job are kept.
// Commit protocol (one mutex; a commit is either wholly visible or not at all):
//   1. the engine state is written to a sibling temporary file, flushed, committed to disk and renamed to its
//      generation name (state_file.hpp saveWithReport: the 4.6 transactional writer with its fault injection);
//   2. its SHA-256 and length are read back from the file;
//   3. the current manifest is copied to manifest.prev.json and the new manifest, which names the new state file
//      and hash, replaces manifest.json by the same transactional writer;
//   4. only then is the job's generation N-2 deleted.
// A process killed at any step leaves manifest.json (or, if it was being replaced, manifest.prev.json) naming
// state files that exist and match their hashes. Work since that commit is lost; nothing committed is damaged.
// Loading verifies the format, the body hash, the study fingerprint and every referenced state hash, and falls
// back from manifest.json to manifest.prev.json. Existing checkpoints are never overwritten unless the caller
// asks to resume them or explicitly allows replacement.
// 5.7.1: step 3 copies the current manifest to manifest.prev.json only if it still verifies (format and body hash).
// 5.5 to 5.7 copied it unconditionally. After a recovery from manifest.prev.json (manifest.json damaged), the first
// commit of the resumed study therefore replaced the only intact manifest with the damaged one before the new
// manifest.json existed: a process killed, or a write that failed, between those two writes left NO usable manifest
// although every measurement and state file was intact (reproduced on 5.7: validation/5.7.1/checkpoint). A damaged
// manifest.json is now left to be replaced in place and manifest.prev.json keeps the intact generation, so the
// statement above holds after a recovery too.
//
// manifest.json: {"format":"EightMax study checkpoint","formatVersion":1,"bodySha256":hex,"body":{...}}
// bodySha256 is the SHA-256 of the canonical serialisation of body (this file's JSON writer applied to the parsed
// body, which is idempotent because numbers are written with 17 significant digits).

static double currentRssMiB() {
#ifdef _WIN32
  PROCESS_MEMORY_COUNTERS pmc; if (K32GetProcessMemoryInfo(GetCurrentProcess(), &pmc, sizeof pmc)) return pmc.WorkingSetSize / 1048576.0;
  return -1;
#else
  FILE *f = std::fopen("/proc/self/statm", "r"); if (!f) return -1; long long total = 0, res = 0; const int n = std::fscanf(f, "%lld %lld", &total, &res); std::fclose(f);
  return n == 2 ? (double)res * (double)sysconf(_SC_PAGESIZE) / 1048576.0 : -1;
#endif
}
static double physicalMemoryMiB() {
#ifdef _WIN32
  MEMORYSTATUSEX s; s.dwLength = sizeof s; if (GlobalMemoryStatusEx(&s)) return (double)s.ullTotalPhys / 1048576.0; return -1;
#else
  const long pages = sysconf(_SC_PHYS_PAGES), size = sysconf(_SC_PAGESIZE); return pages > 0 && size > 0 ? (double)pages * (double)size / 1048576.0 : -1;
#endif
}
static std::string sha256Text(const std::string &s) { emsha::Sha256 h; h.add(s.data(), s.size()); return h.hex(); }
static std::vector<double> numsOf(const JV *a) { std::vector<double> v; if (a && a->type == J_ARR) for (int i = 0; i < a->n; i++) v.push_back(numOr(a->items[i], NAN)); return v; }
static bool boolOf(const JV *v) { return v && v->type == J_BOOL && v->num != 0; }
// Inverse of pointW. Every number was written with 17 significant digits, so the restored Point is bit-identical.
static bool pointRead(const JV *j, Point &p) {
  if (!j || j->type != J_OBJ || !at(j, "status") || !at(j, "ev")) return false;
  p.status = strOr(at(j, "status"), ""); p.stopReason = strOr(at(j, "stopReason"), ""); p.complete = boolOf(at(j, "complete")); p.qualityRequired = boolOf(at(j, "qualityRequired"));
  p.independentEvaluation = boolOf(at(j, "independentEvaluation")); p.evSeed = (uint32_t)numOr(at(j, "evaluationSeed"), 0); p.qualitySeed = (uint32_t)numOr(at(j, "qualitySeed"), 0);
  p.qualitySamples = (long long)numOr(at(j, "qualitySamples"), 0); p.deals = (long long)numOr(at(j, "deals"), 0); p.updates = (long long)numOr(at(j, "updates"), 0); p.rows = (long long)numOr(at(j, "rows"), 0);
  p.tableMiB = numOr(at(j, "tableMiB"), 0); p.limitReached = boolOf(at(j, "limitReached")); p.trainThreads = (int)numOr(at(j, "trainingThreads"), 0);
  p.trainSeconds = numOr(at(j, "trainingSecondsCumulative"), 0); p.evSeconds = numOr(at(j, "evSeconds"), 0); p.qualitySeconds = numOr(at(j, "qualitySeconds"), 0); p.peakRss = numOr(at(j, "processPeakRssMiB"), 0);
  p.evError = strOr(at(j, "evError"), ""); p.trainerJson = jvS(at(j, "trainer")); p.processingPath = strOr(at(j, "trainingDevicePath"), ""); p.requestedDevice = strOr(at(j, "trainingDeviceRequested"), "");
  p.largestGain = numOr(at(j, "largestUnilateralGain"), NAN); p.evMethod = strOr(at(j, "evMethod"), ""); p.evStatus = strOr(at(j, "evStatus"), ""); p.evSamples = (long long)numOr(at(j, "evSamples"), 0);
  p.strategyStored = boolOf(at(j, "strategyStored")); p.freq = numsOf(at(j, "frequency")); p.ev = numsOf(at(j, "ev")); p.se = numsOf(at(j, "evStdErr")); p.fallback = numsOf(at(j, "fallbackShare"));
  p.evLower = numOr(at(j, "evPayoffLowerBound"), NAN); p.evUpper = numOr(at(j, "evPayoffUpperBound"), NAN); p.evWithin = boolOf(at(j, "evSamplesWithinBound"));
  p.pairSe.clear(); if (const JV *ps = at(j, "pairedDiffStdErr")) for (int i = 0; ps->type == J_ARR && i < ps->n; i++) p.pairSe.push_back(numsOf(ps->items[i]));
  p.qualityError = strOr(at(j, "qualityError"), ""); p.qualityKind = strOr(at(j, "qualityKind"), ""); p.quality = numOr(at(j, "quality"), NAN); p.qualitySe = numOr(at(j, "qualityStdErr"), NAN);
  p.seatGain = numsOf(at(j, "seatGain")); p.seatSe = numsOf(at(j, "seatGainStdErr")); p.have = true;
  return true;
}
struct JobCheckpoint {
  std::string variant; long long seed = 0;
  bool hasState = false; std::string file, sha, devicePath; double bytes = 0; long long deals = 0, updates = 0; int budgetIndex = 0, generation = 0; double trainSeconds = 0;
  std::vector<std::string> points;   // pointW text of the completed budgets, in budget order (a contiguous prefix)
  std::string previousFile;          // generation N-1, deleted when N+1 commits
};
struct Checkpoint {
  bool enabled = false, resumed = false, stages = true; std::string dir, fingerprint, planJson, version, build, lastError, status = "running", statusReason;
  double everySeconds = 60; long long everyUpdates = 0, sequence = 0, commits = 0, stateWrites = 0; int resumeCount = 0; double priorElapsed = 0, lastCommitElapsed = -1, secondsWriting = 0, bytesWritten = 0;
  std::mutex mu; std::vector<std::vector<JobCheckpoint>> jobs;   // [variant][seed]
  std::vector<std::string> loadNotes;   // states dropped while loading (damaged or missing)
  std::string path(const std::string &name) const { return dir + "/" + name; }
  static std::string slurpText(const std::string &p) { std::string s; FILE *f = std::fopen(p.c_str(), "rb"); if (!f) return s; char b[65536]; size_t n; while ((n = std::fread(b, 1, sizeof b, f)) > 0) s.append(b, n); std::fclose(f); return s; }
  // Canonical body text -> full manifest text
  static std::string wrap(const std::string &body) { return "{\"format\":\"EightMax study checkpoint\",\"formatVersion\":1,\"bodySha256\":\"" + sha256Text(body) + "\",\"body\":" + body + "}\n"; }
  std::string bodyText(double elapsed) const {
    Out o; o.raw("{"); o.ks("calculationVersion", study55::CALCULATION); o.ks("version", version); o.ks("build", build); o.ks("studyFingerprint", fingerprint);
    o.ki("sequence", sequence); o.ks("status", status); o.ks("statusReason", statusReason); o.kn("elapsedSeconds", elapsed); o.ki("resumeCount", resumeCount);
    o.ki("savedAtUnixSeconds", (long long)std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count());
    o.key("plan"); o.raw(planJson); o.key("jobs"); o.raw("[");
    for (size_t vi = 0; vi < jobs.size(); vi++) for (size_t si = 0; si < jobs[vi].size(); si++) {
      const JobCheckpoint &j = jobs[vi][si]; o.sep(); o.raw("{"); o.ks("variant", j.variant); o.ki("variantIndex", (long long)vi); o.ki("seed", j.seed); o.ki("seedIndex", (long long)si);
      o.key("state"); if (!j.hasState) o.raw("null"); else { o.raw("{"); o.ks("file", j.file); o.ks("sha256", j.sha); o.kn("bytes", j.bytes); o.ki("deals", j.deals); o.ki("updates", j.updates); o.ki("budgetIndex", j.budgetIndex); o.ki("generation", j.generation); o.kn("trainingSeconds", j.trainSeconds); o.ks("trainingDevicePath", j.devicePath); o.ks("previousFile", j.previousFile); o.raw("}"); }
      o.key("points"); o.raw("["); for (size_t b = 0; b < j.points.size(); b++) { if (b) o.raw(","); o.raw(j.points[b]); } o.raw("]"); o.raw("}");
    }
    o.raw("]"); o.raw("}");
    char e[256] = ""; JV *v = json_parse(o.s.c_str(), o.s.size(), e, sizeof e); if (!v) return std::string();
    std::string canon = jvS(v); json_free(v); return canon;
  }
  // Does this text carry a manifest whose body matches its recorded SHA-256? (The same format and hash test as
  // readManifest; whether it belongs to this study is not asked: load() has already refused a foreign checkpoint.)
  static bool intactManifestText(const std::string &text) {
    char e[256] = ""; JV *v = json_parse(text.c_str(), text.size(), e, sizeof e); if (!v) return false;
    bool ok = false;
    if (v->type == J_OBJ && strOr(at(v, "format"), "") == "EightMax study checkpoint" && numOr(at(v, "formatVersion"), 0) == 1) {
      const JV *body = at(v, "body"); ok = body && body->type == J_OBJ && sha256Text(jvS(body)) == strOr(at(v, "bodySha256"), "");
    }
    json_free(v); return ok;
  }
  // Caller holds mu. Publishes the manifest atomically; the previous manifest is kept as manifest.prev.json
  // (5.7.1: only when it verifies, so a damaged manifest.json never displaces an intact manifest.prev.json).
  bool publish(double elapsed) {
    Clock c; sequence++; const std::string body = bodyText(elapsed);
    if (body.empty()) { lastError = "the checkpoint manifest could not be serialised"; sequence--; return false; }
    const std::string text = wrap(body), cur = path("manifest.json"), prev = path("manifest.prev.json");
    const std::string old = slurpText(cur);
    if (!old.empty() && intactManifestText(old)) { SaveReport r; if (!saveWithReport(prev.c_str(), [&](FILE *f) { return std::fwrite(old.data(), 1, old.size(), f) == old.size(); }, r)) { lastError = "manifest.prev.json: " + r.text(); sequence--; return false; } }
    SaveReport r; if (!saveWithReport(cur.c_str(), [&](FILE *f) { return std::fwrite(text.data(), 1, text.size(), f) == text.size(); }, r)) { lastError = "manifest.json: " + r.text(); sequence--; return false; }
    commits++; lastCommitElapsed = elapsed; secondsWriting += c.s(); lastError.clear(); return true;
  }
  // Writes the engine state of one job (called by the thread that owns the engine) and commits a manifest naming it.
  bool saveState(MW *m, size_t vi, size_t si, long long deals, long long updates, int budgetIndex, double trainSeconds, const std::string &devicePath, double elapsed) {
    if (!enabled) return true;
    Clock c; int gen; { std::lock_guard<std::mutex> l(mu); gen = jobs[vi][si].generation + 1; }
    char name[96]; std::snprintf(name, sizeof name, "job-%zu-%zu.g%d.state", vi, si, gen); const std::string full = path(name);
    // the same bytes `mwcli spec n threads out.state` writes: a streamed EMMW4 state for external-sampling engines, the exported state otherwise
    SaveReport r; bool ok;
    if (mw_is_external(m)) ok = saveWithReport(full.c_str(), [&](FILE *f) { return mw_write_stream(m, f, nullptr) > 0; }, r);
    else { unsigned char *buf = nullptr; const size_t n = mw_export(m, &buf); ok = buf && n && saveWithReport(full.c_str(), [&](FILE *f) { return std::fwrite(buf, 1, n, f) == n; }, r); if (!(buf && n)) { r.stage = "export"; r.message = "the engine produced no state bytes"; } std::free(buf); }
    if (!ok) { std::lock_guard<std::mutex> l(mu); lastError = std::string(name) + ": " + r.text(); return false; }
    uint64_t bytes = 0; const std::string sha = emsha::fileHex(full.c_str(), &bytes);
    if (sha.empty()) { std::lock_guard<std::mutex> l(mu); lastError = std::string(name) + ": cannot read the state back for its hash"; return false; }
    std::lock_guard<std::mutex> l(mu); JobCheckpoint &j = jobs[vi][si]; const JobCheckpoint before = j;
    const std::string drop = j.previousFile; j.previousFile = j.hasState ? j.file : std::string();
    j.hasState = true; j.file = name; j.sha = sha; j.bytes = (double)bytes; j.deals = deals; j.updates = updates; j.budgetIndex = budgetIndex; j.generation = gen; j.trainSeconds = trainSeconds; j.devicePath = devicePath;
    stateWrites++; bytesWritten += (double)bytes; secondsWriting += c.s();
    if (!publish(elapsed)) { j = before; std::remove(full.c_str()); return false; }
    if (!drop.empty()) std::remove(path(drop).c_str());
    return true;
  }
  // Records a completed point and commits.
  bool savePoint(size_t vi, size_t si, size_t b, const std::string &pointJson, double elapsed) {
    if (!enabled) return true;
    std::lock_guard<std::mutex> l(mu); JobCheckpoint &j = jobs[vi][si];
    if (j.points.size() != b) return true;   // only a contiguous prefix of completed budgets is recorded
    j.points.push_back(pointJson); if (!publish(elapsed)) { j.points.pop_back(); return false; } return true;
  }
  bool finish(const std::string &st, const std::string &reason, double elapsed, bool dropStates) {
    if (!enabled) return true;
    std::lock_guard<std::mutex> l(mu); status = st; statusReason = reason;
    std::vector<std::string> drop;
    if (dropStates) for (auto &v : jobs) for (auto &j : v) { if (j.hasState) drop.push_back(j.file); if (!j.previousFile.empty()) drop.push_back(j.previousFile); j.hasState = false; j.file.clear(); j.previousFile.clear(); j.sha.clear(); }
    if (!publish(elapsed)) return false;
    for (const auto &f : drop) std::remove(path(f).c_str());
    return true;
  }
  // Reads one manifest file. 1: valid for this study, 0: absent, -1: unusable (why says how).
  int readManifest(const std::string &file, std::string &why, bool restore) {
    const std::string text = slurpText(file); if (text.empty()) { why = "absent or empty"; return 0; }
    char e[256] = ""; JV *v = json_parse(text.c_str(), text.size(), e, sizeof e);
    struct Free { JV *v; ~Free() { if (v) json_free(v); } } guard{v};
    if (!v || v->type != J_OBJ) { why = std::string("not valid JSON (") + e + ")"; return -1; }
    if (strOr(at(v, "format"), "") != "EightMax study checkpoint") { why = "not an EightMax study checkpoint"; return -1; }
    if (numOr(at(v, "formatVersion"), 0) != 1) { why = "unsupported checkpoint formatVersion (this build reads version 1)"; return -1; }
    const JV *body = at(v, "body"); if (!body || body->type != J_OBJ) { why = "no body"; return -1; }
    if (sha256Text(jvS(body)) != strOr(at(v, "bodySha256"), "")) { why = "the manifest body does not match its SHA-256 (damaged or edited)"; return -1; }
    // 5.11: the build is compared first: a checkpoint of another build is refused for that reason whatever its plan. (The plan of a
    // study now includes its training streams; without this order a checkpoint of an earlier build would be reported as "a different
    // study" whenever the study did not ask for the 5.10 streams.)
    if (strOr(at(body, "build"), "") != build) { why = "the checkpoint was written by build " + strOr(at(body, "build"), "?") + "; this is build " + build + " (exact continuation is only defined within one build)"; return -2; }
    if (strOr(at(body, "studyFingerprint"), "") != fingerprint) { why = "the checkpoint belongs to a different study (fixture, seeds, budgets, variants, trainer, evaluation settings or memory budget differ)"; return -2; }
    if (strOr(at(body, "calculationVersion"), "") != study55::CALCULATION) { why = "the checkpoint was written with a different statistical calculation"; return -2; }
    const JV *js = at(body, "jobs"); if (!js || js->type != J_ARR) { why = "no jobs"; return -1; }
    std::vector<std::vector<JobCheckpoint>> got = jobs; std::vector<std::string> notes;
    for (int i = 0; i < js->n; i++) {
      const JV *x = js->items[i]; const size_t vi = (size_t)numOr(at(x, "variantIndex"), -1), si = (size_t)numOr(at(x, "seedIndex"), -1);
      if (vi >= got.size() || si >= got[vi].size() || strOr(at(x, "variant"), "") != got[vi][si].variant || (long long)numOr(at(x, "seed"), -1) != got[vi][si].seed) { why = "a job does not match the study plan"; return -1; }
      JobCheckpoint &j = got[vi][si]; const JV *pts = at(x, "points");
      for (int b = 0; pts && pts->type == J_ARR && b < pts->n; b++) { Point p; if (!pointRead(pts->items[b], p) || !p.complete) { why = "a recorded point is not a completed point"; return -1; } j.points.push_back(jvS(pts->items[b])); }
      if (const JV *s = at(x, "state"); s && s->type == J_OBJ) {
        j.hasState = true; j.file = strOr(at(s, "file"), ""); j.sha = strOr(at(s, "sha256"), ""); j.bytes = numOr(at(s, "bytes"), 0); j.deals = (long long)numOr(at(s, "deals"), 0); j.updates = (long long)numOr(at(s, "updates"), 0);
        j.budgetIndex = (int)numOr(at(s, "budgetIndex"), 0); j.generation = (int)numOr(at(s, "generation"), 0); j.trainSeconds = numOr(at(s, "trainingSeconds"), 0); j.devicePath = strOr(at(s, "trainingDevicePath"), ""); j.previousFile = strOr(at(s, "previousFile"), "");
        if (j.file.empty() || j.file.find_first_of("/\\") != std::string::npos || j.previousFile.find_first_of("/\\") != std::string::npos) { why = "a state file name is not a plain file name"; return -1; }
        uint64_t bytes = 0; const std::string sha = emsha::fileHex(path(j.file).c_str(), &bytes);
        // The manifest (hash-verified above) is the authority for completed measurements. A missing or damaged engine
        // state loses only that seed's training since its last completed budget: the state is dropped, never used.
        if (sha.empty() || sha != j.sha || (double)bytes != j.bytes) {
          notes.push_back("variant " + j.variant + " seed " + std::to_string(j.seed) + ": engine state " + j.file + (sha.empty() ? " is missing or unreadable" : " does not match its recorded SHA-256 or length (damaged)") + "; it is discarded and the seed is retrained from its start (recorded measurements are kept)");
          j.hasState = false; j.file.clear(); j.sha.clear(); j.previousFile.clear(); j.generation += 1;   // never reuse the damaged file's name
        }
      }
    }
    if (restore) { jobs.swap(got); loadNotes = notes; sequence = (long long)numOr(at(body, "sequence"), 0); resumeCount = (int)numOr(at(body, "resumeCount"), 0) + 1; priorElapsed = numOr(at(body, "elapsedSeconds"), 0); resumed = true; }
    why.clear(); return 1;
  }
  // Restores the engine of one job from its committed state file. On success *m is replaced by the restored engine
  // (external-sampling states are loaded into a NEW engine by mw_load_stream, as `mwcli ... in.state` does).
  bool restoreEngine(MW **m, const JobCheckpoint &j, const std::string &spec, double memMiB, std::string &why) const {
    const std::string file = path(j.file); FILE *f = std::fopen(file.c_str(), "rb"); if (!f) { why = "cannot open " + j.file; return false; }
    char e[512] = "";
    if (mw_is_external(*m)) {
      MW *loaded = nullptr; const int st = mw_load_stream(f, (uint64_t)j.bytes, spec.c_str(), memMiB, -1, &loaded, e, sizeof e, nullptr, nullptr); std::fclose(f);
      if (st != 200 || !loaded) { if (loaded) mw_free(loaded); why = e[0] ? e : "the state stream was refused"; return false; }
      mw_free(*m); *m = loaded; return true;
    }
    std::vector<unsigned char> bytes; unsigned char buf[65536]; size_t n; while ((n = std::fread(buf, 1, sizeof buf, f)) > 0) bytes.insert(bytes.end(), buf, buf + n); std::fclose(f);
    if (bytes.empty() || !mw_import(*m, bytes.data(), bytes.size(), e, sizeof e)) { why = e[0] ? e : "the state was refused"; return false; }
    return true;
  }
  // Removes what no committed manifest names: temporary files of a writer that was killed, and unreferenced states.
  // Called after a successful restore and first commit (the directory belongs to this checkpoint).
  int sweep() {
    std::lock_guard<std::mutex> l(mu); std::set<std::string> keep = {"manifest.json", "manifest.prev.json"}; int removed = 0;
    for (const auto &v : jobs) for (const auto &j : v) { if (j.hasState) keep.insert(j.file); if (!j.previousFile.empty()) keep.insert(j.previousFile); }
    std::error_code ec;
    for (const auto &e : std::filesystem::directory_iterator(dir, ec)) {
      const std::string n = e.path().filename().string(); if (keep.count(n) || !e.is_regular_file(ec)) continue;
      const bool ours = n.rfind("job-", 0) == 0 || n.rfind("manifest.", 0) == 0 || (n.rfind("EMs", 0) == 0 && n.size() > 4 && n.substr(n.size() - 4) == ".tmp");
      if (ours && std::filesystem::remove(e.path(), ec)) removed++;
    }
    return removed;
  }
  // Is there a checkpoint in the directory at all (any manifest file)?
  bool present() const { return !slurpText(path("manifest.json")).empty() || !slurpText(path("manifest.prev.json")).empty(); }
  // Restores from manifest.json, else manifest.prev.json. 1 restored, 0 nothing to restore, -1 unusable, -2 another study.
  int load(std::string &why, std::string &used) {
    std::string a, b; int r = readManifest(path("manifest.json"), a, true); if (r == 1) { used = "manifest.json"; return 1; }
    if (r == -2) { why = a; return -2; }
    const int r2 = readManifest(path("manifest.prev.json"), b, true);
    if (r2 == 1) { used = "manifest.prev.json"; why = "manifest.json was unusable (" + a + "); the previous committed manifest was used"; return 1; }
    if (r2 == -2) { why = b; return -2; }
    if (r == 0 && r2 == 0) return 0;
    why = "manifest.json: " + a + "; manifest.prev.json: " + b; return -1;
  }
};
