# EightMax 5.10: performance

Build `7fa0e8c16d6c6ade` against the unchanged 5.9 program (build `00600c81455ead44`). Evidence: `validation/5.10/performance/`
(`bench510.py`; wall times, Linux-6.18.44-fc-v880-x86_64-with-glibc2.39, 4 logical processors, an otherwise idle machine, alternating repetitions) and
`validation/5.10/profile/` (`profile510.sh`; instruction counts with valgrind, which do not depend on the machine's
load). Training speed, memory, response training and whole studies are reported separately.

**Every time below is from a 4-processor development container.** Nothing was timed on the i7-13700F; the Windows
validation script prints that PC's own numbers (sections "throughput" and "estimator 5.10").

## 1. Summary

| Question | Answer |
|---|---|
| Is the default trainer faster? | **Only with Detailed hand groups** (0.89 to 0.96 of the 5.9 time). Everywhere else it is the 5.9 trainer at the 5.9 speed: ratios of 0.97 to 1.10 (median 1.00) over 16 measurements, +0.5% to +1.1% instructions. One small fixture (`flop6-jack-small`) measured 7 to 10% slower; instruction counts do not show a cause, and it is reported as measured |
| Are its states the 5.9 states? | Yes: 20 of 20 benchmark rows, 1, 2 and 4 threads |
| What does a deal of `rbes` cost? | 1.6 to 16 times a deal of the default on the reference games; 2.9 times on the six-player flop fixture; 9.7 times on the three-player flop fixture; **36 times with Detailed groups and 210 to 250 times on the two preflop fixtures**, where it should not be used |
| Does `rbes` use threads? | Yes: 1.9 to 2.5 times the one-thread rate on 4 threads (the default: 1.8 to 2.7), one state for every thread count |
| Memory | The `rbes` table holds 2 to 2.6 times the rows of the default's at the same deals on the flop fixtures; **with Detailed groups 38 times (1.46 GiB after 30,000 deals)** and on a preflop fixture 170 times |
| Is the default trained response faster? | No: the same bits and, within noise, the same time as 5.9 |
| What does `"responseEstimator":"rbes"` buy? | A much stronger response for more training time per deal. At the same response deals it finds 92 to 99% of exact NashConv on three small fixtures where the default response finds 70 to 92%, and on the two flop fixtures it certifies 1.66 and 2.29 BB where the default response certifies 0.14 and 0.02 BB. At a quarter of the deals - no more training time than the default on five of six games - it still finds more on five of six |
| A complete study | default: 98 s (5.9) and 99 s (5.10); with `estimator=rbes` 128 s for the same budgets |

## 2. The default trainer: 5.9 against 5.10

Rule: the algorithm is unchanged, so the two programs must write the same state; a row whose states differ would be
void. 5 alternating repetitions (5.9, 5.10, 5.9, ...); median and minimum of the training call.

