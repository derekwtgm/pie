# EightMax 4.8 validation evidence

| Folder | Content |
|---|---|
| `baseline-4.7/` | full regression of the unmodified 4.7 source rebuilt here: 462 passed, 0 failed, 0 skipped |
| `regression/` | 4.8 full regression (build 2c01340963236a30, 482 passed / 1 failed - see RELEASE-4.8.md section 6) and the v47 + v48 re-run on the final build (34/34, TAP) |
| `response-eval/` | `tools/brbench48.js` 4.7 vs 4.8: `*-final.json` = final build (5 rounds; flop6w 2 rounds); `*-quick.json` = earlier development builds (2-3 rounds, restricted and sampled) |
| `independent-br/` | `tools/independent_br48.py` reports (engine vs independent exact best responses, chip conservation) |
| `wine/` | `--selftest47` (10/10) and `--selftest48` (9/9) of the shipped Windows executables under Wine 9.0 (not Windows) |
| `fixtures/` | specs used by `mwcli --selftest48` and `Run 4.8 checks.bat` |
| `ARCHITECTURE-REVIEW.md` | future-format note (Priority 18) |

Windows evidence from the GitHub Actions runner is described in RELEASE-4.8.md section 5 (runs 45 and 46
of the "Windows build, release and verification" workflow on branch ccr-b6b3ba71-s19btg).
