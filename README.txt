EightMax 4.6 - 8-max MTT solver for Windows
============================================

NEW IN 4.6: THE FAILED 4.5 SELF-TEST, A MEMORY BUDGET FOR THE WHOLE PROGRAM
  - Your 4.5 "Run self-tests.bat" stopped because a checkpoint file
    (icm45b.state) was missing. The test script threw away the solver's
    messages and never checked whether the solver succeeded, so the real
    reason was lost. The same steps run correctly here, both natively and with
    the Windows build of 4.5 (byte-for-byte the files you ran) under Wine.
    What made them fail on your PC is still unknown and needs your next report.
  - 4.6 makes that impossible to miss again. The self-test now records, for
    every solver call: the command, folder, exit code, all output and error
    text, and the time it took. It checks that a file exists before using it.
    A failing section no longer stops the sections after it. A failed run
    keeps its files in a "Windows-self-test-evidence-..." folder next to the
    report.
  - mwcli now says exactly why a checkpoint could not be read or written
    (which step failed and the Windows error). A failed save always leaves
    the previous checkpoint untouched. If another program (for example a
    virus scanner) briefly holds a just-written file, saving retries for up
    to 3 seconds instead of failing.
  - New continuation test (25 checks, every step a separate run): 150+150,
    500+500 and 1000+1000 updates equal uninterrupted training byte for byte;
    so do four checkpoint generations, repeated save/restore, 1 or 8 threads,
    saves interrupted at three different points, cancelled training, and
    missing or damaged checkpoints. It runs inside "Run self-tests.bat".
  - One memory budget for the whole program: the open study, a checkpoint
    being restored, evaluations and background jobs now reserve from one
    shared budget before allocating. Anything that does not fit is refused
    (or a background job waits) and nothing already computed is changed.
    The budget follows EIGHTMAX_PROCESS_MIB. See it at /api/mw/memory.
  - Automatic GPU mode: the 4.5 report said Automatic was 21% slower than
    CPU-only. That comparison used 3 runs per mode, and Automatic's fastest
    run beat every CPU run. Automatic does not touch the GPU on such small
    first requests, so it ran the same CPU code. "Validate CUDA hardware.bat"
    now alternates the modes over 9 rounds and reports a 95% range.
  - Strategy quality: training is unchanged (same strategy bytes as 4.4 and
    4.5). Three exploration settings were tested on six games with ten new
    seeds; none was better or worse beyond chance, so the default was kept.
    No better-converging trainer exists yet.
  - STILL NOT DONE ON YOUR PC: please run "Run self-tests.bat" and "Validate
    CUDA hardware.bat" again and keep Windows-self-test.json,
    hardware-validation.json and device-results.json.
Read RELEASE-4.6.md.

EightMax 4.5 - 8-max MTT solver for Windows
============================================

NEW IN 4.5: MEMORY LIMITS THAT HOLD, ONE MORE WINDOWS NUMBER FIX, FASTER ICM
  - The audit was right: the strategy-coverage table used more memory than
    its limit (1.43 MB for a 1 MB limit; about 90 MB for the default 64 MB).
    4.5 counts every byte of it before allocating - including the old table
    copies that stay alive while it grows - and refuses to go over. The
    limit "coverageMiB" is now a true ceiling. If the limit is too small for
    an evaluation, counts are reported as "at least N" with an estimate, as
    before; EVs never change. Each result shows budget and peak bytes.
  - Background evaluations now reserve their coverage memory in the shared
    memory pool as well (before, only the table memory was reserved).
  - A new 200,000-number check found that the Windows C library misreads a
    few extremely large or small numbers in their last digit. EightMax now
    reads numbers with its own exact routine. Printing was already exact.
  - The 4.4 "Run self-tests.bat" could not finish on Windows: one line of
    the test script used a function that Windows PowerShell 5.1 does not
    have. Found by running the tests on a Windows machine in the cloud
    (no GPU) and fixed.
  - ICM (tournament payout) calculations for 5-8 players are about 1.4x
    faster with bit-identical results; eight-handed ICM training is 13-19%
    faster. Strategies are byte-for-byte the same as 4.4.
  - Strategy quality is the same as 4.4. Two new training options were
    tested on six games with ten seeds each; neither was better, so they
    stay off. No better-converging trainer exists yet.
  - STILL NOT DONE: nothing has run on your RTX 4060 Ti. GPU scheduling is
    unchanged. Please run "Run self-tests.bat" and "Validate CUDA
    hardware.bat" and keep Windows-self-test.json, hardware-validation.json
    and device-results.json.
Read RELEASE-4.5.md.

EightMax 4.4 - 8-max MTT solver for Windows
============================================

NEW IN 4.4: THE TWO 4.3 TEST FAILURES EXPLAINED AND REPAIRED
  - "Run self-tests.bat" failed in 4.3 on a last-digit difference
    (15.670177585564112 instead of ...113). The solver was right. Windows
    PowerShell 5.1 changed the number while the test converted it. The
    solver now also prints each exact result as its exact bit pattern, and
    the tests compare those, so no script can alter a digit. A failing
    check no longer stops the checks after it.
  - Sampled EV evaluations with a time limit came back late in 4.3 (up to
    0.2 s late in our measurements). The time went into tidying up strategy
    coverage data after the deadline. 4.4 does that work while it runs.
    Measured here: at most about 0.02 s late, for every limit and thread
    count tested. Partial results now say how many samples were completed.
  - Automatic GPU mode: your 4.3 hardware report showed Automatic staying on
    the CPU even when the warm GPU was faster. 4.4 Automatic times the
    CPU and both ways of using the GPU on real tables and uses the fastest.
    THIS HAS NOT BEEN MEASURED ON A GPU. Please run
    "Validate CUDA hardware.bat"; it now reports exactly this comparison.
  - Strategy quality is the same as 4.3. We tested nine alternative training settings on
    six games with ten seeds each; none was better across the board, so
    training is unchanged (4.3 and 4.4 produce identical study files).
  - New accuracy checks for multiway spots (six players on the flop down to
    heads-up, bubble and final-table ICM): betting rules, chip conservation,
    prize-pool sums and two independent calculations agreeing. All pass.
  - Nothing in 4.4 has been run on Windows or on an NVIDIA GPU yet. The
    Windows programs were checked under Wine (a Windows compatibility layer on Linux) only.
    Please run both .bat files and keep the three JSON reports.
Read RELEASE-4.4.md.

EightMax 4.3 - 8-max MTT solver for Windows
============================================

