The interface test (validation/5.9/study_ui59.js: the Study tab in Chromium against the desktop host) was run on the
development machine with the 5.11 Linux host, which is byte-identical to the host the hosted runner built
(validation/5.11/build/SHA256.txt). On the hosted runner the same step stopped with "Cannot find module
'playwright'" before testing anything; run-final511-steps.txt records that as "interface in a browser exit 1".
The four screenshots the test writes are not kept in the archive (space).
