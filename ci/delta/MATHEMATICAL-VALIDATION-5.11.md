# EightMax 5.11: mathematical validation of the training streams

5.11 changes one thing in the trainer: where its random numbers come from. This document states what is **proven**
about that, what is **tested**, and what is **neither**. Convergence is a separate question with its own document
(CONVERGENCE-5.11.md). Evidence files are under `validation/5.11/`.

| Class | Meaning here |
|---|---|
| proven | follows from arithmetic or from a proof written out below; a test of it is a check of the implementation, not of the statement |
| tested | observed by the program's own tests, an independent implementation, or a recorded comparison |
| not established | stated as such; nothing in this release depends on it being true |

## 1. Summary

1. **Proven.** The training streams of 5.10 and earlier are segments of one cycle of 2^32 states. Per-deal action
   streams can start in the same state (then they are the same numbers again) and do so in counted cases; the single
   deal stream repeats after 2^32 draws, which 10,000,000 updates of 64 deals can exceed (section 2).
2. **Proven.** With `"trainingStreams":"philox64"`, no two random numbers of a training state come from the same
   generator input, for any number of updates, deals, threads, stops and continuations (section 4). The
   10,000,000-update limit therefore has no reason to apply to such a state.
3. **Tested.** The implementation is the published function (reference vectors, a second source text, an independent
   Python implementation), the address rule is the stated one, and real trainings hand the generator each counter
   exactly once (a counter audit of 240,263 generator calls in seven configurations, and of a state above update 2^32).