NEW IN 4.3: SHARED SHOWDOWN TABLES, WARM CUDA, LARGER EXACT COVERAGE
  - Exact EVs and exact response gains no longer repeat work. Your 4.2
    hardware report showed every worker (and every seat of a response-gain
    request) building its own copy of the same showdown table. 4.3 builds
    each table once per request, with all available threads helping, and
    counts showdown patterns while scoring. Numbers are identical bit for
    bit. Measured here (4 CPUs): eight-seat exact response gains 4-5x
    faster, exact eight-player EVs 1.2-2.9x faster.
    (Sampled one-decision response gains measured about 5% slower.)
  - CUDA stays warm. The device is opened, verified and kept once per
    program run; Automatic opens it in the background instead of making an
    evaluation wait for start-up; set EM_GPU_PREWARM=1 to open it when the
    desktop app starts. Unused GPU buffers are released after 60 s idle.
  - GPU and CPU work on the same table together: the GPU takes batches,
    CPU threads take the rest or count patterns of GPU-scored boards. The
    long GPU "lock waits" in your 4.2 report came from duplicate tables and
    are gone in the simulated tests.
  - Strategy coverage counts are exact up to 2 million information sets by
    default (coverageMiB to change it). Beyond the limit results say
    "lowerBound" and add an approximate estimate, clearly labelled.
  - Ten-seed convergence study: no training variant was better on every
    game, so training is unchanged (identical states).
  - Validate CUDA hardware.bat now measures cold vs warm GPU use in one
    program run for every mode and 1-24 threads. GPU speed on your RTX 4060
    Ti has NOT been measured for 4.3 yet - please run it.
Read RELEASE-4.3.md.

EARLIER (4.2): CORRECT COVERAGE, SAFE CUDA CONTEXTS, MUCH FASTER EXACT EVs
  - Strategy coverage is counted correctly. 4.1 could count one information
    set twice (observed, merged from a worker, observed again), could merge
    two different ones, and mixed the seat into bits of the betting-state
    number. 4.2 keeps every key unmodified and merges worker results as a set
    union, so counts no longer depend on the number of threads. Results now
    show distinct information sets (with a stored row / using the fallback)
    separately from policy lookups (visits). Training, regrets and EVs were
    never affected; only the reported counts were.
  - CUDA works from every worker thread. The 4.1 message "CUDA allocation,
    VRAM reserve or launch failed during an EV table" came from driver calls
    made on EV worker threads on which the CUDA context was not current (the
    driver keeps a current context per thread). 4.2 makes the context current
    for exactly the duration of each call, on whichever thread calls, and
    releases every buffer. This was reproduced and fixed with a driver test
    double that enforces the real driver's rules; it has NOT yet been
    confirmed on your RTX 4060 Ti - run Validate CUDA hardware.bat.
  - CUDA problems are reported precisely: the driver call, its error name and
    code, the thread, requested bytes, free VRAM, budget and reserve, and
    whether the CPU took over. A table that does not fit the GPU budget goes
    to the CPU without disabling the GPU; a genuine driver fault disables it
    for the session. The results are identical either way.
  - Exact EVs and exact response gains are about 5-24x faster (identical
    numbers, bit for bit). Profiling showed that 96% of the time went into
    counting showdown rank patterns, not into evaluating boards (3%), which is
    why the GPU could never speed up complete EVs much. 4.2 counts them once
    per table and derives every subset exactly.
  - Automatic processing starts CUDA only after a run has already spent at
    least the expected CUDA start-up time on CPU table work, so short
    evaluations no longer pay for GPU start-up. Results show the requested
    AND the actual device, and a time profile.
  - The GPU memory check in the hardware validator was wrong in 4.1 (the
    equity kernel needs only about 2.7 KB, so a 1 MiB budget is enough). 4.2
    measures the real request and tests one byte below it and exactly at it.
  - Validate CUDA hardware.bat re-runs the 4.1 failing configurations, the
    budget checks, response gains with 1 to 24 workers and the new
    gpustress.exe (concurrent GPU jobs, cancellation on the GPU, repeated
    CUDA start-up), all compared bit for bit with the CPU.
Training is unchanged (byte-identical states). Read RELEASE-4.2.md.

EARLIER (4.1): SAFER INPUT, RELIABLE JOBS, HONEST STATISTICS, FASTER GAINS
  - Malformed numbers are refused. Values such as 1e300, 2^64, fractions,
    null or "512" in any request field are rejected with a clear message
    BEFORE they are converted. In 4.0 such values could crash the desktop
    host (undefined behaviour reproduced in 10 of 16 tested input paths).
  - Background evaluation jobs: a job that waits in the queue now gets its
    full time limit once it starts (4.0 subtracted the waiting time). The
    intermittent Windows test failure of 4.0 was traced to the test comparing
    a live memory measurement, not to the engine; the test was corrected and a
    repeated concurrent-start stress test was added.
  - Action comparisons account for the number of actions and for picking the
    highest estimate. Labels: "best (supported)" only when an action beats
    every other one with family-wise 95% confidence; "highest estimate (not
    established)" when the top estimate is not clearly ahead; "lower
    (supported)", "difference uncertain" (never evidence of equality) and
    "equivalent within margin" (only with a margin you set). The tooltip shows
    the simultaneous interval. In simulations the 4.0 labels made a false
    claim in 20% (4 equal actions) to 50% (8 equal actions) of runs; 4.1 in
    about 5%.
  - Work budgets: the EV result reports the work done (board evaluations,
    tree visits, samples, ICM evaluations, ...). A new "Board-evaluation
    limit" and a "Memory (MiB)" field join the time limit, sample count and
    visit budget. An exact result is never shown when a budget ran out.
  - Strategy quality: "Measure response gains" (explorer) runs a background
    job and lists every seat (UTG ... BB) with the evaluator used (exact,
    restricted or sampled one-decision deviation), gain, 95% interval,
    samples, seed, time and fallback share. Seats are evaluated in parallel:
    eight-seat exact gains 19.1 s -> 4.7 s on 4 threads, identical numbers.
    Restricted and sampled gains are lower bounds, never exploitability.
  - Training is unchanged. A new convergence study (other DCFR settings, exact
    measurements, five seeds, multiplicity-adjusted) found no setting better
    than the default, so none was adopted.
  - The GPU report shows why each showdown table ran on the CPU or GPU and the
    peak VRAM used. The RTX 4060 Ti has still NOT been tested: run
    Validate CUDA hardware.bat; its "physicalNvidiaExecution" field says
    whether CUDA really ran on your PC and matched the CPU.
