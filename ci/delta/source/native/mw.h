#ifndef EM_MW_H
#define EM_MW_H
// Native multiway sampled-CFR training engine (C++20, C interface).
//
// The JavaScript application builds the betting tree, ranges and settings
// (lib_wide.js nativeSpec()) and remains the reference implementation, the
// evaluator and the user interface. This engine trains the same game with the
// same random stream, deal sampler, arithmetic order and frozen-batch rules, so
// with equal settings it produces the same regrets and averages as JavaScript.
// Protocol: see source/native/MW-PROTOCOL.md (spec version 1, state format EMMW1).
#include <stddef.h>
#include <stdio.h>
#include <stdint.h>
#include "json.h"
#ifdef __cplusplus
extern "C" {
#endif
#define MW_PROTOCOL 1
// The largest number of committed training updates of one engine state. One update is batchDeals sampled deals
// (1 to 64), so a state holds at most 10,000,000 x batchDeals sampled deals. The bound is not arbitrary: the deal
// stream and the shared action stream are 32-bit generators with 2^32 states on one cycle; the default trainer
// (one deal per update) stays inside one cycle at this limit, and a larger limit would need a different generator,
// that is, different training states and a different checkpoint header (MATHEMATICAL-VALIDATION-5.8.md, section 5).
// Every entry point checks a request against this bound BEFORE it trains anything.
#define MW_MAX_UPDATES 10000000LL
// 5.11: a protocol-4 spec with "trainingStreams":"philox64" trains with counter-based 64-bit streams
// (streams511.hpp): every random number has an address that is used once, for any number of updates, so the bound
// above does not apply to such a state. Its bound keeps 64 deals per update an exact integer below 2^53
// (floor((2^53 - 1) / 64)). DCFR weighting keeps MW_MAX_UPDATES (its per-row discount counters are 32-bit).
// A spec without the key, and every state trained by 5.10 or earlier, keeps the 5.10 streams and MW_MAX_UPDATES.
#define MW_MAX_UPDATES_WIDE 140737488355327LL
#define MW_STREAMS511 "streams-5.11-philox4x64-v1"
typedef struct MW MW;
// Builds an engine from a JSON spec. memoryMiB caps the strategy tables (regrets,
// averages, batch scratch); a spec whose estimated tables exceed it is refused.
MW *mw_create(const char *json, size_t len, double memoryMiB, char *err, int errlen);
void mw_free(MW *m);
// A streamed restore owns a new engine until the final integrity check succeeds.
// Pass -1 for expectedUpdates only for a standalone raw EMMW4 file.
int mw_load_stream(FILE *, uint64_t, const char *spec, double budgetMiB,
                   int expectedUpdates, MW **candidate, char *error, int capacity,
                   int (*cancelled)(void), void (*progress)(uint64_t,uint64_t));
int mw_is_external(const MW *);
// 5.11: the largest number of committed updates this engine's state may hold (MW_MAX_UPDATES or MW_MAX_UPDATES_WIDE).
long long mw_max_updates(const MW *);
// 5.11: 1 when a study that does not choose its training streams uses the counter-based ones (study52.hpp).
int mw_study_default_wide(void);
// 5.11: checks of the counter-based training streams that have no command-line surface (known-answer vectors, the
// inverse map, the address rule). Writes {"checks":[{id,name,pass,detail}...],"passed":n,"failed":n}.
int mw_selftest511(JB *out);
// 5.11: the first `count` (1 to 4096) numbers of the training stream with the address (seed, domain, purpose, t, d),
// as 16 hexadecimal digits of the IEEE double each, plus the raw 64-bit words. domain 0 = training, 1 + seat = the
// response training of that seat. For tools/independent_streams511.py.
int mw_stream511(unsigned long long seed, int domain, int purpose, long long t, long long d, int count, JB *out);
// 5.11 (validation): from this call on, every 256-bit counter the engine hands to the generator is recorded;
// mw_streams511_audit_end writes {"blocks":n,"distinct":n,"duplicates":n,"byPurpose":{...},"outOfRange":n,...} and
// stops recording. Recording changes no number. Returns 0 for an engine of the 5.10 streams.
int mw_streams511_audit_begin(MW *m);
int mw_streams511_audit_end(MW *m, JB *out);
size_t mw_stream_size(MW *);
size_t mw_write_stream(MW *, FILE *, int (*cancelled)(void));

// Replaces the training state with a binary EMMW1 blob (resume from JavaScript or a checkpoint).
int mw_import(MW *m, const unsigned char *buf, size_t len, char *err, int errlen);
// Trains `iterations` updates (each batchDeals deals). threads >= 1. *stop is polled
// between updates. progress may be NULL. Returns 1 on success (including a stop or
// a memory-budget stop, see mw_info), 0 on error.
typedef void (*mw_progress_fn)(void *ctx, long long iterations, long long deals);
int mw_train(MW *m, long long iterations, int threads, volatile int *stop, mw_progress_fn progress, void *ctx, char *err, int errlen);
// Binary EMMW1 state: header JSON + rows. Caller frees *out with free().
size_t mw_export(MW *m, unsigned char **out);
// {"protocol","iterations","trainingDeals","stateVisits","rng","rows","tableMiB","limitReached","threads"}
void mw_root_policy(MW *m, JB *out);
// 3.8: strategy explorer. Request JSON {path:[action slots], board:[dealt cards],
// rangeSeat?, offset?, limit?}; writes one node's description and the stored
// strategies of its rows. Returns an HTTP-style status (200 on success) and
// sets err otherwise. *cancel is polled. See explorer.hpp.
int mw_node_query(MW *m, const char *json, size_t len, JB *out, char *err, int errlen, volatile int *cancel);
// 3.9: action-specific EVs at one decision node (action_ev.hpp). Request
// {path, board, hands:[acting-seat range indices], range?, policy?, missing?,
// method?, futureActions?, samples?, seed?, maxVisits?, timeLimitMs?,
// studyId?, stateId?}. Returns an HTTP-style status.
int mw_action_ev(MW *m, const char *json, size_t len, JB *out, char *err, int errlen, volatile int *cancel);
// 3.9: per-seat response gains (exact best response or sampled one-shot deviation).
int mw_response_gain(MW *m, const char *json, size_t len, JB *out, char *err, int errlen, volatile int *cancel);
/* 5.1: telemetry of the last evaluation request in this process, as a JSON object (deadline investigation). */
int mw_last_query_telemetry(char *buf, int len);
// 4.0: background evaluation tasks. A task carries the cancellation flag, the
// shared deadline/progress state and the result of one action-EV (kind 0) or
// response-gain (kind 1) request. mw_eval_run blocks (call it on a worker
// thread); mw_eval_progress and mw_eval_cancel may be called concurrently from
// any thread. The engine is only read: concurrent tasks and explorer queries
// are safe while no training, import, restore or free runs (the host enforces
// this with a reader count).
typedef struct MwEvalTask MwEvalTask;
MwEvalTask *mw_eval_task_new(void);
void mw_eval_task_free(MwEvalTask *);
void mw_eval_cancel(MwEvalTask *);
int mw_eval_run(MW *m, int kind, const char *json, size_t len, JB *out, char *err, int errlen, MwEvalTask *);
void mw_eval_progress(MwEvalTask *, JB *out);
// Validates a request (schema, path, hands, identifiers) without evaluating it.
int mw_eval_validate(MW *m, int kind, const char *json, size_t len, char *err, int errlen);
// Process-wide cap on evaluation worker threads per request (default: logical CPUs).
void mw_set_eval_threads(int cap);
int mw_eval_threads(void);
void mw_info(MW *m, JB *out);
// 3.1: CUDA device probe (availability, reason, name, compute capability, VRAM).
void mw_cuda_info(JB *out);
// 5.7: checks of the engine's own parts that changed in 5.7 and have no command-line surface: the card code
// against the 5.6 function (every flop, every order), the worker pool, the deal queue and the two measured
// choices (thread count, stage spreading) on synthetic workloads. Writes a JSON array of
// {"name","passed","detail"}; returns the number of failed checks. Used by mwcli --selftest57.
int mw_selftest57(JB *out);
// 4.3: CUDA lifecycle for evaluation tables. mw_gpu_prewarm starts the device
// open on a background thread (returns at once); mw_gpu_status writes the
// process-wide lifecycle counters as JSON; mw_ev_cache_clear drops cached
// action-EV results (benchmarks that repeat one request).
void mw_gpu_prewarm(void);
void mw_gpu_status(JB *out);
void mw_ev_cache_clear(MW *m);
// 4.4: IEEE 754 value-preservation probes (ieee_probe.hpp). mw_ieee_probe writes a
// table of doubles as {bits, value, text}; mw_ieee_verify parses such a document
// with the engine's JSON reader and reports the ULP distance of every parsed
// number from its stated bit pattern (200, or 400 for a malformed document).
void mw_ieee_probe(JB *out);
int mw_ieee_verify(const char *json, size_t len, JB *out, char *err, int errlen);
// 4.5: deterministic print/parse sweep over `count` doubles (ieee_probe.hpp). 1 = all round trips exact,
// -1 = at least one mismatch (details in the document), 0 = bad arguments.
int mw_ieee_sweep(JB *out, long long count, unsigned long long seed);
// 4.5: strtod replacement, correctly rounded on every platform (std::from_chars); out-of-range or
// unparsable input falls back to the C runtime's strtod semantics (HUGE_VAL / 0, *end).
double em_parse_double(const char *s, char **end);
// 3.1: exact multiway all-in equity by complete board enumeration on the CPU,
// the GPU, or both (with an exact integer comparison). See MW-PROTOCOL.md.
int mw_equity(const char *json, size_t len, JB *out, char *err, int errlen);
// 5.2: decision studies (study52.hpp). mw_study_run trains every variant of a study fixture for every seed
// through the fixture's sampled-deal budgets and evaluates the hero hand's action frequencies, action EVs and
// the quality of the surrounding strategy after each budget. options may be NULL (see study52.hpp). *stop is
// polled; progress (may be NULL) receives a small JSON object before every training step. Returns an
// HTTP-style status; the result document ("EightMax study result") is written to out.
// mw_study_identity sets the version and build recorded in results (the engine object is not stamped).
void mw_study_identity(const char *version, const char *build);
int mw_study_run(const char *fixture, size_t len, const char *options, size_t olen, JB *out, char *err, int errlen,
                 volatile int *stop, void (*progress)(void *, const char *), void *ctx);
// 5.8: trained response (response58.hpp): a lower bound of one seat's best-response gain for games too large for an
// exact best response. mw_response_begin {seat, seed} turns a LOADED TRAINING STATE into the response problem of one
// seat, in place (the other seats are frozen at their average strategies; the engine no longer holds a training
// state and must not be saved as one). mw_train then trains the response; mw_response_end finishes it: afterwards
// policy "average" of the state is (response, sigma of the others) and policy "current" is sigma, so the exact
// evaluators apply to it, and mw_response_value {samples, seed, threads, timeLimitMs, memoryMiB} estimates the gain
// of the response on deals independent of its training. All three return an HTTP-style status and write JSON.
// 5.9: mw_response_value also takes {streams: "5.9" | "5.8", alpha} and writes `randomStreams`, `statistics` and the
// one-sided distribution-free `lowerBound` of the seat (response59.hpp); every 5.8 field is still written.
int mw_response_begin(MW *m, const char *json, size_t len, JB *out, char *err, int errlen);
int mw_response_end(MW *m, JB *out, char *err, int errlen);
int mw_response_value(MW *m, const char *json, size_t len, JB *out, char *err, int errlen, volatile int *cancel);
// 5.8: checks of parts that have no command-line surface: the evaluation random-number generator against its
// published outputs, the distinctness of the block streams, and the ICM cache against the recursion (bit for bit,
// through hits and evictions) and against the finishing-order formula. Writes a JSON array of
// {"name","passed","detail"}; returns the number of failed checks. Used by mwcli --selftest58.
int mw_selftest58(JB *out);
// 5.9: checks of parts that have no command-line surface: the counter-based evaluation generator (Philox4x64-10)
// against its known-answer vectors, its inversion round by round (the bijection that partitions the streams), and the
// addressing of the streams. Same output convention as mw_selftest58. Used by mwcli --selftest59.
int mw_selftest59(JB *out);
// 5.9: the first `count` (1 to 4096) numbers of the evaluation stream with the address (seed, seat, block, purpose),
// for independent implementations. Returns 200, or 400 for an address outside the engine's ranges.
int mw_stream59(unsigned long long seed, int seat, long long block, int purpose, int count, JB *out);
// 5.10: exact check of the experimental RB-ES estimator (spec "estimator":"rbes") on the engine's current tables:
// for {deals, seed} sampled deals and every updating seat, the expectation of what one traversal writes, formed over
// EVERY outcome of its sampled opponent actions, against a brute-force walk of the whole betting tree for every
// compatible hand of the seat (es_rbes510_check.hpp). Writes a JSON object; returns an HTTP-style status. The tables,
// counters and random streams are left unchanged. Used by mwcli --selftest510 and tests/rbes510.cpp.
int mw_rbes_check(MW *m, const char *json, size_t len, JB *out, char *err, int errlen);
#ifdef __cplusplus
}
#endif
#endif