4. **Not established, by this or any release.** That the numbers behave as independent uniform variables: this is the
   empirical record of Philox4x64-10 (its authors' BigCrush results), and the assumption of every sampling statement
   of the program. Anything relating two different seeds.
5. **Unchanged, tested byte for byte.** A spec without the new key trains with the 5.10 streams and writes the 5.10
   states (section 6).

## 2. The streams of 5.10 and earlier

The generator (`struct Rng`, `native/mw.cpp`; `randomStream`, `web/lib_wide.js`) keeps a 32-bit state `s`. One draw is
`s <- s + C (mod 2^32)`, `C = 0x6d2b79f5`, followed by a hash of `s`. `C` is odd, so the map is a single cycle through
all 2^32 states: **every stream is a walk along the same cycle and is identified by where it starts.** Writing
`p(s) = s * C^-1 (mod 2^32)` for the position of a state on the cycle (`C^-1 = 0xdc58aa5d`), a stream that starts in
state `s` and draws `n` numbers uses positions `p(s)+1 ... p(s)+n`, and two streams share numbers exactly when these
intervals intersect.

* **Deal stream.** One per training state, consumed in order. It repeats after 2^32 = 4,294,967,296 draws. A deal
  draws at least one number per seat, more for board cards and rejected hands. With one deal per update, 10,000,000
  updates stay far below one cycle - that is what the limit protected. With 64 deals per update a state may hold
  640,000,000 deals, and at seven or more draws a deal that is more than one cycle (2^32 / 7 = 613,566,756 deals).
* **"shared" action stream.** A second walk on the same cycle, starting at `seed ^ 0x7138ab94`. The deal stream of
  seed 101 reaches the action stream's starting position after 195,119,580 draws; over the seeds 0 to 99,999 the
  smallest such distance is 11,001,124 draws (seed 528).
* **"deal" action streams** (frozen batches). Stream (update `t`, deal `d`) starts in
  `seed ^ ((t+1) * 0x9e3779b1) ^ ((d+1) * 0x85ebca6b) (mod 2^32)`. Nothing prevents two `(t, d)` from giving the same
  state, and nearby starting positions overlap. Counted for seed 101 (`tools/streams511_overlap.c`; arithmetic, no
  training; `validation/5.11/independent/streams510-overlap-seed101.json`):

| Updates of 64 deals | Streams | Identical to an earlier stream | Start fewer than 8 / 32 / 128 steps after another |
|---:|---:|---:|---:|
| 1,000 | 64,000 | 0 | 6 / 25 / 115 |
| 10,000 | 640,000 | 34 | 724 / 3,021 / 12,344 |
| 100,000 | 6,400,000 | 3,328 | 70,220 / 294,712 / 1,110,116 |
| 1,000,000 | 64,000,000 | 412,458 | 6,739,225 / 23,953,905 / 54,431,570 |
| 10,000,000 | 640,000,000 | 43,880,754 | not sorted at this size: one stream starts every 6.7 positions on average |

These counts are facts about the 5.10 streams. Whether they harm a training is an empirical question; the experiment
of CONVERGENCE-5.11.md includes the frozen-batch mode for that reason and reports what it found. Nothing here says
that results obtained with 5.10 were wrong.

## 3. The streams of 5.11 (`native/streams511.hpp`)

Philox4x64-10 (Salmon, Moraes, Dror & Shaw, "Parallel random numbers: as easy as 1, 2, 3", SC 2011) maps a 256-bit
counter and a 128-bit key to 256 bits. Every random number of a training has an **address**, and the address is the
counter:

```
key     = (trainingSeed, DOMAIN)     trainingSeed: 64 bits ("trainingSeed", or the spec's 32-bit actionSeed)
                                     DOMAIN: "EM511trn" for training; "EM511rs" + seat for the training of a response
counter = (j, t, d, purpose)         j = 0, 1, 2, ...: the j-th group of four numbers of the stream
   purpose 1  cards    the hands and board of deal d (position in the update, 0..63) of update t
   purpose 2  actions  the sampled actions of the traversals of that deal (all seats, in seat order)
   purpose 3  Latin    the permutation of seat d in epoch t (chanceSampling "latin")
number  = (word >> 11) * 2^-53       53 bits, uniform on the multiples of 2^-53 in [0, 1)   (5.10: 32 bits)
```

`t` is the number of committed updates before the update, a 64-bit integer. Each address field has a 64-bit counter
word of its own: nothing is packed, hashed or truncated.

## 4. The theorem

**Statement.** Fix a training state with philox64 streams (a seed and a domain). Let two random numbers be drawn at
any time in the life of that state - in any update, by any thread, before or after any number of stops,
continuations, saves and restores. If their addresses `(purpose, t, d, j)` differ, they are words of the generator's
output for two different inputs, and those two 256-bit outputs are different. Every address is drawn for one purpose
only, and a stream cannot end or wrap.

**Proof.**

1. *The generator is a bijection of the counter for a fixed key.* One round maps `(c0, c1, c2, c3)` to
   `(hi(M1*c2) ^ c1 ^ k0, lo(M1*c2), hi(M0*c0) ^ c3 ^ k1, lo(M0*c0))`. `M0` and `M1` are odd, hence invertible modulo
   2^64: from the second and fourth output words, `c2 = lo(M1*c2) * M1^-1` and `c0 = lo(M0*c0) * M0^-1`; then `c1` and
   `c3` follow by exclusive or with known values. A round is therefore invertible, and so is the composition of ten
   rounds (the key schedule adds constants to the key and does not depend on the counter).
2. *The address is the counter.* The map `(purpose, t, d, j) -> (j, t, d, purpose)` is a permutation of four 64-bit
   words: injective. With 1, different addresses give different 256-bit outputs.
3. *Each address is used for one thing.* Cards of deal `d` of update `t` are drawn only by the deal sampler when it
   prepares that deal; actions only by the traversal of that deal (one thread traverses a deal; its seats run in
   order); a Latin permutation only by `latinPrepare(epoch)`. The code sets the address at exactly these three places
   (`MW::deal`, the three traversal call sites of `es::train`, `latinPrepare`).
4. *Time.* `t` is the committed update count. It only increases, and it increases when an update is committed. A
   stopped, saved and continued training resumes with the committed `t`, so it continues with addresses that were
   never used. An update that is rolled back (a table limit) was not committed: if it is repeated, it is repeated
   with the same `t` and the same numbers. That is the same computation again, not a second use of the numbers for
   something else. A Latin permutation recomputed after a restore is likewise the same permutation.
5. *No end.* `j` is a 64-bit counter; the program aborts rather than let it wrap (2^64 groups of one stream).
6. *Response training* (5.8/5.9) of a philox64 state uses the key `(response seed, "EM511rs" + seat)`: another key
   domain, so its streams are not addressed in the training's key at all. (Two keys are two bijections; that their
   outputs are unrelated is part of what is not established, item 4 of section 1 - exactly as for two seeds.) **End.**

**Consequences.** There is no cycle to overlap on and no birthday bound inside a state; streams are pure functions of
`(seed, address)`, so a state stores no generator state (its header has none), a result cannot depend on the thread
count or on how many numbers another stream consumed, and stopping and continuing cannot change a number. The update
limit of such a state is set by exact integer arithmetic alone: `MW_MAX_UPDATES_WIDE = floor((2^53 - 1) / 64) =
140,737,488,355,327`, so that the deal count at 64 deals per update stays an exact integer of a JSON number.

