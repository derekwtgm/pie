# EightMax 5.11: performance

5.11 changes the cost of one thing: a random number of a training with the new streams. Nothing else in the trainer,
the evaluators or the scheduler changed. With the 5.10 streams the 5.11 program executes the 5.10 arithmetic.

All numbers are from machines named in the tables. **None is from the target PC**; `Run 5.11 Windows validation.bat`
prints the same measurement there (section "streams 5.11", class `information`).

## 1. Time per sampled deal, 5.10 streams against philox64 (build machine)

`validation/5.11/performance/bench511.py`: one thread, the same program, the same number of deals; the two arms
alternate five times and the fastest run of each is reported. Linux, Intel Xeon 2.1 GHz, 2 logical processors.
Raw: `validation/5.11/performance/bench511-build-machine.json`.

| Game | Kind | 5.10 streams, ns per deal | philox64, ns per deal | Time ratio |
|---|---|---:|---:|---:|
| hu-river | reference | 779 | 745 | 0.956 |
| rg-hu-turn | reference | 1,011 | 1,062 | 1.050 |
| rg-river3 | reference | 1,382 | 1,484 | 1.074 |
| turn4 | reference | 1,781 | 2,207 | 1.239 |
| rg-turn4 | reference | 2,692 | 2,856 | 1.061 |
| flop6 | reference | 3,416 | 3,759 | 1.100 |
| rg-flop6c | reference | 6,421 | 7,320 | 1.140 |
| rg-icm3-river | reference | 1,735 | 1,792 | 1.033 |
| final8 | reference | 4,867 | 5,233 | 1.075 |
| mid3-turn | reference | 2,711 | 2,995 | 1.105 |
| flop3-kings | fixture | 9,344 | 10,081 | 1.079 |
| flop3-kings | fixture, batches of 64 | 10,380 | 10,617 | 1.023 |
| flop6-jack | fixture | 25,082 | 24,656 | 0.983 |
| flop6-jack | fixture, batches of 64 | 24,778 | 27,643 | 1.116 |
| flop3-kings-detailed | fixture | 18,918 | 19,408 | 1.026 |
| flop3-kings-detailed | fixture, batches of 64 | 21,041 | 20,389 | 0.969 |
| icm8-bb-call | fixture | 3,607 | 3,677 | 1.020 |
| icm8-bb-call | fixture, batches of 64 | 3,133 | 3,325 | 1.061 |
| btn25-open | fixture | 7,952 | 8,172 | 1.028 |
| btn25-open | fixture, batches of 64 | 7,823 | 7,894 | 1.009 |

Median time ratio: reference games 1.075, fixtures 1.026, fixtures with batches of 64 1.023.

The measurement is noisy at the level of a few percent (two games come out faster with the more expensive generator,
which cannot be real). What it supports: **about 2 to 3% more time per deal on the study fixtures, 5 to 15% on the
small reference games**. The difference is the generator: Philox4x64-10 costs about twenty 64-bit multiplications
per four numbers, the 32-bit generator of 5.10 three 32-bit multiplications per number, and a small game spends a
larger share of a deal drawing numbers.

## 2. The same on other machines

Sampled deals per second, printed by section "streams 5.11" of the validation script; each cell is ONE run on a shared virtual machine, so differences of several percent between two cells are not resolved.

| Machine | Fixture | Threads offered | 5.10 streams | philox64 | Ratio |
|---|---|---:|---:|---:|---:|
| hosted Windows runner (Windows Server 2025, 4 virtual processors), Windows programs | flop6-jack | 1 | 50,001 | 47,568 | 0.951 |
| hosted Windows runner (Windows Server 2025, 4 virtual processors), Windows programs | flop6-jack | 4 | 116,701 | 115,317 | 0.988 |
| hosted Windows runner (Windows Server 2025, 4 virtual processors), Windows programs | flop3-kings | 1 | 112,580 | 100,324 | 0.891 |
| hosted Windows runner (Windows Server 2025, 4 virtual processors), Windows programs | flop3-kings | 4 | 247,822 | 224,568 | 0.906 |
| hosted Windows runner (Windows Server 2025, 4 virtual processors), Windows programs | known-akq-river | 1 | 2,582,184 | 2,557,272 | 0.990 |
| hosted Linux runner (Ubuntu 24.04, 4 virtual processors), Linux programs | flop6-jack | 1 | 61,712 | 58,969 | 0.956 |
| hosted Linux runner (Ubuntu 24.04, 4 virtual processors), Linux programs | flop6-jack | 4 | 119,092 | 111,760 | 0.938 |
| hosted Linux runner (Ubuntu 24.04, 4 virtual processors), Linux programs | flop3-kings | 1 | 140,531 | 131,313 | 0.934 |
| hosted Linux runner (Ubuntu 24.04, 4 virtual processors), Linux programs | flop3-kings | 4 | 240,539 | 229,052 | 0.952 |
| hosted Linux runner (Ubuntu 24.04, 4 virtual processors), Linux programs | known-akq-river | 1 | 3,312,363 | 3,333,519 | 1.006 |


## 3. What that does to results at equal time

CONVERGENCE-5.11.md: in two seconds of training on 17 small games the philox64 arm trained a median of 0.887 of the
deals of the 5.10 arm (other work was running on that machine), and the pooled exact NashConv was 1.030 of 5.10's
(interval 0.985 to 1.078).

## 4. Not optimised, and why

The generator was not made cheaper in this release. Two ways exist - seven rounds instead of ten, or 32-bit numbers
for the action samples - and each would be a different stream algorithm with its own identifier, states and
validation. They are noted for Phase 4 (faster multiway convergence), where time per deal is the subject and where
they can be judged against a measured rule.

## 5. Unchanged

Memory: a philox64 state stores no generator state and the engine holds 100 bytes of stream state per worker; table
sizes are those of 5.10. Thread scaling, CUDA scoring and the evaluators: no change (no such code was touched).
