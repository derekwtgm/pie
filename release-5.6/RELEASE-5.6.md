# EightMax 5.6 — release report

Build `7ee054b44c409149`. Upgraded from 5.5 (`abe74607a4a0120b`), whose archive was verified first: archive hash, all 3,939 manifest entries, the source rebuilding to the same fingerprint, and its regression totals (567 passed, 1 skipped).

## Outcome by objective

| Objective | Outcome |
|---|---|
| Actual GTO convergence at equal time | **Improved by speed, not by a new algorithm.** The default trainer computes what 5.5 computed, 1.15x to 2.81x faster on the study fixtures. Exact NashConv after equal wall-clock training was lower than 5.5's on 6 of 7 measured games (unresolved on flop6). |
| Opponent-enumeration candidate | **Built, validated, not promoted.** One shared walk of the final street for all seats, with cross-seat updates on earlier-street games. Correct in expectation; better than the 5.6 default at equal time on one of four games, worse on one, unresolved on two. Opt-in. |
| Mathematical correctness | **Extended.** Every estimator, the default included, is now checked against an independently computed exact CFR update. No divergence found. |
| Statistical confidence | **Scope made explicit.** New across-trainings verdict (exact sign test), minimum trainings, undetectable failure rate, warnings. A best action is declared only when supported for the measured strategies and for the typical training. |
| Multiway and ICM evaluation | **Improved in the evaluator.** Compact showdown tables and passive runouts; values unchanged. |
| Tournament functionality | **Preserved.** Rules, payoffs, fixtures, modes and formats unchanged; trainer output byte-identical to 5.5. |
| Checkpoints | **Preserved and hardened.** Concurrent use refused; another build or trainer refused with the reason. |
| CPU / GPU | CPU faster. **GPU untouched and untested**; no GPU figure is given. |
| Regression testing | 583 tests, 582 passed, 0 failed, 1 skipped on Linux. The same suite was also run against the Windows programs under Wine. |
| Windows release | Built, byte-reproducible, smoke-tested under Wine from the packaged archive. **Not run on Windows.** |

## What changed

### Training (`CONVERGENCE-5.6.md`, `PERFORMANCE-5.6.md`)

- Default trainer: direct child links and terminal records for stored betting states, row hints, one undo journal per call, sampled stage timing, one flop code per deal, number lookup for Compact keys. Same state bytes as 5.5.
- New training report field `linkCache`. The `seconds` of one-deal training are estimates from one update in sixteen.
- Experimental `opponentEnumeration`: `river-shared`, `river-cross` (command line and spec). Refused together with own-hand enumeration and the terminal estimators.

### Exact evaluation

- Showdown tables release their scores once their histogram is built; the shared table cap is 4,096.
- Passive runouts use the showdown table.
- `EM_EV_KEEP_SCORES=1` and `EM_EV_NO_PASSIVE=1` restore the 5.5 behaviour for comparison.

### Statistics (`STATISTICAL-VALIDATION-5.6.md`)

- `confidence.replication`, `confidence.evaluationKind`, `confidence.evaluationUncertainty`, `confidence.trainingVariation`, `bestAction`, `statisticalWarnings`, `replicationCalculation` in every study result. The 5.5 fields and their calculation are unchanged.
- Headline: "Prefer X" only for a declared best action; otherwise "Leader among the measured trainings: X (no best action declared)".
- `seeds=N` may exceed the fixture's list (up to 64).

### Checkpoints

- `study.lock` in a checkpoint directory while a study runs (operating-system lock; released when the process ends for any reason).

### Windows validation

- `Run 5.6 Windows validation.bat` / `source/tools/validate_windows56.ps1`; golden specs in `validation/5.6/windows/`.
- CI workflow: the script and the whole regression suite on a Windows runner (not yet run).
- Launchers: `Run 5.6 quick study.bat`, `Run 5.6 standard study.bat`, `Resume 5.6 standard study.bat`, `Run 5.6 replicated study.bat`.

## Compatibility

- Solver checkpoints (EMMW4, EMZ1) of 5.5 continue in 5.6 and the reverse, to the same bytes, for the trainers both versions have.
- Study checkpoints are tied to their build: a saved 5.5 study is listed and refused with the reason; run it again.
- Result files of 5.2 to 5.5 open as before. A 5.5 result keeps its 5.5 presentation; it carries no across-trainings verdict.
- Study fixtures are unchanged. Defaults are unchanged: eight-handed, 0.5/1 blinds, 0.1 BB ante per player (2.3 BB starting pot), no big-blind-ante substitution.
- The process memory budget still defaults to 70% of installed memory.

## Known limits

See FINAL-REPORT-5.6.md sections 10 and 11. In short: not run on Windows or a GPU; the Windows validation script is unexecuted; no estimator beats the default everywhere; exact NashConv only on small games; the mean over trainings is still model-based.

