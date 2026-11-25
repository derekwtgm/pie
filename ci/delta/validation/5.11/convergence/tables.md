### Decisive comparisons (pooled over the 13 scale games; 32 seeds; two-sided level 0.025 each)

| Comparison | NashConv philox64 / 5.10 streams | Interval | Seeds lower / higher | Verdict |
|---|---:|---|---:|---|
| equal time, 2 s of training | 1.030 | [0.985, 1.078] | 13 / 19 | **no worse** |
| equal deals, 500,000 sampled deals | 0.957 | [0.921, 0.995] | 21 / 11 | **better** |

### Other pooled comparisons (level 0.05 each; not decisive)

| Comparison | Games | Ratio [interval] | Verdict |
|---|---:|---|---|
| equal deals, 100,000 deals | 13 | 0.992 [0.963, 1.022] | no worse |
| frozen batches of 64, 512,000 deals | 7 | 1.008 [0.977, 1.039] | no worse |
| class "few hands", equal time | 4 | 1.011 [0.922, 1.109] | unresolved |
| class "few hands", equal deals | 4 | 0.888 [0.811, 0.972] | better |
| class "ranges", equal time | 7 | 1.046 [1.008, 1.085] | worse |
| class "ranges", equal deals | 7 | 1.000 [0.968, 1.033] | no worse |
| class "tournament", equal time | 2 | 1.015 [0.941, 1.095] | no worse |
| class "tournament", equal deals | 2 | 0.955 [0.899, 1.014] | no worse |
| all 17 games (with the four excluded from the rule), equal time | 17 | 1.108 [1.024, 1.199] | worse |
| all 17 games (with the four excluded from the rule), equal deals | 17 | 0.988 [0.907, 1.077] | no worse |

### Every cell (guard family: 58 cells at level 0.05 / 58 each, and the pooled batch comparison)

Median exact NashConv over 32 seeds (philox64 / 5.10 streams), the ratio of geometric means with its interval, and the verdict. `*` = one of the four games outside the pooled statistics.

| Game | 100,000 deals | 500,000 deals | 2 s | batches of 64 |
|---|---|---|---|---|
| hu-river | 0.117 / 0.118; 0.968 [0.846, 1.108] (unresolved) | 0.0504 / 0.0546; 0.945 [0.718, 1.244] (unresolved) | 0.0245 / 0.0219; 1.141 [0.870, 1.498] (unresolved) |  |
| hu-turn | 0.16 / 0.165; 0.967 [0.853, 1.096] (no worse) | 0.0723 / 0.0744; 0.994 [0.912, 1.083] (no worse) | 0.0408 / 0.0411; 0.997 [0.885, 1.123] (unresolved) |  |
| river3-chip | 0.0531 / 0.0557; 0.966 [0.756, 1.235] (unresolved) | 0.0234 / 0.0234; 1.005 [0.794, 1.271] (unresolved) | 0.018 / 0.0182; 1.007 [0.759, 1.336] (unresolved) |  |
| turn4 * | 0.00184 / 0.0017; 0.970 [0.659, 1.426] (unresolved) | 7.19e-05 / 6.64e-05; 0.966 [0.655, 1.427] (unresolved) | 5.24e-05 / 4.34e-05; 1.156 [0.719, 1.857] (unresolved) |  |
| flop6 | 0.0933 / 0.0796; 0.988 [0.654, 1.494] (unresolved) | 0.0328 / 0.0541; 0.658 [0.397, 1.090] (no worse) | 0.0511 / 0.0453; 0.912 [0.531, 1.567] (unresolved) |  |
| final8 * | 3.24e-06 / 2.96e-06; 1.051 [0.378, 2.924] (unresolved) | 1.3e-07 / 1.18e-07; 1.051 [0.378, 2.924] (unresolved) | 8.94e-06 / 6.43e-06; 1.462 [0.531, 4.029] (unresolved) |  |
| bubble4 * | 3.65e-06 / 2.6e-06; 1.012 [0.260, 3.935] (unresolved) | 1.46e-07 / 1.04e-07; 1.012 [0.260, 3.935] (unresolved) | 8.3e-07 / 1.1e-06; 1.277 [0.321, 5.072] (unresolved) |  |
| rg-hu-river | 0.206 / 0.206; 1.016 [0.949, 1.087] (no worse) | 0.0785 / 0.0791; 1.021 [0.949, 1.099] (no worse) | 0.0467 / 0.0403; 1.048 [0.965, 1.138] (unresolved) | 1.032 [0.926, 1.150] (unresolved) |
| rg-river3 | 0.0726 / 0.0775; 0.993 [0.848, 1.162] (unresolved) | 0.0259 / 0.0255; 1.014 [0.872, 1.180] (unresolved) | 0.0184 / 0.0162; 0.999 [0.854, 1.169] (unresolved) | 0.978 [0.815, 1.173] (unresolved) |
| rg-hu-turn | 0.309 / 0.305; 1.002 [0.968, 1.037] (no worse) | 0.123 / 0.125; 0.985 [0.946, 1.026] (no worse) | 0.0786 / 0.0699; 1.055 [0.979, 1.138] (unresolved) | 1.019 [0.977, 1.063] (no worse) |
| rg-turn3 | 2.63 / 2.63; 1.007 [0.964, 1.053] (no worse) | 1.14 / 1.14; 1.006 [0.973, 1.040] (no worse) | 1.27 / 1.2; 1.059 [0.999, 1.123] (unresolved) | 1.002 [0.957, 1.049] (no worse) |
| rg-turn4 | 0.6 / 0.628; 0.970 [0.891, 1.055] (no worse) | 0.154 / 0.148; 1.019 [0.840, 1.237] (unresolved) | 0.155 / 0.16; 1.046 [0.864, 1.267] (unresolved) | 0.942 [0.790, 1.124] (unresolved) |
| rg-icm3-river | 0.203 / 0.208; 0.997 [0.879, 1.130] (unresolved) | 0.0734 / 0.0782; 0.966 [0.853, 1.093] (no worse) | 0.0644 / 0.0546; 1.099 [0.962, 1.255] (unresolved) | 1.037 [0.915, 1.175] (unresolved) |
| rg-flop6c | 0.455 / 0.449; 1.044 [0.867, 1.259] (unresolved) | 0.246 / 0.248; 0.988 [0.756, 1.291] (unresolved) | 0.341 / 0.338; 1.017 [0.813, 1.271] (unresolved) | 1.047 [0.767, 1.428] (unresolved) |
| mid3-turn | 1.44 / 1.38; 1.039 [0.950, 1.137] (unresolved) | 0.658 / 0.69; 0.969 [0.886, 1.060] (no worse) | 0.688 / 0.671; 1.016 [0.926, 1.116] (unresolved) |  |
| bubble5-icm * | 8.2e-06 / 6.67e-06; 1.412 [0.402, 4.968] (unresolved) | 3.28e-07 / 2.67e-07; 1.413 [0.402, 4.968] (unresolved) | 5.01e-06 / 2.48e-06; 1.791 [0.516, 6.211] (unresolved) |  |
| sidepot3-icm | 0.139 / 0.152; 0.946 [0.767, 1.167] (unresolved) | 0.0627 / 0.0669; 0.941 [0.780, 1.135] (unresolved) | 0.0529 / 0.0535; 1.014 [0.806, 1.276] (unresolved) |  |