| Fixture or game | Deals per update | Threads | Sampled deals | 5.9: median s (min) | 5.10: median s (min) | 5.10 / 5.9, medians | minima | 5.10 deals per second | States identical |
|---|---|---|---|---|---|---|---|---|---|
| `flop6-jack` | 1 | 1 | 120,000 | 2.77 (2.57) | 2.76 (2.61) | 0.998 | 1.01 | 43,476 | yes |
| `flop3-kings` | 1 | 1 | 300,000 | 3.45 (3.01) | 3.34 (3.25) | 0.967 | 1.08 | 89,928 | yes |
| `flop3-kings-detailed` | 1 | 1 | 150,000 | 3.79 (3.58) | 3.54 (3.27) | 0.935 | 0.913 | 42,324 | yes |
| `btn25-open` | 1 | 1 | 300,000 | 3.21 (2.99) | 3.18 (3.06) | 0.993 | 1.02 | 94,220 | yes |
| `icm8-bb-call` | 1 | 1 | 1,000,000 | 2.93 (2.66) | 2.99 (2.6) | 1.02 | 0.979 | 334,635 | yes |
| `flop6-jack-small` | 1 | 1 | 400,000 | 2.12 (1.91) | 2.32 (2.05) | 1.1 | 1.07 | 172,057 | yes |
| `rg-hu-river` | 1 | 1 | 2,000,000 | 1.61 (1.58) | 1.55 (1.53) | 0.966 | 0.966 | 1,288,492 | yes |
| `final8` | 1 | 1 | 600,000 | 2.66 (2.49) | 2.59 (2.53) | 0.977 | 1.01 | 231,239 | yes |
| `flop6-jack` | 64 | 1 | 192,000 | 4.57 (4.5) | 4.69 (4.43) | 1.02 | 0.984 | 40,953 | yes |
| `flop6-jack` | 64 | 2 | 192,000 | 2.7 (2.58) | 2.78 (2.66) | 1.03 | 1.03 | 69,145 | yes |
| `flop6-jack` | 64 | 4 | 192,000 | 1.78 (1.73) | 1.72 (1.66) | 0.967 | 0.957 | 111,403 | yes |
| `flop3-kings` | 64 | 1 | 384,000 | 4.08 (3.85) | 4.17 (3.75) | 1.02 | 0.974 | 92,077 | yes |
| `flop3-kings` | 64 | 2 | 384,000 | 2.85 (2.66) | 2.76 (2.7) | 0.968 | 1.02 | 139,270 | yes |
| `flop3-kings` | 64 | 4 | 384,000 | 1.8 (1.76) | 1.82 (1.73) | 1.01 | 0.984 | 211,416 | yes |
| `flop3-kings-detailed` | 64 | 1 | 192,000 | 5.14 (4.98) | 4.76 (4.45) | 0.926 | 0.894 | 40,319 | yes |
| `flop3-kings-detailed` | 64 | 2 | 192,000 | 3.38 (3.3) | 3.24 (2.98) | 0.958 | 0.902 | 59,328 | yes |
| `flop3-kings-detailed` | 64 | 4 | 192,000 | 2.54 (2.2) | 2.27 (2.21) | 0.893 | 1 | 84,479 | yes |
| `btn25-open` | 64 | 1 | 384,000 | 4.42 (4.33) | 4.68 (4.11) | 1.06 | 0.95 | 82,082 | yes |
| `btn25-open` | 64 | 2 | 384,000 | 3.03 (3) | 3.17 (2.95) | 1.04 | 0.982 | 121,095 | yes |
| `btn25-open` | 64 | 4 | 384,000 | 2.23 (2.04) | 2.17 (2.12) | 0.974 | 1.04 | 176,761 | yes |

States identical in 20 of 20 rows. The ratio of the medians over all rows except the Detailed fixture is
0.97 to 1.10 (median 1.00); on the Detailed fixture it is 0.89 to 0.96 (the identifier cache of
TRAINING-ENGINE-5.10.md, section 5).

Instructions executed for the same work (one training call that continues the same saved state):

| Workload | Trainer | Deals (after a prefix of) | Instructions, 5.9 | Instructions, 5.10 | 5.10 / 5.9 | Instructions per deal, 5.10 | States identical |
|---|---|---|---|---|---|---|---|
| `rg-hu-river` | default | 200,000 (100,000) | 1,257,620,187 | 1,265,766,438 | 1.0065 | 6,329 | yes |
| `rg-turn3` | default | 100,000 (100,000) | 2,410,796,063 | 2,421,923,706 | 1.0046 | 24,219 | yes |
| `flop6-jack` | default | 12,000 (60,000) | 1,649,193,759 | 1,661,390,974 | 1.0074 | 138,449 | yes |
| `flop3-kings` | default | 12,000 (60,000) | 899,039,154 | 908,592,355 | 1.0106 | 75,716 | yes |
| `flop3-kings-detailed` | default | 6,000 (20,000) | 2,604,450,496 | 2,599,295,428 | 0.9980 | 433,216 | yes |
| `flop6-jack` | rbes | 5,000 (20,000) | - | 3,364,908,397 | - | 672,982 | - |
| `rg-hu-river` | rbes | 50,000 (100,000) | - | 6,128,951,239 | - | 122,579 | - |

