# EightMax 5.12: the delivered archive on a hosted Windows runner

This file is beside the ZIP and not inside it: it reports a run that tested the packaged archive. Nothing in
`EightMax-Windows-5.12.zip` or its identity file was changed by it.

**What ran.** GitHub Actions workflow `eightmax-5.12-windows.yml` on commit `4c74e3e`, run 45701227569, job
139511531628, 25 November 2026. It compares the SHA-256 of the ZIP with the identity file
(`5a1246b0...490c8` in both), extracts the archive into an empty folder and runs the two launchers a user
double-clicks, with `EIGHTMAX_NO_PAUSE=1`. Raw log: `windows-ci/job-139511531628.log.gz`.

**Where.** Microsoft Windows Server 2025 Datacenter 10.0.26100; AMD EPYC 9V74, 4 logical processors; 16 GiB RAM;
Windows PowerShell 5.1.26100.33822; a Hyper-V virtual machine with no NVIDIA GPU ("Physical Windows: False").
**This is not the target PC and says nothing about CUDA.**

| Step | Result |
|---|---|
| `Run 5.12 focused validation.bat` | **exit status 1.** `mwcli.exe --selftest512`: 8 passed, 0 failed, 0 untested. Script (148.3 s): 71 passed, **1 failed**, 0 skipped, 0 untested |
| `Run 5.12 Windows validation.bat` | **exit status 1.** Self-tests 5.7 / 5.7.1 / 5.8 / 5.9 / 5.10 / 5.11 / 5.12: 28 / 24 / 33 / 32 / 21 / 26 / 8, all passed. Script (765.8 s): 264 passed, **1 failed**, 1 skipped, 0 untested |
| The one skipped check | GPU / CUDA validation: no NVIDIA device on the runner |

## The one failed check is a defect of the 5.12 validation script, and you will see it on your PC

`[FAILED] (gate) integrity / SHA256SUMS.txt: every file matches (1949 files)`

Every one of the 1,949 files of the archive has the SHA-256 the manifest lists. The check fails all the same, because
the script also requires **more than 3,000 manifest entries** - a floor inherited from 5.11, whose archive had 5,679
files - and 5.12 moved the evidence of old releases into a second archive. I changed the archive and did not change
the floor. The hosted runs I made before packaging could not catch it: they used a tree without a manifest.

**What it means for you:**

* On your PC both 5.12 launchers will end with **exit status 1** and list exactly this check as failed, although the
  files are intact. Every other check is unaffected.
* To run 5.12 without it: append `-SkipIntegrity` to the launcher (`"Run 5.12 focused validation.bat" -SkipIntegrity`)
  and compare the ZIP's SHA-256 with the identity file by hand (WINDOWS-TESTS-5.12.md, section 1). Or skip 5.12 and
  run 5.13: its launchers repeat every 5.12 check and its script has the floor at 1,000 entries.
* The sentence in WINDOWS-TESTS-5.12.md "Expected: exit status 0" is therefore wrong for 5.12 as delivered.

Repairing it inside 5.12 would mean a new archive and a new hash; it is repaired in 5.13 and stated here.

## What the run did establish

Made for the first time on Windows with the delivered files: all 8 checks of `--selftest512`; the four library
lines identical in the file and in the page EightMax.exe serves; the two six-handed reference states for 1, 2 and 4
threads and all four processing modes equal to the state of the Linux build; and every check of 5.11 and earlier.