Verdicts of the 58 cells: 0 worse, 14 no worse, 0 better, 44 unresolved.

### Deals trained in equal time (2 s; median over seeds)

| Game | philox64 | 5.10 streams | Ratio |
|---|---:|---:|---:|
| hu-river | 1,424,384 | 1,654,016 | 0.861 |
| hu-turn | 1,161,568 | 1,310,272 | 0.887 |
| river3-chip | 800,128 | 951,584 | 0.841 |
| turn4 | 532,832 | 662,016 | 0.805 |
| flop6 | 277,952 | 302,880 | 0.918 |
| final8 | 242,176 | 289,536 | 0.836 |
| bubble4 | 897,024 | 791,168 | 1.134 |
| rg-hu-river | 1,491,744 | 1,586,016 | 0.941 |
| rg-river3 | 838,976 | 1,039,360 | 0.807 |
| rg-hu-turn | 1,240,064 | 1,485,120 | 0.835 |
| rg-turn3 | 419,712 | 450,816 | 0.931 |
| rg-turn4 | 612,928 | 628,288 | 0.976 |
| rg-icm3-river | 847,616 | 1,027,136 | 0.825 |
| rg-flop6c | 240,768 | 271,072 | 0.888 |
| mid3-turn | 550,016 | 614,432 | 0.895 |
| bubble5-icm | 715,264 | 778,496 | 0.919 |
| sidepot3-icm | 806,144 | 942,816 | 0.855 |

Median over games 0.887 (smallest 0.805, largest 1.134).

### The four games outside the pooled statistics: share of seeds with NashConv below 1e-4

| Game | Budget | philox64 | 5.10 streams |
|---|---|---:|---:|
| turn4 | deals 100000 | 0% | 0% |
| turn4 | deals 500000 | 88% | 81% |
| turn4 | time 2.0 | 78% | 81% |
| final8 | deals 100000 | 100% | 100% |
| final8 | deals 500000 | 100% | 100% |
| final8 | time 2.0 | 91% | 97% |
| bubble4 | deals 100000 | 100% | 100% |
| bubble4 | deals 500000 | 100% | 100% |
| bubble4 | time 2.0 | 100% | 100% |
| bubble5-icm | deals 100000 | 94% | 100% |
| bubble5-icm | deals 500000 | 100% | 100% |
| bubble5-icm | time 2.0 | 97% | 100% |
