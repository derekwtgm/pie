EightMax 5.11: the hosted jobs that built and validated this release.

The development machine of 5.11 has no Windows cross-compiler, no Wine and no PowerShell and may not install
packages. These GitHub Actions workflows did that part, on a scratch branch of the repository
(claude/eightmax-5.11-crossbuild); they are kept here as the record of how the evidence in validation/5.11 was made.

  build-and-validate.yml   build (Ubuntu 24.04, g++-mingw-w64-x86-64-posix 13: the toolchain of BUILD-5.10.md; the
                           tree is built twice and the seven artifacts compared), linux-suite (regression suite),
                           linux-chain (run_final511.sh), sanitize (sanitize511.sh), pwsh (powershell511.sh),
                           wine (wine511.sh), windows (both launchers on windows-latest, Windows PowerShell 5.1)
  package.yml              rebuilds the programs, checks them against the fingerprints of the validated build and
                           runs release511.py --wine
  tree.sh                  the tree under test: the delivered 5.10 archive with the changed and added files laid
                           over it (mkdelta.py computes that set from the working tree)
  publish.sh               each job commits its evidence to a results branch, from which it was copied here

The first run of the build job (run 45618606007) built the UNMODIFIED 5.10 source from the delivered 5.10 archive:
the three Windows executables came out byte-identical to the shipped ones (validation/5.11/baseline).
The evidence of this release is from run 45650359107 (build af452eaa0ea731be).
