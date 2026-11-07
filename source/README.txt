EightMax 2.8 source

web/       Browser UI, preflop models and shared pot rules. lib_river.js
           implements the multi-street postflop betting tree and alternating
           CFR+. lib_runouts.js handles private blockers, public chance, and
           showdown shares. The worker computes full unilateral best
           responses to the average profile in the selected tree.
web/lib_wide.js samples weighted private deals and community cards, trains a
           strength/draw-grouped average strategy and evaluates it on a separate
           seeded stream. Compact trees use chance-sampled full traversal.
           Large trees use explored external sampling and build states only
           while visiting them. Importance ratios account for every sampled
           opponent in both regret updates and own-reach strategy averaging.
           Storage pools keep regrets and sums in Float64 blocks.
web/lib_quality.js validates added sizes and summarizes seed and size checks.
           worker.js runs these jobs sequentially and keeps the base strategy
           available on cancellation or a candidate failure.
native/    Two-player native C postflop server and OpenCL backend. The main
           native solver code is the same generation as 1.6.
wasm/      C source for the browser's heads-up WebAssembly kernel.
tools/     Bundling, equity and chart generation, optional Windows repack.
tests/     Regression cases, analytic examples, and the independent
           enumeration of three-player pure best responses.

MultiwayGame accepts two to eight live seats. Tournament setups pass dealt
(2-8), common (other shared chips, excluding antes), stacks (chips behind),
prior (each live seat's earlier wagers) and folded (earlier folded wagers).
The solver adds the 0.1 bb ante for each dealt seat once. API callers that
omit dealt continue to provide their entire common pot, including antes.
The fixed tournament ante applies to preflop chart generation and both
custom preflop UIs. Preflop models accept an explicit legacy ante override
for callers replaying older model configurations.


TRAINING CHECKPOINTS AND HAND GROUPS (2.3)
lib_information.js defines observable strength, blocker, draw and texture
features. Detailed grouping keeps the sequence of signals across streets.
Exact cards retains hole-card identity, sorted initial flop cards, and
ordered turn/river cards; it is not an exhaustive chance solve.
MultiwayGame accepts abstraction: 'compact' | 'detailed' | 'exact' (default
'detailed'), and strategyBudgetMiB: 1..256 (default 112). Automatic traversal
selects external sampling for non-compact groups with future streets.
Explicit traversal: 'full' remains available for small reference studies.

lib_checkpoint.js provides async encodeCheckpoint(game.snapshot(labels)),
async decodeCheckpoint(text), and restoreCheckpoint(payload). The latter
returns {game,cfg,labels}; it reconstructs and validates a fresh game before
it is installed. Encoding is JSON with SHA-256 over the serialized payload,
and little-endian base64 Float64 arrays. Format 1 / multiway-2.3 rejects
incompatible engine state. Sparse stores retain path maps and pool indices;
full stores retain each public node's regrets and average sums. Both retain
absolute iteration counts; sampled games also retain deal/action RNG state,
algorithm, memory-stop status and visited-state count. The constructor
copies configuration so caller mutation cannot invalidate saved training.

Worker requests: multi-export {labels}, multi-load {text}, multi-resume
{iterations,memoryMiB?,target?}. Resume adds iterations, with per-call limits
of 100000 sampled or 5000 enumerated and a cumulative limit of 1e9.
A failed load leaves the active strategy in place. The checksum detects
accidental changes; it is not authentication. Save/load transient memory
can exceed the strategy budget. File size is capped at 512 MiB.
Training state is retained after a memory stop, including partial-iteration
updates. A larger budget permits continuation; stopped vs restored runs
match, while uninterrupted high-budget runs may differ.

WINDOWS AUTOMATION
From the release root, run Run self-tests.bat. It uses built-in Windows
PowerShell and produces Windows-self-test.json. No Python or Node install
is needed for that native launch/CPU test. GPU tests remain separate.
source/tools/test_windows.ps1 accepts -Exe and -Report paths.

For developer validation, place the CONTENTS of this release directory at
the root of a GitHub repository. The included Windows workflow runs Node
regressions and bundled app/worker integration, repacks and tests the
provided host, compiles an independent MinGW-w64 host, and tests that host.
No workflow was run remotely while preparing this release. The fixture
checks exercise real application/worker code but do not render a browser.

From the release root (Node 24):
  node --test source/tests/*.test.js
  node source/tools/package_smoke.js .
  node source/tools/mtt_ui_smoke.js .
  node source/tools/checkpoint_ui_smoke.js .

The bundler losslessly dictionary-packs deep preflop data and verifies each
entry against the original. The decoded chart contents are unchanged.

NEW TOURNAMENT AND PREFLOP API
MultiwayGame accepts icm: {payouts, others, startStacks?}. Payouts must be
nonnegative, descending, and have at least one positive entry. Include all
remaining players; at most 16 total. Other stacks are fixed chips behind.
The optional active hand-start stacks determine simultaneous bust order;
otherwise they are derived from current stacks, prior wagers and antes.
Every joint terminal chip outcome is converted to ICM before averaging.
This preserves dependencies between main and side pots. Metrics and views
include utility, unit, reportThreshold and, for ICM, prizePool/icmPlayers.
ICM EV is absolute prize equity, never a chip delta relabeled as money.

For a new preflop study pass privateMode:'sampled', board:'', dealt, common:0,
zero prior/folded wagers, and preflop:{mode:'linked'|'shove', opens:'2',
raises:'3x,a', maxBets:3, limps:true}. Here stacks are BEFORE forced posts.
The last two seats are SB and BB; heads-up SB acts first preflop and BB first
postflop. Linked mode supports 2-6 live seats; shove mode supports 2-8.
Seats outside this conditional study contribute only their 0.1 bb antes.
They are assumed folded before the first decision. All active folded cards
continue to block later deals. Range text random or any includes all hands.

Linked preflop uses the same external-sampling updates across all four
streets. Preflop information is the player's starting hand class (exact
combo for a narrow range); later groups retain previous street signals.
It does not replace terminal values with the legacy realization heuristic.
The flop chance step in view(path) accepts {cards:[c1,c2,c3]}; later streets
accept {card:c}. The first postflop actor is the first live seat from the SB.
Shove mode permits fold, call/overcall and all-in actions, then assumes a
checkdown if several players still have chips. An under-blind all-in call
remains available, and unmatched blind excess is returned at settlement.

The existing DeepTree/PushFold chart models and chart data are unchanged.
They are separate from these new conditional, sampled multiway studies.

WIDE MODE CONTROLS AND DIAGNOSTICS
traversal accepts auto (default), full, or external. Automatic mode samples
betting for preflop and fine-grouped future-street studies. Other sampled
studies use full traversal up to 2,200 states, then visit branches on demand.
strategyBudgetMiB defaults to 112 and supports 1-256 in the API and UI.
Budget exhaustion returns limitReached and the current average strategy.
Memory figures estimate strategy storage and exclude engine/JS overhead.
evaluationSeed controls a stream independent of training. Large-tree EV
evaluation samples later actions as well as legal private and public cards.

multi-check accepts runs (1-5), responseIterations (100-20000), and extra
street entries containing bets and raises. An added raise permits at least
two bets. Original and expanded runs use matched training seeds and a common
evaluation seed. Aggregate EV changes average matched pairs. Public-card
sampling also varies its seed when using enumerated private deals.
Fixed exact enumeration uses one run. Candidate failures are listed individually.

The response probe uses the same observable hand groups as the original
profile, trains against frozen average opponents, and evaluates paired
payoff differences on separate deals. Its signed gain and sampling standard
error describe one tested policy. It is an approximate deviation search.
Small or negative measured gains provide no upper bound on exploitability.
Checks never change the original profile or its training random streams.

Algorithm background
https://www.holdemresources.net/icmcalculator
https://www.pokerstars.com/help/articles/rules-table-master/218841/
https://papers.nips.cc/paper_files/paper/2009/hash/00411460f7c92d2124a67ea0f4cb5f85-Abstract.html
https://github.com/google-deepmind/open_spiel/blob/master/open_spiel/python/algorithms/external_sampling_mccfr.py

RUN CHECKS AND REBUILD
From inside source, with Node 18 or newer:
  node --test tests/*.test.js
  node tools/build.js

This writes build/EightMax-Offline.html and build/native.html. Built charts,
heads-up equity data and both compiled WebAssembly kernels are included in web.
Ordinary packaging does not require rebuilding these data files.

For a full native build, install Python 3 and a C compiler and use a POSIX
shell. On Windows use an x86-64 MinGW-w64 toolchain with winpthreads
(e.g. the original llvm-mingw toolchain), and set CC if it is not on PATH.
  sh native/build.sh linux
  sh native/build.sh windows
The corresponding output is in build/linux or build/windows.

The Windows release reuses the verified native desktop host and changes its
read-only UI and version resources. The resource packager accepts a matching
1.6 through 2.3 executable, including the host in this package:
  python tools/package_windows.py ../EightMax.exe build/native.html build/EightMax.exe
The script verifies all bytes outside the two data resources.
The full native build above is independent of the old executable.

OPTIONAL REGENERATION
  node tools/gen_deep.js solve 15,20,25,30,40,50,60,80,100
  node tools/gen_deep.js merge
  node tools/gen_charts.js
The deep generator stores intermediate JSON under build/charts (override with
EIGHTMAX_CHART_DIR). Its post-serialization metric measures local action
improvements in the preflop model. Packaged charts were trained with a
0.001 bb/hand local target and a maximum of 2,500 iterations before rounding.
To regenerate heads-up equities, compile and run tools/pfeq.c, then pass the
resulting pfeq.bin path to node tools/gen_eqdata.js. To regenerate browser
kernels, run sh tools/build_wasm.sh with a wasm32-capable clang and wasm-ld.