The default path executes +0.5% to +1.1% instructions relative to 5.9 on the four workloads without Detailed keys
(the option's fields in the walker and the game object) and -0.2% on the Detailed fixture. Thread counts
of 8 and the measured thread choice are covered for IDENTITY (not for speed) by `validation/5.10/identity/`
(225 configurations, 1,782 trainings, 0 differences).

## 3. `rbes` against the default trainer, at the same number of sampled deals

One thread, one deal per update (the fixtures as shipped).

| Fixture or game | Trainer | Sampled deals | Seconds (median of 3) | Deals per second | State visits per deal | Information sets (rows) | Table MiB | Process peak MiB | Hands carried per seat walk | Rows written per deal |
|---|---|---|---|---|---|---|---|---|---|---|
| `flop6-jack` | default | 120,000 | 2.94 | 40,843 | 246 | 167,537 | 17.2 | 342 |  |  |
| `flop6-jack` | rbes | 120,000 | 8.63 | 13,902 | 280 | 361,789 | 35 | 342 | 46 | 227 |
| `flop3-kings` | default | 60,000 | 0.609 | 98,534 | 122 | 87,926 | 8.48 | 342 |  |  |
| `flop3-kings` | rbes | 60,000 | 5.88 | 10,210 | 178 | 230,184 | 20.2 | 342 | 180 | 557 |
| `flop3-kings-detailed` | default | 30,000 | 0.572 | 52,468 | 117 | 437,775 | 53.2 | 342 |  |  |
| `flop3-kings-detailed` | rbes | 16,832 | 11.6 | 1,449 | 163 | 16,772,629 | 1.46e+03 | 1.5e+03 | 180 | 3.27e+03 |
| `btn25-open` | default | 3,000 | 0.0275 | 109,186 | 56.9 | 22,697 | 3.53 | 342 |  |  |
| `btn25-open` | rbes | 3,000 | 5.81 | 516 | 107 | 3,880,735 | 348 | 379 | 903 | 4.22e+03 |
| `icm8-bb-call` | default | 6,000 | 0.0263 | 228,319 | 16.6 | 1,003 | 2.19 | 342 |  |  |
| `icm8-bb-call` | rbes | 6,000 | 6.6 | 909 | 18.5 | 1,014 | 18 | 342 | 903 | 505 |
| `rg-hu-river` | default | 400,000 | 0.338 | 1,183,015 | 14.2 | 468 | 0.091 | 342 |  |  |
| `rg-hu-river` | rbes | 400,000 | 5.51 | 72,559 | 20.4 | 468 | 0.091 | 342 | 50.4 | 215 |
| `rg-river3` | default | 400,000 | 0.552 | 725,160 | 26.8 | 752 | 0.12 | 342 |  |  |
| `rg-river3` | rbes | 400,000 | 4.29 | 93,271 | 35.8 | 752 | 0.12 | 342 | 23.7 | 128 |
| `rg-hu-turn` | default | 400,000 | 0.39 | 1,024,918 | 18.5 | 6,016 | 0.602 | 342 |  |  |
| `rg-hu-turn` | rbes | 400,000 | 3.29 | 121,631 | 19.9 | 6,016 | 0.602 | 342 | 27.8 | 124 |
| `rg-turn3` | default | 200,000 | 0.69 | 289,908 | 49.9 | 71,163 | 7.4 | 342 |  |  |
| `rg-turn3` | rbes | 200,000 | 3.58 | 55,795 | 62.5 | 86,194 | 8.31 | 342 | 17.5 | 176 |
| `rg-turn4` | default | 400,000 | 1.01 | 396,148 | 43.6 | 26,836 | 2.44 | 342 |  |  |
| `rg-turn4` | rbes | 400,000 | 3.29 | 121,605 | 54.9 | 33,178 | 3.57 | 342 | 7.95 | 64.4 |
| `rg-icm3-river` | default | 400,000 | 0.644 | 621,051 | 27.1 | 752 | 0.12 | 342 |  |  |
| `rg-icm3-river` | rbes | 400,000 | 4.5 | 88,975 | 36.7 | 752 | 0.12 | 342 | 23.7 | 128 |
| `rg-bubble4` | default | 400,000 | 0.649 | 616,261 | 29.6 | 70 | 0.065 | 342 |  |  |
| `rg-bubble4` | rbes | 400,000 | 1.44 | 277,141 | 29.9 | 70 | 0.065 | 342 | 3.64 | 14.6 |
| `rg-flop6c` | default | 200,000 | 1.11 | 180,370 | 145 | 1,188 | 0.274 | 342 |  |  |
| `rg-flop6c` | rbes | 200,000 | 2.16 | 92,437 | 157 | 1,198 | 0.275 | 342 | 3.08 | 24.2 |
| `hu-river` | default | 1,000,000 | 0.6 | 1,666,580 | 15 | 48 | 0.062 | 342 |  |  |
| `hu-river` | rbes | 1,000,000 | 2.15 | 465,880 | 22.2 | 48 | 0.062 | 342 | 5.58 | 25.6 |
| `final8` | default | 400,000 | 1.72 | 231,998 | 108 | 343 | 0.094 | 342 |  |  |
| `final8` | rbes | 400,000 | 2.79 | 143,179 | 114 | 324 | 0.092 | 342 | 1 | 8 |
| `flop6` | default | 400,000 | 1.23 | 324,397 | 88 | 379 | 0.088 | 342 |  |  |
| `flop6` | rbes | 400,000 | 2.02 | 197,774 | 97.3 | 384 | 0.088 | 342 | 1.89 | 13.7 |

Per deal `rbes` is slower, because it writes every row of the updating seat, and its table holds more rows at the
same number of deals, because it creates them sooner:

| Fixture or game | Time per deal, rbes / default | Rows at the same deals, rbes / default | Table MiB: default | rbes |
|---|---|---|---|---|
| `flop6-jack` | 2.94 | 2.16 | 17.2 | 35 |
| `flop3-kings` | 9.65 | 2.62 | 8.48 | 20.2 |
| `flop3-kings-detailed` | 36.2 | 38.3 | 53.2 | 1.46e+03 |
| `btn25-open` | 211 | 171 | 3.53 | 348 |
| `icm8-bb-call` | 251 | 1.01 | 2.19 | 18 |
| `rg-hu-river` | 16.3 | 1 | 0.091 | 0.091 |
| `rg-river3` | 7.77 | 1 | 0.12 | 0.12 |
| `rg-hu-turn` | 8.43 | 1 | 0.602 | 0.602 |
| `rg-turn3` | 5.2 | 1.21 | 7.4 | 8.31 |
| `rg-turn4` | 3.26 | 1.24 | 2.44 | 3.57 |
| `rg-icm3-river` | 6.98 | 1 | 0.12 | 0.12 |
| `rg-bubble4` | 2.22 | 1 | 0.065 | 0.065 |
| `rg-flop6c` | 1.95 | 1.01 | 0.274 | 0.275 |
| `hu-river` | 3.58 | 1 | 0.062 | 0.062 |
| `final8` | 1.62 | 0.945 | 0.094 | 0.092 |
| `flop6` | 1.64 | 1.01 | 0.088 | 0.088 |

Whether that cost is repaid is a question about strategies, not about throughput: CONVERGENCE-5.10.md.

### 3.1 Threads (frozen batches of 64 deals)

| Fixture or game | Trainer | Threads | Sampled deals | Seconds (median of 3) | Deals per second | Speed-up over one thread | One state for every thread count |
|---|---|---|---|---|---|---|---|
| `flop6-jack` | default | 1 | 288,000 | 7.18 | 40,129 | 1 | yes |
| `flop6-jack` | default | 2 | 288,000 | 4.19 | 68,731 | 1.71 | yes |
| `flop6-jack` | default | 4 | 288,000 | 2.64 | 109,166 | 2.72 | yes |
| `flop6-jack` | rbes | 1 | 96,000 | 6.62 | 14,500 | 1 | yes |
| `flop6-jack` | rbes | 2 | 96,000 | 4.32 | 22,237 | 1.53 | yes |
| `flop6-jack` | rbes | 4 | 96,000 | 2.69 | 35,662 | 2.46 | yes |
| `flop3-kings` | default | 1 | 115,200 | 1.12 | 103,287 | 1 | yes |
| `flop3-kings` | default | 2 | 115,200 | 0.841 | 137,053 | 1.33 | yes |
| `flop3-kings` | default | 4 | 115,200 | 0.606 | 190,203 | 1.84 | yes |
| `flop3-kings` | rbes | 1 | 38,400 | 3.67 | 10,470 | 1 | yes |
| `flop3-kings` | rbes | 2 | 38,400 | 2.39 | 16,071 | 1.53 | yes |
| `flop3-kings` | rbes | 4 | 38,400 | 1.67 | 22,946 | 2.19 | yes |
| `rg-turn3` | default | 1 | 576,000 | 2.11 | 273,224 | 1 | yes |
| `rg-turn3` | default | 2 | 576,000 | 1.64 | 350,528 | 1.28 | yes |
| `rg-turn3` | default | 4 | 576,000 | 1.04 | 551,763 | 2.02 | yes |
| `rg-turn3` | rbes | 1 | 192,000 | 3.24 | 59,263 | 1 | yes |
| `rg-turn3` | rbes | 2 | 192,000 | 2.45 | 78,337 | 1.32 | yes |
| `rg-turn3` | rbes | 4 | 192,000 | 1.73 | 111,191 | 1.88 | yes |

The container has four logical processors; scaling on 16 cores / 24 threads is unmeasured (WINDOWS-TESTS-5.10.md,
section 2, prints it).

## 4. Trained-response analysis

The response of each seat is trained against the frozen strategies of the others, then evaluated. Three questions:
is the DEFAULT response unchanged (it must give the same bits), how long does its training take in 5.9 and 5.10,
and what does `"responseEstimator":"rbes"` change. On the four games small enough for the exact evaluator, the last
but one column is the share of exact NashConv that the trained responses actually find - the quantity a better
response trainer raises.

| Fixture or game | Program and response trainer | Response deals per seat | Response training s (all seats) | Evaluation s | Whole analysis s | Sum of sampled seat gains | Simultaneous 95% lower bound of NashConv | Exact NashConv | Share of exact NashConv the responses find | Default response: 5.9 and 5.10 bits identical |
|---|---|---|---|---|---|---|---|---|---|---|
| `flop3-kings-small` | 5.9 default | 50,000 | 0.0927 | 0 | 0.435 | 0.149 | 0.0575 | 0.16 | 91% | yes |
| `flop3-kings-small` | 5.10 default | 50,000 | 0.111 | 0 | 0.401 | 0.149 | 0.0575 | 0.16 | 91% | yes |
| `flop3-kings-small` | 5.10 rbes | 50,000 | 0.197 | 0 | 0.525 | 0.16 | 0.0656 | 0.16 | 99% | yes |
| `flop3-kings-small` | 5.10 rbes, a quarter of the response deals | 12,500 | 0.0554 | 0 | 0.357 | 0.155 | 0.0621 | 0.16 | 93% | yes |
| `flop6-jack-small` | 5.9 default | 50,000 | 0.338 | 0 | 3.16 | 0.451 | 0.117 | 0.608 | 77% | yes |
| `flop6-jack-small` | 5.10 default | 50,000 | 0.349 | 0 | 3 | 0.451 | 0.117 | 0.608 | 77% | yes |
| `flop6-jack-small` | 5.10 rbes | 50,000 | 0.561 | 0 | 3.35 | 0.524 | 0.154 | 0.608 | 92% | yes |
| `flop6-jack-small` | 5.10 rbes, a quarter of the response deals | 12,500 | 0.178 | 0 | 2.9 | 0.328 | 0.106 | 0.608 | 61% | yes |
| `icm8-bb-call-small` | 5.9 default | 50,000 | 0.0702 | 0 | 31.1 | 0.0184 | 0.00253 | 0.0261 | 70% | yes |
| `icm8-bb-call-small` | 5.10 default | 50,000 | 0.0725 | 0 | 31 | 0.0184 | 0.00253 | 0.0261 | 70% | yes |
| `icm8-bb-call-small` | 5.10 rbes | 50,000 | 0.137 | 0 | 31.9 | 0.0266 | 0.00431 | 0.0261 | 98% | yes |
| `icm8-bb-call-small` | 5.10 rbes, a quarter of the response deals | 12,500 | 0.0372 | 0 | 33.1 | 0.0207 | 0.00208 | 0.0261 | 76% | yes |
| `rg-turn4` | 5.9 default | 50,000 | 0.205 | 0 | 11.3 | 0.0051 | 0 | 0.783 | 0% | yes |
| `rg-turn4` | 5.10 default | 50,000 | 0.185 | 0 | 9.6 | 0.0051 | 0 | 0.783 | 0% | yes |
| `rg-turn4` | 5.10 rbes | 50,000 | 0.5 | 0 | 9.65 | 0.557 | 0.353 | 0.783 | 74% | yes |
| `rg-turn4` | 5.10 rbes, a quarter of the response deals | 12,500 | 0.169 | 0 | 9.69 | 0.196 | 0.0439 | 0.783 | 26% | yes |
| `flop3-kings` | 5.9 default | 100,000 | 1.49 | 0 | 4.87 | 0.142 | 0.143 | - | - | yes |
| `flop3-kings` | 5.10 default | 100,000 | 1.34 | 0 | 4.35 | 0.142 | 0.143 | - | - | yes |
| `flop3-kings` | 5.10 rbes | 100,000 | 9.92 | 0 | 12.8 | 1.84 | 1.66 | - | - | yes |
| `flop3-kings` | 5.10 rbes, a quarter of the response deals | 25,000 | 3.16 | 0 | 6.16 | 1.35 | 1.2 | - | - | yes |
| `flop6-jack` | 5.9 default | 100,000 | 3.74 | 0 | 14.9 | 0.0885 | 0.0211 | - | - | yes |
| `flop6-jack` | 5.10 default | 100,000 | 3.92 | 0 | 15.5 | 0.0885 | 0.0211 | - | - | yes |
| `flop6-jack` | 5.10 rbes | 100,000 | 9.64 | 0 | 21.9 | 2.74 | 2.29 | - | - | yes |
| `flop6-jack` | 5.10 rbes, a quarter of the response deals | 25,000 | 3.53 | 0 | 15.5 | 1.43 | 1.03 | - | - | yes |

Reading the table.

* **The default response is unchanged**: identical bits in all six games, and training times within the noise of
  repeated runs.
* **Same response deals.** The response trained by `rbes` takes 1.6 to 7 times the training time and finds more in
  every game: 99%, 92% and 98% of exact NashConv against 92%, 77% and 70% on the three small fixtures; on the
  four-player turn game the default response finds nothing (its estimated gain is 0.005 of 0.78 BB) and `rbes` finds
  74%. On the fixtures without exact values the certified lower bound of NashConv rises from 0.14 to 1.66 BB
  (three-player flop) and from 0.02 to 2.29 BB (six-player flop).
* **A quarter of the response deals.** Training time is then at or below the default's on five of six games (2.4
  times on the three-player flop fixture). `rbes` finds more on five of six and less on `flop6-jack-small` (61%
  against 77%).