**What keeps a limit of 10,000,000.** States of the 5.10 streams (rule: a state continues under the rules that made
it). DCFR weighting, whose per-row discount counters are 32-bit. The interactive multiway panel of the desktop
application, which hands states between the JavaScript engine and the native one and therefore uses the 5.10
streams. The training of a response (its own request bound, unchanged).

## 5. Tests of the implementation

| Check | What it shows | Where |
|---|---|---|
| G1 | the three known-answer vectors of the reference implementation (Random123) | `mwcli --selftest511 ... streams` |
| G2 | the same 256 bits as the 5.9 evaluation generator for 100,000 random counters and keys (two source texts) | same |
| G3 | the map inverted in both directions for 100,000 random inputs; `M0`, `M1` odd, inverses exact | same |
| A1 | stream `(purpose, t, d)` draws `Philox((j, t, d, purpose), (seed, domain))`, up to the largest update index (40,000 numbers) | same |
| A2 | 25,344 blocks of a grid of addresses around 10,000,000, 2^32 and the largest update index, three key domains: all different | same |
| N1 | a million numbers: in [0, 1), on the 2^-53 grid, mean and variance within 4.5 standard errors | same |
| L1 | a stream without an address still draws the numbers of the 5.10 generator (values from the JavaScript reference) | same |
| **U1** | **counter audit:** every 256-bit counter handed to the generator in seven real trainings (one deal per update; frozen batches on three threads; ICM; preflop; six players with rbes; Latin deals; Compact groups) recorded: 240,263 counters, none twice, no gap in any stream, every one a valid address, one card stream per sampled deal | same |
| U2 | the same for a state that starts at update 4,294,967,303 and is trained in two calls | same |
| K, B, S | **independent implementation** in Python integers, written from the definition: reference vectors; inverse; 11,100 numbers of 300 random addresses equal to the program's, bit for bit | `tools/independent_streams511.py`, `validation/5.11/independent/` |
| W1-W3, L2, L3 | determinism across threads and platforms: recorded SHA-256 of 15 states and of two long states (10,000,200 updates; update index above 2^32) | `mwcli --selftest511 ... training / limits` |

U1 and U2 are observations of the theorem's premise 3 (the code addresses the streams as stated): if a call site used
a wrong or repeated address, the audit would show a duplicate, a gap or an invalid counter. They are not a proof that
no other call site exists; that is by inspection of the three places named in the proof.

## 6. The 5.10 streams are untouched

A spec without `"trainingStreams"`, or with `"trainingStreams":"5.10"`, takes the 5.10 code path: the same arithmetic
in the same order (the only change in that path is a predicted branch in `Rng::next` and in the traversal call sites).
Tested: `--selftest510` D1 and `--selftest511` D1 (14 states against the SHA-256 recorded from the unchanged 5.9
program, with and without the explicit key); `tools/identity57.py` with the unchanged 5.10 program against this build
(thread counts, trainer options, hand groups, table limits); the experiment's identity arm (CONVERGENCE-5.11.md);
the golden states of 5.7 in the Windows script. A 5.10 state loads and continues to the bytes 5.10 would write, with
the 5.10 limit.

## 7. Checkpoint identity

A philox64 state names its streams and seed in the header (`"trainingStreams":"streams-5.11-philox4x64-v1"`,
`"trainingSeed"`), carries **no** `"rng"` / `"actionRng"`, and has a study identifier derived from the spec's and the
algorithm identifier. Rules, each tested (`--selftest511` C1-C3, `tests/v511.test.js`):

* a 5.10 state is refused by a philox64 engine and a philox64 state by a 5.10 engine, with the reason, exit 1, nothing written;
* a philox64 state continues only under the seed that trained it (the streams are a function of the seed);
* **the unchanged 5.10 program refuses a philox64 state** (run with the 5.10 Linux binary): by the study identifier,
  and, were that ever equal, by the two header fields it requires and does not find;
* a header that names philox64 and also carries a 32-bit generator state was not written by this program and is refused.

## 8. Not established, in one place

* statistical quality of the numbers beyond the reference record and the moment check (N1);
* independence between seeds, and between the training key domain and a response key domain;
* that no training of practical size was harmed by the coincidences of section 2 (see CONVERGENCE-5.11.md for what
  was measured);
* anything about the user's Windows PC and GPU: the Windows programs were executed under Wine and on a hosted Windows
  runner (VALIDATION-5.11.md), not on the target hardware. The recorded states make that a byte comparison there.
