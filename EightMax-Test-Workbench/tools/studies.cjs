'use strict';
/* Study definitions used by the 0.24 full-hand scenarios.
 * PREFLOP8_LINKED: eight seats, equal 25 BB stacks, classic 0.1 BB ante, linked preflop tree (fold / call / raise sizes / all-in),
 * every seat starting from the full "random" range. It is a MODEL of preflop play, trained by sampled external-sampling CFR; convergence is not proven. */
const A = require('../src/study-adapter.js');
const PREFLOP8_LINKED = { board: '', dealt: 8, common: 0, preflop: { mode: 'linked', opens: '2.2,a', maxBets: 3 }, stacks: Array(8).fill(25), ranges: Array(8).fill('random'),
  streets: { flop: { bets: '50', raises: 'a', maxBets: 1 }, turn: { bets: '50', raises: 'a', maxBets: 1 }, river: { bets: '50', raises: 'a', maxBets: 1 } }, privateSeed: 8 };
module.exports = { PREFLOP8_LINKED, EXAMPLES: A.EXAMPLES };

/* Native trainer for on-demand postflop studies: runs the bundled EightMax CPU engine (mwcli) as a child process
 * and loads the resulting state into the prepared game. Asynchronous, so a slow solve never blocks other tables. */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
function nativeTrainer(cli, options = {}) {
  const dir = options.dir || fs.mkdtempSync(path.join(os.tmpdir(), 'em-post-')); let n = 0;
  return async function train(prepared, iterations) {
    const id = process.pid + '-' + (++n) + '-' + Math.random().toString(36).slice(2, 8), spec = path.join(dir, id + '.spec.json'), state = path.join(dir, id + '.state');
    fs.writeFileSync(spec, JSON.stringify(A.nativeJob(prepared, id).spec));
    await new Promise((resolve, reject) => {
      const c = cp.spawn(cli, [spec, String(iterations), String(options.threads || 1), state, String(options.memoryMiB || 256)], { stdio: ['ignore', 'pipe', 'pipe'] });
      let err = ''; c.stderr.on('data', (d) => { err += d; }); c.stdout.on('data', () => {});
      const timer = setTimeout(() => { c.kill('SIGKILL'); reject(new Error('Native training timed out')); }, options.timeoutMs || 120000);
      c.on('exit', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Native training failed (' + code + '): ' + err.slice(0, 300))); });
      c.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    prepared.game.importNative(fs.readFileSync(state)); try { fs.rmSync(spec); fs.rmSync(state); } catch (e) { /* temp cleanup only */ }
  };
}
module.exports.nativeTrainer = nativeTrainer;
