# EightMax 5.17: the comparisons of method exact-hu

Build `6efe7970626b6460`. Plan: `validation/5.17/plan.json`, written 2026-11-27T18:34:24Z, before the comparisons were run, with
two amendments (section 7). Units: `validation/5.17/measure/units` (39 units, 0 with an error).
Runner: `validation/5.17/measure517.py`; analysis: `analyze517.py`; its output: `measure/summary.txt`.

Nothing in this file is about a graphics card. The "device" below is an OpenCL implementation that runs on the CPU
of the development machine (`cpu-skylake-avx512-Intel(R) Xeon(R) Processor @ 2.10GHz`, PoCL). It exercises the device code path; it says nothing about the speed or the
arithmetic of an NVIDIA card.

## 1. What was measured, and how

* **Games.** Twelve heads-up postflop games (`source/tools/games517.js`): five small ones of 5.10 and 5.16, and seven
  added. Five of the added ones give both players every hand the board leaves: 1081 hands on a river, 1128 on a
  turn, 1176 on a flop. Each game is taken with every grouping whose table fits.
* **Strategies.** Each unit trains the game once with the default trainer (200,000 deals; the whole-range flops
  1,000,000; one thread; seed 5171) and once for a single deal, so that nearly every lookup falls back to the
  uniform policy. Both tables are evaluated.
* **The two methods.** `exact` (unchanged since 5.8) and `exact-hu` (new) get the same spec, the same state file and
  compute the same quantity: for each seat the value of the stored average strategy, the value of the best response
  to it over physical hands and exact boards, and the difference; NashConv is the sum of the two differences.
* **Seconds** are whole processes on one CPU thread, three runs, the median; four threads are reported beside it.

## 2. The table, and R1: agreement with method exact

Rule: for every value of both seats and for NashConv, |exact-hu - exact| at most 1e-9 times max(1, |exact|),
wherever method `exact` finishes. One value outside would have withdrawn the method.