* **What this changes.** The trained response is the only quality measure for large games, and it is a lower bound
  whose usefulness depends on how good the response is. The 5.9 reports quoted lower bounds of 0.75 to 1.17 BB for
  the six-player fixture after 250,000 deals; for one such strategy the stronger search certifies at least 2.29 BB
  (95% lower bound of NashConv inside the abstraction). Lower bounds found by the default response were weak
  bounds, and CONVERGENCE-5.10.md, section 7.3, repeats the comparison of the trainers with the stronger search.
* The evaluation of a response, its statistics and its confidence statements are those of 5.9 in every row.

What was examined and left: each seat loads its own copy of the state (0.09 s for a 9 MB state; a fixed 0.6 s of a
six-seat analysis on the six-player fixture, about a third of it with 20,000 response deals per seat and a few
percent at realistic budgets). Sharing one immutable copy between the seats would remove most of it but touches the
engine's ownership of its tables; it was judged not worth the risk next to an algorithmic gain. Parallel seats
(`parallelSeats`, 5.9) are unchanged.

## 5. A complete study

`mwcli --study` on the three-player flop fixture, two seeds, budgets 20,000 and 100,000 deals, one thread, including
its evaluations:

| Program | Whole study s | Training s at the last budget, per seed | Evaluation s (all points) | Rows at the last budget | Process peak MiB | Complete |
|---|---|---|---|---|---|---|
| 5.9 default | 98.3 | 1.01, 0.969 | 96.3 | 103,755, 103,261 | 342 | yes |
| 5.10 default | 99.3 | 1.12, 0.966 | 97.2 | 103,755, 103,261 | 342 | yes |
| 5.10 estimator=rbes | 128 | 8.88, 9.23 | 110 | 242,116, 242,386 | 342 | yes |

