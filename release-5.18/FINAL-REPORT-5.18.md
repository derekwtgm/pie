# EightMax 5.18: final development report (Phase 8: bet sizes outside the tree)

Build `23205cbc12cae290`, successor of 5.17 (`6efe7970626b6460`).

## 0. The short version

The brief for this phase: *off-tree bet sizes. Map bet sizes outside the tree onto the solved sizes, and measure how
much results move when a size is added.*

| | | Status |
|---|---|---|
| Map a size outside the tree onto the solved sizes | one rule, three variants (`map-5.18-v1`); `mwcli --offtree` for a line of real actions; a field in the strategy explorer | **built**, tested |
| ... which variant? | rule written beforehand: harmonic unless another is better on two variants and worse on none | **blend** became the default by that rule; the evidence is two variants of one game and a supplement added afterwards |
| What does a strategy lose against a size it was not solved for? | `mwcli --translate` + the exact best response of 5.17; twelve added sizes, three games, five seeds | **measured**: large (above 0.5% of the pot a player in every seed) on 12 of 12 added sizes under the threshold rules, on 10 under blend; 3.2 to 16.2% for sizes outside the tree's sizes |
| How much do results move when a size is added? | the same game solved with the size | **measured**: the first decision moves on 10 of 12 variants; the value of the game does not move by more than the solutions are exact to |
| Mapping against solving with the size, equal time | primary comparison | solving with the size is better on 22 of 36 (variant, budget) pairs against blend and on 23 against the threshold rules; mapping is better on 0 and 0; 1 is unresolved and 13 were not equal in time (left out); in the supplementary game, blend beat direct solving on one added raise size in all five seeds |
| The same for three or more seats, preflop, tournaments | no exact measure exists there | **not measured**; the tools run there and are tested for correctness only |
| Trainers and every earlier study | the unchanged 5.17 binary: 225 configurations and 224 fixture cases, 0 differences | **tested**, byte for byte |
| Self-test, Windows script, launchers, ZIP, identity file, reports, branch | | delivered |
| Your PC, the GPU | | **untested** - and 5.11 to 5.17 with it |

## 1. Baseline

Before the first change, the delivered 5.17 archive was extracted and its source rebuilt: all 9 artifacts byte-identical to the delivered files. On that
tree the twelve self-tests pass, and the regression suite gives 724 tests: 723 passed, 0 failed, 1 skipped (a permissions test that cannot work as root). The rebuild and the self-tests were
finished before the first change; the suite of that separate, untouched tree was still running while development
had begun. VALIDATION-5.18.md, section 1.

## 2. What was built

* **`native/map518.hpp`**: the rule. A size as a fraction of the pot; between two tree sizes the nearer one, the
  pseudo-harmonic threshold, or both with the pseudo-harmonic weights. Mirrored in `web/lib_offtree.js`.
* **`mwcli --offtree`**: a line of real actions with real amounts, onto the tree, step by step; tree paths and
  weights at the end.
* **The explorer field**: the same for one bet at the node shown, in the desktop program.
* **`mwcli --translate`**: the strategy of a solved study written as a state of the same game with other bet sizes.
  It is what turns "what does the missing size cost" into a number: the exact evaluators read the file like any
  state. Any number of seats.
* **A translated state** has its own header fields and identifier; evaluated by 5.18, never trained, refused by
  5.10 to 5.17.
* **`mwcli --selftest518`** (8 checks), `validate_windows518.ps1` (34 sections), two launchers,
  `tests/v518.test.js` (9 tests), `tools/games518.js`, `tools/offtree_ui518.js`.

## 3. Rules written before measuring, and their outcomes

