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
void mw_info(MW *m, JB *out);
// 3.1: CUDA device probe (availability, reason, name, compute capability, VRAM).
void mw_cuda_info(JB *out);
// 3.1: exact multiway all-in equity by complete board enumeration on the CPU,
// the GPU, or both (with an exact integer comparison). See MW-PROTOCOL.md.
int mw_equity(const char *json, size_t len, JB *out, char *err, int errlen);
#ifdef __cplusplus
}
#endif
#endif
