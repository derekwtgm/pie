'use strict';
// Shared trained study for integration tests. Native training (EIGHTMAX_TEST_CLI) gives full hand coverage; without it a
// short JavaScript run is used and tests that need complete coverage are skipped explicitly rather than weakened.
const { trainStudy, cliPath } = require('../tools/train-study.cjs');
const SS = require('../src/solver-service.js');
let cached = null;
function study() {
  if (cached) return cached;
  const full = !!cliPath(), t = trainStudy(full ? 500000 : 20000);
  cached = { ...t, full, src: new SS.StudyDecisionSource(t.EM, t.prepared, { studyId: 'preflop8-' + t.updates + '-' + t.backend }) };
  return cached;
}
module.exports = { study, full: () => !!cliPath() };