Read RELEASE-4.1.md for measurements, test results and limitations.

EARLIER (4.0): RESPONSIVE, CANCELLABLE AND CLEARER ACTION EVs
Open a native study, choose Explore strategy, pick a decision and a hand
class, then "Calculate EVs". 4.0 changes how that works:
  - EVs run as BACKGROUND JOBS on the desktop host. While a large evaluation
    runs you can keep navigating the explorer, change hands, look at results
    and checkpoints, and press Cancel at any time. The status line shows the
    job state, elapsed time, completed samples, runout boards scored (and how
    many on the GPU), the current stage and evaluation memory. No completion
    percentage is shown because the remaining work is not known in advance.
  - Time limits are enforced. 3.9 could ignore a 100 ms limit for more than
    ten seconds in an eight-player preflop ICM spot; 4.0 stops within a few
    milliseconds of the limit (measured: 101-102 ms for a 100 ms limit on
    Linux, under Wine and on a GitHub Windows runner). A timed-out EXACT
    evaluation shows no numbers; a timed-out sampled evaluation shows its
    completed samples marked PARTIAL, only if at least 100 were completed.
  - New controls: Method (Automatic/Exact/Sampled), Utility (ICM or chip EV in
    tournament studies), Time limit, Visit budget, Processing (Automatic, CPU
    only, GPU preferred, Hybrid CPU/GPU), Equivalence margin, and how
    untrained states are handled (uniform, fold/check or call/check fallback,
    or refuse).
  - Honest comparisons. Each action is labelled against the highest estimate:
    "lower (supported)" when the 95% interval of the paired difference
    excludes zero, "difference uncertain" when it does not - which is NOT
    evidence that the actions are equal - and "equivalent within margin" only
    if you set a margin and two one-sided tests support it. Overlapping
    intervals are never presented as equality.
  - Strategy coverage. Every result reports how many strategy lookups found a
    trained row, which fallback policy replaced the missing ones and how much
    probability passed through them. A red warning appears when the share is
    notable (default 5%) or substantial (25%), because those EVs depend on the
    fallback assumption rather than on a trained strategy.
  - Exact evaluations are much faster in multiway all-in spots (showdown tables
    shared by all terminals of a deal; e.g. 24.5 s -> 2.0-2.4 s single-threaded,
    1.3 s with threads, for the eight-player push/fold root) and use several
    CPU threads. Results do not depend on the thread count.
  - Response gains have three clearly named modes: exact best response (small
    games), restricted best response (best response on the study's first
    street, exact or sampled) and the 3.9 sampled one-decision deviation.
    None of them is a claim that an eight-player game is solved.
Training is unchanged from 3.9 (byte-identical strategies). Read
RELEASE-4.0.md for measurements, test results and limitations, and run
Run self-tests.bat and Validate CUDA hardware.bat on your PC: the RTX 4060 Ti
CUDA path for EV showdown tables has NOT been run on NVIDIA hardware yet.

EARLIER (3.9): ACTION EVs, RESPONSE GAINS AND STRICT EXPLORER REQUESTS
Open a native study and choose Explore strategy (preflop to river) as in 3.8.
At a decision, click a hand class, then "Calculate EVs of the selected class"
(or "Calculate EVs of every hand"). EightMax computes the expected value of
every legal action (fold, check, call, bet/raise sizes, all-in) for each combo,
the EV of the stored mixed strategy, and each action's difference from it.
  - EVs are COMPUTED from the game model, not read from the checkpoint (it
    does not store EVs) and not derived from strategy frequencies or regrets.
  - Every later decision of every seat follows the named continuation policy
    (Average = solver output, or Current regret matching). Opponent ranges are
    weighted by their own strategy on the path and by card removal.
  - Chip-EV studies report BB; ICM studies report tournament equity (payout
    units). Small spots are enumerated exactly; larger ones are Monte Carlo
    estimates with sample counts, a seed and 95% intervals (shown as +/-).
  - "Matrix shows" switches the 13x13 matrix between strategy frequencies, the
    EV of one action, EV minus mixed-strategy EV, and the EV standard error.
    Classes without computed combos stay empty.
Desktop API: POST /api/mw/ev and POST /api/mw/response-gain (see
source/native/MW-PROTOCOL.md). Malformed explorer, EV and response-gain
requests (for example "rangeSeat":"nonsense", negative offsets, fractional
numbers, unknown fields) are now refused with HTTP 400 instead of being
silently converted. Response gains are exact best responses for small studies
(exact exploitability for heads-up chip EV) or clearly labelled sampled
one-shot deviation gains per seat for large multiway studies; they are not
claims that an eight-player game is solved.
Read RELEASE-3.9.md for test results, measurements and limitations.

EARLIER (3.8): STRATEGY EXPLORER FOR NATIVE STUDIES
Extract the ZIP and double-click EightMax.exe. Open Multiway, then Native
checkpoint recovery, and open a saved native study (Open latest on desktop or
choose a portable .emstudy). Choose Explore strategy (preflop to river).
Click actions to move through the solved betting tree, select flop, turn and
river cards when a street ends, and click a hand in the 13x13 matrix to see
each combo. Previous decision and the history buttons go back. Strategy
switches between the average strategy (the solver output) and current regret
matching. Range of shows another seat's reach distribution. The explorer reads
one decision point at a time from the desktop host, so large studies are not
copied into the browser. EVs are not shown: saved native studies do not store
them. Branches outside the solved bet sizes are refused, not invented.
Native restores are now checked against an up-front memory estimate and are
refused with the required and available MiB when they cannot fit.
Read RELEASE-3.8.md for measured speed, accuracy, memory and test results.

CONTINUING A NATIVE STUDY
After verification, enter Additional updates and choose Continue training.
View starting-hand strategy shows root action probabilities. Use Save native
checkpoint to commit and Close desktop study to release memory.
The default storage cap is 2,048 MiB. See RELEASE-3.7.md for larger studies,
generation retention, disk estimates and RAM limits.
Use Run self-tests.bat and Validate CUDA hardware.bat for your Windows PC.

QUICK START
1. In Windows Explorer, right-click the ZIP, choose Extract All, and open the
   EightMax folder.
2. Double-click EightMax.exe. Keep its console window open while studying.
   It opens a browser at a local address, usually http://127.0.0.1:8708/.