| Rule | Outcome |
|---|---|
| T0: a strategy in its own tree is unchanged to the bit; with a size added no seat gains less | **met**: a strategy in its own tree has the bits of the source in 135 of 135 cases; with a size added and the same fallback in both trees, no seat gains less and every policy value is the same in 540 of 540. With the default fallback (uniform) the second statement is violated in 66 cases, which is what amendment 1 is about |
| T1: the cost of a missing size is LARGE above 0.5% of the pot a player in all five seeds | nearest: LARGE on 12 of 12 variants; harmonic: LARGE on 12; blend: LARGE on 10, SMALL on 2. The ten sizes outside the tree's sizes (where the three rules coincide) cost 3.2 to 16.2% of the pot a player; the two between tree sizes cost 1.7 to 3.7% under nearest, 1.7 to 4.4% under harmonic and 0.28 to 0.31% under blend |
| T2: a rule is BETTER when lower in all five seeds; the default changes only for two BETTER and no WORSE | nearest is BETTER than harmonic on 1 variants and WORSE on 0; blend is BETTER than harmonic on 2 variants and WORSE on 0. By the rule the default is **blend**. The three rules give the same strategy on 10 of 12 variants (the size lies outside the tree's sizes) |
| T3: equal time, DIRECT BETTER when lower in all five seeds | against nearest: direct better on 23 of 36 (variant, budget) pairs, translated better on 0, unresolved 0, left out as not equal in time 13; against harmonic: direct better on 23 of 36 (variant, budget) pairs, translated better on 0, unresolved 0, left out as not equal in time 13; against blend: direct better on 22 of 36 (variant, budget) pairs, translated better on 0, unresolved 1, left out as not equal in time 13 |
| T4: the value moved when the exact intervals do not overlap; the first decision moved when above seed noise | the value of the game: the exact intervals of the two solutions overlap in 60 of 60 (variant, seed) pairs, so no movement of the value is established; the first decision: moved on 10 of 12 variants (by up to 23 points a base action, `ot-flop+f25`); where the added size is available at the first decision it gets 0.5 to 46% of the range |

Amendments: three, **all written after something had been seen** (CONVERGENCE-5.18.md, section 8). (1) T0's second
statement was false as I wrote it; it holds with a fallback that is the same in both trees. (2) The largest budget
is 10,000,000 deals, the trainer's limit. (3) A supplementary game, because the choice of the default rested on one
game.

## 4. Proven, tested, untested

* **Follows from the definitions:** where the larger tree's history uses only sizes of the source, the translated
  strategy is the source strategy; hence no seat's best response is worth less in the larger tree, for any number
  of seats, provided hands without a stored row are treated alike in both (MATHEMATICAL-VALIDATION-5.18.md,
  section 3). A translated file is a function of the source state, the two specs and the rule.
* **Not a theorem, and found false:** that mapping keeps a strategy sound. Nothing bounds the cost, and it is large.
* **Tested:** the rule in two languages against one recorded table; translation on two and three seats; the
  recorded files and bits on Linux, under Wine and on a hosted Windows runner; refusals; the explorer field in a
  browser against the desktop host; sanitizers; everything earlier against the unchanged 5.17 program.
* **Measured, for two seats postflop:** the cost of twelve added sizes; the three rules; mapping against solving at
  equal time; how the solution moves.
* **Not established:** anything about cost for three or more seats, preflop or tournament payoffs; the best
  weights for blending; the draw-once randomised mapping.
* **Untested:** everything on your PC and on the GPU.

## 5. Decisions I made that are yours to overrule

1. **I answered "how much results move" with two numbers, and the first is not the one the words suggest.** The
   brief's phrase can mean "how different is the solution when a size is added" (T4). I added "how much a solution
   loses against a size it lacks" (T1), because that is the number that says whether mapping can be trusted, and
   5.17 made it exact. If you only wanted T4, it is section 6 of CONVERGENCE-5.18.md.
2. **`blend` is the default, on thin evidence.** By the rule I wrote beforehand it had to be: better than harmonic
   on two variants, worse on none. But only two of the twelve variants put a size between two tree sizes, both on
   one river game; elsewhere the three rules are the same rule. I added a second game afterwards (amendment 3,
   outside the rule): on its two between-sizes blend costs 0.49 and 0.05% of the pot a player, harmonic 4.81 and 4.10, nearest 6.14 and 2.26; blend is BETTER than both other rules on 2 of 2. If you prefer one size to two with weights, `harmonic` and `nearest` are one
   word away in every tool.
3. **`blend` is an interpolation of two strategies, not a coin flip between them.** The coin-flip version is the
   one in the literature. It needs a memory a strategy table does not have; I built what the file format can hold
   and say so. Its measured cost is the interpolation's.
4. **A small bet is never taken as a check, and all-in is a size like any other.** Both are choices. The second
   means a large non-all-in bet can be taken as the tree's all-in, after which the tree has nothing to say; the
   tools report when that happens.
5. **Translated states are a new kind of file.** They look like checkpoints and cannot be trained. I gave them
   their own identifier so that no earlier program can mistake them for a trained state, rather than a new file
   format, because every evaluator already reads EMMW4.
6. **No re-solving.** The obvious next step - add the size and continue training from the translated strategy - is
   not in 5.18. It would be a change to training, with its own identifier and its own comparison against training
   from scratch.
7. **The measurement is on three games I chose**, with one or two sizes a street. Real studies have more sizes; the
   gaps between them are smaller and the cost of a size between two of them should be smaller. That is an
   expectation, not a result.
8. **The explorer field is in the desktop explorer only**, maps one bet at one node and uses the tree's pot.

## 6. Unresolved, not done, or not established

* The cost of a missing size for three or more seats, preflop and tournament payoffs.
* Two missing sizes at once; trees with three or more sizes a street.
* Whether pseudo-harmonic weights are the best weights for blending; the draw-once mapping.
* Continuing training after adding a size.
* The equal-time comparison on your processor (here: one thread, 4 cores).
* Still open from Phase 7: method exact-hu on the graphics card. From Phase 4: `rbes` as automatic trainer (your
  run of the 5.13 kit), pruning and threads on your processor (the 5.14 equal-time launcher).
* From earlier phases, unchanged: ROADMAP.md.

## 7. What to run, and what to send back

WINDOWS-TESTS-5.18.md has the steps. In order of value:

1. `Run 5.18 focused validation.bat`: send `Windows-focused-validation-5.18.json`, `.txt`,
   `Windows-selftest518-5.18.json`. It also answers the open question of 5.17 about the graphics card.
2. `Run 5.18 Windows validation.bat` (GPU included): `Windows-validation-5.18.json`, `.txt`, the thirteen
   `Windows-selftest*-5.18.json`, `hardware-validation.json`.
3. The 5.13 `rbes` kit, if not yet run: its folder `rbes-equal-time-results`.
4. `Run 5.14 equal-time comparison.bat`: the folder `equal-time-results` without `units`.
