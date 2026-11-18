'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const IC = require('../src/image-codec.js');
const gradient = (w, h) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; d[i] = (x * 7) & 255; d[i + 1] = (y * 11) & 255; d[i + 2] = ((x + y) * 3) & 255; d[i + 3] = 255; } return { width: w, height: h, data: d }; };

test('PNG encode/decode round-trips pixel-exactly', () => {
  const img = gradient(37, 23), back = IC.decodePng(IC.encodePng(img));
  assert.equal(back.width, 37); assert.equal(back.height, 23); assert.deepEqual(Array.from(back.data), Array.from(img.data));
});
test('every PNG scanline filter decodes (sub, up, average, paeth)', () => {
  const w = 5, h = 5, img = gradient(w, h), stride = w * 3, raw = [];
  for (let f = 0; f < 5; f++) { const row = []; for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) row.push(img.data[((f % h) * w + x) * 4 + c]); raw.push(row); }
  // build a PNG by hand with filters 0..4 applied to RGB rows
  const filtered = []; let prev = new Array(stride).fill(0);
  raw.forEach((row, f) => { const out = [f]; for (let i = 0; i < stride; i++) { const a = i >= 3 ? row[i - 3] : 0, b = prev[i], c = i >= 3 ? prev[i - 3] : 0; const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : (() => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; })(); out.push((row[i] - pred) & 255); } filtered.push(...out); prev = row; });
  const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); Buffer.from(data).copy(b, 8); b.writeUInt32BE(IC.crc32(b, 4, 8 + data.length), 8 + data.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from(filtered))), chunk('IEND', Buffer.alloc(0))]);
  const dec = IC.decodePng(png);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) assert.equal(dec.data[(y * w + x) * 4 + c], raw[y][x * 3 + c], 'filter ' + y);
});
test('corrupt, truncated and unsupported images are refused', () => {
  const png = IC.encodePng(gradient(10, 10)), bad = Buffer.from(png); bad[bad.length - 20] ^= 0xff;
  assert.throws(() => IC.decodePng(bad), /checksum|length|Truncated|inflate|incorrect/i);
  assert.throws(() => IC.decodePng(png.subarray(0, 40)), /./); assert.throws(() => IC.decodePng(Buffer.from('not a png at all, definitely not')), /Not a PNG/);
  assert.throws(() => IC.decodeAny(Buffer.from('GIF89a......')), /Unsupported image format/);
});
test('BMP 24-bit bottom-up and 32-bit top-down decode', () => {
  const w = 3, h = 2, mk = (bpp, topDown) => { const stride = Math.floor((w * bpp + 31) / 32) * 4, b = Buffer.alloc(54 + stride * h); b.write('BM'); b.writeUInt32LE(b.length, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14); b.writeInt32LE(w, 18); b.writeInt32LE(topDown ? -h : h, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(bpp, 28); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const sy = topDown ? y : h - 1 - y, p = 54 + sy * stride + x * bpp / 8; b[p] = 30 + x; b[p + 1] = 60 + y; b[p + 2] = 90; } return b; };
  for (const [bpp, td] of [[24, false], [32, true]]) { const img = IC.decodeBmp(mk(bpp, td)); assert.equal(img.width, 3); assert.equal(img.data[0], 90); assert.equal(img.data[1], 60); assert.equal(img.data[2], 30); assert.equal(img.data[(1 * 3 + 2) * 4 + 1], 61); }
});
test('BGRA from GDI converts to RGBA and rejects short buffers', () => {
  const bgra = Buffer.from([1, 2, 3, 0, 4, 5, 6, 0]), img = IC.fromBgra(bgra, 2, 1);
  assert.deepEqual(Array.from(img.data), [3, 2, 1, 255, 6, 5, 4, 255]); assert.throws(() => IC.fromBgra(bgra, 4, 1), /too short/);
});
test('shipped validation images decode as real PNG files (captured-fixture ingestion)', () => {
  const dir = path.join(__dirname, '../examples/image-validation'), files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')); assert.ok(files.length >= 6);
  for (const f of files) { const img = IC.decodePng(fs.readFileSync(path.join(dir, f))); assert.ok(img.width > 0 && img.height > 0 && img.data.length === img.width * img.height * 4, f); }
});
test('resize and crop helpers keep geometry exact', () => {
  const img = gradient(40, 20), up = IC.resizeNearest(img, 80, 40), bl = IC.resizeBilinear(img, 60, 30), c = IC.crop(img, 5, 5, 10, 8);
  assert.equal(up.width, 80); assert.equal(up.data[0], img.data[0]); assert.equal(bl.height, 30); assert.equal(c.data.length, 10 * 8 * 4); assert.throws(() => IC.crop(img, 35, 0, 10, 5), /outside/);
  assert.equal(IC.fingerprint(img), IC.fingerprint(gradient(40, 20))); assert.notEqual(IC.fingerprint(img), IC.fingerprint(gradient(40, 21)));
});
