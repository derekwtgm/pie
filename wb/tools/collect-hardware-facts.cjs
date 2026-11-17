'use strict';
/* Cross-platform hardware facts collector (developer/Linux counterpart of windows\Test-Hardware.ps1). Prints JSON. */
const os = require('node:os'), cp = require('node:child_process');
function run(cmd, args) { try { return cp.spawnSync(cmd, args, { encoding: 'utf8', timeout: 8000 }); } catch (e) { return { status: -1, stdout: '', stderr: String(e) }; } }
function collect() {
  const cpus = os.cpus(), smi = run('nvidia-smi', ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits']);
  const gpus = smi.status === 0 && smi.stdout.trim() ? smi.stdout.trim().split('\n').map((l) => { const [n, m, d] = l.split(',').map((s) => s.trim()); return { name: n, vramBytes: Number(m) * 1048576, driver: d }; }) : [];
  return {
    format: 'eightmax-hardware-facts', version: 1, collector: 'node', collectedAt: new Date().toISOString(),
    os: { name: os.type() + ' ' + os.release(), version: os.version ? os.version() : '', arch: os.arch() },
    cpu: { model: cpus[0] && cpus[0].model.trim(), logical: cpus.length, cores: null },
    memory: { totalBytes: os.totalmem(), availableBytes: os.freemem() },
    gpus, nvidiaSmi: { present: smi.status === 0, cudaVersion: null },
    nativeSolver: null, gpuAcceleration: { executed: false, evidence: null },
  };
}
if (require.main === module) process.stdout.write(JSON.stringify(collect(), null, 2) + '\n');
module.exports = { collect };
