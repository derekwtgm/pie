/* EightMax Test Workbench: hardware facts -> validation report.
 * Facts are collected by windows\Test-Hardware.ps1 (Windows) or tools\collect-hardware-facts.cjs (any OS).
 * This module only classifies; it never upgrades a fact into a claim it does not support. In particular a
 * detected NVIDIA GPU is not GPU acceleration: that needs gpuAcceleration.executed === true with evidence.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WorkbenchHardwareReport = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const GiB = 1024 ** 3;
  const TARGET = Object.freeze({ os: 'Windows 10/11 x64', cpu: 'Intel Core i7 (13th generation)', gpu: 'NVIDIA GeForce RTX 4060 Ti', vramBytes: 8 * GiB, ramBytes: 16 * GiB });

  function validateFacts(f) {
    const issues = [];
    if (!f || f.format !== 'eightmax-hardware-facts' || f.version !== 1) return ['Not an eightmax-hardware-facts v1 record'];
    if (!f.os || typeof f.os.name !== 'string') issues.push('os.name missing');
    if (!f.cpu || !Number.isInteger(f.cpu.logical) || f.cpu.logical < 1) issues.push('cpu.logical missing');
    if (!f.memory || !(f.memory.totalBytes > 0)) issues.push('memory.totalBytes missing');
    if (!Array.isArray(f.gpus)) issues.push('gpus must be an array');
    return issues;
  }

  function estimateRequirements(opts = {}) {
    const studyMiB = opts.strategyMemoryMiB || 256, tables = opts.tables || 10;
    return {
      assumptions: 'Preflop push/fold study of the bundled 5.1 engine; scheduler memory from the measured simulated benchmark where supplied.',
      strategyMemoryMiB: studyMiB, schedulerResidentMiB: opts.measuredRssMiB || null,
      suggestedMinimumRamGiB: Math.ceil((studyMiB + (opts.measuredRssMiB || 300) + 2048) / 1024),
      gpuRequiredForBundledSolver: false,
      note: 'The bundled native CLI runs protocol-4 CPU jobs only; ' + tables + ' tables use one shared study, not ' + tables + ' solver instances.',
    };
  }

  function build(facts, extras = {}) {
    const issues = validateFacts(facts);
    if (issues.length) return { format: 'eightmax-hardware-report', version: 1, valid: false, issues };
    const tested = [], simOnly = [], unsupported = [], awaiting = [], target = [];
    const isWin = /windows/i.test(facts.os.name);
    tested.push('Facts collected on ' + facts.os.name + ' (' + (facts.collector || 'unknown collector') + ')');
    if (facts.cpu.model) tested.push('CPU identified: ' + facts.cpu.model + ', ' + facts.cpu.logical + ' logical threads');
    tested.push('Memory read: ' + (facts.memory.totalBytes / GiB).toFixed(1) + ' GiB total' + (facts.memory.availableBytes ? ', ' + (facts.memory.availableBytes / GiB).toFixed(1) + ' GiB available' : ''));
    const ns = facts.nativeSolver;
    if (ns && ns.selfTest && ns.selfTest.ran && ns.selfTest.passed) tested.push('Native CPU solver ran a short study here: ' + (ns.selfTest.detail || 'passed'));
    else if (ns && ns.selfTest && ns.selfTest.ran) unsupported.push('Native CPU solver study FAILED here: ' + (ns.selfTest.detail || 'see output'));
    else awaiting.push('Native CPU solver compatibility on this machine (self-test not run)');
    if (ns && ns.hashMatches === false) unsupported.push('Native solver binary hash does not match the release manifest');
    // GPU: detection, execution and acceleration are three different facts.
    const nv = facts.gpus.filter((g) => /nvidia/i.test(g.name || ''));
    if (nv.length) tested.push('NVIDIA GPU detected: ' + nv.map((g) => g.name + (g.vramBytes ? ' (' + (g.vramBytes / GiB).toFixed(1) + ' GiB)' : '')).join(', '));
    else tested.push('No NVIDIA GPU detected');
    if (facts.nvidiaSmi && facts.nvidiaSmi.present) tested.push('nvidia-smi present' + (facts.nvidiaSmi.cudaVersion ? ', driver reports CUDA ' + facts.nvidiaSmi.cudaVersion : ''));
    const ga = facts.gpuAcceleration;
    const gpuVerified = !!(ga && ga.executed === true && ga.evidence);
    if (gpuVerified) tested.push('GPU code path executed (evidence: ' + ga.evidence + ')');
    else {
      unsupported.push('GPU acceleration is NOT claimed: no GPU code path was executed' + (nv.length ? ' (an NVIDIA GPU is merely present)' : ''));
      unsupported.push('Bundled mwcli.exe accepts CPU protocol-4 jobs only');
    }
    simOnly.push('Ten-table orchestration, scheduling, fault isolation, stale-decision rejection and checkpoints (Node simulation; see benchmark file)');
    simOnly.push('Throughput/latency figures measured on a non-target machine' + (extras.benchmark ? ' (' + extras.benchmark.machine.platform + ' ' + extras.benchmark.machine.cpu + ')' : ''));
    if (!isWin) awaiting.push('Everything Windows-specific: desktop host, installer, Job Object ownership, PowerShell runners');
    awaiting.push('Ten-table run on target hardware with real Windows timing');
    awaiting.push('Visual dashboard check in Edge/Chrome on Windows');
    // Target comparison, facts only.
    const cpuOk = /i7-13\d{3}/i.test(facts.cpu.model || '') || /13th Gen.*i7/i.test(facts.cpu.model || '');
    target.push({ item: 'OS', target: TARGET.os, found: facts.os.name + ' ' + (facts.os.version || '') + ' ' + (facts.os.arch || ''), meets: isWin && /64/.test(facts.os.arch || '') });
    target.push({ item: 'CPU', target: TARGET.cpu, found: facts.cpu.model || 'unknown', meets: cpuOk, note: cpuOk ? undefined : 'Other CPUs may work; capacity is unmeasured on them' });
    target.push({ item: 'GPU', target: TARGET.gpu, found: nv.map((g) => g.name).join(', ') || 'none', meets: nv.some((g) => /4060\s*Ti/i.test(g.name)) });
    const vram = Math.max(0, ...nv.map((g) => g.vramBytes || 0));
    target.push({ item: 'VRAM', target: '8 GB', found: vram ? (vram / GiB).toFixed(1) + ' GiB' : 'unknown', meets: vram >= 7.5 * GiB, note: 'Informational: the bundled solver does not use VRAM' });
    target.push({ item: 'RAM', target: '16 GB', found: (facts.memory.totalBytes / GiB).toFixed(1) + ' GiB', meets: facts.memory.totalBytes >= 15.5 * GiB });
    return {
      format: 'eightmax-hardware-report', version: 1, valid: true, generatedFrom: facts.collectedAt || null,
      successfullyTested: tested, testedOnlyInSimulation: simOnly, unsupportedOrNotVerified: unsupported, awaitingWindowsTesting: awaiting,
      targetComparison: target, gpuAcceleration: { verified: gpuVerified, detectedNvidia: nv.length > 0 },
      estimatedRequirements: estimateRequirements({ measuredRssMiB: extras.benchmark ? Math.round(Math.max(...extras.benchmark.runs.map((r) => r.memory.peakRssBytes)) / 1048576) : null }),
    };
  }
  return { TARGET, validateFacts, estimateRequirements, build };
});