3. Choose Multiway. For a six-way example, select 6 under Players
   in the pot, leave Players dealt in at 8, and click Solve flop.
   In Action explorer, choose Check for each player, then choose a turn card.
   Follow another betting line or deal a river when the turn betting closes.

EightMax-Offline.html is a browser-only alternative. Open it in a current
version of Edge, Chrome or Firefox. It includes the same multiway postflop solver
and preflop charts. EightMax.exe also enables native heads-up solving, GPU
support and saved heads-up solutions. Both entry points work locally.

HISTORICAL CHANGES IN 3.6
Open Multiway and use Save training for a portable .emstudy file. Enable the
autosave interval to keep recoverable generations in Documents\EightMax.
Checkpoint recovery details shows progress, generation, time, size, integrity
and disk or storage policy errors. The default per-checkpoint cap is 2 GiB
with 128 MiB of disk space reserved. Read RELEASE-3.6.md for storage policy,
validation, memory requirements and measured accuracy and performance.

Extract the ZIP completely before double-clicking EightMax.exe. Run self-tests.bat
produces Windows-self-test.json. Validate CUDA hardware.bat produces
hardware-validation.json for your Windows PC and RTX 4060 Ti.

HISTORICAL CHANGES IN 3.5
Open Multiway and choose Checkpoint recovery details to see generations,
download a portable checkpoint, or adopt an older legacy save. See
RELEASE-3.5.md for measured results and local hardware validation.

NEW IN 3.4
Desktop checkpoints are verified before commit. A failed background job can be
retried. Native full betting traversal now supports Compact and Detailed groups.
Eligible sampled batches can use CUDA for scoring. For tests, benchmark results,
known limitations and instructions for your PC, read RELEASE-3.4.md.

PREVIOUS RELEASE: NEW IN 3.2
Read RELEASE-3.2.md for checkpoint recovery, memory caps, supported grouped games,
accuracy measurements and Windows hardware validation. Results are in validation/3.2.

PREVIOUS RELEASE 3.1
Read RELEASE-3.1.md for the supported configuration matrix, measured accuracy per
second, CUDA status and known limitations.
- Large and preflop Multiway studies now train in native C++ too. Choose Wide
  ranges, Exact cards and Training engine = Native C++ when eligible. Big trees
  use native external sampling (sampled betting) instead of falling back to
  JavaScript; small trees still use full traversal. Results are identical to the
  JavaScript engine, only faster (about 8-9x on one thread, more with threads).
- Sampled-betting action streams = Per deal lets frozen batches (Deals per update
  above 1) use every CPU core. Shared keeps a single stream.
- The progress line shows which engine, algorithm, device and memory are in use,
  and why JavaScript was used if it was.
- Validate CUDA hardware.bat checks your NVIDIA GPU (e.g. RTX 4060 Ti) against the
  CPU with exact all-in equities and records speed. CUDA was not run on a physical
  GPU while preparing this release.

PREVIOUS RELEASE: NEW IN 3.0
Read RELEASE-3.0.md for supported games, accuracy measurements and outstanding hardware checks.
Balanced remains the accuracy preset. CPU Only is the initial multiway scoring device.
For native training choose Wide ranges, Exact cards and Native C++ when eligible.
The desktop interface offers CPU Only, Automatic, GPU Preferred and Hybrid CPU/GPU.
Run Compare processing modes.bat on Windows to test an identical turn study on your machine.
It records the observed device, wall time and a digest of the final strategy for each mode.
The earlier GPU self-test exercises the separate OpenCL heads-up engine.

ADDED IN 2.9
Read RELEASE-2.9.md for everything measured in this release and what remains
untested.
- Native C++ multiway training: in EightMax.exe, sampled Multiway studies that
  use Exact cards and chip EV train in native code with all CPU cores. That is
  about 7-11x faster than the browser engine, with exactly the same results.
  Choose Training engine = JavaScript to compare. Other studies train in
  JavaScript, and the result says why.
- Update scheme: Own-hand enumeration gives the most accurate strategies per
  sampled deal. Simultaneous (the default) is faster per second.
- Memory: EightMax.exe keeps the native host plus the reported browser memory
  within half of your RAM (at most 8 GB). EIGHTMAX_APP_MIB changes this. Studies
  too large for the budget are refused with an estimate.
- Browser checkpoints were tested across browser restarts and crashes.
- Version 2.9 had no CUDA support. Its executables were unsigned and tested under Wine on
  Linux, not on Windows.

PREVIOUS RELEASE: NEW IN 2.8
See RELEASE-2.8.md for setup, checkpoint recovery, resource limits, measured
accuracy, performance comparisons and release limitations.

PREVIOUS RELEASE: NEW IN 2.7
Read RELEASE-2.7.md and ACCURACY-SUMMARY.md for changes, measured results,
precision presets, and features that remain unimplemented or unverified.
The new Windows executable was cross-compiled, not run on Windows here.

PREVIOUS RELEASE: NEW IN 2.6
Full details: CHANGELOG.md. Test and benchmark results: validation/2.6/.

Seven- and eight-player presets solve again. Multiway postflop now has
Private ranges = Automatic (the default). It uses exact deal enumeration when
the spot fits the desktop limits and is practical to run, and sampled deals
(Wide ranges) otherwise. The result says which mode was chosen and why. In
2.5 the 7- and 8-player presets asked for exact enumeration and stopped with
a tree-limit error.

Fresh Windows engine. EightMax.exe is compiled from the included source
(MinGW-w64, 64-bit) and contains the native fixes that the 2.5 package's
older binary lacked. The interface, the engine and BUILD-INFO.json share a
version (2.6) and build id. The app warns if they ever differ. SHA256SUMS.txt
lists a checksum for every file. The executable is not digitally signed.

Honest accuracy numbers. Check accuracy now measures a sampled study exactly
whenever its spot can be enumerated. It copies the strategy into the exact
game and computes each seat's full best response. This showed that the old
tested-response figure understated the error: on the 3-player reference
river, sampled training is about 0.24 bb from a best response after 12,000
iterations, against 0.0003 bb for exact enumeration. Prefer exact
enumeration (Automatic does) when a spot fits. The tested-response check
used for larger spots is stronger now, but it is still a lower bound.
Completing the iterations does not make a strategy GTO.

Antes. 0.1 bb per dealt player remains the default (0.8 bb with eight dealt).
A preflop seat too short for the ante posts what it has and can win only what
it matched. With a big blind ante, the blind is posted before the ante.

