/* EightMax 4.6: process-wide memory reservation ledger of the desktop host.
 *
 * Before 4.6 the host had independent allowances that never saw each other: the
 * open study's table budget, a background-job pool, and each foreground
 * evaluation's own memoryMiB/coverageMiB. A restored study, a foreground
 * evaluation and two background jobs could all take their full allowance at the
 * same time. Every large GOVERNED allocation now reserves from one budget first;
 * a reservation that does not fit is refused (HTTP 503, or a background job
 * waits in its queue) and nothing is allocated.
 *
 * Governed (each is enforced inside the engine by its own byte accounting, and
 * that allowance is what is reserved here):
 *   tables   the open native study: regret/average tables, betting states, row
 *            index, training scratch (es::train sizes workers within budgetBytes)
 *   restore  a study being restored from a checkpoint (coexists with the open one)
 *   eval     synchronous action-EV / response-gain requests: memoryMiB + coverageMiB
 *   jobs     running background evaluation jobs: memoryMiB + coverageMiB
 * NOT governed (measured, not reserved): allocator overhead and fragmentation,
 * thread stacks, the embedded user interface and HTTP buffers, the QuickJS
 * checkpoint verifier, the CUDA driver and its pinned host buffers (device memory
 * is bounded separately by gpuMiB), the legacy river solver (bounded by
 * PROCESS_LIMIT_MIB checks against resident memory), and the browser.
 * Therefore this is a ceiling on governed reservations, not on resident memory;
 * GET /api/mw/memory reports both, with the operating system's working-set and
 * peak working-set figures.
 *
 * Budget: EIGHTMAX_PROCESS_MIB (64-32768; default 6144, never above the
 * application limit min(RAM/2, 8192)) minus a 256 MiB allowance for the
 * ungoverned items. EIGHTMAX_LEDGER_MIB overrides the governed budget directly
 * (16-65536; tests use it to create memory pressure). */
#pragma once
enum { EML_TABLES, EML_RESTORE, EML_EVAL, EML_JOBS, EML_KINDS };
static const char *const EML_NAMES[EML_KINDS] = {"tables", "restore", "eval", "jobs"};
static pthread_mutex_t EML_MU = PTHREAD_MUTEX_INITIALIZER;
static long long EML_BUDGET_MIB = 0, EML_TOTAL_MIB = 0, EML_PEAK_MIB = 0;
static long long EML_HELD[EML_KINDS], EML_PEAK_KIND[EML_KINDS], EML_GRANTS[EML_KINDS], EML_REFUSALS[EML_KINDS];
static char EML_LAST_REFUSAL[256];
static long long MW_TABLE_RESERVED_MIB = 0;   /* the open study's reservation (guarded by MW_MU) */

static void eml_init(long processLimitMiB) {
  long long b = (long long)processLimitMiB - 256; if (b < 32) b = 32;
  const char *o = getenv("EIGHTMAX_LEDGER_MIB");
  if (o) { char *end = NULL; long v = strtol(o, &end, 10); if (end != o && !*end && v >= 16 && v <= 65536) b = v; }
  EML_BUDGET_MIB = b;
}
/* Adjust a reservation of `kind` from `held` MiB to at most `want` MiB, atomically.
 * Returns the granted MiB (>= minMib), or -1 with nothing changed when even minMib
 * does not fit. Overflow-safe: all values are clamped to [0, 2^40). */
