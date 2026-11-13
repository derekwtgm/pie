'use strict';
// EightMax 4.9 regression tests.
//   Priority 1  - EMZ1 restoration through a secure anonymous temporary file (native/temp_file.hpp)
//                 instead of std::tmpfile(): --selftest49 (levels, missing/Unicode/long temp
//                 directories, injected failure, corrupted/truncated/checksum-mismatched files,
//                 concurrent restorations, 500+500, 1000+1000, generations, no leftovers), the size
//                 limit, a read-only output folder, compressed = uncompressed canonical state.
//   Priority 2  - the native sources compile with Clang and GCC (C++20, -Wall -Wextra, no errors).
//   Priority 6  - the adaptive small-table cache keeps exact results bit-identical and lowers memory.
//   Priority 7  - Automatic does not open CUDA for small training jobs (Linux CUDA test double),
//                 GPU Preferred/Hybrid keep their behaviour, every mode writes the same strategy bytes.
//   Priority 3/12 - the dashboard draws its ten charts from real analytics rows.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto');
const E = require('../tools/loadlib');
for (const l of ['lib_runouts', 'lib_wide', 'lib_river', 'lib_dashboard']) require('../web/' + l);
const G = require('../tools/games48');
const build = require('./native_build');
const tool = () => process.env.EM_TEST_MWCLI || build.cli().cli;
const skip = !tool() && (build.cli().why || 'no native CLI');
const native = path.join(__dirname, '..', 'native');
const has = c => { try { cp.execFileSync(c, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } };
const fx49 = path.join(__dirname, '..', '..', 'validation', '4.9', 'fixtures'), spec45 = path.join(fx49, 'icm-final8.spec.json');
const GOLDEN_300 = 'aa80974199182afa91d5a47166d32af0eb00ecff3ba334593eb5a359cc2e22b8';
const tmp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'em49 ')); t.after(() => { try { fs.chmodSync(d, 0o755); for (const f of fs.readdirSync(d)) { try { fs.chmodSync(path.join(d, f), 0o755); } catch {} } } catch {} fs.rmSync(d, { recursive: true, force: true }); }); return d; };
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const cli = (args, env = {}) => cp.spawnSync(tool(), args.map(String), { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 900000, maxBuffer: 1 << 28 });
const json = r => { assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };
const writeJson = (dir, name, o) => { const f = path.join(dir, name); fs.writeFileSync(f, JSON.stringify(o)); return f; };