Windows status: the new EightMax.exe was tested under Wine on Linux, not on
Windows. Run "Run self-tests.bat" on your PC once. GPU solving was checked
only with the built-in CPU emulator.

NEW IN 2.5
Future-game ICM (FGS). Custom push/fold with ICM has a Future hands setting:
Off, Next hand or Next 2 hands (4 players or fewer). Plain ICM values stacks
the moment the hand ends and ignores the blinds still to come. With FGS each
possible result is valued by solving the next hand at the same blinds with
the button moved one seat; busted players keep their finishing payout and
players at other tables keep their stacks. Example, 4-handed 50/30/20, big
blind ante, stacks 4/20/15/11 bb: the 4 bb player, who posts the next big
blind, jams 55% instead of 30%. Heads-up, where ICM is linear in chips, it
changes almost nothing. One hand takes about 2 s at 4 players and 15 s at 8.

Recalibrated 15-100bb charts. The equity-realization estimate behind the deep
preflop charts was hand-tuned. It is now fitted to 80 of EightMax's own flop
solves (20 representative flops, BTN-vs-BB and SB-vs-BB single-raised pots at
25 and 60 bb). On flops held out of the fit its error in pot share fell 14-19%.
Pots can now be won by more than their size when stacks are deep (heads-up
chip pots only). All nine chart depths were re-solved. Typical changes: the
button opens about 4 points wider at 40-60 bb, the small blind raises more
often instead of limping, and the big blind defends slightly wider. Re-solve
with postflop play remains the exact answer for any one spot.

Eight-player linked and postflop studies. Preflop-to-river and postflop
multiway studies now take up to eight seats (shove/call already did). Re-solve
with postflop play loads all eight seats of the 8-max chart instead of the
last six.

Faster multiway ICM. Tournament-payout studies keep many more ICM results in
memory and reuse betting labels. A six-player linked ICM study, 10,000
iterations, takes 9.2 s instead of 12.5 s in 2.3 on the same machine, with
less memory. Results are bit-for-bit unchanged.

Accuracy report. source/tools/accuracy_report.js measures accuracy and writes
validation/ACCURACY.txt. Push/fold is checked by an independent oracle with
exact card removal: the solved strategies are within 0.0004 bb (or prize
units) of a true equilibrium, and EVs agree within 0.01. On a small
three-player river, exact deals reach a 0.0003 bb best-response gain in 5,000
iterations, while sampled deals still vary by seed after 12,000. When a spot is
small enough for exact deals, use them.

Windows build and verification. .github/workflows/windows.yml, restored in the
package, runs the tests on a Windows machine, compiles a fresh EightMax.exe
from this source, checks the 2.5 host fixes, and produces a release zip
built around the fresh executable with Windows test reports in validation/.
VALIDATION-2.5.json summarizes the checks run for this package; the 2.3
reports are kept in validation/2.3.

Fixes. An empty request to the native host no longer crashes it; every route
returns an error instead. Saved solutions can no longer use Windows device
names such as CON, NUL, AUX, COM1 or LPT1, which Windows treats as devices
rather than files, and saving before solving reports a clear message instead
of a server error. Very large solves whose river data would overflow the GPU's
32-bit offsets now fall back to the CPU instead of corrupting the GPU data.

NEW IN 2.4
Ante structures. Multiway studies, linked preflop, Shove / call and custom
push/fold now offer Each dealt player (classic, default 0.1 bb), Big blind
ante (default 1 bb, posted once by the BB) or No ante. Postflop studies with a
big blind ante can name the live seat that posted it for ICM start stacks.
The built-in push/fold and 15-100bb chart libraries remain classic-ante.

Faster Wide ranges convergence. New Wide studies use linear iteration
weighting (Linear MCCFR): later, better-informed iterations count more. On a
heads-up river reference with two sizes and raises, the tested best-response
gain after 16,000 iterations fell from about 0.010 to 0.002 bb. Training
saved by 2.3 resumes with its original uniform weighting. New saves use the
2.4 format; 2.3 files still load.

Geometric bets. Enter g in a multiway bet box for the pot fraction that gets
the effective stack in by the river at the same fraction on every street.

Overcalls and solved charts. Custom push/fold has Solve with overcalls, which
opens the spot in Shove / call, where every seat can call, overcall or
isolate. The 15-100bb charts have Re-solve with postflop play, which loads the
last six seats into the linked preflop-through-river study instead of the
charts' equity-realization estimate.

Heads-up locks. A Suit isomorphism switch is now in the heads-up setup. With
it on, a strategy lock after a turn or river card that has suit twins is
refused, because it would also lock the twin cards. Turn it off to lock there.

Fixes. The native host no longer overflows when scheduling accuracy checks
for very tight targets, and Build, Load, Save and Lock can no longer race a
solve that is starting. Negative, infinite or missing stacks, range weights
and report iteration counts are rejected or clamped.

Windows: this EightMax.exe carries the 2.4 interface and all browser engines
on the verified 2.3 native heads-up core. The native fixes above are in
source/native; the included GitHub workflow compiles and tests a fresh
EightMax.exe with them. Validation: 76 regression tests and the packaged
UI/worker smoke tests pass; native checks passed on Linux.

NEW IN 2.3
Multiway training can now be saved and continued after closing the app.
After solving or pressing Stop, click Save training. Keep the downloaded
.emstudy file. Use Load saved training at the top of Multiway to reopen it,
then enter Additional iterations and click Continue training. Both browser
and desktop entry points use this format. It includes the setup, regrets,
average strategy, iteration count and both training random states.

A restored study continues the same training sequence on the same engine.
Save/load works for enumerated postflop, sampled postflop, linked preflop
and shove/call studies, with chip EV or ICM. Checkpoints use exact Float64
values and an integrity checksum. Damaged or incompatible files are rejected
without replacing the current study. This format starts with version 2.3;
older native heads-up .em8 solutions remain a separate, view-only format.
Accuracy reports are not saved and should be rerun after further training.

Wide ranges now offers three hand-grouping choices:
- Compact: the earlier broad strength/draw groups, using less memory.
- Detailed (default): separates private hand classes, made hands, flush
  blockers and draw quality, straight outs, backdoor potential, and board
  texture while remembering the earlier street signals.
- Exact cards: no card grouping; distinguishes each private combination and
  complete board history. Deals and betting branches are still sampled.

