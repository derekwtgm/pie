EightMax Windows 4.5 source

Read ../RELEASE-4.5.md and ../validation/4.5/README.md for 4.5. 4.5 additions and changes:
  native/coverage.hpp        emcov::Budget (strict live-byte ledger: reserve before allocate, overflow-
                             checked); SharedCoverage planned generations (planFor), retired generations
                             and abandoned replacements accounted / released, status codes, fault
                             injection hook (failAllocations); WorkerFilter inside the budget;
                             Coverage (per-seat tables): sketches drawn from the pool
  native/action_ev.hpp       EvShared::shareCoverage(workers) builds the ledger; coverage.memory JSON;
                             merged-table path shares the worker pool
  native/ev_jobs.h           jobs charged memoryMiB + coverageMiB; coverageMiB validated at submission
  native/ieee_probe.hpp      mw_ieee_sweep (deterministic print/parse sweep with digest)
  native/mw.cpp              em_parse_double (std::from_chars) installed as the JSON number parser;
                             experimental chanceSampling "latin" (dealLatin) and opponentExploration
  native/json.c, json.h      json_number_parser hook (default strtod; the engine replaces it)
  native/icm.hpp             two-lane SSE2 kernel for five or more live players (bit-identical)
  native/mwcli.cpp           --ieee-sweep [count] [seed]
  web/lib_wide.js            passes the experimental options to the native specification; the
                             JavaScript trainer refuses them
  tests/v45.test.js tests/coverage45.cpp tests/icm45.cpp
  tests/fixtures/coverage44_reference.hpp, icm44_reference.hpp   archived 4.4 code (regression references)
  tools/bench45.js tools/icm_bench45.cpp tools/stability45.js tools/wine45.js tools/sanitize45.sh
  tools/test_windows.ps1 (section v45; [math]::Abs fix)  tools/validate_hardware.ps1 (section 11)

EightMax Windows 4.4 source

Read ../RELEASE-4.4.md, ../validation/4.4/README.md and ../validation/4.4/NUMERIC-POLICY.md.
4.4 additions and changes:
  native/ieee_probe.hpp      jbits()/jbitsArr() (IEEE 754 patterns as hex strings), probe table,
                             mw_ieee_probe / mw_ieee_verify, ulpDistance()
  native/coverage.hpp        SharedCoverage (request-wide exact set in growing tiers: lock-free lookups,
                             inserts under a shared lock, promotion under an exclusive lock, key limit,
                             lock-free sketches back-filled when the limit is reached) and WorkerFilter; Coverage::countOnly. The 4.2/4.3
                             Coverage class is unchanged (EM_EV_MERGED_COVERAGE=1 selects it)
  native/action_ev.hpp       Evaluator key memo: growable direct-mapped cache (was std::unordered_map);
                             evBits / gainBits; EvShared::covSet; EvalPool::CovSummary (no merge after
                             the workers stop); deadline.phasesMs; partialResult; Automatic arms in
                             Evaluator::build(); execution.auto44
  native/ev_control.hpp      stopNs and phase marks
  native/showdown_table.hpp  ArmStats44 / AutoArms44 (measured whole-table time per arm)
  native/mwcli.cpp           --ieee, --ieee-verify, valueBits and auto44 in --session results
  native/server.c            GET /api/mw/ieee-probe
  tests/v44.test.js tests/v44_postflop.test.js tests/coverage44.cpp tests/auto44.cpp
  tools/bench44.js tools/convergence44.js tools/merge_convergence44.js tools/deadline44.js
  tools/ps_number_model.py   arithmetic model of the PowerShell 5.1 Decimal -> Double cast
  tools/test_windows.ps1     bit-pattern comparisons, continue-after-failure, v44 section
  tools/validate_hardware.ps1 bit-pattern comparisons, section 10 (Automatic on a warm device)
