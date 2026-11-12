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
#ifdef __cplusplus
}
#endif
#endif
