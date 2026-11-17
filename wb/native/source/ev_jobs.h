/* EightMax 4.0: background evaluation jobs for the desktop host (server.c).
 *
 * Large action-EV and response-gain evaluations no longer hold the engine lock
 * or a browser request open. A job is submitted, validated immediately
 * (malformed requests are rejected with HTTP 400 and no job is created),
 * queued, and executed by a bounded pool of worker threads. Status, progress,
 * results, cancellation and release have their own endpoints (MW-PROTOCOL.md
 * section "Evaluation jobs").
 *
 * Concurrency: a running job is a READER of the open study (MW_READERS). Every
 * route that mutates or replaces the study is refused while readers exist, and
 * MW_GEN changes whenever the study changes, so a queued job either evaluates
 * exactly the study (and training counters) it was submitted for or fails
 * with a clear message. Evaluations never write regrets, averages, betting
 * states, RNG state, counters or checkpoints (the engine is accessed through
 * const references; the only shared mutable structure, the EV result cache, has
 * its own mutex).
 *
 * Resources: at most EVJ_SLOTS jobs are retained, at most EVJ_QUEUE_LIMIT are
 * pending, at most `workers` run at once (default 2), each with at most
 * `threadsPerJob` evaluation threads, and the memory budgets (memoryMiB + coverageMiB since 4.5) of
 * running jobs never exceed the evaluation memory pool (default: a quarter of
 * available RAM, at most 2,048 MiB - conservative for a 16 GB PC). A job that
 * does not fit waits; one larger than the pool is refused (413). Workers are
 * started lazily, never exceed the configured count, and every evaluation
 * thread is joined before its job is marked finished.
 */
enum { EVJ_PENDING, EVJ_RUN, EVJ_COMPLETED, EVJ_CANCELLED, EVJ_TIMEDOUT, EVJ_FAILED };
static const char *EVJ_STATUS[] = {"pending", "running", "completed", "cancelled", "timedOut", "failed"};
#define EVJ_SLOTS 32
#define EVJ_MAX_WORKERS 8
typedef struct {
  int used, kind, status, http, partial, cancelRequested;
  unsigned long long seq, gen; char id[40], study[96];
  char *body; size_t blen;
  double created, started, finished; long long createdUnix, memoryMiB, coverageMiB, chargedMiB, timeLimitMs;
  MwEvalTask *task; JB result; int hasResult; char error[512];
} EvJob;
static EvJob EVJ[EVJ_SLOTS];
static pthread_mutex_t EVJ_MU = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t EVJ_CV = PTHREAD_COND_INITIALIZER;
static int EVJ_WORKERS = 0, EVJ_STARTED = 0, EVJ_RUNNING = 0, EVJ_THREADS = 0, EVJ_QUEUE_LIMIT = 16;
static long long EVJ_POOL_MIB = 0, EVJ_RUNNING_MIB = 0, EVJ_STARTS = 0, EVJ_START_FAILURES = 0;
static unsigned long long EVJ_SEQ = 0; static unsigned EVJ_BOOT = 0;