static long long eml_resize(int kind, long long held, long long want, long long minMib, char *why, size_t whyLen) {
  if (held < 0) held = 0; if (want < 0) want = 0; if (minMib < 0) minMib = 0;
  if (want > (1LL << 40)) want = 1LL << 40; if (minMib > want) minMib = want;
  pthread_mutex_lock(&EML_MU);
  const long long freeMib = EML_BUDGET_MIB - EML_TOTAL_MIB + held;
  long long grant = want < freeMib ? want : freeMib;
  if (grant < minMib || grant < 0) {
    EML_REFUSALS[kind]++;
    snprintf(EML_LAST_REFUSAL, sizeof EML_LAST_REFUSAL, "%s: %lld MiB requested, %lld MiB free of the %lld MiB process budget (tables %lld, restore %lld, eval %lld, jobs %lld)",
             EML_NAMES[kind], minMib, freeMib < 0 ? 0 : freeMib, EML_BUDGET_MIB, EML_HELD[EML_TABLES], EML_HELD[EML_RESTORE], EML_HELD[EML_EVAL], EML_HELD[EML_JOBS]);
    if (why && whyLen) snprintf(why, whyLen, "Process memory budget: %s. Close the open study, cancel evaluations, lower memoryMiB/coverageMiB or raise EIGHTMAX_PROCESS_MIB.", EML_LAST_REFUSAL);
    pthread_mutex_unlock(&EML_MU); return -1;
  }
  EML_TOTAL_MIB += grant - held; EML_HELD[kind] += grant - held; EML_GRANTS[kind]++;
  if (EML_TOTAL_MIB > EML_PEAK_MIB) EML_PEAK_MIB = EML_TOTAL_MIB;
  if (EML_HELD[kind] > EML_PEAK_KIND[kind]) EML_PEAK_KIND[kind] = EML_HELD[kind];
  pthread_mutex_unlock(&EML_MU);
  return grant;
}
static int eml_reserve(int kind, long long mib, char *why, size_t whyLen) { return eml_resize(kind, 0, mib, mib, why, whyLen) >= 0; }
static void eml_release(int kind, long long mib) {
  if (mib <= 0) return;
  pthread_mutex_lock(&EML_MU); EML_TOTAL_MIB -= mib; EML_HELD[kind] -= mib; pthread_mutex_unlock(&EML_MU);
}
/* move a reservation between kinds (restore -> tables after a successful restore) */
static void eml_move(int from, int to, long long mib) {
  pthread_mutex_lock(&EML_MU); EML_HELD[from] -= mib; EML_HELD[to] += mib;
  if (EML_HELD[to] > EML_PEAK_KIND[to]) EML_PEAK_KIND[to] = EML_HELD[to]; pthread_mutex_unlock(&EML_MU);
}
static double peak_resident_mib(void) {
#ifdef _WIN32
  PROCESS_MEMORY_COUNTERS pm;
  if (GetProcessMemoryInfo(GetCurrentProcess(), &pm, sizeof(pm))) return pm.PeakWorkingSetSize / 1048576.0;
#else
  FILE *f = fopen("/proc/self/status", "r"); char line[160]; long kib = -1;
  if (f) { while (fgets(line, sizeof line, f)) if (sscanf(line, "VmHWM: %ld kB", &kib) == 1) break; fclose(f); }
  if (kib >= 0) return kib / 1024.0;
#endif
  return -1;
}
static double resident_mib(void);
static void eml_json(JB *b) {
  pthread_mutex_lock(&EML_MU);
  jb_printf(b, "{\"semantics\":\"governed reservations (tables, restore, eval, jobs) never exceed budgetMiB; resident memory also includes ungoverned items (allocator overhead, thread stacks, interface and HTTP buffers, checkpoint verifier, CUDA driver and pinned buffers)\",\"budgetMiB\":%lld,\"reservedMiB\":%lld,\"peakReservedMiB\":%lld,\"freeMiB\":%lld,\"withinBudget\":%s,\"kinds\":{",
            EML_BUDGET_MIB, EML_TOTAL_MIB, EML_PEAK_MIB, EML_BUDGET_MIB - EML_TOTAL_MIB, EML_PEAK_MIB <= EML_BUDGET_MIB ? "true" : "false");
  for (int k = 0; k < EML_KINDS; k++) jb_printf(b, "%s\"%s\":{\"reservedMiB\":%lld,\"peakMiB\":%lld,\"grants\":%lld,\"refusals\":%lld}", k ? "," : "", EML_NAMES[k], EML_HELD[k], EML_PEAK_KIND[k], EML_GRANTS[k], EML_REFUSALS[k]);
  jb_puts(b, "},\"lastRefusal\":"); jb_str(b, EML_LAST_REFUSAL);
  pthread_mutex_unlock(&EML_MU);
  jb_puts(b, ",\"process\":{\"residentMiB\":"); jb_num(b, resident_mib(), 1); jb_puts(b, ",\"peakResidentMiB\":"); jb_num(b, peak_resident_mib(), 1); jb_puts(b, "}}");
}
/* memoryMiB + coverageMiB of an evaluation request, with the engine's defaults
 * (action_ev.hpp: memoryMiB 16-4096 default 512; coverageMiB default clamp(memoryMiB/4, 4, 64)).
 * Out-of-range values are clamped here and refused by the engine's own validation. */
static long long eml_eval_mib(const char *body, size_t blen) {
  char e[64]; long long mem = 512, cov = -1;
  JV *v = body && blen ? json_parse(body, blen, e, sizeof e) : NULL;
  if (v && v->type == J_OBJ) {
    const JV *m = jget(v, "memoryMiB"), *c = jget(v, "coverageMiB");
    if (m && m->type == J_NUM && m->num >= 16 && m->num <= 4096) mem = (long long)m->num;
    if (c && c->type == J_NUM && c->num >= 1 && c->num <= 4096) cov = (long long)c->num;
  }
  if (v) json_free(v);
  if (cov < 0) { cov = mem / 4; if (cov < 4) cov = 4; if (cov > 64) cov = 64; }
  return mem + cov;
}
