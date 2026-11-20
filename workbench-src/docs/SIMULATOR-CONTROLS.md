# Simulator Controls (0.35.0) — visible mouse and keyboard input for your own simulator

The Workbench can now **play your poker simulator through its normal window**: it reads the table from the screen, asks the
strategy for a decision, moves the real mouse cursor visibly to the right button, clicks it (or types the bet amount), and then
reads the screen again to confirm the simulator accepted exactly that action. If anything is uncertain it **stops that table**
and waits for you — it never guesses and never clicks the same thing twice.

It only works with windows **you register** (your simulator, or the bundled test table), bound to the program's SHA-256. It has
no profiles for any third-party poker client, no hidden input, no anti-detection features, and no randomised "human" behaviour.
It does **not** change the EightMax 5.1 engine or make its strategies more accurate.

## Safety first

| You want to… | Do this |
|---|---|
| Stop everything immediately | Press **Ctrl+Alt+F12** (configurable) or the red **Emergency stop** button. Movement stops within one update (~16 ms), held buttons/keys are released, nothing starts again until you press *Reset emergency stop* **and** enable automation again. |
| Take the mouse back | Just use your mouse or keyboard. The driver notices physical input (Windows Raw Input) and **yields**: it refuses all input until you press *Resume after manual input*. |
| Make sure nothing can move | *Manual control mode* — the driver refuses every input command. |
| Pause one table / all tables | The table list's *Pause* button / *Pause all tables*. |

Restarting the Workbench never resumes automation by itself: the driver always starts **disabled**.

## First run (about 10 minutes)

1. Extract the whole ZIP and double-click **START-DESKTOP.cmd**. In the dashboard choose **⌖ Simulator controls**.
2. Try it on the bundled test tables first: double-click **START-TEST-TABLES.cmd** (two small table windows open).
3. **Connect simulator** → *List windows* → pick *EightMax Test Table 01* → tick the three confirmations → *Register window*.
4. **Check before you run** → *Preview mouse movement* (the cursor visits every control without clicking), *Test click*,
   *Test bet entry* (types the amount and reads it back; nothing is submitted).
5. **Automated play** → tick *Allow the labelled SCRIPTED test policy* (only possible on the bundled test table) →
   *Start automated simulation*. Watch the cursor; press Ctrl+Alt+F12 to see the emergency stop work.

## Your own simulator

1. Start your simulator and register its window (step 3 above). The Workbench records the program's file name and SHA-256;
   a different build of the program needs a new registration.
2. **Calibrate controls** → the Workbench takes a screenshot. Drag a rectangle over **Fold, Check, Call, Bet/Raise, the wager
   field** and (optionally) **All-in**. *Suggest from Windows UI Automation* fills in standard Windows buttons for you — check
   every box anyway. Choose the wager convention your simulator uses:
   * **raise TO** — you type the total your bet becomes (e.g. raising a 100 bet to 300 → type 300);
   * **raise BY** — you type the chips above the current bet (same raise → type 200).
   The preview shows every region, the exact click points, your display scaling (e.g. 150 %), the window size and a confidence
   figure. *Save profile* stores it with an integrity checksum (an edited file is refused on import).
3. Run the dry run and the test click / test bet entry again on your simulator.
4. Automated decisions on your simulator come from EightMax strategies; when none is available for a situation the table
   pauses (the scripted test policy is refused outside the bundled test table).

**Recognition of your simulator's table** (cards, stacks, pot) is a separate calibration — the controlled test table uses the
Workbench's own renderer. See *Remaining simulator-specific integration* below and `docs/NEW-PLATFORM-GUIDE.md`.

## Settings (Simulator controls → Settings)

