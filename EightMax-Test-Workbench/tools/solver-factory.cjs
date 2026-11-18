'use strict';
/* Decision-source factory loaded inside solver worker threads. kinds:
 *   preflop-linked  - trained linked preflop study (cached native state) + on-demand postflop studies
 *   postflop-only   - on-demand postflop studies only
 *   burn            - test source that busy-loops (to prove isolation); never used outside tests/benchmarks */
const path = require('node:path');
exports.createSource = async function createSource(o) {
  const root = path.join(__dirname, '..');
  if (o.kind === 'burn') return { decide: (req) => { const end = Date.now() + (req.burnMs || o.burnMs || 50); let x = 0; while (Date.now() < end) x += Math.sqrt(x + 1); return { status: 'unavailable', reason: 'burn source', format: 'eightmax-decision', version: 1, stateKey: req.stateKey }; } };
  const A = require(path.join(root, 'src/study-adapter.js')), ST = require(path.join(root, 'src/solver-tree.js')), T = require(path.join(root, 'tools/studies.cjs')), EM = require(path.join(root, 'tests/load-solver.cjs'));
  const sources = [];
  if (o.kind === 'preflop-linked') {
    if (o.cli) process.env.EIGHTMAX_TEST_CLI = o.cli;
    const { trainStudy } = require(path.join(root, 'tools/train-study.cjs'));
    const s = trainStudy(o.updates || 100000, { config: T.PREFLOP8_LINKED, name: 'preflop8-linked', cacheDir: o.cacheDir, threads: 2, budgetMiB: 256 });
    sources.push(new ST.PreflopTreeSource(s.EM, s.prepared, { studyId: 'preflop8-linked-' + s.updates, backend: s.backend }));
  }
  sources.push(new ST.PostflopStudySource({ EM, adapter: A, iterations: o.postIterations || 3000, trainer: o.cli ? T.nativeTrainer(o.cli, { threads: 1 }) : undefined, backend: o.cli ? 'native-cli-cpu' : 'javascript-reference-cpu' }));
  return new ST.CompositeDecisionSource(sources);
};