Environment switches added in 4.4: EM_EV_MERGED_COVERAGE=1 (4.3 coverage merge),
EM_GPU_AUTO_MODEL=4.3 (4.3 Automatic rule). EM_GPU_INIT_ESTIMATE_S now defaults to 0.1.
Toolchains for 4.4: Ubuntu 24.04, Node 22, GCC 13.3, MinGW-w64 GCC 13 (posix), Python 3.13, Wine 9.0 (tests only).
No CUDA toolkit is needed: the embedded kernels (score.cu / score_ptx.hpp) are unchanged from 4.1.
  node tools/build.js && sh native/build.sh linux && CC=x86_64-w64-mingw32-gcc-posix sh native/build.sh windows
  EM_TEST_HOST=build/linux/eightmax EM_TEST_MWCLI=build/linux/mwcli node tools/run_tests.js report.json

EightMax Windows 4.3 source

Read ../RELEASE-4.3.md and ../validation/4.3/README.md for 4.3. 4.3 additions and changes:
  native/showdown_table.hpp  ShowTable shared by every worker and every response-gain seat of a request
                             (TableCache), cooperative chunked construction (16,384 boards a chunk),
                             fullPattern() (branch-free dense rank code), FlatHist (open-addressing
                             histogram), EvGpu lifecycle (openAsync background start-up, idle buffer
                             janitor, use counters), autoChoice43() Automatic cost model
  native/action_ev.hpp       build(): device decision, helper threads within the request's thread
                             budget, device pull of chunk batches (verification and first batch
                             reserved before helpers start), fused score+pattern chunks, CPU pattern
                             counting of device-scored chunks; coverageMiB; tables43 / lifecycle JSON;
                             mw_gpu_prewarm, mw_gpu_status, mw_ev_cache_clear
  native/coverage.hpp        16-byte slots, configurable key limit, shared byte pool, HyperLogLog
                             estimates (reported only once exact counting stopped, labelled approximate)
  native/ev_control.hpp      Poller::waitCheck (deadline/cancel check while waiting, not counted as work)
  native/mwcli.cpp           --session spec state plan.json (cold/warm, repeated, concurrent, idle,
                             cancelled and budget-refused requests in ONE process)
  native/server.c            EM_GPU_PREWARM=1, GET /api/mw/gpu-status
  tests/v43.test.js tests/table43.cpp tests/coverage43.cpp
  tools/bench43.js tools/convergence43.js tools/sessions43/*.json
  tools/validate_hardware.ps1 (section 9: cold vs warm CUDA), tools/test_windows.ps1 (4.3 checks)
Environment switches for A/B comparisons: EM_EV_PRIVATE_TABLES=1 (4.2 per-worker tables),
EM_EV_DIRECT_PATTERNS=1 (4.1 per-board subset patterns), EM_EV_NO_TABLES=1 (3.9 per-board
enumeration), EM_GPU_BATCH_CHUNKS (1-64, default 8), EM_GPU_IDLE_RELEASE_S (default 60, 0 = never),
EM_GPU_INIT_ESTIMATE_S (Automatic warm-up, default 0.3 s), EM_GPU_PREWARM=1 (desktop host).
Toolchains for 4.3: Ubuntu 24.04, Node 22, GCC 13, MinGW-w64 GCC 13 (posix), Python 3.13, Wine 9.0 (tests only).
No CUDA toolkit is needed: the embedded kernels (score.cu / score_ptx.hpp) are unchanged from 4.1/4.2.
  node tools/build.js && sh native/build.sh linux && CC=x86_64-w64-mingw32-gcc-posix sh native/build.sh windows
  EM_TEST_HOST=build/linux/eightmax EM_TEST_MWCLI=build/linux/mwcli node tools/run_tests.js report.json

EightMax Windows 4.2 source

Read ../RELEASE-4.2.md and ../validation/4.2/README.md for 4.2. 4.2 additions and changes:
  native/coverage.hpp        strategy-coverage accounting (unmodified 128-bit keys, merge = set union)
  native/cuda_score.hpp      primary CUDA context + RAII push/pop guard per call, structured CUDA errors,
                             process-wide device-memory ledger, budget refusal before any driver call
  native/showdown_table.hpp  EvGpu (atomic state, bounded waits), failure classes, Automatic rule autoChoice()
  native/action_ev.hpp       verification under the device lock, per-phase profile, observed device,
                             gpuBudgetBytes / gpuWaitMs fields, rank patterns by projection
                             (EM_EV_DIRECT_PATTERNS=1 selects the 4.1 per-board method), EM_COVERAGE_AUDIT=1
  native/mw.cpp              mwcli --equity: gpuBudgetBytes, gpuRequestedBytes, structured gpuError
  tests/coverage42.cpp tests/cuda42.cpp tests/v42.test.js tests/cuda_driver_fixture.cpp (now enforces
                             per-thread current contexts and tracks every device allocation)
  tools/gpu_stress42.cpp     in-process CUDA stress (built as build/*/gpustress[.exe])
  tools/bench42.js tools/convergence42.js
