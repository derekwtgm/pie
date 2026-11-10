EightMax 3.8 - 8-max MTT solver for Windows
============================================

NEW IN 3.8: STRATEGY EXPLORER FOR NATIVE STUDIES
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