static void evj_defaults(void) {   /* call with EVJ_MU held */
  if (EVJ_WORKERS) return;
  EVJ_WORKERS = 2;
  EVJ_THREADS = LOGICAL_CPUS / EVJ_WORKERS; if (EVJ_THREADS < 1) EVJ_THREADS = 1; if (EVJ_THREADS > 8) EVJ_THREADS = 8;
  double avail = available_memory_mib(); long long pool = avail > 0 ? (long long)(avail / 4) : 512;
  if (pool > 2048) pool = 2048; if (pool < 256) pool = 256; EVJ_POOL_MIB = pool;
  EVJ_BOOT = (unsigned)((unsigned long long)(now_s() * 1e6) ^ (unsigned long long)(uintptr_t)&EVJ_SEQ);
  mw_set_eval_threads(EVJ_THREADS);
}
static int evj_finished(const EvJob *j) { return j->status >= EVJ_COMPLETED; }
static void evj_free(EvJob *j) { /* EVJ_MU held; never for a running job */
  free(j->body); j->body = NULL; if (j->task) mw_eval_task_free(j->task); j->task = NULL;
  if (j->hasResult) jb_free(&j->result); j->hasResult = 0; j->used = 0;
}
static EvJob *evj_find(const char *id) {
  for (int i = 0; i < EVJ_SLOTS; i++) if (EVJ[i].used && !strcmp(EVJ[i].id, id)) return &EVJ[i];
  return NULL;
}
/* The oldest pending job, if a worker may run it now (FIFO; the head waits until its memory fits). */
static EvJob *evj_next(void) {
  if (EVJ_RUNNING >= EVJ_WORKERS) return NULL;
  EvJob *best = NULL;
  for (int i = 0; i < EVJ_SLOTS; i++) if (EVJ[i].used && EVJ[i].status == EVJ_PENDING && (!best || EVJ[i].seq < best->seq)) best = &EVJ[i];
  if (best && EVJ_RUNNING_MIB + best->chargedMiB > EVJ_POOL_MIB) return NULL;
  /* 4.6: the job's memory is also reserved in the process ledger; if it does not fit now the
     job waits at the head of the queue (workers re-check every 250 ms) */
  if (best && !eml_reserve(EML_JOBS, best->chargedMiB, NULL, 0)) return NULL;
  return best;
}
static void *evj_worker(void *arg) {
  (void)arg;
  pthread_mutex_lock(&EVJ_MU);
  for (;;) {
    EvJob *j;
    while (!(j = evj_next())) {
      struct timespec until; clock_gettime(CLOCK_REALTIME, &until); until.tv_nsec += 250000000L;
      if (until.tv_nsec >= 1000000000L) { until.tv_sec++; until.tv_nsec -= 1000000000L; }
      pthread_cond_timedwait(&EVJ_CV, &EVJ_MU, &until);
    }
    j->status = EVJ_RUN; j->started = now_s(); EVJ_RUNNING++; EVJ_RUNNING_MIB += j->chargedMiB;
    const int kind = j->kind; const char *body = j->body; const size_t blen = j->blen; const unsigned long long gen = j->gen; MwEvalTask *task = j->task;
    pthread_mutex_unlock(&EVJ_MU);
    /* Attach to the study as a reader. A checkpoint SAVE (MW_RESTORING without a
       study change) is transient: the job goes back to the queue. */
    MW *m = NULL; const char *why = NULL; int requeue = 0;
    pthread_mutex_lock(&MW_MU);
    if (!MWG) why = "The study was closed before the job started";
    else if (MW_GEN != gen) why = "The study changed (training, import, restore or a new study) after the job was submitted; submit it again";
    else if (MW_RUNNING) why = "Training is running";
    else if (MW_RESTORING) requeue = 1;
    else { m = MWG; MW_READERS++; }
    pthread_mutex_unlock(&MW_MU);
    if (requeue) {
      pthread_mutex_lock(&EVJ_MU); EVJ_RUNNING--; EVJ_RUNNING_MIB -= j->chargedMiB; eml_release(EML_JOBS, j->chargedMiB);
      /* 4.1: a cancel that arrived while the job was briefly "running" here
         finishes it as cancelled now (4.0 put it back in the queue and only
         noticed the cancellation after it was picked up and started again). */
      if (j->cancelRequested) { j->status = EVJ_CANCELLED; j->finished = now_s(); j->http = 409; snprintf(j->error, sizeof j->error, "Cancelled before it started"); }
      else { j->status = EVJ_PENDING; j->started = 0; }
      pthread_cond_broadcast(&EVJ_CV);
      pthread_mutex_unlock(&EVJ_MU); sleep_ms(100); pthread_mutex_lock(&EVJ_MU); continue;
    }
    JB out; jb_init(&out); char err[512] = ""; int rc;
    if (m) {
      rc = mw_eval_run(m, kind, body, blen, &out, err, sizeof err, task);
      pthread_mutex_lock(&MW_MU); MW_READERS--; pthread_mutex_unlock(&MW_MU);
    } else { rc = 409; snprintf(err, sizeof err, "%s", why); }
    pthread_mutex_lock(&EVJ_MU);
    j->finished = now_s(); j->http = rc; EVJ_RUNNING--; EVJ_RUNNING_MIB -= j->chargedMiB; eml_release(EML_JOBS, j->chargedMiB);
    if (rc == 200 && !out.failed) {
      j->status = EVJ_COMPLETED; j->result = out; j->hasResult = 1;
      j->partial = strstr(out.s, "\"status\":\"partial\"") != NULL;
    } else {
      jb_free(&out);
      j->status = rc == 408 ? EVJ_TIMEDOUT : (rc == 409 && j->cancelRequested) ? EVJ_CANCELLED : EVJ_FAILED;
      snprintf(j->error, sizeof j->error, "%s", rc == 200 ? "Out of memory while storing the result" : err[0] ? err : "Evaluation failed");
    }
    pthread_cond_broadcast(&EVJ_CV);
  }
  return NULL;
}
static void evj_json(JB *b, EvJob *j, int withProgress) {
  const double now = now_s();
  jb_printf(b, "{\"jobId\":\"%s\",\"kind\":\"%s\",\"status\":\"%s\",\"studyId\":", j->id, j->kind ? "response-gain" : "ev", EVJ_STATUS[j->status]);
  jb_str(b, j->study);
  jb_printf(b, ",\"createdUnix\":%lld,\"queuedMs\":%.1f,\"runningMs\":", j->createdUnix, ((j->started ? j->started : (evj_finished(j) ? j->finished : now)) - j->created) * 1000);
  if (j->started) jb_printf(b, "%.1f", ((evj_finished(j) ? j->finished : now) - j->started) * 1000); else jb_puts(b, "null");
  jb_printf(b, ",\"memoryMiB\":%lld,\"coverageMiB\":%lld,\"chargedMiB\":%lld,\"timeLimitMs\":%lld,\"cancelRequested\":%s", j->memoryMiB, j->coverageMiB, j->chargedMiB, j->timeLimitMs, j->cancelRequested ? "true" : "false");
  /* Cooperative cancellation normally stops a job within milliseconds of its
     limit; a job far past it is flagged (it cannot be killed safely). */
  jb_printf(b, ",\"overdue\":%s", j->status == EVJ_RUN && (now - j->started) * 1000 > j->timeLimitMs + 5000 ? "true" : "false");
  if (evj_finished(j)) {
    jb_printf(b, ",\"httpStatus\":%d,\"partial\":%s,\"resultBytes\":%lu,\"error\":", j->http, j->partial ? "true" : "false", j->hasResult ? (unsigned long)j->result.n : 0UL);
    if (j->status == EVJ_COMPLETED) jb_puts(b, "null"); else jb_str(b, j->error);
  }
  if (withProgress && j->task && j->status != EVJ_PENDING) { jb_puts(b, ",\"progress\":"); mw_eval_progress(j->task, b); }
  if (withProgress) { jb_puts(b, ",\"request\":"); jb_putn(b, j->body, j->blen); }
  jb_putc(b, '}');
}
static void evj_config_json(JB *b) {
  jb_printf(b, "{\"workers\":%d,\"workersStarted\":%d,\"threadsPerJob\":%d,\"queueLimit\":%d,\"slots\":%d,\"memoryPoolMiB\":%lld,\"runningMiB\":%lld,\"running\":%d,\"logicalCPUs\":%d,\"workerStartFailures\":%lld}",
            EVJ_WORKERS, EVJ_STARTED, EVJ_THREADS, EVJ_QUEUE_LIMIT, EVJ_SLOTS, EVJ_POOL_MIB, EVJ_RUNNING_MIB, EVJ_RUNNING, LOGICAL_CPUS, EVJ_START_FAILURES);
}
static int evj_valid_id(const char *id) {
  size_t n = strlen(id); if (!n || n >= 40) return 0;
  for (size_t i = 0; i < n; i++) if (!((id[i] >= 'a' && id[i] <= 'z') || (id[i] >= '0' && id[i] <= '9') || id[i] == '-')) return 0;
  return 1;
}
/* Starts one more worker if jobs are pending and the pool is below its size. */
static void evj_grow(void) {   /* EVJ_MU held */
  int pending = 0; for (int i = 0; i < EVJ_SLOTS; i++) pending += EVJ[i].used && EVJ[i].status == EVJ_PENDING;
  while (pending > 0 && EVJ_STARTED < EVJ_WORKERS && EVJ_STARTED - EVJ_RUNNING < pending) {
    static int injected = 0;
    if (getenv("EIGHTMAX_TEST_FAIL_EV_WORKER") && !injected) { injected = 1; EVJ_START_FAILURES++; break; }
    if (launch_thread(evj_worker, NULL, 8 << 20)) { EVJ_START_FAILURES++; break; }
    EVJ_STARTED++; EVJ_STARTS++;
  }
}
/* 4.1: checked extraction of an integer job field. 4.0 converted the JSON double
   with (long long)f->num BEFORE validation, which is undefined behaviour for
   values such as 1e300 (UBSan: float-cast-overflow). The request has already
   passed mw_eval_validate() when this runs, but the conversion is checked here
   as well so that the job table can never hold a value that was not
   representable and in range. Returns 0 and stores *out (the default when
   the field is absent), or writes a message and returns -1. */
