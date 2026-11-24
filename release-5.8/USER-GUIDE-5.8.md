# EightMax 5.8 user guide

Everything in USER-GUIDE-5.6.md still applies (running a study, the accuracy and recovery panel, saving and
resuming, memory, the launchers). This guide covers what 5.8 adds.

## Measuring strategy quality: the trained response

**What it is for.** A study tells you what the trained strategy does with one hand. Whether the strategy *around*
that decision is any good is a separate question. For a small game the program can answer it exactly (the exact best
response of every seat; their sum is NashConv). For a realistic game it cannot: the exact calculation would have to
go through every combination of the other players' hands. Until 5.8 the realistic fixtures were measured by letting
each seat change **one** decision. 5.8 lets each seat change **all** of them:

1. the other seats are frozen at their trained strategies;
2. the program trains a response for one seat against them (the same trainer, with only that seat learning);
3. the response is then played against the frozen strategies on deals that were not used to train it, and its
   gain over the seat's own trained strategy is measured.

**How to read the number.** The gain of the response is a **lower bound** of what that seat could gain by its best
possible deviation, and the sum over the seats is a lower bound of NashConv - inside the study's bet sizes, with
real cards. A large value means the strategy is certainly not close to equilibrium. A small value means that *this
search* found little; it is **not** proof that nothing larger exists, and no percentage of "GTO" follows from it.
With more than two players, or with ICM, none of this is "exploitability".

On fourteen reference games where the exact answer is known (130 trained states), responses trained for two million
deals per seat found at least 70% of the exact NashConv in every state and a median of 100%; responses trained for
200,000 deals found a median of 96% and as little as 19%. The share depends on the game and on how long the response
is trained (CONVERGENCE-5.8.md has it game by game), and those games are small: no share measured there carries over
to a large study.

### Running it

Double-click **Run 5.8 response example.bat** for a complete example (six-player flop, about a minute). It writes
`EightMax-5.8-response-example.json`.

For your own trained state, from a command prompt in the release folder:

    mwcli.exe --response <spec.json> <trained.state> <request.json> [table memory in MiB]

