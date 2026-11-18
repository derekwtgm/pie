# Screen capture (0.24)

Two halves: a platform-independent pipeline (`src/screen-capture.js`, tested here on Linux) and a Windows capture service
(`desktop/CaptureService.cs`, compiled here with Mono, **never executed on Windows**).

## What is captured, and only after what
* One operator-selected **window client area** or one operator-selected **desktop region**. Nothing is captured until the operator
  presses *Start capture* in the dashboard, ticks the consent box for that window, and the desktop host receives `consent: true`.
* The host refuses captures without the session token, without consent, for its own windows, and records every `open` in
  `/api/capture/audit` (in memory).
* No process-memory access, injection, hooks, input synthesis, display-affinity tricks or concealment. `tests/windows-release.test.cjs`
  fails the build if the sources use `ReadProcessMemory`, `WriteProcessMemory`, `SetWindowsHookEx`, `SendInput`, `OpenProcess`, `LoadLibrary`, … .
* **External poker clients:** observation of an external client's window is possible technically but nothing here operates it. Automated
  execution exists only for the offline controlled client and for an explicitly authorized QA interface (docs/QA-INTERFACE.md). Using any
  capture or automation against a poker site requires that operator's written permission; play-money does not imply permission.

## Windows methods (documented Win32 only)
| Method | Used when | Notes |
| --- | --- | --- |
| `PrintWindow(PW_CLIENTONLY \| PW_RENDERFULLCONTENT)` | default for windows | the window paints itself, so covered windows still capture; some GPU-composited surfaces return flat black — detected and reported as `invalid-frame` |
| `BitBlt(SRCCOPY \| CAPTUREBLT)` from the screen DC | regions; windows when PrintWindow fails and nothing covers them | copies what is on screen: if any window covers the target the frame is refused (`target-occluded`) |
| `DwmGetWindowAttribute(DWMWA_CLOAKED)` | every window capture | cloaked (other virtual desktop / hidden) windows are reported, never captured |

**Windows Graphics Capture is NOT implemented.** It needs WinRT projections the compile-on-first-launch toolchain (.NET Framework C# 5) does not
provide. The host's health reply says `windowsGraphicsCapture:false`. It is the natural next step for games that render with DirectX surfaces.

## What the pipeline guarantees (`CaptureSession`)
* **Identity:** window handle + process id + title prefix must still match what the operator selected (handle reuse is detected: `target-identity-changed`).
* **Sequencing:** `seq` increases by one per attempt; `tMs` is a monotonic clock; a clock that goes backwards is `timestamp-regressed`.
* **No silent reuse:** a failed capture returns a frame record with `valid:false` and **no image**; `latest()` returns `null` after any failure and after
  `maxFrameAgeMs`.
* **Staleness:** a source frame older than `maxFrameAgeMs`, or one the host reports as old (`ageMs`), is `stale-frame`.
* **Resizing / DPI:** a size change restarts a settling period (`settleFrames`); frames are withheld (`resolution-settling`) until the size holds. The layout geometry is
  resolution independent (normalised regions) but the glyph/card TEMPLATES are not: they must be calibrated at the capture scale (`calibrateFromLabeled`). Calibrated at 125/150/200 % bilinear scaling the synthetic
  client reads with 0 false acceptances; templates from another scale are refused wholesale (docs/0.24-recognition-synthetic.json), never misread.
* **Lost / minimised / covered:** `target-lost`, `target-minimized`, `target-occluded` (screen-copy refuses any cover; every method refuses >50 %).
* **Interruption and recovery:** `failuresBeforeInterrupted` consecutive failures → `interrupted` (retry with exponential back-off) → `recovering`
  → `live` after `recoveryGoodFrames` good frames. A hung capture call times out (`grabTimeoutMs`).
* **Frequency:** `intervalMs` (dashboard: 250 ms – 2 s). Effective fps is measured and shown.
* **Monitors:** `resolveRegion()` validates a region against the real monitor layout (negative coordinates, mixed DPI warnings, off-screen refusal).
* **Recording (debugging, off by default):** `FrameRecorder` writes bounded PNG sequences with an index (`maxFrames`, `maxBytes`, `every`).

## Verification status
| Item | Status |
| --- | --- |
| Pipeline logic (sequencing, staleness, resize, recovery, recording, geometry) | tested on Linux with a simulated window and a mock host speaking the same JSON as the C# service (`tests/screen-capture.test.cjs`) |
| `CaptureService.cs`, `EightMaxCapture.cs`, `DesktopHost.cs` | compile with Mono `mcs -platform:x64` (`tests/windows-release.test.cjs`); prebuilt `desktop/bin/*.exe` are x64 PE32+ |
| Real Windows capture, PrintWindow behaviour on real applications, DPI behaviour, multi-monitor | **not run**. `RUN-CAPTURE-CHECK.cmd` (see WINDOWS-ACCEPTANCE.md step 11) does it on the target PC |

## 0.25 additions
* `src/capture-manager.js` adds a backend **catalogue** with the strongest verification actually achieved (`tested-linux`, `windows-unrun`, `not-implemented`), profile-driven **selection with fallback** (a backend that cannot be built or opened is skipped and the reason recorded), **run-time switching** (queue flushed, switch logged; a refused switch keeps the working backend), a **bounded frame queue** (oldest dropped and counted; a failure flushes older frames so nothing from before an interruption is offered), a **health roll-up**, **window-identity validation** (handle, process, class, title pattern) and the **ObservationGate**.
* Backends: structured feed (non-optical), screenshot files, recorded frame sequences (PNG/BMP; convert video with an external tool first — no video decoder is bundled), simulated window, host window/region, PrintWindow, BitBlt. **Windows Graphics Capture: not implemented** (needs WinRT/Direct3D interop that could not be compiled or run here); planned for 0.26.
* Everything above except the Win32 calls is exercised by `tests/capture-manager.test.cjs` and `tests/screen-capture.test.cjs` with simulated windows. The Win32 calls themselves remain unrun.
