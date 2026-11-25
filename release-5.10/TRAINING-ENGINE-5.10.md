# EightMax 5.10: the training engine

What the trainer of 5.9 does, where it loses time and accuracy, what 5.10 adds, and what each addition costs.
Evidence for every number is named beside it; the mathematics of the new estimator is proven and tested in
MATHEMATICAL-VALIDATION-5.10.md, its effect on strategies is measured in CONVERGENCE-5.10.md, and timings are in
PERFORMANCE-5.10.md.

## 1. Summary

| Item | 5.9 | 5.10 |
|---|---|---|
| Default trainer | linear external-sampling MCCFR, one sampled hand per seat per deal | **unchanged**: the same states, byte for byte (section 5) |
| Default trainer, speed | | Detailed hand groups: 4% to 11% less time per deal on the Detailed fixture (identifier cache); everything else unchanged within measurement noise (+0.5% to +1.1% instructions) |
| Experimental estimators in the engine | terminal baseline (4.3), own-hand enumeration (4.7, exact cards only), river enumeration (5.5/5.6), DCFR, regret matching+ | the same, **plus `rbes`** (section 4) |
| `rbes` | - | Rao-Blackwellised external sampling: every compatible hand of the updating seat in one traversal, an opponent's terminal children in expectation; works with exact cards **and with Compact/Detailed hand groups**, with frozen batches and threads; opt-in |
| Checkpoints of the default trainer | EMMW4 / EMZ1 | unchanged: a 5.9 state continues under 5.10 to the same bytes and the reverse |
| Checkpoints of `rbes` | - | EMMW4 with an `estimator` header field and their own study identifier; refused by the default trainer and by earlier versions, and the reverse (section 6) |
| Trained response | default estimator | default estimator (unchanged, same bits); `"responseEstimator":"rbes"` opt-in (section 4.7) |

## 2. The default trainer, as audited

Source: `source/native/mw_es.hpp` (rules, tables, worker pool), `mw_es_impl.hpp` (`Walker::learn`, `merge`, `train`),
`mw.cpp` (deal sampler, row table).

**One update** (one deal, or a frozen batch of up to 64 deals whose increments are merged together):

1. *Deal.* Every seat draws a hand from its weighted range; a tuple that shares a card is rejected and redrawn; the
   missing board cards are drawn uniformly from the cards left. The joint distribution is therefore
   P(hands, board) proportional to the product of the range weights over the card-compatible tuples, with every board
   completion equally likely.
