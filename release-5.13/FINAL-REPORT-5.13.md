# EightMax 5.13: final development report (Phase 3: satellites)

Build `e9ce3436fa829e47`, successor of 5.12 `913dc2280e5088ae`. This report covers Phase 3 only.

## 0. The short version

**Asked:** a satellite setup (equal prizes for the top N), bubble fixtures checked against exact answers on small
cases, and an approximation for large fields with players at other tables.

**Delivered:**

| | | Status |
|---|---|---|
| Satellite setup for up to 16 players | `satellite N` wherever payouts are typed: the existing exact ICM with N equal prizes | done; no engine change; same bytes as 5.12 |
| Large fields: payoff model `satfield-5.13-v1` (up to 5,000 players, 2,000 seats) | ICM tab card, Multiway payoff, native engine, `mwcli --satfield` | done |
| ... its formula | Malmuth-Harville top-N probability as one integral | **proven** (MATHEMATICAL-VALIDATION-5.13.md) |
| ... its numbers | 2.1e-14 from exact rational values on small fields; 2.0e-10 from an independent integration up to 5,000 players | **tested**; error measured, not bounded by proof |
| Bubble fixtures against exact answers | six fixtures; folding aces and a mixed river spot against closed forms derived by hand and computed independently | **tested** |
| Existing trainers and utilities | the unchanged 5.12 binary: 225 configurations and 80 fixture cases, 0 differences | **tested** |
| Self-test, Windows script, launchers, ZIP, identity file, reports, branch | | delivered |
| Your PC, the GPU | | **untested** - and 5.11 and 5.12 with it |

**Four things you should know before anything else.**

1. **The "approximation for large fields" is exact in its arithmetic and approximate in its input.** Under the ICM
   model the large-field value is computed to about 1e-14; that part needed no approximation. What is approximate
   is what you can know about the other tables. Entering them as "K players with the average stack" moved a seat
   probability by 1.3 points in the median and **by up to 35 points** in my test fields; three groups kept it within
   11 points. By the rule I wrote beforehand that is too much to call good enough, so the program does not call it
   that: it tells you beside the input. If you can enter the real stacks of the other tables, do.
2. **5.12 as delivered has a defect: its launchers return exit status 1 on every PC.** The manifest check demands
   more than 3,000 files and the 5.12 archive has 1,949 (every one of which matches). I caused it by moving old
   evidence out of the ZIP without changing the check, and my pre-packaging runs could not see it because they used
   a tree without a manifest. It is fixed in 5.13 and documented beside the 5.12 ZIP. Run 5.13, not 5.12.
3. **Three releases are now waiting for your PC** (5.11, 5.12, 5.13). The 5.13 focused launcher runs the checks of
   all three in 10 to 25 minutes. Phase 4 needs more from your PC than that: equal-time results for `rbes`, for which
   I still owe you a launcher.
4. **This phase changed engine files** (Phase 2 changed none): one branch in the ICM evaluation, new spec and header
   fields. Nothing a 5.12 study does goes through the new code, and the unchanged 5.12 binary agrees byte for byte
   on everything it can train; but the claim rests on those tests, not on untouched files.

## 1. Baseline

The delivered 5.12 archive rebuilt byte for byte (7 artifacts). Its regression suite (682: 680 / 1 / 1) and seven
self-tests had run on this machine on the unmodified build the same day; I did not run them a second time.

## 2. What was built

* **`native/satfield513.hpp`**: the model. Finishing orders under Malmuth-Harville are the order of independent
  exponential clocks, so the probability of a top-N finish is one integral of a density times the probability that
  fewer than N others are ahead; the count of others is a sum of independent indicators. The field's part is
  tabulated once per study at fixed quadrature nodes; an evaluation adds the seats of the table. No library
  exponential is used, so Windows and Linux compute the same bits.
* **Engine:** `icm.model = "satellite-field"` with `seats` and `field` in a protocol-4 spec; the per-worker ICM cache
  is reused; header, information, continuation rules; refused by earlier programs for want of a payout table.
* **Interface:** payout shorthand; the satellite card of the ICM tab (shows the exact recursion beside the model when
  the field has 16 players or fewer); the Multiway payoff "Satellite, large field"; a JavaScript mirror of the model
  that prints the native program's bits; a "Satellites" group in the Study list.
* **Fixtures:** `sat5-bubble-bb-call`, `satfield-bb-call` (each with a small exact companion), `sat3-fold-aces`,
  `known-sat-akq-river`.