test('4.9 --selftest49: compressed-checkpoint restoration in every temporary-directory situation (15 checks)', { skip, timeout: 900000 }, t => {
  const dir = tmp(t), r = cli(['--selftest49', fx49, path.join(dir, 'st')]);
  const rep = JSON.parse(fs.readFileSync(path.join(dir, 'st', 'selftest49.json'), 'utf8'));
  assert.equal(r.status, 0, rep.checks.filter(c => !c.passed).map(c => c.name + ': ' + c.detail).join('\n'));
  assert.equal(rep.failed, 0); assert.ok(rep.passed >= 15, 'checks ' + rep.passed);
});
test('4.9 EMZ1 restoration falls back to the checkpoint folder when TMPDIR is unusable, refuses cleanly when no temporary file can be created, and enforces the size limit', { skip, timeout: 600000 }, t => {
  const dir = tmp(t), a = path.join(dir, 'a.state'), z = path.join(dir, 'a.emz');
  json(cli([spec45, 150, 4, a, 512])); assert.equal(cli(['--compress', a, z]).status, 0);
  json(cli([spec45, 150, 4, path.join(dir, 'b.state'), 512, z], { TMPDIR: path.join(dir, 'missing') }));
  assert.equal(sha(path.join(dir, 'b.state')), GOLDEN_300);
  const f = cli([spec45, 150, 4, path.join(dir, 'c.state'), 512, z], { EM_TEST_TEMP_FAIL: '1' });
  assert.equal(f.status, 3); assert.match(f.stderr, /cannot create a temporary file for decompression \(tried: .*fault injection/); assert.ok(!fs.existsSync(path.join(dir, 'c.state')));
  const l = cli([spec45, 150, 4, path.join(dir, 'd.state'), 512, z], { EM_EMZ_MAX_MIB: '0.25' });
  assert.equal(l.status, 3); assert.match(l.stderr, /exceeds the restoration limit/); assert.ok(!fs.existsSync(path.join(dir, 'd.state')));
  assert.equal(fs.readdirSync(dir).filter(n => n.startsWith('EightMax-emz-')).length, 0, 'no temporary file left in the checkpoint folder');
});
test('4.9 compressed and uncompressed restoration give the same canonical state for every inspection command (--state-info, --verify)', { skip, timeout: 600000 }, t => {
  const dir = tmp(t), spec = writeJson(dir, 's.json', G.spec('river3-chip', 3)), a = path.join(dir, 'a.state'), z = path.join(dir, 'a.emz');
  json(cli([spec, 2000, 2, a, 256])); assert.equal(cli(['--compress', a, z, 9]).status, 0);
  const va = json(cli(['--verify', spec, a, 'method=exact'])), vz = json(cli(['--verify', spec, z, 'method=exact']));
  assert.equal(va.checkpoint.strategyHash, vz.checkpoint.strategyHash); assert.deepEqual(va.seats.map(s => s.gain), vz.seats.map(s => s.gain));
});
test('4.9 a checkpoint save into a read-only folder fails with exit 4 and leaves the input untouched (POSIX permissions)', { skip: skip || (process.platform === 'win32' && 'POSIX permissions') || (process.getuid && process.getuid() === 0 && 'running as root: permissions are not enforced'), timeout: 300000 }, t => {
  const dir = tmp(t), ro = path.join(dir, 'ro'), a = path.join(dir, 'a.state'); fs.mkdirSync(ro);
  json(cli([spec45, 50, 2, a, 512])); const before = sha(a); fs.chmodSync(ro, 0o555);
  const r = cli([spec45, 50, 2, path.join(ro, 'b.state'), 512, a]); assert.equal(r.status, 4, r.stderr); assert.equal(sha(a), before);
});
test('4.9 the native sources compile with Clang and GCC (C++20, -Wall -Wextra): no errors (4.8: Clang rejected an explicit FlatHist construction)', { skip: !has('clang++') && !has('g++') && 'no compiler', timeout: 900000 }, t => {
  const dir = tmp(t), bi = path.join(dir, 'bi.h'); fs.writeFileSync(bi, '#define EM_VERSION "4.9"\n#define EM_BUILD_ID "test"\n');
  for (const cxx of ['clang++', 'g++'].filter(has)) for (const src of ['mw.cpp', 'mwcli.cpp']) {
    const r = cp.spawnSync(cxx, ['-std=c++20', '-O0', '-Wall', '-Wextra', '-ffp-contract=off', '-fsyntax-only', '-I' + native, '-include', bi, path.join(native, src)], { encoding: 'utf8' });
    assert.equal(r.status, 0, cxx + ' ' + src + '\n' + r.stderr.split('\n').filter(l => /error/.test(l)).slice(0, 10).join('\n'));
    assert.doesNotMatch(r.stderr, /error:/, cxx + ' ' + src);
  }
});
test('4.9 adaptive small-table cache: exact gains bit-identical to the 4.7 path, evaluation memory below the 4.8 level (weighted six-player flop)', { skip, timeout: 900000 }, t => {
  const dir = tmp(t), s = G.spec('flop6w', 5), spec = writeJson(dir, 's.json', s), st = path.join(dir, 's.state');
  json(cli([spec, 20000, 2, st, 512])); const q = writeJson(dir, 'q.json', { method: 'exact', threads: 4 });
  const now = json(cli(['--gain', spec, st, q])), old = json(cli(['--gain', spec, st, q], { EM_EV_NO_RANK_CACHE: '1', EM_BR_NO_HOIST: '1', EM_EV_SMALL_TABLE_CAP: '4', EM_EV_TABLE_CAP: '0' }));
  assert.deepEqual(now.seats.map(x => x.gainBits), old.seats.map(x => x.gainBits));
  const v48 = json(cli(['--gain', spec, st, q], { EM_EV_SMALL_TABLE_CAP: '1024' }));
  assert.deepEqual(v48.seats.map(x => x.gainBits), now.seats.map(x => x.gainBits));
  assert.equal(now.execution.showdownTables, v48.execution.showdownTables, 'the adaptive cap rebuilds no more tables than the 4.8 cap');
  assert.ok(now.execution.peakEvaluationMiB < 0.6 * v48.execution.peakEvaluationMiB, now.execution.peakEvaluationMiB + ' vs ' + v48.execution.peakEvaluationMiB);
});
test('4.9 Automatic does not open CUDA for a small training job; GPU Preferred and Hybrid still measure; all modes write the same strategy bytes (Linux CUDA test double, simulated driver)', { skip: (skip || (process.platform !== 'linux' && 'Linux CUDA test double') || (!build.cli().fixtureDir && 'no CUDA test double')), timeout: 600000 }, t => {
  const dir = tmp(t), env = { LD_LIBRARY_PATH: build.cli().fixtureDir }, out = {};
  for (const device of ['cpu', 'auto', 'gpu', 'hybrid']) {
    const s = G.spec('final8', 3, { batchDeals: 16 }); s.device = device; const spec = writeJson(dir, device + '.json', s), st = path.join(dir, device + '.state');
    out[device] = { info: json(cli([spec, 150, 2, st, 512], env)), sha: sha(st) };
  }
  assert.equal(out.auto.info.automaticDeviceSkipped, true); assert.equal(out.auto.info.scoreCalibrations, 0); assert.match(out.auto.info.devicePath, /CUDA not opened/);
  for (const d of ['gpu', 'hybrid']) { assert.equal(out[d].info.automaticDeviceSkipped, false); assert.ok(out[d].info.scoreCalibrations >= 1, d + ' still calibrates'); }
  for (const d of ['auto', 'gpu', 'hybrid']) assert.equal(out[d].sha, out.cpu.sha, d);
  const s = G.spec('final8', 3, { batchDeals: 16 }); s.device = 'auto'; const spec = writeJson(dir, 'big.json', s), st = path.join(dir, 'big.state');
  const big = json(cli([spec, 150, 2, st, 512], { ...env, EM_AUTO_MIN_SCORE_SECONDS: '0' }));
  assert.equal(big.automaticDeviceSkipped, false); assert.ok(big.scoreCalibrations >= 1, 'a job above the threshold is measured'); assert.equal(sha(st), out.cpu.sha);
});
test('4.9 dashboard: ten charts, each with points from a real monitor run where the run provides that measurement', { skip, timeout: 600000 }, t => {
  const dir = tmp(t), spec = writeJson(dir, 's.json', G.spec('river3-chip', 2)), out = path.join(dir, 'm');
  const r = cli(['--monitor', spec, out, 'updates=8000', 'eval=exact', 'first=500', 'growth=2', 'threads=1']); assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(fs.readFileSync(path.join(out, 'analytics.json'), 'utf8')), html = EM.analytics.chartsHTML([doc]);
  const figs = html.split('<figure').slice(1); assert.equal(figs.length, 10);
  const titles = figs.map(f => /<figcaption>([^<]*)/.exec(f)[1]);
  // chart 7 needs a second imported run; every other chart has data points from this one run
  for (const [i, f] of figs.entries()) if (!titles[i].startsWith('7 ')) assert.ok(f.includes('<circle'), 'chart without data: ' + titles[i]);
  assert.ok(figs[titles.findIndex(x => x.startsWith('7 '))].includes('Import the analytics export'), 'chart 7 explains that it needs a second run');
});
