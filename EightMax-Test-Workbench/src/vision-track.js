/* EightMax Test Workbench 0.24: temporal filtering of screen readings.
 *
 * A single frame can catch a card mid-deal, chips mid-slide or a half-repainted window. Two guards, both conservative:
 *  - StabilityGate: pixels must stop changing (fewer than `maxChanged` of sampled pixels differ between consecutive frames)
 *    for `required` consecutive frames before a frame is allowed to be read at all (animation / transition detection).
 *  - ReadingConsensus: the same table reading (board, pot, stacks, bets, markers) must come out of `required` consecutive
 *    stable frames before it is released downstream (temporal filtering of OCR noise).
 * Nothing is interpolated or "filled in": a reading either repeats or is withheld.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WorkbenchVisionTrack = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Fraction of sampled pixels whose luminance differs by more than `threshold` (0..255 scale). Different sizes count as fully changed. */
  function changedFraction(a, b, opt = {}) {
    if (!a || !b || a.width !== b.width || a.height !== b.height) return 1;
    const step = opt.step || 3, thr = opt.threshold || 14; let n = 0, c = 0;
    for (let y = 0; y < a.height; y += step) for (let x = 0; x < a.width; x += step) {
      const i = (y * a.width + x) * 4, la = 0.2126 * a.data[i] + 0.7152 * a.data[i + 1] + 0.0722 * a.data[i + 2], lb = 0.2126 * b.data[i] + 0.7152 * b.data[i + 1] + 0.0722 * b.data[i + 2];
      n++; if (Math.abs(la - lb) > thr) c++;
    }
    return n ? c / n : 1;
  }

  class StabilityGate {
    constructor(o = {}) { this.maxChanged = o.maxChanged === undefined ? 0.0005 : o.maxChanged; this.required = o.required || 2; this.prev = null; this.run = 1; this.last = null; }
    /** Feed a frame; `stable` is true once `required` consecutive frames agree. */
    push(img) {
      const ch = this.prev ? changedFraction(this.prev, img) : 1;
      if (this.prev && ch <= this.maxChanged) this.run++; else this.run = 1;
      this.prev = img; this.last = ch;
      return { stable: this.run >= this.required, run: this.run, changedFraction: ch };
    }
    reset() { this.prev = null; this.run = 1; }
  }

  function readingKey(o) {
    return JSON.stringify([o.hand, o.status, o.street, o.board, o.pot, o.button, o.actor, o.seats.map((s) => [s.stack, s.bet, s.folded, s.cards]), o.callAmount, o.minRaiseTo, o.controls]);
  }
  class ReadingConsensus {
    constructor(o = {}) { this.required = o.required || 2; this.key = null; this.run = 0; this.dropped = 0; }
    /** Returns the observation once it has been read identically `required` times in a row; otherwise null. */
    push(observation) {
      const k = readingKey(observation);
      if (k === this.key) this.run++; else { this.key = k; this.run = 1; if (this.required > 1) this.dropped++; }
      return this.run >= this.required ? observation : null;
    }
    reset() { this.key = null; this.run = 0; }
  }

  return { changedFraction, StabilityGate, ReadingConsensus, readingKey };
});