| Setting | Default | Meaning |
|---|---|---|
| Cursor speed | 1600 px/s | Upper limit; physical pixels (at 4K/150 % the screen is 3840 px wide) |
| Max acceleration | 9000 px/s² | Upper limit |
| Update interval | 16 ms | ≈ 60 cursor positions per second |
| Minimum movement time | 140 ms | Even a short move is visible |
| Path curvature | 0 | 0 = straight; up to 0.25 bows the path sideways (deterministic) |
| Delay before click / button hold / settle after click | 60 / 70 / 150 ms | Click timing |
| Key interval | 45 ms | Pause between typed characters |
| Confirmation timeout | 3000 ms | How long to wait for the simulator to show the result |
| Window focus | bring-to-front | `refuse` never raises a covered window |
| Decision window | 12000 ms | An action that cannot be executed within this time **at the configured speed** is dropped, never rushed |
| Emergency-stop hotkey | Ctrl+Alt+F12 | Needs a driver restart to change |

The movement is a **minimum-jerk** profile (s(u) = 10u³ − 15u⁴ + 6u⁵): speed and acceleration are zero at both ends, peak speed
is 1.875 × distance / duration. The duration is the shortest one that respects *both* limits and the minimum time. These are
starting points for UI testing, not a model of human movement.

## How it works

```
capture (desktop host: PrintWindow or Windows Graphics Capture)
  → recognise (calibrated table reader + status strip on the test table)
  → reconstruct state (HandStateEngine; inconsistent readings pause the table)
  → decide (EightMax decision, or the labelled scripted policy on the bundled test table)
  → validate (TestExecutor: mode, authorisation, freshness, legality, duplicates)
  → schedule (ONE cursor: earliest deadline first; a job that cannot finish in time is dropped)
  → revalidate inside the lease (a fresh capture must still show the same frame and window rectangle)
  → input (EightMaxInput.exe via the desktop host: smooth move → hit test → click / clear+type+read back)
  → capture again → confirmAction(before, after): confirmed | rejected | ambiguous | timed-out | cancelled
```

* **EightMaxInput.exe** (C#, documented Win32 only): `SendInput` for all mouse/keyboard input, per-monitor-v2 DPI awareness,
  window identity = handle + process id + process start time + class, client-rectangle guard (`layout-changed`), the window
  under the cursor must be the target before pressing, `RegisterHotKey` for the emergency stop, Raw Input to notice a person's
  mouse/keyboard (no hooks), UI Automation read-only (control list, field value), WM_GETTEXT read-back of the wager field.
  Two single clicks on one spot are spaced beyond the Windows double-click time (a defect found by the Windows acceptance).
* **Desktop host** owns the one driver process (job object: it dies with the host), forwards whitelisted commands from
  authenticated requests (`/api/input/*`), and does not restart a crashed driver silently.
* **Duplicate protection**: the executor binds each action to (table, hand, state revision); the UI adapter records the
  idempotency key *before* any input; visible input is never retried. Only a refusal that provably sent nothing (e.g. the window
  moved before the click) lets a later attempt run, from a fresh reading, at most 4 times in a row.

## Checking this PC

| Launcher | What it does | Time |
|---|---|---|
| RUN-INPUT-SELFTEST.cmd | Driver moves/clicks/types in its own small window; tests cancel and the hotkey | 20 s |
| RUN-INPUT-ACCEPTANCE.cmd | 29 graded checks on two test tables (movement continuity, limits, click targeting, wager entry, invalid wager, move/resize, covered window, focus loss, cancel, minimise/close, e-stop, no orphan process) | 2 min |
| RUN-SIMULATOR-BENCHMARK.cmd | Full loop on 1, 2, 5, 8, 10 tables; every action graded against the test table's own record | 8 min |
| RUN-035-ACCEPTANCE.cmd | All three, then COLLECT-TEST-RESULTS.cmd | 12 min |

Close the desktop host before the benchmark (it uses the same local port). Do not touch the mouse while they run — touching it
makes the driver yield, which those tests count as a failure.

## Remaining simulator-specific integration

* **Table recognition for your simulator's look** — the shipped reader is calibrated for the Workbench's own renderer. Your
  simulator needs its own layout/templates (recognition calibration), or a status line like the test table's strip.
* **Which seat is yours** and whether opponents act on their own (the test table shows the acting seat's view).
* **The amount convention and chip unit** of your wager field (set in the calibration).
* **Your simulator's executable** for the SHA-256 binding.
