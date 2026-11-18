'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const HR = require('../src/hardware-report.js'), C = require('../tools/collect-hardware-facts.cjs');
const GiB = 1024 ** 3;
const win = (over = {}) => ({ format: 'eightmax-hardware-facts', version: 1, collector: 'powershell-cim', collectedAt: 'x', os: { name: 'Microsoft Windows 11 Pro', version: '10.0.22631', arch: 'x64' }, cpu: { model: '13th Gen Intel(R) Core(TM) i7-13700K', cores: 16, logical: 24 }, memory: { totalBytes: 16 * GiB, availableBytes: 9 * GiB }, gpus: [{ name: 'NVIDIA GeForce RTX 4060 Ti', vramBytes: 8 * GiB }], nvidiaSmi: { present: true, cudaVersion: '12.4' }, nativeSolver: { present: true, hashMatches: true, selfTest: { ran: true, passed: true, detail: '2000 updates' } }, gpuAcceleration: { executed: false, evidence: null }, ...over });

test('a detected NVIDIA GPU with CUDA reported by the driver is NOT reported as GPU acceleration', () => {
  const r = HR.build(win());
  assert.equal(r.gpuAcceleration.verified, false); assert.equal(r.gpuAcceleration.detectedNvidia, true);
  assert.ok(r.unsupportedOrNotVerified.some((x) => /GPU acceleration is NOT claimed/.test(x)));
  assert.ok(r.successfullyTested.some((x) => /NVIDIA GPU detected/.test(x)));
  assert.ok(!r.successfullyTested.some((x) => /GPU code path executed/.test(x)));
});

test('GPU acceleration is only reported with executed=true and evidence', () => {
  assert.equal(HR.build(win({ gpuAcceleration: { executed: true, evidence: null } })).gpuAcceleration.verified, false);
  assert.equal(HR.build(win({ gpuAcceleration: { executed: true, evidence: 'kernel timing log' } })).gpuAcceleration.verified, true);
});

test('target comparison reports facts and keeps simulation, unsupported and awaiting sections separate', () => {
  const r = HR.build(win()), by = Object.fromEntries(r.targetComparison.map((t) => [t.item, t]));
  assert.equal(by.CPU.meets, true); assert.equal(by.GPU.meets, true); assert.equal(by.RAM.meets, true); assert.equal(by.OS.meets, true);
  assert.ok(r.testedOnlyInSimulation.length >= 2); assert.ok(r.awaitingWindowsTesting.length >= 2);
  const low = HR.build(win({ memory: { totalBytes: 8 * GiB }, gpus: [], cpu: { model: 'AMD Ryzen 5', logical: 12 } })), l = Object.fromEntries(low.targetComparison.map((t) => [t.item, t]));
  assert.equal(l.RAM.meets, false); assert.equal(l.GPU.meets, false); assert.equal(l.CPU.meets, false);
});

test('failed or missing native solver self-test and a hash mismatch are surfaced', () => {
  assert.ok(HR.build(win({ nativeSolver: { present: true, hashMatches: true, selfTest: { ran: true, passed: false, detail: 'exit 1' } } })).unsupportedOrNotVerified.some((x) => /FAILED/.test(x)));
  assert.ok(HR.build(win({ nativeSolver: null })).awaitingWindowsTesting.some((x) => /self-test not run/.test(x)));
  assert.ok(HR.build(win({ nativeSolver: { present: true, hashMatches: false, selfTest: { ran: false } } })).unsupportedOrNotVerified.some((x) => /hash/.test(x)));
});

test('malformed facts are refused and the real collector output on this machine validates', () => {
  assert.equal(HR.build({}).valid, false);
  const facts = C.collect(), r = HR.build(facts);
  assert.equal(r.valid, true, JSON.stringify(r.issues)); assert.equal(facts.cpu.logical, require('node:os').cpus().length);
  assert.ok(r.awaitingWindowsTesting.some((x) => /Windows-specific/.test(x)) === !/windows/i.test(facts.os.name));
  assert.equal(r.gpuAcceleration.verified, false);
});
