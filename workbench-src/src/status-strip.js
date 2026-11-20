/* EightMax Test Workbench 0.35.0: the controlled test table's STATUS STRIP (pixels, bottom-left corner).
 *
 * A row of 40 black/white cells drawn into the table image: table number, the seat whose view is shown, whether a hand is in
 * progress, and a 16-bit frame revision, protected by an 8-bit checksum and two magic nibbles. It is part of what the window
 * SHOWS (a status line), so reading it is screen recognition, not privileged access; it lets the Workbench tell a new frame
 * from an old one without relying on the window title (which can change a few milliseconds after the pixels).
 * Region {x:0, y:0.972, w:0.2, h:0.028} overlaps no region the table reader uses (checked by tests).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WorkbenchStatusStrip = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const REGION = Object.freeze({ x: 0, y: 0.972, w: 0.2, h: 0.028 }), CELLS = 40, HEAD = [1, 0, 1, 1], TAIL = [0, 1, 1, 0];
  const bitsOf = (v, n) => Array.from({ length: n }, (_, i) => (v >> (n - 1 - i)) & 1);
  const valOf = (b) => b.reduce((a, x) => a * 2 + x, 0);
  function crc8(bits) { let c = 0; for (let i = 0; i < bits.length; i += 8) { c ^= valOf(bits.slice(i, i + 8).concat(Array(Math.max(0, 8 - bits.slice(i, i + 8).length)).fill(0))); for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff; } return c; }
  function encode({ table, viewSeat, playing, revision }) {
    if (!(table >= 0 && table <= 15 && viewSeat >= 0 && viewSeat <= 7)) throw new Error('status strip fields out of range');
    const body = [...bitsOf(table, 4), ...bitsOf(viewSeat, 3), playing ? 1 : 0, ...bitsOf(revision & 0xffff, 16)];
    return [...HEAD, ...body, ...bitsOf(crc8(body), 8), ...TAIL];
  }
  const cellBox = (img, i) => { const x0 = Math.floor(REGION.x * img.width), w = Math.floor(REGION.w * img.width), y0 = Math.ceil(REGION.y * img.height), y1 = img.height; return { x0: x0 + Math.floor(i * w / CELLS), x1: x0 + Math.floor((i + 1) * w / CELLS), y0, y1 }; };
  /** Draw onto an RGBA image {width,height,data}. */
  function draw(img, fields) {
    const bits = encode(fields);
    for (let i = 0; i < CELLS; i++) { const b = cellBox(img, i), v = bits[i] ? 235 : 15; for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) { const k = (y * img.width + x) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = v; img.data[k + 3] = 255; } }
    return img;
  }
  /** Read from a captured image. Returns {ok, table, viewSeat, playing, revision} or {ok:false, reason}. */
  function read(img) {
    if (!img || !(img.width >= 200) || !(img.height >= 120)) return { ok: false, reason: 'image too small for the status strip' };
    const bits = [];
    for (let i = 0; i < CELLS; i++) {
      const b = cellBox(img, i), mx = Math.max(1, Math.floor((b.x1 - b.x0) / 4)), my = Math.max(1, Math.floor((b.y1 - b.y0) / 4)); let sum = 0, n = 0;
      for (let y = b.y0 + my; y < b.y1 - my; y++) for (let x = b.x0 + mx; x < b.x1 - mx; x++) { const k = (y * img.width + x) * 4; sum += (img.data[k] + img.data[k + 1] + img.data[k + 2]) / 3; n++; }
      if (!n) return { ok: false, reason: 'status strip cells too small' }; const m = sum / n; if (m > 90 && m < 160) return { ok: false, reason: 'status strip cell ' + i + ' is neither black nor white (' + m.toFixed(0) + ')' }; bits.push(m >= 125 ? 1 : 0);
    }
    if (HEAD.some((b, i) => bits[i] !== b) || TAIL.some((b, i) => bits[36 + i] !== b)) return { ok: false, reason: 'no status strip (magic mismatch)' };
    const body = bits.slice(4, 28); if (crc8(body) !== valOf(bits.slice(28, 36))) return { ok: false, reason: 'status strip checksum mismatch (frame tearing or scaling)' };
    return { ok: true, table: valOf(body.slice(0, 4)), viewSeat: valOf(body.slice(4, 7)), playing: body[7] === 1, revision: valOf(body.slice(8, 24)) };
  }
  return { REGION, CELLS, encode, draw, read, crc8 };
});