Detailed treats suit names symmetrically; use Exact cards when asymmetric
suit weights make that approximation unsuitable. Finer groups need more
training and memory. They do not automatically produce a more accurate
strategy at the same iteration count. Compare seeds and tested responses.
Automatic traversal samples betting branches for Detailed and Exact cards
studies with future streets, avoiding the rapid memory growth of full
betting traversal. Compact mode keeps the earlier automatic threshold.

Set Strategy budget from 1 to 256 MiB (default 112). This is estimated
strategy storage, not total application memory. If training stops at the
budget, increase it under Save and continue training, then continue.
The file preserves any updates made before a memory stop. Continuing that
saved state matches continuing the same stopped in-memory study; it does
not undo the partly processed iteration. Checkpoint downloads are limited
to 512 MiB. Loading and saving temporarily require additional RAM.

Tournament ICM also has an optional hand-start stack field for the live
seats, used to rank simultaneous eliminations. Leave it blank to derive
stacks from chips behind, prior wagers and antes. Preflop always uses the
entered before-posting stacks.

Double-click Run self-tests.bat to check the Windows native CPU engine.
It starts a temporary local instance, checks the version and embedded app,
tests an independently known river equilibrium, rejects duplicate cards,
and writes Windows-self-test.json. GPU self-test.bat is still separate.
A clean Windows build/test workflow is included for developer use.

Validation: 70 engine regression tests pass, including exact checkpoint
continuation and malformed-file rejection. Bundled app/worker checks cover
save, load, resume, new grouping controls and the existing study modes.
Native CPU equilibrium and 990-runout checks passed on Linux. The Windows
scripts and workflow have not been executed on Windows in this release;
physical GPU operation and real browser rendering remain unverified here.
See VALIDATION-2.3.json for the recorded scope and results.

Six-player postflop and the 0.1 bb ante per dealt player remain supported.
There is no big-blind ante. This remains an approximate research/study
solver; no complete eight-handed tournament GTO solution is certified.

NEW IN 2.2
Tournament ICM now works in multiway postflop and the new preflop studies.
Choose Tournament ICM under Payoff, enter the remaining payouts largest
first, and include every other player still in the tournament under Other
remaining stacks. Include folded seats with their chips left after posting
and betting. Up to 16 remaining players are supported. Values are expected
remaining prizes in your payout units; stacks and bets stay in bb.

ICM is calculated separately for each completed showdown and side-pot
outcome, then averaged. Simultaneous busts are ranked by hand-start stack;
equal starting stacks split the affected prizes. The postflop setup derives
hand-start stacks from chips behind, earlier wagers and the 0.1 bb ante.
This release models regular payouts, without knockout bounties or future
blind increases.

Multiway > Preflop loads a linked preflop-through-river study for two to six
live players. It trains preflop decisions with the configured postflop
betting tree, including calls, overcalls, raises, folds and side pots.
Enter stacks BEFORE posting. List seats in preflop order, SB second last
and BB last. The solver posts the blinds and antes automatically. Both
blinds must be included; any other dealt seats are assumed already folded.
For eight dealt and six live players, all eight antes are in the pot.

Opening preflop sizes are raise-to amounts in bb. Reraises use multiples,
percentages of the pot, or a for all-in. The preflop raise cap is separate
from the caps on flop, turn and river. Use random for all 1,326 private
combinations, or enter weighted ranges. After following a preflop line,
enter three flop cards in the explorer to inspect its continuation.

Multiway > Shove / call supports two to eight players, unequal stacks,
overcalls and all-in isolation raises. Play continues through every eligible
seat after a caller enters. If several players retain chips when preflop
closes, this restricted mode checks down the rest of the hand. Use the
linked mode when those players must be able to bet postflop.

Preflop studies use sampled training. Their chip EV includes each active
player's blind and ante payments, measured before posting. ICM values are
absolute expected prizes. Accuracy reports and response checks use the
selected units; the ICM reporting threshold is 0.1% of the prize pool.

Validation: 54 regression tests passed, including independent ICM ranking,
complete three-player deviation checks, tied bust payouts, six-player
linked streets, eight-player overcalls, short blinds and side-pot refunds.
Packaged UI/worker checks cover the new controls and previous workflows.
Native heads-up checks ran on Linux. Direct Windows execution and physical
GPU testing remain unverified.

The legacy eight-handed preflop charts retain their earlier approximation
and three-player flop cap. The new linked study is separate, conditional on
the entered live seats and ranges. Its postflop hand groups and chosen bet
sizes remain abstractions. A completed iteration budget does not establish
GTO convergence. See ROADMAP.md for the remaining planned work.

NEW IN 2.1
Wide ranges now handles larger betting trees automatically. Small studies
keep the full betting traversal. Larger studies sample opponent actions,
explore the updating player's actions, and create betting states as needed.
Regrets and average strategies share pooled storage. The six-player example
now offers two bet sizes plus a 2.5x raise on every street.

After solving, open Accuracy and bet sizes and press Check accuracy and bet
sizes. The default check uses three training seeds, adds the sizes entered
for each remaining street, and trains a separate response for every seat.
The original solution stays in the Action explorer. Stop ends the checks
and returns the original solution with any completed comparisons.

The report includes original and expanded EVs, observed seed ranges, root
action frequencies, and tested response gains with approximate individual
95% intervals. It flags EV changes above 0.1 bb and frequency changes above
5 percentage points. Each recorded run shows its seed, training count,
traversal and stopping reason. Errors from expanded trees appear in the report.
The regular wide-range solve also compares its halfway and final root mix.

Added-size comparisons re-solve all players at the original completed
iteration budget. Seed variation includes training and evaluation noise.
A tested response is learned against the frozen original strategy, then
evaluated with separate deals. Its gain covers that tested policy within the
chosen bets and hand groups. These checks cannot certify full-game GTO.
Exact enumeration already reports complete unilateral gains within its
configured private-deal, betting and public-card tree.

Validation covered 41 regression tests, including an independent three-player
policy and response oracle, the analytic river bluff equilibrium, side pots,
ante accounting, memory stops, comparison failures and cancellation.
Packaged UI/worker checks exercised six-player flop-through-river play and
the complete accuracy-check controls. Native heads-up checks ran on Linux.
Direct Windows execution and physical GPU validation remain outstanding.

TOURNAMENT SETUP
Each player dealt a hand posts 0.1 bb, including the small blind, the big
blind, and anyone who folds preflop. With eight dealt, the pot before the
first action is 2.3 bb (0.8 in antes plus the 0.5 and 1 bb blinds).
The push/fold charts at all 23 depths and the deeper preflop charts at all
nine depths have been regenerated for this structure.

