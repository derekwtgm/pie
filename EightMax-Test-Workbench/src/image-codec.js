/* EightMax Test Workbench 0.24: minimal PNG / BMP codec and image helpers.
 *
 * Needed so captured frames (PNG from the Windows capture helper, BMP/PNG screenshots supplied by the
 * operator) can be ingested and recorded without any external dependency. PNG: 8-bit grey, grey+alpha,
 * RGB, RGBA and palette, non-interlaced, all five scanline filters. BMP: uncompressed 24/32-bit.
 * Browser builds have no synchronous inflate, so decodePng needs Node's zlib; the dashboard decodes in
 * the page with createImageBitmap instead and hands this module the raw pixels.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('node:zlib'), require('node:crypto'));
  else root.WorkbenchImageCodec = factory(null, null);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (zlib, crypto) {
  'use strict';

  const ok = (x, m) => { if (!x) throw new Error(m); };
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  const MAX_PIXELS = 16 * 1024 * 1024;

  let crcTable = null;
  function crc32(buf, start, end) {
    if (!crcTable) { crcTable = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; } }
    let c = 0xffffffff;
    for (let i = start; i < end; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /** img = {width, height, data: Uint8ClampedArray|Uint8Array RGBA}. Returns a Buffer/Uint8Array PNG (RGBA, filter 0). */
  function encodePng(img) {
    ok(zlib, 'PNG encoding needs Node zlib');
    ok(img && Number.isInteger(img.width) && Number.isInteger(img.height) && img.width > 0 && img.height > 0 && img.data.length === img.width * img.height * 4, 'Invalid image');
    const stride = img.width * 4, raw = Buffer.alloc((stride + 1) * img.height);
    for (let y = 0; y < img.height; y++) { raw[y * (stride + 1)] = 0; Buffer.from(img.data.buffer, img.data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1); }
    const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8); b.writeUInt32BE(crc32(b, 4, 8 + data.length), 8 + data.length); return b; };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(img.width, 0); ihdr.writeUInt32BE(img.height, 4); ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([Buffer.from(SIG), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
  }

  function paeth(a, b, c) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }

  function decodePng(input) {
    ok(zlib, 'PNG decoding needs Node zlib');
    const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
    ok(buf.length > 33 && SIG.every((v, i) => buf[i] === v), 'Not a PNG file');
    let pos = 8, w = 0, h = 0, depth = 0, ctype = -1, interlace = 0, palette = null, trns = null; const idat = [];
    while (pos + 12 <= buf.length) {
      const len = buf.readUInt32BE(pos), type = buf.toString('latin1', pos + 4, pos + 8);
      ok(pos + 12 + len <= buf.length, 'Truncated PNG chunk');
      if (crc32(buf, pos + 4, pos + 8 + len) !== buf.readUInt32BE(pos + 8 + len)) throw new Error('PNG chunk checksum mismatch (' + type + ')');
      const d = buf.subarray(pos + 8, pos + 8 + len);
      if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ctype = d[9]; interlace = d[12]; }
      else if (type === 'PLTE') palette = d; else if (type === 'tRNS') trns = d; else if (type === 'IDAT') idat.push(d);
      else if (type === 'IEND') break;
      pos += 12 + len;
    }
    ok(w > 0 && h > 0 && w * h <= MAX_PIXELS, 'PNG dimensions invalid or too large');
    ok(depth === 8 && interlace === 0, 'Only 8-bit non-interlaced PNG is supported');
    const chans = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype]; ok(chans, 'Unsupported PNG colour type ' + ctype);
    if (ctype === 3) ok(palette, 'Palette PNG without PLTE');
    const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * chans;
    ok(raw.length === (stride + 1) * h, 'PNG pixel data has the wrong length');
    const out = new Uint8ClampedArray(w * h * 4), prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
    for (let y = 0; y < h; y++) {
      const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
      for (let i = 0; i < stride; i++) {
        const a = i >= chans ? cur[i - chans] : 0, b = prev[i], c = i >= chans ? prev[i - chans] : 0;
        cur[i] = (line[i] + (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? paeth(a, b, c) : (() => { throw new Error('Bad PNG filter'); })())) & 255;
      }
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4, p = x * chans;
        if (ctype === 6) { out[o] = cur[p]; out[o + 1] = cur[p + 1]; out[o + 2] = cur[p + 2]; out[o + 3] = cur[p + 3]; }
        else if (ctype === 2) { out[o] = cur[p]; out[o + 1] = cur[p + 1]; out[o + 2] = cur[p + 2]; out[o + 3] = 255; }
        else if (ctype === 0) { out[o] = out[o + 1] = out[o + 2] = cur[p]; out[o + 3] = 255; }
        else if (ctype === 4) { out[o] = out[o + 1] = out[o + 2] = cur[p]; out[o + 3] = cur[p + 1]; }
        else { const k = cur[p]; ok(k * 3 + 2 < palette.length, 'Palette index out of range'); out[o] = palette[k * 3]; out[o + 1] = palette[k * 3 + 1]; out[o + 2] = palette[k * 3 + 2]; out[o + 3] = trns && k < trns.length ? trns[k] : 255; }
      }
      cur.copy(prev);
    }
    return { width: w, height: h, data: out };
  }

  function decodeBmp(input) {
    const b = Buffer.isBuffer(input) ? input : Buffer.from(input);
    ok(b.length > 54 && b[0] === 0x42 && b[1] === 0x4d, 'Not a BMP file');
    const off = b.readUInt32LE(10), hdr = b.readUInt32LE(14); ok(hdr >= 40, 'Unsupported BMP header');
    const w = b.readInt32LE(18); let h = b.readInt32LE(22); const planes = b.readUInt16LE(26), bpp = b.readUInt16LE(28), comp = b.readUInt32LE(30);
    ok(planes === 1 && (bpp === 24 || bpp === 32) && (comp === 0 || comp === 3), 'Only uncompressed 24/32-bit BMP is supported');
    const top = h < 0; h = Math.abs(h); ok(w > 0 && h > 0 && w * h <= MAX_PIXELS, 'BMP dimensions invalid');
    const stride = Math.floor((w * bpp + 31) / 32) * 4; ok(off + stride * h <= b.length, 'Truncated BMP');
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) { const sy = top ? y : h - 1 - y; for (let x = 0; x < w; x++) { const p = off + sy * stride + x * (bpp / 8), o = (y * w + x) * 4; out[o] = b[p + 2]; out[o + 1] = b[p + 1]; out[o + 2] = b[p]; out[o + 3] = 255; } }
    return { width: w, height: h, data: out };
  }

  /** Raw BGRA (as returned by GDI) -> RGBA image. */
  function fromBgra(bytes, width, height, stride) {
    stride = stride || width * 4; ok(bytes.length >= stride * height, 'BGRA buffer too short');
    const out = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const p = y * stride + x * 4, o = (y * width + x) * 4; out[o] = bytes[p + 2]; out[o + 1] = bytes[p + 1]; out[o + 2] = bytes[p]; out[o + 3] = 255; }
    return { width, height, data: out };
  }

  function decodeAny(input) {
    const b = Buffer.isBuffer(input) ? input : Buffer.from(input);
    if (b[0] === 0x89 && b[1] === 0x50) return decodePng(b);
    if (b[0] === 0x42 && b[1] === 0x4d) return decodeBmp(b);
    throw new Error('Unsupported image format (need PNG or BMP)');
  }

  function sha256(img) { ok(crypto, 'Hashing needs Node crypto'); return crypto.createHash('sha256').update(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length)).digest('hex'); }
  /** Fast non-cryptographic 32-bit content hash (works in the browser too). */
  function fingerprint(img) { let h = 0x811c9dc5; const d = img.data; for (let i = 0; i < d.length; i += 7) { h ^= d[i]; h = Math.imul(h, 0x01000193) >>> 0; } return ((h ^ img.width * 31 ^ img.height) >>> 0).toString(16).padStart(8, '0'); }

  /** Nearest-neighbour resize (exact for integer ratios; used for DPI normalisation tests). */
  function resizeNearest(img, w, h) {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) { const sy = Math.min(img.height - 1, Math.floor((y + 0.5) * img.height / h)); for (let x = 0; x < w; x++) { const sx = Math.min(img.width - 1, Math.floor((x + 0.5) * img.width / w)); const s = (sy * img.width + sx) * 4, o = (y * w + x) * 4; out[o] = img.data[s]; out[o + 1] = img.data[s + 1]; out[o + 2] = img.data[s + 2]; out[o + 3] = img.data[s + 3]; } }
    return { width: w, height: h, data: out };
  }
  /** Bilinear resize: what a real DPI-scaled window looks like (not exact), used by robustness tests. */
  function resizeBilinear(img, w, h) {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      const fy = Math.max(0, Math.min(img.height - 1, (y + 0.5) * img.height / h - 0.5)), y0 = Math.floor(fy), y1 = Math.min(img.height - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < w; x++) {
        const fx = Math.max(0, Math.min(img.width - 1, (x + 0.5) * img.width / w - 0.5)), x0 = Math.floor(fx), x1 = Math.min(img.width - 1, x0 + 1), tx = fx - x0, o = (y * w + x) * 4;
        for (let c = 0; c < 4; c++) { const a = img.data[(y0 * img.width + x0) * 4 + c], b = img.data[(y0 * img.width + x1) * 4 + c], d = img.data[(y1 * img.width + x0) * 4 + c], e = img.data[(y1 * img.width + x1) * 4 + c]; out[o + c] = Math.round((a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty); }
      }
    }
    return { width: w, height: h, data: out };
  }
  function crop(img, x, y, w, h) {
    ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= img.width && y + h <= img.height, 'Crop outside image');
    const out = new Uint8ClampedArray(w * h * 4);
    for (let r = 0; r < h; r++) out.set(img.data.subarray(((y + r) * img.width + x) * 4, ((y + r) * img.width + x + w) * 4), r * w * 4);
    return { width: w, height: h, data: out };
  }

  return { encodePng, decodePng, decodeBmp, decodeAny, fromBgra, sha256, fingerprint, resizeNearest, resizeBilinear, crop, crc32 };
});