2. *One traversal per seat* (`Walker::learn`), the seat i being "the updating seat":
   - at a decision of i every action is followed;
   - at a decision of another seat ONE action is sampled from q = 0.9 sigma + 0.1 / k (sigma: regret matching on the
     row of that seat's sampled hand) and its value is multiplied by sigma(a) / q(a);
   - at a decision h of i, with opp = the product of the opponents' sigma on the path and sp = the product of the q
     they were sampled with:

         regret(I, a)  += step * (opp / sp) * (v(a) - sum_b sigma(b) v(b))
         average(I, a) += step * (own / sp) * sigma(a)            own = the product of i's sigma on the path

     step = the update number (linear weighting; 1 for "uniform").
3. *Merge.* The increments are added to the rows (immediately, seat after seat, with one deal per update; through a
   delta table for a frozen batch). New betting states and rows get their identifiers here, in deal order, which is
   why results never depend on the number of threads.

A row is (betting state, hand field, code field): with exact cards the strategy hand and the card code of the street;
with hand groups the identifier of the key "previous key x 2048 + strength group" (Compact) or the feature text
(Detailed). Rows live in an open-addressing hash (`hkeys`, `hrow`), their metadata in `rows`, their 2k numbers in
`vals`.

### 2.1 Where the instructions go (callgrind, `validation/5.10/profile/`)

Six-player flop fixture `flop6-jack` (Compact groups, 59 to 125 hands a seat), 12,000 deals after 60,000, one deal
per update: 93,000 instructions and about 248 state visits per deal inside the training call
(`default-flop6-jack.inclusive.txt`: 1,117.5 million instructions under `es::train`; the shares below are the
exclusive counts of `default-flop6-jack.exclusive.txt` relative to that).

| Part | Share of instructions |
|---|---|
| `Walker::learn` itself (terminal handling, bookkeeping, recursion) | 38% |
| strategy lookup and regret matching (`policy`, hash mix, two divisions per action) | 15.5% |
| child state through the link table (`descendP`) | 13.6% |
| hand-group keys of the deal (`worldGroups`, `strengthGroup`, hand evaluation) | 7% |
| merge and update journal | 4% |
| action random numbers, deal sampler | 6% |
| everything else | 16% |

No single item is left that earlier releases had not already reduced (5.6 removed the repeated hash lookups, state
rebuilds and clock reads; 5.7 the thread wake-ups). The trainer executes about 375 instructions per state visit; what
remains is the traversal itself and the dependent memory reads of a strategy lookup (hash slot, row record, values),
which an instruction count does not show.

### 2.2 The ten audit questions

| # | Question | Finding | Evidence |
|---|---|---|---|
| 1 | Sampling variance | The dominant source is the **updating seat's own sampled hand**: only one of its hands is updated per deal and every other row of the seat receives nothing. Taking the expectation over that hand reduces the variance of the regret increments per deal to 2 to 6% of the default's on river and turn games with 20 to 60 hands a seat, to 9% and 15% on the two Compact-group fixtures, to 0.8% on the Detailed fixture - and only to 35 to 43% on small six-player games, where five sampled opponents carry most of the noise. | `validation/5.10/estimator/variance/`; MATHEMATICAL-VALIDATION-5.10.md, 5.2 |
| 2 | High-variance information sets | Rows deep in the tree after several opponent decisions: their average-strategy increments carry the weight 1 / sp, which is at most 1.11 per decision for a line the opponent's hand takes and 10 k (k actions) for a line it takes only by exploration. | section 2.3 |
| 3 | Infrequently visited actions | An opponent action with strategy probability 0 is still sampled with probability 0.1 / k (the exploration floor); nothing below it is unreachable, but it is reached rarely and then weighted heavily. Raising the floor to 0.3 or 0.5 made exact NashConv worse in the pilot (regret weights sigma / q grow). | `validation/5.10/pilot/` |
| 4 | Repeated computational work | (a) The hand-group key of every seat at every street is recomputed for every deal although it is a pure function of (hand, public cards). (b) `mix / k` was divided once per action. (c) With `rbes`: showdown scores and score order of a range are pure functions of the board. | sections 4.5, 5 |
| 5 | Unnecessary memory accesses | A strategy lookup reads the hash key array, the row-index array, the row record and the values: four dependent reads. One lookup per visit cannot overlap them; `rbes` looks up all rows of a node together and prefetches each stage. | sections 4.5, 5.3 |
| 6 | Strategy-table growth | The default table grows with the sampled part of the game. `rbes` touches every row of the updating seat at each visited node, so its table reaches its final size much earlier (flop6-jack after 250,000 deals: 213,000 rows and 20 MiB with the default trainer, 412,000 rows and 38.1 MiB with `rbes`). The rows are the same rows; they are created sooner. With large exact ranges that is fast: a six-player flop game with 208 exact hands a seat filled a 512 MiB table after 2,048 deals. | PERFORMANCE-5.10.md, section 6; `validation/5.10/convergence/fixtures/` |
| 7 | Sampling inefficiencies | A traversal that samples a fold which ends the hand stops there, although the terminal payoffs of ALL terminal children are cheap. | rule R2 of `rbes` |
| 8 | Regret-update bottlenecks | With one deal per update every touched row is journalled (152 bytes zero-initialised and filled) and every stored sum tested for finiteness twice. Irrelevant for the default trainer, which writes a few dozen rows a deal; a large share of the time of an `rbes` deal in the first implementation, until `mergeRB` tested the sums once (development measurement). | section 4.5 |
| 9 | Multiplayer-specific limits | n traversals per deal share one deal; each updates one seat. The average-strategy weight 1 / sp multiplies over n - 1 opponents, and a best response of any of them can lead into the rarely visited rows. | section 2.3 |
| 10 | Multi-street limits | With exact cards a row belongs to one (turn, river) pair and a deal brings one such pair: coverage of boards, not of hands, bounds the speed. With hand groups the exact best response of a small game is measured OUTSIDE the abstraction and has a floor that no training removes (pilot, the three-player three-street game with Compact groups: 1.31 to 1.43 BB at every budget from 100,000 to 4,000,000 deals of the default trainer and to 1,000,000 deals of `rbes`, with no downward trend). | CONVERGENCE-5.10.md, section 6 |

### 2.3 The average strategy is estimated with heavy-tailed weights (not changed in 5.10)

The target of the average at a row is step x own x sigma(a) x P(the row's hand and public cards): it does not depend
on the opponents at all. The trainer visits the row only when the opponents' sampled actions lead there, with
probability sp, and compensates with the weight 1 / sp. If a fraction R of the opponent's hands takes a line and the
others reach it only by exploration, a share 1 - R of the row's total weight arrives in visits of weight 10 k that
happen with probability 0.1 / k each.

This was measured while validating `rbes` (`validation/5.10/estimator/diagnosis.json`). On the three-player flop
fixture, average-strategy entries that had received a nonzero increment in more than 500 of 60,000 deals had a
Kish effective sample size near 120, and their sample means changed by an order of magnitude when the sample was
made 32 times larger - for both estimators. The same weights enter the average strategy that a study evaluates.

`rbes` reduces them only where rule R2 applies (it samples among the non-terminal children, so the weight of
continuing is 1 / p with p >= q). Its measured average-increment variance is 0.1% to 38% of the default's in the
final samples, but that ratio is itself unstable on large games (MATHEMATICAL-VALIDATION-5.10.md, 5.2) and no
reduction is claimed there. A lower-variance average estimator - updating a seat's average where it is the sampled
opponent, or separate average passes - is the most promising item left open; see CONVERGENCE-5.10.md, section 9.

## 3. Candidates considered for 5.10

| Candidate | Effect in the pilot (exact NashConv relative to the default trainer, same seeds, equal sampled deals; geometric mean over the pilot seeds) | Cost | Decision |
|---|---|---|---|
| Learned-baseline control variates at opponent decisions (VR-MCCFR) | not built; bounded by what removing ALL action sampling on the river gives (`opponentEnumeration: river`): x 0.53 to 0.87 on three games | a second table of the size of the strategy table, one more lookup per opponent decision; the river enumeration itself cost 1.0 to 4.2 times the time | not implemented: smaller gain than the hand, larger memory |
| Terminal-sibling control variate (exists since 4.3) | x 0.81 to 1.12 | 1.0 to 1.5 times the time (5.9: "unresolved") | superseded by rule R2 inside `rbes` |
| Own-hand enumeration (exists since 4.7) | x 0.40 to 0.71 on games with 4 to 6 hands a seat | 1.8 to 2.6 times the time per deal; **refused with hand groups**, so unavailable on every realistic fixture | generalised: this is rule R1 of `rbes` |
| More opponent exploration (0.3 instead of 0.1) | default trainer: x 0.98 to 1.32 (not better anywhere beyond noise, worse on the three-player river). `rbes` with 0.3 / 0.5 against `rbes` with 0.1: equal to 2.5 times worse | none | rejected |
| Uniform instead of linear weighting | default trainer: mixed (x 0.83 to 0.92 on the heads-up river, x 1.05 to 1.26 on the three-player river). `rbes`: worse than linear on 3 of 4 games, equal on one | none | rejected |
| Rao-Blackwellisation over the updating seat's whole range, with hand groups, vectorised, threaded | x 0.08 to 0.32 on six games with ranges and exact cards; x 0.57 to 0.82 on a six-player flop game with Compact groups; x 0.81 to 0.95 on a three-player three-street game with Compact groups whose exact NashConv has a floor outside the abstraction (section 2.2, item 10) | 2 to 22 times the time per deal in the pilot version (before the work of section 4.5) | **implemented: `rbes`** |

Rule R2 (an opponent's terminal children in expectation) against the same estimator without it, equal deals: lower
exact NashConv on 6 of 8 pilot games with ranges (ratio 0.57 to 1.07; 0.57 on the ICM river game) for 1.0 to 1.45 times
the time. R2 is the released variant; the other one remains selectable (section 4.1).

The pilot runs (seeds 9001 to 9012, never used in a formal experiment) are in `validation/5.10/pilot/`
(`summary.json` holds every ratio quoted here). They chose the candidate and its variant; they are not evidence for
any claim of this release: the formal experiment is CONVERGENCE-5.10.md.

## 4. The experimental estimator `rbes` (identifier `rbes-5.10-v1`)

Select it with `"estimator": "rbes"` in an engine spec, `estimator=rbes` on `mwcli --study`, or
`{"trainer": {"estimator": "rbes"}}` in a study's options. Absent or `"external"`: the default trainer, bit for bit.

### 4.1 Definition

The deal sampler, the regret matching, the linear weighting, the merge and the table are the default trainer's. For
the deal D and the updating seat i, two sampled quantities are replaced by conditional expectations.

**R1, the updating seat's hand.** Let C be the hands x of i's range that share no card with the sampled board and
the opponents' sampled hands, and c(x) = w(x) / sum of w over C (the conditional distribution of i's hand given
everything else in the deal). One traversal carries a vector over C. An opponent's decision never depends on x, so
its sampled action is shared by all x. At a decision h of i:

    regret(row, a)  += step * (opp / sp) * sum over x in row of c(x) * (v_a[x] - sum_b sigma_x(b) v_b[x])
    average(row, a) += step * (1 / sp) * sigma_row(a) * own_row * sum over x in row of c(x)

A row holds one hand with exact cards and the hands of one group with Compact or Detailed keys; hands that share a
row at a node shared a row at every earlier decision of the seat (a key contains the previous street's key), so the
own reach is one number per row.

**R2, an opponent's terminal children.** At an opponent decision with terminal children T (a fold that ends the hand,
a call that closes the betting with nobody left to act) and non-terminal children N:

    v[x] = sum over a in T of sigma(a) * u_a[x]   +   (sigma(a*) / p(a*)) * v_{a*}[x]      a* ~ p(a) = q(a) / q(N)

The terminal part is exact. When N is empty nothing is sampled; when T is empty this is the default's sampling. The
sampling reach below a* is multiplied by p(a*).

`"rbesOpponentTerminals": "sampled"` switches R2 off (identifier `rbes-5.10-v1-sampled-terminals`, a different
algorithm with its own states). R2 is the released variant (the pilot comparison is at the end of section 3).

### 4.2 Why the expected increments are right

The default estimator is unbiased for the counterfactual regret and the reach-weighted strategy of the sampled-chance
CFR update (5.6 validated this statistically; 5.10 re-validates it). R1 replaces the increment by its conditional
expectation given (board, opponents' hands, opponents' sampled actions); R2 replaces a sampled value by the sum of an
exact part and an importance-weighted sample of the rest. Neither changes an expectation (tower property; proof with
the weights in MATHEMATICAL-VALIDATION-5.10.md, section 2), and both were checked EXACTLY, not statistically: for
sampled deals, the expectation of the estimator's own code over every outcome of its sampling equals a brute-force
walk of the whole betting tree (28 game and variant combinations, largest difference 9.4e-17 of the scale), and for
11 game and variant combinations an independent Python implementation of the definition agrees to 2.8e-17. The
sampler's frequencies were tested separately (131 decisions, 2,000,000 draws each).

### 4.3 What it supports and what it refuses

Supported: two to eight seats; river, turn, flop and preflop starts; chip EV and ICM; exact cards and Compact or
Detailed hand groups (`groupKeys`); one deal per update and frozen batches with threads; linear and uniform
weighting; studies, study checkpoints, compressed states, the explorer and every evaluator (they read the table).

Refused before anything is trained (the estimator was not validated for them): DCFR, regret matching+, batch
schedules, Latin and stratified deals, turn and river representative groups, an opponent exploration of zero (every
sampled action needs a positive probability), and any combination with `ownHandEnumeration`,
`opponentEnumeration`, `terminalBaseline` or `terminalExpectation`.

Processing modes: the traversal runs on the CPU in every mode, as the default trainer's does; CPU Only, Automatic,
Hybrid and GPU-Preferred only decide where the showdowns of a frozen batch are scored, through the unchanged
scheduler. With the project's simulated CUDA driver all four modes write one state (regression test); on a real
GPU this is a check of the Windows validation script and has not run.

Slow, not refused: preflop starts with hand groups (the group keys of all 1,326 hands of every seat are computed for
every deal on one thread; about 500 to 1,000 deals per second on the two preflop fixtures). The key cache covers
streets at most two cards after a flop or turn start.

### 4.4 Data structures

| Structure | Content | Lifetime |
|---|---|---|
| `RbEntry` | for one (seat, street, public cards): the row of every hand of the range, and the key fields of each distinct row | cache (`RbKeyMemo`), built on first use in deal order on the calling thread (new keys are interned there, so identifiers never depend on threads) |
| `RbScores` | for one (seat, complete board): showdown score of every hand and the hands in score order | cache, same rules |
| `RbSeat` | for one (deal, seat): the compatible hands in score order, their conditional weights, per street the row of each hand, the weight mass of each row and the row of the previous street it came from | rebuilt per deal by the traversing thread |
| value frames | per tree depth: one block of doubles (k x hands for the children's values, a few numbers per row) | scratch budget of the training call |

The caches are pure functions of the game and the key dictionary. They are never saved, are dropped when the
dictionary is truncated (a rolled-back update) or replaced (an import), have an allowance of 256 MiB that is not
charged to the table budget, and are reported (`trainer.rbes.keyCacheMiB`). `EIGHTMAX_RBES_KEYCACHE_MIB=0` switches
them off; the states are the same bytes (self-test R1).

### 4.5 The traversal, and what it costs

A straightforward vector traversal touches every hand at every node several times. The production walk
(`Walker::learnRB`) avoids most of that:

* a node writes `mult x value` directly into the buffer of the node that needs it, so an opponent decision costs no
  pass over the hands (it multiplies `mult` and hands the buffer on; terminal children add their runs to it);
* the children of an own decision write into that decision's per-action block (nothing is copied);
* the own reach is carried per row, not per hand;
* positions are ordered by showdown score, so a terminal payoff is a few constant runs (one scalar payoff per
  distinct comparison with the live opponents' scores; this also bounds the ICM evaluations per terminal);
* the rows of an own decision are looked up together, each stage (hash slot, row record, values) prefetched for all
  rows before the first is read;
* `mergeRB` tests the finiteness of the stored sums once per seat instead of twice per value.

The reference walk (`learnRBref`, `"rbesWalk": "reference"`) is the straightforward form, kept for validation: every
exact check runs each sampling outcome through both walks and compares their increments.

On `flop6-jack` (5,000 deals after 20,000) a deal of `rbes` executes 498,000 instructions against the default's
93,000 (`validation/5.10/profile/rbes-flop6-jack.inclusive.txt`), about a third of them in the preparation of the
deal - the rows of every hand of every seat at every street - while the key cache is still filling. It writes
every row of the updating seat at each of its decisions, several times the rows the default trainer writes
("rows written per deal" in PERFORMANCE-5.10.md, section 3). Measured cost relative to the default trainer, one
thread, time per sampled deal:

| Games | Hands a seat | Time per sampled deal, rbes / default |
|---|---|---|
| reference games with 1 to 6 hands (seven games) | 1 to 6 | 1.5 to 3.7 |
| river games with ranges (three games) | 27 to 59 | 7 to 17 |
| turn games with ranges (three games) | 10 to 35 | 3 to 8 |
| three streets, deep stacks (`early3-flop`) | weighted ranges | 2.3 |
| `flop6-jack` (six players, Compact groups) | 59 to 125 | 3.0 |
| `flop3-kings` (three players, Compact groups) | 109 to 360 | 9.0 |

(The first four rows: 1,000,000 deals in the convergence experiment, CONVERGENCE-5.10.md, 4.4; the fixtures: 250,000
deals, section 7 there. PERFORMANCE-5.10.md, section 3, has the measurements on an idle machine with rows written
and state visits per deal.) Per deal `rbes` is dearer because it writes every row of the seat; whether that is
repaid is the subject of CONVERGENCE-5.10.md.

### 4.6 Memory

The table of `rbes` is the default's table: the same rows, created earlier (flop6-jack after 250,000 deals: 213,000 rows and 20 MiB with the default trainer, 412,000 rows and 38.1 MiB with `rbes`). It is bounded by the
same table budget;
when the budget is reached training stops with a valid state of committed updates (self-test L2) and continues under
a larger budget to the state of an uninterrupted run. Additional memory: the caches of 4.4 (5 to 6 MiB on the flop
fixtures) and the value frames (k + 1 doubles per hand and tree depth per thread: 0.3 MiB a thread for 360 hands).
Peak numbers are in PERFORMANCE-5.10.md, sections 3 and 6.

### 4.7 The trained response with `rbes`

`mwcli --response` trains a response of each seat against the frozen strategies of the others and measures its gain
on deals independent of the training. `"responseEstimator": "rbes"` trains that response with `rbes`. The measured
quantity and every confidence statement keep their meaning, because they never depended on how the response was
trained; a better trainer finds more of the best-response gain in the same time. Default (`"external"` or absent):
the 5.9 response, bit for bit (regression test, 5.9 reference responses).

### 4.8 Reporting

`mwcli` and the study documents print, for a state trained by `rbes`: `trainer.estimator` ("Rao-Blackwellised
external sampling MCCFR"), `trainer.algorithm` (`rbes-5.10-v1`), `experimentalEstimator: true`,
`validatedDefault: false`, and under `trainer.rbes` the seat traversals, the hands
carried per traversal, the row increments written, the terminal children taken in expectation, the sampled and
unsampled opponent decisions, and the size of the key cache. `rows`, `tableMiB`, `processPeakRssMiB`, `seconds`
(deal / traverse / merge) and the frozen-batch stages are the fields of 5.9.

## 5. Performance-only changes of the default trainer

Rule: identical states (SHA-256 against the unchanged 5.9 binary) for one deal per update and frozen batches,
1 to 4 threads here and 1 to 24 in the Windows validation script.

| Change | Result | Kept |
|---|---|---|
| Cache of hand-group identifiers by (seat, street, public cards, hand): an entry is written when the trainer has the identifier, i.e. after the key was interned exactly when 5.9 interned it | Detailed keys (text): 4% to 11% less time per deal on the Detailed fixture (PERFORMANCE-5.10.md, section 2). Compact keys (a few integer operations): reading the identifier from a table of several megabytes was not faster in development (ratios 0.99 to 1.06) | Detailed only |
| `exploreMix / k` computed once per decision instead of once per action (same operands, same quotient) | within noise | yes |
| `rbes` structures added to the walker and the game object | +0.5% to +1.1% instructions on the default path for the same work on four workloads (callgrind, `validation/5.10/profile/instructions.json`); the same states | unavoidable cost of the option; wall time within noise (PERFORMANCE-5.10.md, section 2) |

**Not done, with the reason.** Storing key and row index of the row hash in one 12-byte record (one cache line
instead of two per probe) would change every reader of the table (158 places in 14 files, among them the checkpoint
loaders and every evaluator) for an estimated 5% on tables that exceed the caches; it was judged not worth the risk
to byte-identical states in this release. A row-offset index maintained during training has the same objection that
5.9 recorded (it moves the point at which a table limit is reached). The remaining cost of the default trainer is
the traversal itself.

## 6. Checkpoint rules

| State trained by | Opened by | Result |
|---|---|---|
| default 5.9 | default 5.10 | accepted; continues to the bytes 5.9 would write |
| default 5.10 | default 5.9 | accepted (the header is the 5.9 header) |
| default (any) | `rbes` | refused: "State was trained by the default trainer and cannot be continued by the experimental estimator (rbes)" |
| `rbes` | default 5.10 | refused: "State was trained by an experimental training algorithm ..." |
| `rbes` | 5.9 or earlier | refused: "State belongs to a different study" (the state's study identifier is derived from the spec's and the algorithm identifier, and earlier versions compare study identifiers) |
| `rbes-5.10-v1` | `rbes-5.10-v1-sampled-terminals` and the reverse | refused |
| `rbes` | `rbes`, same variant | accepted; stop-and-continue is byte for byte, also from a compressed state and after a table-limit stop |
| study checkpoint with one trainer | study resumed with another | refused by the study layer ("the checkpoint belongs to a different study (... trainer ...)") |

The state FORMAT is unchanged (EMMW4, EMZ1): no new row layout, no new fields in a default state. An `rbes` state
has one more header field, `"estimator"`. The evaluators, the explorer and the trained response read an `rbes` state
like any other: its rows are regrets and average-strategy sums of the same game.

One edge is not closed: a spec WITHOUT a study identifier (hand-written specs; the application always writes one)
makes earlier versions skip their study check, so 5.9 would open an `rbes` state trained from such a spec and
continue it with the default trainer. 5.10 refuses in both directions regardless.