Multiway postflop supports two through six live seats on the flop, turn and
river. The Players dealt in field controls the ante total independently.
The six-way example assumes both blinds continued, all six put in 2 bb
preflop and started at 25 bb. With eight dealt, the flop pot is 12.8 bb and
each player has 22.9 bb behind. With six dealt, the same pot is 12.6 bb.
Enter other folded blinds or wagers separately when applicable. Enter chips
behind after the ante and previous betting. The ante is added automatically.

The six-way example starts in Wide ranges with small illustrative ranges.
Flop bets are 25/50% pot, turn bets 50/100%, and river bets 75/125%. Each
street permits a 2.5x raise, with a two-bet cap. Replace the board and ranges
to match your study. Wide mode samples fresh legal cards from the full deck.
Enumeration remains available for compact reference studies.

WIDE PRIVATE RANGES
Choose Multiway > 25 bb button vs blinds > Solve flop to study an
eight-handed chart opening to 2 bb, followed by calls from both blinds.
The preset brings all three weighted ranges into a three-way 6.8 bb pot. All three have 22.9 bb behind.
The half-pot opening bet is available on each street with a one-bet cap.

In Private ranges, Wide ranges draws fresh weighted hands and legal remaining
board cards for every training deal. Hands are drawn independently, and any
colliding tuple is discarded in full. Training uses sampled regret matching with full or sampled betting traversal. Strategies share information across hands with similar visible
made-hand strength and draws, remembering preceding street signals. A narrow
starting range (at most 12 combinations in a seat) uses exact starting hands.
Showdowns always use actual hands. Wide mode uses the full physical deck,
regardless of the public-card subset selected for enumeration.

Results use 4,096 separate evaluation deals. Standard errors describe noise
in estimating the displayed strategy's EV. They exclude uncertainty from
training, hand grouping and omitted bet sizes. Rerun with other seeds before
drawing conclusions about close actions. Hand rows display effective sample
counts. Wide mode accepts up to 100,000 training iterations. Detailed and Exact cards use sampled betting traversal when future streets
remain. Compact mode switches above 2,200 betting states. Strategy storage has an
estimated configurable budget per solve (default 112 MiB), separate from total process memory.
Reaching that budget returns the current strategy with a visible stopping
reason. Stop also returns the current average strategy. Enumeration remains available for small reference studies.

LINKED POSTFLOP STREETS
- Start a two- to six-player chip-EV study with three, four or five board
  cards. The same solve trains the starting street and all later streets.
  Each player sees their own cards and the public history. Folds, stacks,
  side-pot eligibility and blockers carry through the hand.
- Set opening bets, raises and a bet/raise cap separately for each street.
  Sizes are percentages of the current pot. For raises, 2.5x is a raise-to
  multiple. Enter a for all-in. A blank size list omits that action.
- All legal cards enumerates every possible next card for each compatible
  private deal. Seeded sample keeps a repeatable subset at each public
  board. Extra cards are included when necessary so every private deal has
  a legal continuation. Sampled results describe that selected card tree.
- The explorer shows next-card probabilities conditioned on the betting line,
  per-hand frequencies and action EV. Action EV starts at the current
  decision and assumes the displayed continuation strategy. The results
  table reports each seat's EV from the start and its best-response gain.
- Use Preflop > 15-100bb to follow a three-player line. Choose Set up a
  multiway flop to carry ranges, prior wagers, stacks and action order over.
  Enter the flop and check the proposed ranges and bet sizes before solving.

WHICH SETTING TO TRY
The three-player enumerated flop example starts with four sampled cards per
later street. Its turn example uses all legal rivers. The river example has
a fixed board. Change the seed to see how sensitive a sampled result is.
For an exact small flop, try short equal stacks, a single all-in opening
size on each street, no raises, and narrow ranges.

SCOPE AND LIMITS
- Enumerated mode includes the entered, compatible private deals, up to 4,096.
  Flop/turn trees allow up to 60,000 public states and 750,000 state-deal
  pairs, subject to memory checks. A fixed river allows 4,000 states and
  180,000 state-deal pairs. A larger request returns an error. Reduce the
  betting tree, use seeded public cards, or narrow the private ranges.
- Postflop uses the chosen ranges and legal actions in the specified tree.
  The iteration limit can be reached before the selected gain target.
  Multiplayer solves report gains for this profile. Sampled gains apply
  only to the selected runouts. No whole-tournament accuracy is certified.
- The eight-seat preflop charts still estimate the value of reaching a flop.
  The handoff opens a postflop study; it does not retrain those charts.
  Multiway postflop supports chip EV or regular-payout ICM for up to 16
  remaining players. Legacy push/fold charts still end at the first caller;
  use the separate Shove / call study for overcalls.
- Version 1.7 repaired betting rights, side pots, heads-up ICM ties, equal
  simultaneous bust payouts and heads-up position transfer. Its nine
  deeper preflop charts were trained again for the 2.0 tournament structure.

NEW IN 1.6
More bet sizes, the way they're used online
- Bet size presets (Postflop > Bet sizes):
    Quick:      Fast (one size per street), Standard (two sizes)
    Online MTT: Single-raised pot (c-bets 33/75/125%, turn 50/100%,
                river 33/75/150%, 3x check-raises), Single-raised pot +
                raises (adds 3x turn and 2.5x river raises), Single-raised
                pot + leads (the caller may lead and donk 33%), 3-bet pot
                (c-bets 25/50%, turn 50/100%, river 50/100%/all-in)
    Styles:     Small ball (25-66%), Polar and overbets (75-150% and jams),
                Geometric
    Big trees:  Detailed, Deep, Max
- "Raised preflop": a preset's c-bet sizes go to the player who raised
  preflop: IP, OOP, or nobody (a limped pot). The sample spots and
  "Solve a flop from here" set it for you.
- Size editor (Edit sizes): tap a box, then tap sizes to add or remove them:
  10% to 200% of the pot, Geo and All-in for bets; 2x, 2.5x, 3x, 3.5x, 4x,
  % of the pot and All-in for raises. You can still type sizes.
- New size types:
    3x     raise to 3 times the bet you face (2x is a min-raise)
    g      geometric: the same fraction of the pot on every street left gets
           the stacks in by the river
    Donk   OOP's lead on the turn or river right after calling a bet, set
           apart from OOP's other bets (empty = no donk bets)
