# EightMax 5.8

Build `d4001e2c0cd77f41`. Windows x64, self-contained (nothing to install). Target: Windows 11, 13th-generation Core i7, 16 GB RAM, RTX 4060 Ti 8 GB. Successor of 5.7.1 (build `65e835e6b7060960`).

**Start here:** extract the ZIP into a new folder and open `EightMax.exe`. To check the release on your PC, run `Run 5.8 focused validation.bat` (a few minutes), then `Run 5.8 Windows validation.bat`; WINDOWS-TESTS-5.8.md says what to send back. **The 5.8 programs have not yet run on Windows hardware or on an NVIDIA GPU.**

## What changed

- **A stronger quality measure for multi-street and large studies: the trained response** (`mwcli.exe --response`, `Run 5.8 response example.bat`, USER-GUIDE-5.8.md). For each seat a response strategy is trained against the other seats frozen at their trained strategies, and its gain is measured on independent deals. The sum over the seats is a proven **lower bound of NashConv** inside the study's abstraction — never an upper bound, and with three or more players or ICM not "exploitability". On 130 trained states of 14 games with exact answers it never exceeded the exact value, and with two million response deals per seat it found at least 70% of exact NashConv in every state (median 100%); the 5.7 one-decision measure found a median of 41%, and the 5.7 restricted measure 4% to 57% on games with more than one betting street. On the shipped six-player flop fixture it proves a NashConv of at least 0.77 to 0.93 BB after one million deals where the 5.7 measure reported nothing distinguishable from zero.
- **Five new reference games with exact answers** for tournament situations (early stage with deep stacks and three streets, medium stacks on the turn, eight-handed short stacks, a five-player ICM bubble, three players with side pots and ICM), beside the ten of 4.8.
- **A study that is too large is refused at once.** A budget above 10,000,000 training updates per seed (10,000,000 deals with the default trainer, 640,000,000 with 64-deal batches) is rejected when the study is configured, with the largest supported budget in the message. Before, it trained for minutes or hours up to the limit and then failed. The limit itself is unchanged, for a stated reason (the engine's random streams would repeat; MATHEMATICAL-VALIDATION-5.8.md, section 5).
- **ICM**: the exact prize-equity cache keeps four entries per slot instead of one. Eight-handed final-table trainings with a small table budget execute up to 10% fewer instructions; every value and every trained state is bit-identical to 5.7.1.
- **A defect of the desktop host repaired**: after answering a checkpoint request it held its checkpoint lock a moment longer, so an immediate next request could be refused ("Another checkpoint operation is active"). This was the cause of the occasional load-sensitive test failures recorded since 5.6. The lock is now released before the answer is sent.
- **`mwcli.exe --selftest58`**: 33 checks of the new parts against exact values, with statuses passed, failed and untested.
- **Windows validation for 5.8**: `validate_windows58.ps1` and three launchers; reports as JSON and text with passed, failed, skipped and untested.

## What did not change

The default trainer and every training option; the action-value and best-response evaluators; the statistics; the CUDA kernels and the Automatic, Hybrid, GPU-Preferred and CPU-only modes; file formats; the interface. With the same specification and seed, 5.8 writes the state file 5.7.1 writes (225 cases, 1,782 training runs, 0 differences). Eight-handed tables keep 0.5 / 1 blinds and a 0.1 BB ante per player (2.3 BB before the first action; no big-blind ante is substituted). The checkpoint-commit repair of 5.7.1 is untouched and its 24 checks pass.

## Verified, and not verified

| | |
|---|---|
| Regression suite (Linux) | 621 tests: 620 passed, 0 failed, 1 skipped (a folder-permission test that cannot fail when run as administrator) |
| Self-tests (Linux, and the Windows programs under Wine) | 5.8: 33 of 33; 5.7.1 checkpoint and memory checks: all; 5.7: 28 of 28 |
| Sanitizers | AddressSanitizer, UndefinedBehaviorSanitizer, ThreadSanitizer, LeakSanitizer: 0 reports |
| Windows executables under Wine | seven reference results bit-identical to the Linux build |
| **Windows hardware** | **not run** |
| **NVIDIA GPU / CUDA** | **not run for 5.8** (no CUDA code changed) |
| **PowerShell validation script** | **never executed**; checked statically only |
| **GitHub Actions Windows workflow** | **not run** |

VALIDATION-5.8.md lists every test, including the ones that failed during development and what was done about them.

## Compatibility

- Solver states (`.state`) of 5.7.1 continue in 5.8 to the same bytes.
- Saved **studies** of 5.7.1 or earlier cannot be continued (a study checkpoint is tied to its build); they are refused with the reason and left untouched.
- Result files of 5.4 to 5.7.1 open as before.
- No new runtime requirement. The executables import only Windows system DLLs.

## New commands

    mwcli.exe --response spec.json trained.state request.json [memoryMiB]
    mwcli.exe --selftest58 studies-dir work-dir [all|engine|response|limits]

## Limits — please read

- **No percentage of "GTO" is reported, and none can be supported.** For a game too large to enumerate the program has lower bounds of NashConv only. A small trained-response gain means that this search found little, not that the strategy is close to equilibrium; on the three-street reference game the search found three quarters of the true value.
- The trained response depends on its response budget. With 200,000 response deals it found as little as 19% of exact NashConv on one reference game.
- With sampled opponent actions (every large study) use the distribution-free bound (`bounded95`); the normal-approximation interval was far too narrow on an eight-handed ICM game whose strategies contain very rare actions.
- Exact NashConv is available only for small games (the fifteen reference games and studies of similar size).
- No training speed-up for multiway postflop games: the profile was measured and one optimisation was tried and rejected. Training speed is that of 5.7.1 (PERFORMANCE-5.8.md).
- The update limit of one engine state is still 10,000,000. In the desktop application a refused study leaves an unlisted folder containing only its request file; it can be deleted.
- Thread scaling was measured only up to four processors. Nothing was measured on the target PC.

Reports: FINAL-REPORT-5.8.md, CONVERGENCE-5.8.md, PERFORMANCE-5.8.md, MATHEMATICAL-VALIDATION-5.8.md, VALIDATION-5.8.md, WINDOWS-TESTS-5.8.md, BUILD-5.8.md, USER-GUIDE-5.8.md.