```
game and grouping. Seconds: whole processes, median of 3, one CPU thread
unless said; the development machine (4 logical processors). "refused": method exact stops at its limit of 2,000,000,000 visits.

game           grouping        hands     rows   items  NashConv     R1 diff      exact s exact-hu s   4 thr. s     ratio  R4
rg-hu-river    compact         58/59       56       2  1.7180624    1.9e-15        0.005      0.003      0.003         2x  exact-hu faster
rg-hu-river    detailed        58/59      200       2  0.18928538   1.1e-15        0.005      0.003      0.003         2x  exact-hu faster
rg-hu-river    ranked          58/59      108       2  0.0881616589 2.2e-15        0.005      0.003      0.003         2x  exact-hu faster
rg-hu-river    exact           58/59      468       2  0.133167431  1.6e-15        0.006      0.003      0.003         2x  not faster
ho-hu-river    compact         43/44       52       2  0.730199521  1.8e-15        0.004      0.004      0.003         1x  not faster
ho-hu-river    detailed        43/44      232       2  0.118398479  6.1e-16        0.004      0.003      0.003         1x  exact-hu faster
ho-hu-river    ranked          43/44      108       2  0.280487481  6.7e-16        0.005      0.004      0.003         1x  not faster
ho-hu-river    exact           43/44      348       2  0.17369051   2.4e-15        0.004      0.004      0.003         1x  exact-hu faster
wr-river       compact     1081/1081      150       2  0.179707112  2.9e-14        1.058      0.013      0.013        80x  exact-hu faster
wr-river       detailed    1081/1081     4790       2  0.253281253  1.3e-15        1.084      0.011      0.011        96x  exact-hu faster
wr-river       exact       1081/1081    10810       2  0.488673808  2.7e-15        1.617      0.013      0.012       129x  exact-hu faster
rg-hu-turn     compact         29/35      120     288  0.468170365  4.4e-15        0.025      0.004      0.004         6x  exact-hu faster
rg-hu-turn     detailed        29/35     1288     288  0.125763808  0.0e+00        0.030      0.005      0.005         6x  exact-hu faster
rg-hu-turn     ranked          29/35      242     288  0.266709968  2.8e-15        0.025      0.004      0.007         6x  exact-hu faster
rg-hu-turn     exact           29/35     6016     288  0.218810188  1.6e-15        0.031      0.006      0.006         5x  exact-hu faster
ho-hu-turn     compact         28/27      230     288  0.183554538  3.5e-16        0.023      0.005      0.004         4x  exact-hu faster
ho-hu-turn     detailed        28/27     2339     288  0.0864806355 1.7e-15        0.024      0.005      0.005         5x  exact-hu faster
ho-hu-turn     ranked          28/27      636     288  0.112501683  2.8e-16        0.021      0.004      0.005         5x  exact-hu faster
ho-hu-turn     exact           28/27     5160     288  0.114665263  1.7e-15        0.031      0.005      0.005         6x  exact-hu faster
mx-turn        compact       1128/30      424     672  0.600873105  2.5e-15        2.155      0.036      0.022        60x  exact-hu faster
mx-turn        detailed      1128/30    57277     672  0.772297446  8.9e-16        3.407      0.132      0.069        26x  exact-hu faster
mx-turn        exact         1128/30   245548     672  2.17106103   3.3e-15        4.910      0.127      0.110        39x  exact-hu faster
wr-turn        compact     1128/1128      916     288  0.615778256  6.8e-15       67.046      0.062      0.034      1080x  exact-hu faster
wr-turn        detailed    1128/1128   109845     288  1.32079731   2.4e-15      157.723      0.228      0.149       692x  exact-hu faster
wr-turn        ranked      1128/1128     3395     288  0.305750448  2.4e-14       73.066      0.075      0.034       978x  exact-hu faster
wr-turn        exact       1128/1128   408333     288  3.52920028   2.4e-15      229.272      0.244      0.184       940x  exact-hu faster
wr-turn-wide   compact     1128/1128    12304     864  1.44925319   refused            -      0.213      0.088         -  
wr-turn-wide   ranked      1128/1128    51516     864  1.44416358   refused            -      0.268      0.115         -  
rg-hu-flop     compact         21/26     8742   42336  1.69421825   4.4e-16        4.315      0.130      0.057        33x  exact-hu faster
rg-hu-flop     detailed        21/26   285421   42336  2.88473293   3.9e-16       11.002      0.642      0.449        17x  exact-hu faster
rg-hu-flop     ranked          21/26    27122   42336  1.49654077   8.9e-16        4.969      0.162      0.068        31x  exact-hu faster
rg-hu-flop     exact           21/26   727387   42336  5.09425406   4.6e-16       17.357      0.585      0.442        30x  exact-hu faster
mid-flop       compact       112/136    12228   42336  1.52693953   2.2e-15      114.749      0.581      0.238       198x  exact-hu faster
mid-flop       detailed      112/136   689083   42336  4.73615097   1.3e-15      417.173      2.531      1.367       165x  exact-hu faster
mid-flop       ranked        112/136   107891   42336  1.83109957   2.3e-15      146.650      0.809      0.316       181x  exact-hu faster
wr-flop        compact     1176/1176    17701   42336  1.00332622   refused            -      5.432      1.743         -  
wr-flop        ranked      1176/1176   225380   42336  0.766844458  refused            -      6.538      2.289         -  
wr-flop-allin  compact     1176/1176    27732   61152  0.749494462  refused            -      6.042      1.792         -  
wr-flop-allin  ranked      1176/1176   495078   61152  0.84468808   refused            -      7.590      2.633         -
```

```
R1 (agreement with method exact, 1e-9 relative, every value of both seats and NashConv; trained tables and tables trained for one deal):
   checked on 66 evaluations: within the bound on 66; largest relative difference 2.91e-14; method exact refused on 12 more (no check possible there)
   -> R1 MET
```

NashConv is in chips, summed over the two seats. "R1 diff" is the largest relative difference of any value of the
unit. Where method `exact` refuses, there is nothing to compare with: those results rest on the same code having
agreed on every game where a comparison exists, on the independent program for the small games (VALIDATION-5.17.md,
section 3), and on nothing else. **For the whole-range flops and the wide whole-range turn no second method has
confirmed the number.**

## 3. R2: one result for every way of running it

Rule: the bits of every value must be the same with 1, 2, 3 and 4 threads; with `brDevice` cpu, gpu and both; with
device batches of 48, 64 and 4096 items. One differing bit would have withdrawn `brDevice gpu`.

```
R2 (one result for every way of running it: 2, 3, 4 threads; brDevice gpu and both; device batches of 48, 64, 4096):
   624 of 624 runs have the bits of one CPU thread; 78 of 78 evaluations identical in every run
   device: cpu-skylake-avx512-Intel(R) Xeon(R) Processor @ 2.10GHz (NOT a GPU: OpenCL on the CPU); 2042200 items worked on it in the gpu and both runs, 1084960 repeated on the CPU, 0 with other bits
   -> R2 MET
```

## 4. R3: the guards must be able to fail

* **(a) The probe.** shown on this device: the kernel with unprotected products, compiled with `-cl-mad-enable`, is refused (the arithmetic of this device differs from the CPU in 2989 of 20480 probe values (first: a product followed by a sum (the device fuses them))). The protected kernel passes on the same device
* **(b) The repetition.** shown: with one bit of one device result altered (`EM_BRHU_TEST=flip`) the request fails and reports no value (`--selftest517` G5, natively and under Wine)