`spec.json` is the engine specification of the game and `trained.state` the solver checkpoint (the files the desktop
application saves for a native study; a study fixture's specification is its `variants[i].nativeSpec`). `request.json`:

    { "responseDeals": 1000000, "samples": 400000, "seed": 58, "parallelSeats": 4 }

| Field | Meaning | Default |
|---|---|---|
| `responseDeals` | sampled deals of response training **per seat**. More deals give a better response and so a larger (tighter) lower bound; the bound is valid for any value | 200,000 |
| `samples` | independent deals on which each seat's gain is measured (rounded up to blocks of 1,024). More samples give a narrower interval | 200,000 |
| `seed` | seed of the response training and of the evaluation deals | 1 |
| `seats` | which seats, for example `[0, 2]` | every seat |
| `parallelSeats` | seats handled at the same time (1 to 8). Each keeps its own copy of the tables in memory. The result does not depend on it | 1 |
| `threads` | threads for the evaluation, and for response training when the study uses frozen batches | 1 |
| `exact` | also compute the exact gain of the response and the exact best response. **Small games only** | false |
| `futureActions` | `auto`, `enumerate` or `sample`: whether the other seats' actions are enumerated or sampled while measuring (auto: enumerated for betting trees of at most 4,096 states) | auto |
| `saveStates` | a path prefix: writes `<prefix><seat>.state`, a state in which policy "average" is the response against the frozen others and policy "current" is the trained strategy. It is not a training state | none |

Requests that cannot be met are refused before anything is trained (an unknown field, a seat that does not exist,
more response training than one engine state can hold).

### The result

Per seat, under `sampled`:

- `gain.mean`, `gain.stdErr` - the estimate and its standard error;
- `gain.ci95` - the usual normal-approximation interval. Read it when the sample is large;
- `bounded.half` - a half-width that holds without any assumption about the distribution of the samples (it uses
  only that a seat cannot win or lose more than the stacks allow). It is wider. It is the one to trust when the
  strategies contain rare, large events, where the normal interval can be far too narrow;
- `bestResponseGainLowerBound.normal95` and `.bounded95` - the lower bound itself, never below 0 (a seat can always
  keep its strategy);
- `responseValue`, `policyValue` - the two values whose difference the gain is.

Under `summary`: `sumOfSeatGains` (the estimate of the lower bound of NashConv, with its standard error) and
`sumOfSeatLowerBounds95` (the per-seat bounds added up: conservative).

**Which bound to read.** `opponentActions` says how the other seats' actions were handled. With `"enumerated"`
(small betting trees) the normal interval behaved almost as stated in validation. With `"sampled"` (every large
study) it did not always: on an eight-handed ICM game whose strategies take some actions with probability near
1 in 100,000, single estimates were up to a thousand reported standard errors away from the exact value, while
the distribution-free bound held in every one of 1,058 tested estimates and the estimator showed no bias
(MATHEMATICAL-VALIDATION-5.8.md, sections 3.4 and 3.5). For a conclusion, use `bounded95`: the sum over the seats of
`bestResponseGainLowerBound.bounded95` is a lower bound of NashConv that needs no assumption about the samples.

With `"exact": true`, per seat under `exact`: the response's exact gain, the exact best-response gain and the share
found; under `summary`, `exactNashConv` and `exactShare`.

**If a seat's gain is negative or its bound is 0:** the response did not beat the trained strategy on the evaluation
deals. Either the strategy is close to a best response for that seat, or the response training was too short to
find the improvement. Raise `responseDeals` and compare; the larger of two bounds is the better one.

**Cost.** Response training for one seat walks the tree for that seat only, so training responses for all `n` seats
with `responseDeals = D` costs about as much as `D` deals of ordinary training. Measuring costs one walk per sample
and seat. `exact` costs what an exact best response costs, twice per seat.

## Study budgets: the limit is checked when the study starts

One engine state holds at most 10,000,000 training updates. An update is one sampled deal with the default trainer
and up to 64 with frozen batches (10,000,000 and 640,000,000 deals). A study whose largest budget needs more is now
refused at once:

    error 400: study budget too large: 10000001 sampled deals per seed need 10000001 training updates for variant
    baseline (1 deal per update), above the 10 million iteration limit of one engine state. Nothing was trained.
    The largest budget this trainer supports is 10000000 sampled deals per seed; frozen batches (trainer batchDeals
    up to 64) raise it to 640,000,000.

Before 5.8 such a study trained every seed up to the limit and failed afterwards. The limit itself is unchanged:
MATHEMATICAL-VALIDATION-5.8.md, section 5, explains what would have to change to raise it (the random-number
generator, and with it every saved state). The shipped presets and fixtures use at most 4,000,000 deals.

## Reference games for checking a measure

`source/tools/games58.js` holds fifteen small games with exact answers: the ten of 4.8 and five tournament-stage
games added in 5.8 (early stage with deep stacks, medium stacks on the turn, eight-handed short stacks, a
five-player bubble with ICM, three players with side pots and ICM). `node source/tools/games58.js describe` prints
what each represents and what it leaves out. They are controlled fixtures, not models of real tournament play.

## Launchers added in 5.8

| File | What it does |
|---|---|
| `Run 5.8 focused validation.bat` | the 5.8 self-test and the checks of what 5.8 added (a few minutes) |
| `Run 5.8 Windows validation.bat` | every check, including the GPU section (15 to 50 minutes) |
| `Run 5.8 response example.bat` | the worked example of the trained response |

WINDOWS-TESTS-5.8.md says which to run first and which report files to keep.

## Command line added in 5.8

    mwcli.exe --response spec.json state request.json [memoryMiB]
    mwcli.exe --selftest58 studies-dir work-dir [all|engine|response|limits]