* **Checks:** `mwcli --selftest513` (14), `tests/v513.test.js` (11), `tools/independent_satfield513.py`,
  `tools/sat_ui513.js`, `validate_windows513.ps1`.

Not built: satellite payouts with a different last prize (seat plus cash for the bubble); a way to import the other
tables' stacks from a lobby; postflop satellite fixtures; anything that models the end of play at the bubble.

## 3. Rules written before measuring, and their outcomes

| Rule | Outcome |
|---|---|
| A: 1e-9 from exact values on small fields | met (2.1e-14) |
| B: 1e-9 from the program's exact recursion | met (7.2e-15) |
| C: 1e-8 from an independent integration on large fields; sums; sampled orders | met (2.0e-10; 2.0e-15; 5 of 5 fields inside the interval) - after I replaced my reference integrator, whose first version was not accurate enough to judge (VALIDATION-5.13.md, section 3) |
| D: field summaries, information; "good enough" only below 0.01 | not below: up to 0.348 (average only), 0.106 (three groups); reported as the size of the approximation |
| E: existing trainers untouched | met (225 configurations and 80 fixture cases, 0 differences) |
| F: fixtures; closed forms | met |
| G: one spot under both payoff models | met (4.4e-16, 5.6e-17) |

The regression suite caught one mistake of mine before release (a change to the Multiway form's default example
that altered how the 5.12 fixtures regenerate; VALIDATION-5.13.md, section 6), and the hosted run of the delivered 5.12
archive caught another (the manifest floor). Each cost a rebuild; all evidence is of the final build.

Two things did not go as first written and are stated where they belong: the reference of rule C, and the first
version of the mixed river fixture, which had no mixing (the kings always fold when aces and queens are equally
likely); I changed its range weights after the program showed that, and the closed form with them.

## 4. Proven, tested, untested

* **Proven:** the formula of the large-field model (three short steps); that exactly N seats are awarded in sum.
* **Tested:** everything in section 0's table; VALIDATION-5.13.md.
* **Not proven:** a bound for the quadrature error; bit-identity across all compilers and processors (it is a
  consequence of IEEE arithmetic and was observed on three platforms).
* **Untested on your hardware:** everything.

## 5. Decisions I made that are yours to overrule

1. **A seat is worth 1** and satellite EVs are probabilities, not percent of a prize pool.
2. **Field limits:** 5,000 players, 2,000 seats, players x seats at most 2,000,000 (set-up time grows with the
   product: about a second at the limit).
3. **A player without chips gets 0** in the large-field model, so it requires more players at other tables than
   seats; smaller fields use `satellite N`.
4. **The large-field model is for the Multiway engine and the ICM tab**, not for the push/fold and 15-100 BB custom
   solvers (they take `satellite N` up to 16 players).
5. **The second archive was not delivered again** (it is the 5.12 file, verified by SHA-256).
6. **I did not re-release 5.12** for its manifest defect; 5.13 replaces it.
7. **The 5.3 test that fails on fast machines** is still unchanged.

## 6. Unresolved, not done, or not established

* Nothing ran on your PC or a GPU; three releases are waiting.
* The cost of not knowing the other tables' stacks is large and has no remedy inside the program.
* Malmuth-Harville near a satellite bubble: not examined. The model does not know that play stops when the bubble
  bursts, that blinds rise, or who is about to post.
* The quadrature error has no proven bound; the independent reference is itself only accurate to about 3.0e-09 on
  the largest fields.
* Cost of the model in trees with many distinct outcomes (postflop): not measured. In the push-or-fold fixtures the
  cache answers almost every evaluation (satfield-bb-call-small: baseline (satellite-field) 1,383,509 deals/s, chip-ev 1,506,557 deals/s; satfield-bb-call: baseline (satellite-field) 423,230 deals/s, chip-ev 446,957 deals/s; sat5-bubble-bb-call: baseline (ordinary ICM) 419,595 deals/s, chip-ev 442,579 deals/s; set-up plus one evaluation: 121 players / 40 seats 0.01 s, 2000 players / 500 seats 1.85 s, 2000 players / 900 seats 3.63 s).
* From Phase 2, unchanged: the 15-100 BB charts against played-out postflop; the push/fold charts and folded
  players' cards.
* The root-level 2.9 workflow still runs and fails on every push; the in-tree MSYS2 workflow was updated and not run.

## 7. What to run, and what to send back

WINDOWS-TESTS-5.13.md: `Run 5.13 focused validation.bat`, then `Run 5.13 Windows validation.bat`, six things to
look at, the report files listed there.
