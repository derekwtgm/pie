'use strict';
// Test factory: a decision source whose worker process dies when asked to (request flag `crash`).
exports.createSource = async () => ({ decide: (req) => { if (req.crash) process.exit(3); return { status: 'ok', format: 'eightmax-decision', version: 1, stateKey: req.stateKey, labels: ['x'], probabilities: [1] }; } });