What this shows: the probe can see a device that merges a product and a sum, and the repetition can see one wrong
bit in one item it repeats. What it does not show: that every possible fault of a real card is seen. An error in an
item that is not repeated (15 of 16 by default) is not seen unless `"brDevice":"both"` is used; the validation
script uses `both`.

## 5. R4: seconds

Rule (no threshold): exact-hu is called faster on a game only if its slowest of three runs beats the fastest of
three runs of method `exact`.

```
R4 (time, reported; exact-hu is called faster only if its slowest of 3 runs beats the fastest of 3 runs of method exact):
   compared on 33 games (where method exact finishes): exact-hu faster on 30 (not faster: rg-hu-river-exact, ho-hu-river-compact, ho-hu-river-ranked); ratio of medians 1.1 to 1080 times
   On the smallest games both take a few milliseconds and the process start dominates.
```

The whole-range games, exact-hu only (seconds; median of 3):

| Game | Grouping | Hands a seat | Items | One thread | Four threads | Method `exact`, one thread |
|---|---|---:|---:|---:|---:|---:|
| `wr-river` | compact | 1081 | 2 | 0.01 | 0.01 | 1.06 |
| `wr-river` | detailed | 1081 | 2 | 0.01 | 0.01 | 1.08 |
| `wr-river` | exact | 1081 | 2 | 0.01 | 0.01 | 1.62 |
| `wr-turn` | compact | 1128 | 288 | 0.06 | 0.03 | 67.05 |
| `wr-turn` | detailed | 1128 | 288 | 0.23 | 0.15 | 157.72 |
| `wr-turn` | ranked | 1128 | 288 | 0.07 | 0.03 | 73.07 |
| `wr-turn` | exact | 1128 | 288 | 0.24 | 0.18 | 229.27 |
| `wr-turn-wide` | compact | 1128 | 864 | 0.21 | 0.09 | refused |
| `wr-turn-wide` | ranked | 1128 | 864 | 0.27 | 0.11 | refused |
| `wr-flop` | compact | 1176 | 42,336 | 5.43 | 1.74 | refused |
| `wr-flop` | ranked | 1176 | 42,336 | 6.54 | 2.29 | refused |
| `wr-flop-allin` | compact | 1176 | 61,152 | 6.04 | 1.79 | refused |
| `wr-flop-allin` | ranked | 1176 | 61,152 | 7.59 | 2.63 | refused |

The times of `brDevice gpu` on this machine are in the units and are not reported here: the device is the same CPU.

## 6. A first look at grouping error with whole ranges

Phase 6 measured the groupings on games of 10 to 60 hands a seat because no exact measure existed above that.
exact-hu is one for two players. **This is not a repeat of the Phase 6 measurement**: one seed, one training
length, no rule written for it, and at this length a grouping's number is partly unfinished training and partly
what the grouping cannot express. It is reported because the numbers exist.

| Game | Deals | Compact | Detailed | Ranked | Exact cards |
|---|---:|---:|---:|---:|---:|
| `wr-river` | 200,000 | 1.5 | 2.1 | not run | 4.1 |
| `wr-turn` | 200,000 | 5.1 | 11.0 | 2.5 | 29.4 |
| `wr-turn-wide` | 200,000 | 12.1 | not run | 12.0 | not run |
| `wr-flop` | 1,000,000 | 10.0 | not run | 7.7 | not run |
| `wr-flop-allin` | 1,000,000 | 9.4 | not run | 10.6 | not run |

Percent of the starting pot a player (NashConv divided by two and by the pot). A proper measurement at this size
(seeds, lengths until the numbers stop falling, a rule beforehand) is now possible and has not been done.

## 7. Amendments

1. **Before any comparison:** the game `mid-flop` was narrowed from about 170 to about 80 hands a seat, because
   method `exact` refused the wider one and R1 could not have been checked on it.
2. **Written after the results, 2026-11-27:** the plan says an "untrained table (0 deals)" is evaluated too. The
   runner evaluated a table trained for **one deal** instead (93 to 100.0 percent of its lookups fall back). There
   was no technical reason; the runner did not follow the wording and I noticed while writing this report. Repair:
   `zero_deals517.py` evaluates the table of 0 deals for every unit with the same checks: R1 within the bound on 33 of 33 (largest relative difference 1.3e-14; method `exact` refused on 6), R2 identical bits in 312 of 312 runs
   (`measure/zero-deals`). With 0 deals every grouping of a game has the same uniform strategy, so these are
   twelve different strategies, not 39. No rule or threshold changed.
