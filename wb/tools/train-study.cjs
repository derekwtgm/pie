'use strict';
/* Train the eight-seat 25 BB preflop push/fold study and return a prepared study.
 * Uses the native EightMax CLI when given (EIGHTMAX_TEST_CLI on Linux, native\mwcli.exe on Windows), otherwise the
 * JavaScript reference engine (slow: ~4,000 updates/s). The trained state is cached by update count. */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
const EM = require('../tests/load-solver.cjs'), A = require('../src/study-adapter.js');

function cliPath() {
  if (process.env.EIGHTMAX_TEST_CLI && fs.existsSync(process.env.EIGHTMAX_TEST_CLI)) return process.env.EIGHTMAX_TEST_CLI;
  const exe = path.join(__dirname, '..', 'native', 'mwcli.exe');
  if (process.platform === 'win32' && fs.existsSync(exe)) return exe;
  return null;
}
function trainStudy(updates, options = {}) {
  const cfg = options.example || 'preflop8', cacheDir = options.cacheDir || path.join(os.tmpdir(), 'eightmax-study-cache');
  const prepared = A.prepare(EM, { config: A.EXAMPLES[cfg], iterations: updates, timeMs: 600000 });
  const cli = options.forceJs ? null : cliPath();
  fs.mkdirSync(cacheDir, { recursive: true });
  const state = path.join(cacheDir, cfg + '-' + updates + (cli ? '-native' : '-js') + '.state');
  let backend;
  if (fs.existsSync(state)) { prepared.game.importNative(fs.readFileSync(state)); backend = cli ? 'native-cli-cpu (cached state)' : 'javascript-reference-cpu (cached state)'; }
  else if (cli) {
    const spec = path.join(cacheDir, cfg + '-' + updates + '.spec.json'), tmp = state + '.tmp' + process.pid;
    fs.writeFileSync(spec, JSON.stringify(A.nativeJob(prepared, 'train').spec));
    const r = cp.spawnSync(cli, [spec, String(updates), String(options.threads || 4), tmp, '512'], { encoding: 'utf8', timeout: 600000 });
    if (r.status !== 0) throw new Error('Native training failed: ' + (r.stderr || r.stdout || r.status));
    fs.renameSync(tmp, state); prepared.game.importNative(fs.readFileSync(state)); backend = 'native-cli-cpu';
  } else { prepared.game.iterate(updates); fs.writeFileSync(state, Buffer.from(prepared.game.exportNative())); backend = 'javascript-reference-cpu'; }
  return { prepared, backend, updates: prepared.game.iterations, statePath: state, EM };
}
module.exports = { trainStudy, cliPath };
