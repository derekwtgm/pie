# EightMax 4.4 — numerical comparison policy

This file states which results are compared **exactly** and which with a
**tolerance**, and why. It was written for the 4.3 Windows self-test failure
(`4.3 exact EVs bit-identical to 4.2 for every thread count`).

## 1. What went wrong in 4.3

| Step | What happened |
|---|---|
| Engine (C++) | computed the double `0x402F57218439052D` and printed it with `%.17g`: `15.670177585564113`. Correct. |
| `mwcli.exe` output, desktop API | carried those digits unchanged. Correct. |
| Windows PowerShell 5.1 `ConvertFrom-Json` | uses .NET Framework's `JavaScriptSerializer`, which stores a JSON number that has a fraction and no exponent as **System.Decimal** (`15.670177585564113` exactly). Still correct. |
| The test: `[double]$value` | Decimal → Double in .NET Framework is `(double)(96-bit integer) / 10^scale`. The integer `15670177585564113` is larger than 2^53, so converting it to double rounds once; the division rounds again. Result: `0x402F57218439052C`, the **neighbouring** double. |
| The test: `'{0:R}' -f` | printed that neighbour: `15.670177585564112`. |
| The test: string compare with `'…,15.670177585564113'` | failed. |

So the last-digit difference was produced by the **test harness**, not by the
solver. Evidence:

* `v42.patternProjection.projectionEv` in the same 4.3 report was written from
  the parsed object without the `[double]` cast and shows `15.670177585564113`.
* `hardware-validation.json` (same machine, same `mwcli.exe`) shows `…113`.
* `tools/ps_number_model.py` reproduces the Decimal → Double arithmetic with
  exact integers. Of the ten reference values in the self-test it changes
  exactly one, `15.670177585564113`, by exactly one ULP, to
  `15.670177585564112` — the pattern the report shows (the other EV and all
  response gains were unaffected in the report, and are unaffected in the
  model). **This is an arithmetic model, not a PowerShell run**: no Windows
  PowerShell was available in the build environment. The 4.4 self-test
  measures the real behaviour on your machine (section 4).
* The 4.4 Windows executables, run under Wine, print
  `"ev":[15.020151348500445,15.670177585564113],"evBits":["402e0a51470d8f36","402f57218439052d"]`.

Two more things followed from that failure:

* the 4.3 script **stopped at the first failed check**, so the 5 checks after it never
  ran;
* the 4.2 and 4.3 "identical for every thread count" checks compared the
  re-rounded numbers with each other. They passed, but two different doubles
  can be re-rounded to the same value, so those checks could have missed a
  one-ULP difference. `validate_hardware.ps1` had the same weakness in its
  CPU-versus-GPU comparisons.

## 2. The repair

* The engine now prints the IEEE 754 bit pattern next to every exact value:
  `evBits` beside `ev` (action EVs), `gainBits` beside `gain` (exact response
  gains), `valueBits` beside `values` (`mwcli --session`). A pattern is 16
  lowercase hex digits in a JSON **string**; no JSON reader, shell or
  serializer can re-round a string.
* `tools/test_windows.ps1` and `tools/validate_hardware.ps1` compare those
  strings. No comparison of re-formatted numbers remains (`'{0:R}'` is gone
  from both; `tests/v44.test.js` checks that). Equity comparisons in the
  hardware validator use the exact integer `shareUnits`.
* A failed check is now recorded and the run continues; the report lists every
  failure (`failures`) and passes only if there is none.
* No assertion was removed and no tolerance was introduced for any check that
  was exact before.

## 3. Policy

**Bit-exact (compare IEEE 754 patterns or integers):**

| Quantity | Reason |
|---|---|
| Exact action EVs and exact response gains across CPU thread counts, table modes (`EM_EV_PRIVATE_TABLES`, `EM_EV_DIRECT_PATTERNS`), devices (CPU, CUDA, hybrid, Automatic arms) and coverage modes | the engine adds the same terms in the same order in all of them (integer scores, sorted pattern histograms); specified as identical since 4.0 |
| The same quantities against the stored 4.2 references on the 4.0 fixture (`402e0a51470d8f36,402f57218439052d`; eight gain patterns) | same build flags (`-ffp-contract=off`, no fast-math), same summation order |
| Sampled estimates with the same seed across thread counts | fixed per-block random streams, block sums added in block order |
| Checkpoint bytes, SHA-256, RNG state, update / deal / visit counters, coverage counts, board counts, equity share units | integers or byte strings |

**Tolerance (stated at the comparison):**

| Comparison | Tolerance | Reason |
|---|---|---|
| Showdown tables vs per-board enumeration (`EM_EV_NO_TABLES`), and the 4.0 expected-value file | relative `1e-12` | the two methods add the same exact terms in a different order; observed differences are 0–2 ULP |
| Action-EV evaluator vs best-response evaluator | relative `1e-10` | different traversal order |
| Chip conservation, ICM prize-pool sums | absolute `1e-9`/`1e-8` | sums of many doubles |
| Sampled vs exact | 5 standard errors | statistical |
| Timings | stated per test | not numerical results |

**Precision guarantee for printed numbers.** Every finite double is printed
with 17 significant digits (`%.17g`). Any correctly rounding reader recovers
the identical double (verified natively and with JavaScript for 26 probe
values including one-ULP neighbours, negative, subnormal, `1e±300`, values
above 2^53 and the largest finite double: `mwcli --ieee`,
`mwcli --ieee-verify`). Readers that are **not** correctly rounding — Windows
PowerShell 5.1's Decimal path — may be off by one ULP; use the `*Bits` fields.

## 4. What the Windows self-test now records (section `v44`)

* `nativeRoundTrip`: `mwcli --ieee` → file → `mwcli --ieee-verify`: mismatches
  must be 0 (native print / native parse; under Windows this exercises the C
  runtime's `strtod`).
* raw-token check: digits in the CLI output compared as text.
* desktop API `/api/mw/ieee-probe` must be character-identical to the CLI.
* `powershell`: for every probe the type `ConvertFrom-Json` produced, the bits
  after a `[double]` cast, the bits after `[double]::Parse`, ULP distances and
  the `R`/`G17` renderings. `castMismatches > 0` is expected on Windows
  PowerShell 5.1 and is a **finding about PowerShell**, recorded and not used
  by any exact check. `referenceCastBits` shows what your PowerShell does to
  the value that failed in 4.3.
* bit patterns must survive `ConvertFrom-Json`, `ConvertTo-Json` and a file
  round trip unchanged (asserted).
* the EV of the 4.3 failure is re-evaluated and its raw printed digits and bits
  are asserted.

## 5. Not verified here

Windows PowerShell 5.1 itself was not run in the build environment (Linux,
Wine has no PowerShell). The PowerShell scripts were edited without being
executed. If a 4.4 script line misbehaves on your machine, the report's
`failures` array names it; please send `Windows-self-test.json`.