## 6. Memory

The `rbes` table is bounded by the same table budget as the default's and reports its size the same way
(`tableMiB`, `rows`, `processPeakRssMiB`; the process peak of 342 MiB that most rows of section 3 show is the
engine's start-up footprint for a 2,048 MiB table budget, the same in 5.9); section 3 has the numbers at equal deals, CONVERGENCE-5.10.md, section 7,
those of the two flop fixtures after 250,000 deals (flop6-jack after 250,000 deals: 213,000 rows and 20 MiB with the default trainer, 412,000 rows and 38.1 MiB with `rbes`). In addition: the key cache (at most 256 MiB,
reported as `trainer.rbes.keyCacheMiB`; 5 to 6 MiB on the flop fixtures) and one value frame per tree depth and
thread. When a table budget is reached, training stops with a valid state of committed updates and can be continued
with a larger budget (self-test L2). With large EXACT ranges on a multiway flop this happens quickly: a six-player
game with 208 hands a seat filled 512 MiB after 2,048 deals. With Detailed hand groups and with preflop starts the
table grows by one to two orders of magnitude over the default's (section 3): `rbes` is meant for postflop starts
with exact cards or Compact groups.

## 7. CPU and GPU

No CUDA code and no scheduling changed. The traversal of both trainers runs on the CPU in every processing mode; the
modes decide where the showdowns of a frozen batch are scored. With the project's simulated CUDA driver, CPU Only,
Automatic, Hybrid and GPU-Preferred write one state for `rbes` as for the default trainer (regression test). On an
NVIDIA GPU: not executed for 5.10.

## 8. Limits of these measurements

Four logical processors, a container whose neighbours are unknown, wall times with a spread of several percent
between repetitions (hence medians and minima, and instruction counts beside them). No measurement above four
threads, none longer than a few minutes, none on Windows.