- 3-bets and later: "Same sizes as raises" or "All-in only".
- Auto all-in: a bet that would leave less than 10/20/30/50% of the pot
  behind becomes a shove (or Off).
- Check tree size: shows the memory and decisions before you solve, and
  whether the river fits on your graphics card.
- Your sizes are remembered between sessions.

Faster
- Leaner presets: Fast and Standard now leave out turn and river donk bets
  and make 3-bets all-in, so their trees are about 20-30% smaller with the
  same main sizes (Standard at 100bb: 3.9 GB -> 2.9 GB).
- Fewer wasted iterations: accuracy checks cost about as much as an
  iteration, so EightMax now predicts when the target will be reached and
  checks then, instead of on a timer.
- Faster showdowns on the CPU engine.
- Measured on the BTN vs BB 25bb sample flop, to 0.5% of the pot, CPU only
  (a 2-core test machine, so your times will be shorter):
    Fast       1.5: 35 s   1.6: 24 s
    Standard   1.5: 151 s  1.6: 91 s
  The same tree on its own solves about 5-15% faster than in 1.5.
- Big trees on the GPU: trees stored in 16-bit used to fall back to the CPU.
  Now the GPU solves them too, and a tree that only fits your graphics card
  in 16-bit is stored that way automatically (half the memory).

Lighter on your PC
- While the GPU works, EightMax checks on it every millisecond instead of
  waiting inside the graphics driver, which can keep one CPU core at 100%
  (NVIDIA's OpenCL driver does this).
- Power (Postflop > Edit spot):
    Full speed  every CPU thread at normal priority
    Balanced    every thread, but other programs go first (the default): as
                fast on an idle PC, and the PC stays responsive
    Quiet       half the threads at the lowest priority, and the graphics card
                rests half the time: cooler and quieter, roughly half the speed

THE GPU ENGINE
- How it works: each iteration, the CPU walks the flop and turn, the GPU
  solves every river subgame at once, and the CPU finishes the iteration
  with the river results. Results match the CPU engine.
- Requirements: a graphics card with OpenCL, which the normal NVIDIA, AMD and
  Intel drivers include. An RTX 4060 Ti with an up-to-date NVIDIA driver is
  fine. Nothing else to install.
- GPU self-test: double-click "GPU self-test.bat". It checks the GPU results
  against the CPU engine on a turn spot, in full precision and in 16-bit,
  then times both on a flop spot and prints the speed-up. If it says FAIL,
  solve with "CPU only" and please send me the output.
- Speed depends on the tree: the GPU helps most on big flop trees with wide
  ranges. I couldn't measure it on your card, so the self-test is the place
  to see how much faster it is on your PC.
- Turning it off: in Postflop > Edit spot, choose "CPU only" under Graphics
  card, or start EightMax with the environment variable EIGHTMAX_GPU=off.
- When the CPU is used anyway (the result line says why): river-only spots,
  trees too big for the card even in 16-bit, and solves with locked river
  decisions. If the GPU reports an error during a solve, EightMax finishes
  the solve on the CPU.
- Saving, viewing nodes mid-solve, locks and reports all work the same; the
  results are copied back from the GPU when needed.

WHAT THE WINDOWS VERSION ADDS
- Native multi-core postflop engine: uses every CPU thread and up to about
  three-quarters of your RAM (around 12 GB on a 16 GB PC), plus the GPU.
- Bigger trees: the online presets, plus Deep (four bets per street) and Max
  for 60-100bb. Custom trees can use 2-5 bets per street.
- Suit isomorphism: turn and river cards that are mirror images of each other
  share one solve (two-tone flops about 1.5x faster, monotone about 3.5x).
- Saved solutions: after a solve, click "Save solution". Files go to
  Documents\EightMax\*.em8. Open them later from Postflop > Edit spot >
  Saved solutions. Saved solutions are view-only until you re-solve.
  Solutions saved with 1.5 still open.
- Faster flop reports (Reports tab) running on all cores, with CSV download.

FEATURES (also in the web version)
- Preflop push/fold Nash library for 8-max with a 0.1 bb ante per player
  (3-25bb), plus custom stacks, ICM payouts and bounties.
- Preflop ranges for 15-100bb (approximate), 8-max with a 0.1 bb ante per player. Click through
  the whole tree: opens, flats, big-blind overcalls, squeezes, 3-bets, 4-bets
  and 5-bet jams for every seat, plus small-blind limps with big blind checks
  and isolation raises, at 15, 20, 25, 30, 40, 50, 60, 80 and 100bb, plus
  custom solves (2-8 players, your own sizes, up to 150bb, chip EV or ICM).
- Postflop solver for any board, ranges and bet sizes, with strategy, EV and
  equity for every hand. Tap "+ Your hand" to follow your exact two cards.
- ICM postflop with optional PKO or knockout bounties.
- Turn and river reports, Hands view (made hands and draws), Practice mode,
  node locking, flop reports, push/fold trainer and ICM calculator.

TIPS FOR SPEED AND MEMORY
- Use Check tree size before a big solve. Each extra size on a street
  multiplies the tree; deeper stacks and wider ranges grow it too.
- The quickest wins: leave donk boxes empty, set 3-bets to all-in only, and
  keep turn and river raises to all-in unless you study them.
- If a tree is too big, EightMax tells you instead of running out of memory.
  Very large trees are stored in 16-bit form automatically (about half the
  memory).

REQUIREMENTS
Windows 10 or 11, 64-bit. Uses AVX2 automatically on CPUs that have it
(almost every CPU since 2013) and falls back to SSE on older ones. The GPU
engine needs an OpenCL graphics driver; without one, everything runs on the
CPU as before.

LIMITS
- Push/fold: all-ins are heads-up (players behind a caller fold). Multiway
  all-ins below about 6bb aren't modeled.
- Preflop 15-100bb model: at most three players see a flop (a cold-caller plus
  the big blind), and players who haven't entered fold to 3-bets. Pots that
  see a flop are valued with an equity-realization model, not a postflop
  solve; with ICM they count as a lottery on the pot. It 3-bets in position
  somewhat more and flats somewhat less than full solvers do.
- Bounties: your own bounty is valued at its amount times your share of the
  chips in play (your rough chance to win it back).
- Native postflop: heads-up pots, with the bet sizes you choose (a size you leave
  out isn't in the solution). ICM uses the Malmuth-Harville model with up to
  16 players.
- Sample postflop ranges are approximate starting points. Replace them with
  your own preflop charts for the spots you study.

The source code is in the "source" folder.
