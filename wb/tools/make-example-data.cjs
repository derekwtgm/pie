'use strict';
/* Regenerates the example data under examples/multitable (deterministic). */
const fs = require('node:fs'), path = require('node:path'), EM = require('../src/engine.js'), HS = require('../src/hand-state.js');
const out = path.join(__dirname, '..', 'examples', 'multitable'); fs.mkdirSync(out, { recursive: true });
const t = new EM.Table(1, 2024), frames = []; let seq = 0, hands = 0; t.startHand();
while (frames.length < 40) { if (t.status === 'complete') { hands++; t.startHand(); } frames.push(HS.observeSimulator(t, seq++, { actions: undefined })); const a = EM.policy(t); t.execute(t.request(a.type, a.amount, 0), 0); }
frames[17] = { ...frames[17], pot: frames[17].pot + 50 }; // one deliberately inconsistent frame: replay must reject it and pause
fs.writeFileSync(path.join(out, 'observation-replay-demo.json'), JSON.stringify({ format: 'eightmax-observation-replay', version: 1, note: 'Structured feed from the offline simulator (seed 2024). Frame 17 has a wrong pot on purpose.', frames }, null, 1));
fs.writeFileSync(path.join(out, 'qa-authorization-TEMPLATE.json'), JSON.stringify({ format: 'eightmax-qa-authorization', version: 1, environment: 'EDIT-ME-local-qa-sandbox', approvedBy: 'EDIT-ME approver name', testEnvironmentOnly: false, noRealMoney: false, operatorOwnsTestClient: false, endpoint: 'http://127.0.0.1:0/actions', expiresAt: 0, comment: 'Template only. It is intentionally invalid: set the three booleans to true only for a test client you own and are authorized to drive, point endpoint at it, and set a near-future expiry (max 8 h).' }, null, 2));
fs.writeFileSync(path.join(out, 'README.txt'), 'observation-replay-demo.json  recorded structured-feed frames (offline simulator); use replayObservations() from src/vision-ocr.js.\nqa-authorization-TEMPLATE.json  intentionally invalid template for Authorized QA mode.\nTrain a study: node tools/train-study.cjs is a module; see tools/multitable-benchmark.cjs for usage (EIGHTMAX_TEST_CLI=path-to-mwcli trains natively).\nBenchmarks: docs/0.23-benchmark-linux-simulated.json; acceptance: docs/0.23-acceptance-linux-simulated.json.\n');
console.log('examples written');
