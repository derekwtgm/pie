# rbes equal-time tool on a hosted Windows runner

Run 45815197190, job 139893020669 (windows-latest), commit 3ef90b7: the package was extracted into a folder with a
space in its name and `eqtime513.exe run --quick` ran twice (default jobs, then `--jobs 2` into a second folder).
Both runs ended with exit status 0 and "P1 equal-deals check ... PASSED": the Windows program reproduced the values
recorded from the Linux build bit for bit. This is a trial of the tool on real Windows, not a result, and not the
target PC.
