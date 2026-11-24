# EightMax 5.9: what changed in the statistics of the trained-response measure

This document is for someone who reads the JSON that `mwcli --response` prints. It says which numbers are estimates,
which are normal-approximation bounds, which are confidence statements with a proof, what each statement is about, and
what happened to the 5.8 fields. Proofs and experiments are in MATHEMATICAL-VALIDATION-5.9.md; the code is
`source/native/response_stats59.hpp` (statistics), `response59.hpp` (evaluation) and `mwcli_response59.hpp` (output).

## 1. What was wrong in 5.8

5.8 printed, in the summary of a response analysis,

    "sumOfSeatLowerBounds95": the sum over the seats of max(0, mean_i - 1.645 * standardError_i)

and described it as "conservative" and "not itself a 95% statement about the sum". Two things are wrong with that
number as something to quote:

1. **Each term is a normal-approximation bound.** `mean - 1.645 SE` is a 95% lower bound only if the sample mean is
   approximately normal and the standard error is approximately right. With sampled opponent actions and strategies
   that take some actions with probability near 1e-5 it is neither: 5.8 itself measured 193 of 960 estimates more than
   four reported standard errors from the exact value on the eight-handed ICM game. 5.9 reproduced that count with the
   unchanged 5.8 program (MATHEMATICAL-VALIDATION-5.9.md, section 4.1).
2. **A sum of k separate 95% bounds is not a 95% bound of the sum.** Even with exact per-seat bounds, "all k hold" is
   only guaranteed with probability 1 - 0.05 k (60% for eight seats).

Nothing in 5.8 computed a wrong number. The field was easy to misread, and no field of the summary was a confidence
statement about the multiplayer total.

## 2. The three kinds of numbers, and where each one is

| Kind | Field (5.9) | What it is |
|---|---|---|
| estimate | `summary.sumOfSeatGains.mean` | the sum of the sample means of the seats' response gains. No confidence statement. `stdErr` and `ci95` beside it are normal approximations (said in `kind`). |
| estimate, per seat | `seats[i].sampled.gain.mean` | sample mean of the gain of that seat's response; `gain.stdErr`, `gain.ci95`: normal approximation (`ci95Kind`) |
| exact, per seat | `seats[i].exact.gain`, `.bestResponseGain` | only with `"exact": true` (small games): the exact gain of the same response and the exact best-response gain |
| normal-approximation bound | `summary.sumOfNormalApproximationLowerBounds95` | the 5.8 number under an explicit name: sum of max(0, mean - 1.645 SE). **Not a confidence statement about the sum.** |
| normal-approximation bound, per seat | `seats[i].sampled.bestResponseGainLowerBound.normal95` | unchanged from 5.8 |
| distribution-free interval, per seat | `seats[i].sampled.bounded` | unchanged from 5.8: two-sided 95% empirical-Bernstein interval of that one seat |
| **confidence statement, per seat** | `seats[i].sampled.lowerBound` | new: one-sided distribution-free lower bound at the seat's share of the family level |
| **confidence statement, all seats** | `summary.simultaneous` | new, **recommended**: a lower bound of the sum of response gains and of NashConv that holds for all seats at once |
| **confidence statement, pooled** | `summary.pooledIndependent` | new: a tighter bound for sums of several seats; additionally assumes independent seat evaluations |

## 3. The new fields

### 3.1 Request (`request.json` of `mwcli --response`)

| Field | Default | Meaning |
|---|---|---|
| `confidence` | 0.95 | familywise confidence of `summary.simultaneous` and of `summary.pooledIndependent` (0.5 to 0.999999) |
| `analyses` | 1 | number of PRESPECIFIED response analyses of this trained state (other response budgets or seeds) of which you will report the largest bound. The error probability is divided by it. |
| `evaluationSeed` | `seed` | seed of the evaluation streams. The response training uses `seed` only, so one response can be evaluated on other, independent deals. |
| `randomStreams` | `"5.9"` | `"5.9"`: counter-based Philox4x64-10 streams. `"5.8"`: the 5.8 streams (the estimate then has the bits 5.8 printed). |
| `threads` | (see text) | unchanged meaning. When it is absent, 5.9 evaluates on every logical processor (the result does not depend on the thread count); 5.8 used one. |