Toolchains for 4.2: Ubuntu 24.04, Node 22, GCC 13, MinGW-w64 GCC 13 (posix), Python 3.13, Wine 9.0 (tests only).
No CUDA toolkit is needed: the embedded kernels (score.cu / score_ptx.hpp) are unchanged from 4.1.
  node tools/build.js && sh native/build.sh linux && sh native/build.sh windows
  EM_TEST_HOST=build/linux/eightmax EM_TEST_MWCLI=build/linux/mwcli node tools/run_tests.js report.json

EightMax Windows 3.9 source

Read ../RELEASE-3.9.md and ../validation/3.9/README.md for 3.9. 3.9 additions: native/action_ev.hpp
(mw_action_ev, mw_response_gain; POST /api/mw/ev, /api/mw/response-gain; mwcli --ev / --gain), strict
request validation in native/explorer.hpp, EV display in web/lib_explorer.js, tests/v39.test.js,
tools/scenarios39.js, tools/convergence39.js.
Read ../RELEASE-3.8.md and ../validation/3.8/README.md for what changed, measurements and reproduction.
3.8 additions: native/explorer.hpp (mw_node_query, POST /api/mw/node), web/lib_explorer.js (explorer UI),
restore estimate (mw_es.hpp restoreEstimate, checkpoint_native.hpp), engine caches (icm.hpp, mw_es.hpp,
mw_es_impl.hpp), mwcli --node / --restore, tools/test_explorer_host.js, tests/v38.test.js.
Toolchains for 3.8: Ubuntu 24.04, Node 22, GCC 13, MinGW-w64 GCC 13 (posix), Python 3.12, Wine 9.0 (tests only).
Earlier: ../RELEASE-3.7.md for checkpoint storage and restoration.

HISTORICAL 3.1 BUILD, TEST AND BENCHMARK
Toolchains used for this release (Ubuntu 24.04): Node 22, GCC 13, MinGW-w64 GCC 13
(winpthreads, the -posix variant; std::thread is required), Python 3, cppcheck 2.13.
  node tools/build.js                       # interface + build-info.json
  sh native/build.sh linux                  # build/linux/eightmax, mwcli
  sh native/build.sh windows                # build/windows/EightMax.exe, mwcli.exe
  node tools/run_tests.js report.json       # all suites, per-file limit, counts
                                            # pass / fail / skip / timeout separately
  sh tools/sanitize29.sh .                  # -Werror, TSan, ASan+UBSan, cppcheck
  EM_TEST_MWCLI=/path/to/sanitizer/mwcli node --test tests/v31.test.js
  sh tools/release.sh                       # full release gate and ZIP
Benchmarks (build a 3.0 mwcli and tools/timed_training.cpp against each mw.cpp):
  node tools/bench31.js mwcli30 mwcli31 timed30 timed31 bench31.json
  node tools/large31.js timed31 large31.json
CUDA module (needs NVRTC 12.9 and ptxas, e.g. the nvidia-cuda-nvrtc-cu12 and
nvidia-cuda-nvcc-cu12 wheels; no GPU needed to build):
  python3 native/gen_ptx.py <libnvrtc.so.12> <ptxas>
The tests compile the native CLI and the CUDA driver test double once per source
fingerprint into the OS temp directory (tests/native_build.js).
New engine files: native/mw_es.hpp (betting rules, state table, workers) and
native/mw_es_impl.hpp (external-sampling traversal, merge, EMMW4). Protocol and
state formats: native/MW-PROTOCOL.md.


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