static int evj_field(const char *body, size_t blen, const char *name, long long lo, long long hi, long long def, long long *out, char *msg, size_t msgn) {
  char e[64]; JV *v = json_parse(body, blen, e, sizeof e);
  if (!v || v->type != J_OBJ) { if (v) json_free(v); snprintf(msg, msgn, "The request must be a JSON object"); return -1; }
  const JV *f = jget(v, name); int rc = EM_NUM_MISSING;
  if (f && f->type == J_NULL) rc = EM_NUM_TYPE; else rc = em_jv_i64(f, lo, hi, out);
  if (rc == EM_NUM_MISSING) { *out = def; rc = EM_NUM_OK; }
  if (rc != EM_NUM_OK) em_num_msg(msg, msgn, name, rc, (double)lo, (double)hi, 1);
  json_free(v); return rc == EM_NUM_OK ? 0 : -1;
}
/* Returns 1 when the route was handled. r = path after "/api/mw/". */
static int ev_jobs_api(sock_t s, const char *method, const char *r, const char *body, size_t blen) {
  if (strncmp(r, "jobs", 4) || (r[4] && r[4] != '/')) return 0;
  const int post = !strcmp(method, "POST"), get = !strcmp(method, "GET");
  const char *rest = r[4] ? r + 5 : "";
  pthread_mutex_lock(&EVJ_MU); evj_defaults(); pthread_mutex_unlock(&EVJ_MU);
  if (!*rest && get) {
    JB b; jb_init(&b); pthread_mutex_lock(&EVJ_MU);
    jb_puts(&b, "{\"config\":"); evj_config_json(&b); jb_puts(&b, ",\"jobs\":[");
    int first = 1;
    for (unsigned long long seq = 0, done = 0; !done;) {   /* list by submission order */
      EvJob *next = NULL; for (int i = 0; i < EVJ_SLOTS; i++) if (EVJ[i].used && EVJ[i].seq > seq && (!next || EVJ[i].seq < next->seq)) next = &EVJ[i];
      if (!next) { done = 1; break; }
      if (!first) jb_putc(&b, ','); first = 0; evj_json(&b, next, 0); seq = next->seq;
    }
    jb_puts(&b, "]}"); pthread_mutex_unlock(&EVJ_MU); respond_json(s, 200, &b); jb_free(&b); return 1;
  }
  if (!strcmp(rest, "config")) {
    if (post) {
      char e[128]; JV *v = json_parse(body && blen ? body : "{}", body && blen ? blen : 2, e, sizeof e);
      if (!v || v->type != J_OBJ) { if (v) json_free(v); respond_err(s, 400, "The request must be a JSON object"); return 1; }
      const JV *w = jget(v, "workers"), *t = jget(v, "threadsPerJob"), *p = jget(v, "memoryPoolMiB");
      for (int i = 0; i < v->n; i++) if (strcmp(v->keys[i], "workers") && strcmp(v->keys[i], "threadsPerJob") && strcmp(v->keys[i], "memoryPoolMiB")) { json_free(v); respond_err(s, 400, "Unknown field"); return 1; }
      /* 4.1: checked conversions (4.0 tested floor(x)==x, which is true for
         infinities, and then cast). */
      int wv = 0, tv = 0; long long pv = 0;
      const int rw = em_jv_int(w, 1, EVJ_MAX_WORKERS, &wv), rt = em_jv_int(t, 1, 64, &tv), rp = em_jv_i64(p, 64, 16384, &pv);
      if ((rw != EM_NUM_OK && rw != EM_NUM_MISSING) || (rt != EM_NUM_OK && rt != EM_NUM_MISSING) || (rp != EM_NUM_OK && rp != EM_NUM_MISSING)) {
        json_free(v); respond_err(s, 400, "workers must be 1-8, threadsPerJob 1-64, memoryPoolMiB 64-16384 (integers)"); return 1;
      }
      pthread_mutex_lock(&EVJ_MU);
      if (w) EVJ_WORKERS = wv;
      if (t) { EVJ_THREADS = tv; if (EVJ_THREADS > LOGICAL_CPUS) EVJ_THREADS = LOGICAL_CPUS; mw_set_eval_threads(EVJ_THREADS); }
      if (p) { double avail = available_memory_mib(); long long cap = avail > 0 && avail < 1e12 ? (long long)(avail / 2) : 1024; EVJ_POOL_MIB = pv > cap ? cap : pv; }
      evj_grow(); pthread_cond_broadcast(&EVJ_CV);
      pthread_mutex_unlock(&EVJ_MU); json_free(v);
    } else if (!get) { respond_err(s, 404, "Not found"); return 1; }
    JB b; jb_init(&b); pthread_mutex_lock(&EVJ_MU); evj_config_json(&b); pthread_mutex_unlock(&EVJ_MU); respond_json(s, 200, &b); jb_free(&b); return 1;
  }
  if (post && (!strcmp(rest, "ev") || !strcmp(rest, "response-gain"))) {
    const int kind = !strcmp(rest, "ev") ? 0 : 1; char err[512] = "";
    if (!body || !blen) { respond_err(s, 400, "The request must be a JSON object"); return 1; }
    if (blen > 65536) { respond_err(s, 413, "The request exceeds 64 KiB"); return 1; }
    /* Validate now (schema, path, hands, identifiers, numeric ranges) as a
       short-lived reader, BEFORE any field is converted (4.1). */
    pthread_mutex_lock(&MW_MU);
    if (!MWG || MW_RUNNING || MW_RESTORING) { pthread_mutex_unlock(&MW_MU); respond_err(s, 409, MWG ? "Stop training before evaluating the study" : "Open a native study first"); return 1; }
    MW *m = MWG; MW_READERS++; const unsigned long long gen = MW_GEN; pthread_mutex_unlock(&MW_MU);
    const int rc = mw_eval_validate(m, kind, body, blen, err, sizeof err);
    JB info; jb_init(&info); mw_info(m, &info);
    pthread_mutex_lock(&MW_MU); MW_READERS--; pthread_mutex_unlock(&MW_MU);
    if (rc != 200) { jb_free(&info); respond_err(s, rc, err[0] ? err : "Invalid request"); return 1; }
    long long mem = 0, lim = 0, cov = 0; char nmsg[200];
    /* Same ranges and defaults as evParams() / the response-gain parser in action_ev.hpp. */
    if (evj_field(body, blen, "memoryMiB", 16, 4096, 512, &mem, nmsg, sizeof nmsg) ||
        evj_field(body, blen, "timeLimitMs", 100, 3600000, kind ? 120000 : 60000, &lim, nmsg, sizeof nmsg)) {
      jb_free(&info); respond_err(s, 400, nmsg); return 1;
    }
    /* 4.5: the coverage budget is memory too. 4.0-4.4 charged only memoryMiB to the pool, so two jobs
     * with coverageMiB 4096 could hold 8 GiB that the pool never saw. The job is now charged
     * memoryMiB + coverageMiB (coverageMiB defaults to clamp(memoryMiB / 4, 4, 64), as in action_ev.hpp). */
    { const long long dcov = mem / 4 < 4 ? 4 : mem / 4 > 64 ? 64 : mem / 4;
      if (evj_field(body, blen, "coverageMiB", 1, 4096, dcov, &cov, nmsg, sizeof nmsg)) { jb_free(&info); respond_err(s, 400, nmsg); return 1; } }
    char study[96] = "";
    { char e[64]; JV *iv = info.failed ? NULL : json_parse(info.s, info.n, e, sizeof e); if (iv) { const char *sid = jstr(jget(iv, "studyId")); if (sid) snprintf(study, sizeof study, "%s", sid); json_free(iv); } }
    jb_free(&info);
    pthread_mutex_lock(&EVJ_MU);
    if (mem + cov > EML_BUDGET_MIB) { pthread_mutex_unlock(&EVJ_MU); char msg[200]; snprintf(msg, sizeof msg, "memoryMiB %lld + coverageMiB %lld exceeds the process memory budget (%lld MiB)", mem, cov, EML_BUDGET_MIB); respond_err(s, 413, msg); return 1; }
    if (mem + cov > EVJ_POOL_MIB) { pthread_mutex_unlock(&EVJ_MU); char msg[200]; snprintf(msg, sizeof msg, "memoryMiB %lld + coverageMiB %lld exceeds the evaluation memory pool (%lld MiB)", mem, cov, EVJ_POOL_MIB); respond_err(s, 413, msg); return 1; }
    int pending = 0, slot = -1; for (int i = 0; i < EVJ_SLOTS; i++) { pending += EVJ[i].used && EVJ[i].status == EVJ_PENDING; if (!EVJ[i].used && slot < 0) slot = i; }
    if (pending >= EVJ_QUEUE_LIMIT) { pthread_mutex_unlock(&EVJ_MU); respond_err(s, 503, "The evaluation queue is full; wait for jobs to finish or cancel some"); return 1; }
    if (slot < 0) {   /* evict the oldest finished job */
      for (int i = 0; i < EVJ_SLOTS; i++) if (evj_finished(&EVJ[i]) && (slot < 0 || EVJ[i].seq < EVJ[slot].seq)) slot = i;
      if (slot < 0) { pthread_mutex_unlock(&EVJ_MU); respond_err(s, 503, "Too many active evaluation jobs"); return 1; }
      evj_free(&EVJ[slot]);
    }
    EvJob *j = &EVJ[slot]; memset(j, 0, sizeof *j);
    j->body = (char *)malloc(blen + 1); j->task = mw_eval_task_new();
    if (!j->body || !j->task) { free(j->body); if (j->task) mw_eval_task_free(j->task); memset(j, 0, sizeof *j); pthread_mutex_unlock(&EVJ_MU); respond_err(s, 503, "Out of memory"); return 1; }
    memcpy(j->body, body, blen); j->body[blen] = 0; j->blen = blen;
    j->used = 1; j->kind = kind; j->status = EVJ_PENDING; j->seq = ++EVJ_SEQ; j->gen = gen; j->memoryMiB = mem; j->coverageMiB = cov; j->chargedMiB = mem + cov; j->timeLimitMs = lim;
    snprintf(j->id, sizeof j->id, "%s-%08x-%llu", kind ? "rg" : "ev", EVJ_BOOT, j->seq); snprintf(j->study, sizeof j->study, "%s", study);
    j->created = now_s(); j->createdUnix = (long long)time(NULL);
    evj_grow();
    if (!EVJ_STARTED) { evj_free(j); pthread_mutex_unlock(&EVJ_MU); respond_err(s, 503, "Could not start an evaluation worker thread"); return 1; }
    pthread_cond_broadcast(&EVJ_CV);
    JB b; jb_init(&b); evj_json(&b, j, 0); pthread_mutex_unlock(&EVJ_MU);
    respond_json(s, 202, &b); jb_free(&b); return 1;
  }
  /* jobs/<id>[/result|/cancel|/release] */
  char id[48] = ""; const char *slash = strchr(rest, '/'); size_t idn = slash ? (size_t)(slash - rest) : strlen(rest);
  if (idn >= sizeof id) { respond_err(s, 404, "Unknown job"); return 1; }
  memcpy(id, rest, idn); id[idn] = 0; const char *action = slash ? slash + 1 : "";
  if (!evj_valid_id(id)) { respond_err(s, 404, "Unknown job"); return 1; }
  pthread_mutex_lock(&EVJ_MU);
  EvJob *j = evj_find(id);
  if (!j) { pthread_mutex_unlock(&EVJ_MU); respond_err(s, 404, "Unknown or released job"); return 1; }
  if (!*action && get) { JB b; jb_init(&b); evj_json(&b, j, 1); pthread_mutex_unlock(&EVJ_MU); respond_json(s, 200, &b); jb_free(&b); return 1; }
  if (!strcmp(action, "result") && get) {
    if (j->status != EVJ_COMPLETED || !j->hasResult) { char msg[160]; snprintf(msg, sizeof msg, "No result: the job is %s", EVJ_STATUS[j->status]); pthread_mutex_unlock(&EVJ_MU); respond_err(s, 409, msg); return 1; }
    /* copy, then send without holding the job lock */
    char *copy = (char *)malloc(j->result.n ? j->result.n : 1); const size_t n = j->result.n;
    if (copy) memcpy(copy, j->result.s, n);
    pthread_mutex_unlock(&EVJ_MU);
    if (!copy) { respond_err(s, 503, "Out of memory"); return 1; }
    respond(s, 200, "application/json; charset=utf-8", copy, n); free(copy); return 1;
  }
  if (!strcmp(action, "cancel") && post) {
    if (j->status == EVJ_PENDING) { j->status = EVJ_CANCELLED; j->cancelRequested = 1; j->finished = now_s(); j->http = 409; snprintf(j->error, sizeof j->error, "Cancelled before it started"); }
    else if (j->status == EVJ_RUN) { j->cancelRequested = 1; mw_eval_cancel(j->task); }
    JB b; jb_init(&b); evj_json(&b, j, 0); pthread_mutex_unlock(&EVJ_MU); respond_json(s, 200, &b); jb_free(&b); return 1;
  }
  if (!strcmp(action, "release") && post) {
    if (j->status == EVJ_RUN || j->status == EVJ_PENDING) { pthread_mutex_unlock(&EVJ_MU); respond_err(s, 409, "Cancel the job before releasing it"); return 1; }
    evj_free(j); pthread_mutex_unlock(&EVJ_MU); respond_ok(s); return 1;
  }
  pthread_mutex_unlock(&EVJ_MU); respond_err(s, 404, "Not found"); return 1;
}