Top level of the result: `schema` (`"response-5.9"`), `confidence`, `analyses`, `perSeatAlpha`, `evaluationSeed`,
`randomStreams`, `evaluationThreads`. `tool` is now `"mwcli response 5.9"`.

### 3.2 Per seat: `seats[i].sampled`

    "statistics": { "samples", "mean", "sampleVariance", "sampleVarianceBits", "provenSampleRange",
                    "withinProvenRange", "sampleCountFixedInAdvance", "responseFixedBeforeEvaluation",
                    "identicallyDistributedEqualWeights" }
    "lowerBound": { "calculation": "response-5.9-eb-one-sided-v1", "method", "alpha", "confidence", "half",
                    "responseGain", "bestResponseGain", "calibrated", "reason", "reading" }
    "randomStreams": { "id", "method", "streamsPerBlock", "address", "partition", "independentOfResponseTraining" }
    "walk": { "version", "offsetIndex", "offsetIndexBytes", "offsetIndexNote", "valuesDependOnIt": false }

* `statistics` is the sample as the summary needs it: N, mean, unbiased sample variance, and the proven width W of the
  range of one sample (twice the width of the seat's utility range; `bounded.sampleRange` in 5.8).
* `lowerBound.responseGain` = `mean - half`, where
  `half = sqrt(2 V ln(2/alpha) / N) + 7 W ln(2/alpha) / (3 (N - 1))` (never more than W).
  With probability at least `confidence` = 1 - `alpha`, over the evaluation deals and for the response that was
  trained, the gain of this response is at least `responseGain`. It can be negative.
* `lowerBound.bestResponseGain` = `max(0, responseGain)`: the seat's best-response gain is at least the gain of any
  response and never negative (the seat may keep its strategy).
* `alpha` here is the seat's SHARE of the family level: `(1 - confidence) / analyses / seats`. For one seat alone at
  95% request that seat only (`"seats": [i]`).
* `calibrated` is false, with a `reason`, when a sample lay outside the proven range (`payoffBoundViolated`); no
  number is then given. This has never been observed.
* `calculation` of `sampled` is `"response-5.9-paired-v2"` with the 5.9 streams and `"response-5.8-paired-v1"` with
  the 5.8 streams.

### 3.3 `summary.simultaneous` (the statement to quote)

    "calculation": "response-5.9-simultaneous-union-v1", "recommended": true, "calibrated", "reason",
    "confidence", "alpha", "analyses", "alphaPerAnalysis",
    "family": { "size", "seats", "statement" }, "allocation": "equal: alpha / analyses / seats", "perSeatAlpha",
    "perSeatMethod", "dependenceBetweenSeats": "none assumed ...",
    "seats": [ { "seat", "evaluated", "alpha", "half", "responseGainLowerBound", "bestResponseGainLowerBound" } ],
    "complete", "sumOfResponseGainsLowerBound", "nashConvLowerBound", "nashConvLowerBoundUsesEverySeat",
    "bits": { ... }, "relationToNashConv", "assumptions": [ ... ], "notCovered"

**The statement.** With probability at least `confidence`, simultaneously for every seat i of the family: the gain of
seat i's trained response is at least `seats[i].responseGainLowerBound`. On that event

    sum over the family of gain_i(R_i)  >=  sumOfResponseGainsLowerBound      (the sum of the seat bounds)
    NashConv  >=  sum over the family of bestResponseGain_i  >=  nashConvLowerBound
                                                                (the sum of max(0, seat bound))

**Why it is valid.** Each seat gets the error budget `alpha / seats`; by the union bound the probability that any of
the k seat statements fails is at most `alpha`. No independence between the seats is used. The floor at 0 is applied
seat by seat because a best-response gain is never negative, whatever was measured.

**Negative gains.** A response trained for too few deals can be worse than the strategy it responds to. Its
`responseGainLowerBound` is then negative; it lowers `sumOfResponseGainsLowerBound` (a statement about those
responses) and contributes 0 to `nashConvLowerBound` (a statement about best responses).

**Incomplete evaluation.** A seat whose evaluation did not complete (time limit; the sample is never shortened) has
`"evaluated": false`, contributes the trivial bound 0 to `nashConvLowerBound`, makes
`sumOfResponseGainsLowerBound` `null` and `complete` false. The statement stays valid: the event "seat i completed
and its bound exceeds the truth" is contained in the event "its bound exceeds the truth".

**A subset of the seats** (`"seats": [...]`): the family is the requested seats; `nashConvLowerBound` is still a
lower bound of NashConv, because the seats left out contribute best-response gains that are never negative.

**Units.** `summary.unit`: `"BB (chip EV)"` or `"payout units (ICM tournament equity)"`. Every gain and bound of the
result is in that unit.

### 3.4 `summary.pooledIndependent` (tighter for several seats, one more assumption)

    "calculation": "response-5.9-pooled-bernstein-subsets-v1", "recommended": false, "calibrated", "reason",
    "family": { "seats", "subsets", "statement" }, "allocation": { "perSubsetBernstein", "perSeatVariance" },
    "method", "dependenceBetweenSeats": "ASSUMED INDEPENDENT ...", "complete",
    "sumOfResponseGainsLowerBound", "bestSubset": { "seats", "sumOfResponseGainsLowerBound" },
    "nashConvLowerBound", "bits", "relationToNashConv", "withSimultaneous"

**The statement.** With probability at least `confidence`, simultaneously for every non-empty subset B of the seats:
the sum of the response gains of B is at least the bound of B. `sumOfResponseGainsLowerBound` is the bound of the
subset "all seats"; `bestSubset` is the subset with the largest bound; `nashConvLowerBound` is
`max(0, bestSubset.sumOfResponseGainsLowerBound)`.

**Why it is tighter.** Standard errors of independent seats add in quadrature; the union bound adds them linearly.
With eight similar seats the slack is 2 to 3 times smaller. **What it costs:** it assumes that the seats' evaluation
samples are independent of one another. They are computed from separate random streams (and, with the 5.9 streams,
provably different numbers), so the assumption is the usual one for pseudo-random numbers; but it IS an assumption,
and `simultaneous` does not need it.

**Why subsets.** A seat whose response loses lowers the sum over all seats. Leaving it out after seeing the data is
only valid if every possible choice was covered by the statement, so the family is all 2^k - 1 subsets (255 for eight
seats) and the error budget is divided accordingly.

### 3.5 `summary.againstExact` (only with `"exact": true`)

Whether each statement holds against the exact values of the same responses: `seatBoundsChecked`,
`seatBoundsHolding`, `simultaneousHolds`, `simultaneousNashConvBoundHolds`, `pooledAllSeatsHolds`,
`pooledBestSubsetHolds`. For validation on small games.

## 4. What happened to the 5.8 fields

| 5.8 field | 5.9 |
|---|---|
| every field of `seats[i].sampled` (`gain`, `bounded`, `bestResponseGainLowerBound`, `responseValue`, `policyValue`, ...) | written as before, same meaning. With `"randomStreams": "5.8"` the same bits. |
| `seats[i].sampled.calculation` | `"response-5.9-paired-v2"` by default (other random numbers); `"response-5.8-paired-v1"` with the 5.8 streams |
| `seats[i].sampled.version` | `"5.9"` (the program that wrote it) |
| `summary.sumOfSeatGains` | as before, plus `kind` |
| `summary.sumOfSeatLowerBounds95` | **deprecated, kept**: same value, same definition. Also written as `sumOfNormalApproximationLowerBounds95`. `summary.deprecated.sumOfSeatLowerBounds95` says why and what to use instead. It will be removed in a later release. |
| `summary.reading` | rewritten (prose) |
| `summary.seatsEvaluated`, `allSeats`, `exactSumOfSeatGains`, `exactSumOfBestResponseGains`, `exactShare`, `exactNashConv` | as before. `seatsEvaluated` now counts the seats whose evaluation completed; `seatsRequested` is new. |
| `tool` | `"mwcli response 5.9"` |

**Migration.** A program that read `summary.sumOfSeatLowerBounds95` as "a lower bound of NashConv I can rely on"
should read `summary.simultaneous.nashConvLowerBound`. A program that read it as a quick summary of the per-seat
normal bounds keeps working unchanged; `sumOfNormalApproximationLowerBounds95` is the same number under a name that
says what it is. No 5.8 field changed its meaning. A result file written by 5.8 is still read correctly by anything
that read it before: 5.9 does not rewrite result files.

**Default numbers differ from 5.8.** The sampled estimates of a default request are computed from other random
numbers than in 5.8 (the 5.9 streams), so they differ in value - as two seeds differ - while the exact values and the
trained responses are identical. To reproduce a 5.8 result exactly, add `"randomStreams": "5.8"`.

## 5. Reading the two confidence statements together

`simultaneous` and `pooledIndependent` are two separate statements, each at `confidence`. Quoting whichever is larger
after looking at both is a statement at confidence `1 - 2 alpha` (90% for the default). To quote the larger one at
95%, request `"confidence": 0.975` and take the larger of the two.

## 6. What the bounds cost, and how to choose the sample count

A distribution-free bound must allow for an event that the sample did not happen to contain: an event of probability
p is missed by N samples with probability about exp(-N p). So the bound contains a term proportional to
`W ln(1/alpha) / N` that no method can avoid (the method used here pays `7/3` of it with `ln(2/alpha)`), beside the
usual term `sqrt(2 V ln(2/alpha) / N)`. W is large in poker (twice the range of one seat's utility: 100 to 800 BB for
deep stacks), so:

    to certify a seat gain g with k seats at 95% (each of the two terms at most g / 2):
        N  >~  (14/3) W ln(40 k) / g      and      N  >~  8 V ln(40 k) / g^2

For W = 200 BB, six seats and g = 0.05 BB per seat the first condition is about 102,000 deals; for g = 0.005 BB it is
about 1,020,000. The default (204,800 evaluation deals) certifies gains of the size found in strategies trained for
a few hundred thousand deals; small gains of well-trained strategies need millions of deals. The evaluation is now
cheap enough for that (PERFORMANCE-5.9.md): prefer `"futureActions": "sample"` with more deals over enumerated
opponent actions with fewer (the bound protects against rare actions either way, and sampling walks 10 to 20 times
fewer nodes per deal on the multi-street fixtures).

A bound of 0 means "not enough deals to certify anything at this level", never "the strategy has no weakness".

## 7. What no statement here covers

* **Upper bounds.** Every number bounds NashConv from below, inside the study's betting abstraction. Nothing here
  says how far a strategy is from equilibrium. No percentage of "GTO optimality" follows from any of it.
* **Choosing after looking.** Running several analyses (seeds, response budgets, sample counts) and quoting the best
  one is covered only if `analyses` counted them before the first one ran.
* **The quality of the response.** The statements are about the responses that were trained. A longer response
  training can find more; that changes what is bounded, not the validity of the bound.
* **The pseudo-random numbers.** The statements assume they behave as independent uniform numbers. 5.9 proves that
  its evaluation streams never reuse a number within one seed (MATHEMATICAL-VALIDATION-5.9.md, section 5); that they
  are statistically independent is the generator's empirical property, not a theorem.
* **The training of the strategy itself**, its uncertainty across training seeds, and the study's own verdicts
  (`study-5.5-bounded-eb-v1`, `study-5.6-replication-v1`): unchanged in 5.9.
