// EightMax 4.7 (Priority 11): EMZ1, an optional LOSSLESS compressed container for EMMW4
// external-sampling checkpoints. The EMMW4 format itself is unchanged; EMZ1 wraps it.
//
//   "EMZ1\0\0\0\0" u32 version(1) u32 level
//   blocks: u32 type, u32 rawLength, u32 packedLength, u32 crc32(raw block bytes), packed bytes
//     type 0: plain bytes (EMMW4 header, betting-state table, row count), deflated
//     type 0 is also used for a block of whole rows when deflating them in their original order
//             is smaller than the shuffled encoding (the encoder tries both).
//     type 1: whole rows. The block's raw bytes are re-ordered before deflate into
//             u32 metaLength | row metadata (everything but the values) | the rows' float64
//             values byte-shuffled (byte 0 of every value, then byte 1, ...). The decoder
//             walks the metadata (k gives each row's value count) and restores the order.
//     type 2: end. rawLength = total EMMW4 bytes (low 32 bits), followed by u64 total and
//             the 32-byte SHA-256 of the complete EMMW4 file.
// Decoding streams block by block (peak memory about three blocks, blocks <= 8 MiB of
// values), checks every block's CRC-32, the total length and the SHA-256, and writes nothing
// the caller keeps unless every check passes (callers write to a temporary file).
// zlib (deflate) is the only codec; nothing is lossy.
#pragma once
#include <zlib.h>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>
#include "sha256_portable.hpp"
#include "json.h"
namespace emz {
constexpr size_t BLOCK_VALUES = 8u << 20;
inline bool isEMZ(const unsigned char *p, size_t n) { return n >= 8 && !std::memcmp(p, "EMZ1\0\0\0\0", 8); }
struct Result { bool ok = false; std::string error; uint64_t rawBytes = 0, packedBytes = 0; std::string rawSha256; double ratio = 0; uint64_t blocks = 0, plainRowBlocks = 0, shuffledRowBlocks = 0; };
struct Reader {   // exact reads from a FILE with a running SHA-256 of what was read
  FILE *f; emsha::Sha256 sha; uint64_t pos = 0; bool hash = true;
  bool read(void *p, size_t n) { if (n && std::fread(p, 1, n, f) != n) return false; if (hash) sha.add(p, n); pos += n; return true; }
};
inline bool put(FILE *o, const void *p, size_t n, uint64_t &count) { count += n; return !n || std::fwrite(p, 1, n, o) == n; }
inline bool writeBlock(FILE *o, uint32_t type, const std::vector<unsigned char> &raw, int level, uint64_t &out) {
  uLongf cap = compressBound((uLong)raw.size()); std::vector<unsigned char> z(cap);
  if (compress2(z.data(), &cap, raw.data(), (uLong)raw.size(), level) != Z_OK) return false;
  const uint32_t h[4] = {type, (uint32_t)raw.size(), (uint32_t)cap, (uint32_t)crc32(0, raw.data(), (uInt)raw.size())};
  return put(o, h, 16, out) && put(o, z.data(), cap, out);
}
// Compresses an EMMW4 stream of inSize bytes from `in` to `out`.
inline Result compress(FILE *in, uint64_t inSize, FILE *out, int level = 6) {
  Result r; Reader rd{in}; uint64_t written = 0;
  auto fail = [&](const char *e) { r.ok = false; r.error = e; return r; };
  unsigned char head[12]; if (inSize < 20 || !rd.read(head, 12) || std::memcmp(head, "EMMW4\0\0\0", 8)) return fail("input is not an EMMW4 external-sampling checkpoint");
  uint32_t hl; std::memcpy(&hl, head + 8, 4); if ((uint64_t)hl + 16 > inSize) return fail("truncated EMMW4 header");
  std::vector<unsigned char> plain(head, head + 12), hdr(hl); if (!rd.read(hdr.data(), hl)) return fail("truncated EMMW4 header");
  plain.insert(plain.end(), hdr.begin(), hdr.end());
  char err[128] = ""; JV *h = json_parse((const char *)hdr.data(), hl, err, sizeof err); if (!h) return fail("unreadable EMMW4 header");
  const bool rowSync = jnum(jget(h, "rowSync"), 0) != 0, rowKeys = jnum(jget(h, "rowKeys"), 0) != 0; json_free(h);
  uint32_t sc; if (!rd.read(&sc, 4)) return fail("truncated state count");
  plain.insert(plain.end(), (unsigned char *)&sc, (unsigned char *)&sc + 4);
  const uint32_t ver[2] = {1, (uint32_t)level};
  if (!put(out, "EMZ1\0\0\0\0", 8, written) || !put(out, ver, 8, written)) return fail("write failed");
  // state table in plain blocks
  uint64_t states = (uint64_t)sc * 9; std::vector<unsigned char> buf;
  if ((uint64_t)12 + hl + 4 + states + 4 > inSize) return fail("truncated state table");
  while (states) {
    const size_t take = (size_t)std::min<uint64_t>(states, BLOCK_VALUES); const size_t at = plain.size(); plain.resize(at + take);
    if (!rd.read(plain.data() + at, take)) return fail("truncated state table");
    states -= take;
    if (plain.size() >= BLOCK_VALUES) { if (!writeBlock(out, 0, plain, level, written)) return fail("compression failed"); r.blocks++; plain.clear(); }
  }
  uint32_t rc; if (!rd.read(&rc, 4)) return fail("truncated row count");
  plain.insert(plain.end(), (unsigned char *)&rc, (unsigned char *)&rc + 4);
  if (!writeBlock(out, 0, plain, level, written)) return fail("compression failed");
  r.blocks++;
  // rows
  std::vector<unsigned char> meta, vals, block; uint32_t done = 0; uint64_t plainRows = 0, shuffledRows = 0;
  auto flushRows = [&]() -> bool {
    if (meta.empty()) return true;
    block.clear(); const uint32_t ml = (uint32_t)meta.size(); block.insert(block.end(), (unsigned char *)&ml, (unsigned char *)&ml + 4); block.insert(block.end(), meta.begin(), meta.end());
    const size_t nv = vals.size() / 8; const size_t at = block.size(); block.resize(at + vals.size());
    for (size_t b = 0; b < 8; b++) for (size_t i = 0; i < nv; i++) block[at + b * nv + i] = vals[i * 8 + b];
    const uint32_t rawLen = (uint32_t)(meta.size() + vals.size());
    // CRC over the ORIGINAL row bytes is checked after reconstruction; compute it from the block's own order of rows
    std::vector<unsigned char> original; original.reserve(rawLen);
    size_t mo = 0, vo = 0;
    while (mo < meta.size()) {
      size_t hdrLen = 4; if (rowKeys) { uint16_t kl; std::memcpy(&kl, &meta[mo + 4], 2); hdrLen += 2 + kl + 1; } else hdrLen += 2 + 5 + 1;
      const int k = meta[mo + hdrLen - 1]; original.insert(original.end(), meta.begin() + mo, meta.begin() + mo + hdrLen); mo += hdrLen;
      original.insert(original.end(), vals.begin() + vo, vals.begin() + vo + 16 * (size_t)k); vo += 16 * (size_t)k;
      if (rowSync) { original.insert(original.end(), meta.begin() + mo, meta.begin() + mo + 4); mo += 4; }
    }
    uLongf cap = compressBound((uLong)block.size()); std::vector<unsigned char> z(cap);
    if (compress2(z.data(), &cap, block.data(), (uLong)block.size(), level) != Z_OK) return false;
    // Measured (validation/4.7/checkpoints): the shuffle helps some tables and hurts others, so each
    // block is also deflated in its original order and the smaller encoding is kept.
    uLongf cap0 = compressBound((uLong)original.size()); std::vector<unsigned char> z0(cap0);
    if (compress2(z0.data(), &cap0, original.data(), (uLong)original.size(), level) != Z_OK) return false;
    const uint32_t crc = (uint32_t)crc32(0, original.data(), (uInt)original.size());
    r.blocks++; meta.clear(); vals.clear();
    if (cap0 <= cap) { const uint32_t hp[4] = {0, (uint32_t)original.size(), (uint32_t)cap0, crc}; plainRows++; return put(out, hp, 16, written) && put(out, z0.data(), cap0, written); }
    const uint32_t hh[4] = {1, (uint32_t)block.size(), (uint32_t)cap, crc}; shuffledRows++;
    return put(out, hh, 16, written) && put(out, z.data(), cap, written);
  };
  for (; done < rc; done++) {
    unsigned char rh[8]; if (!rd.read(rh, 4)) return fail("truncated row");
    meta.insert(meta.end(), rh, rh + 4);
    int k;
    if (rowKeys) { uint16_t kl; if (!rd.read(&kl, 2)) return fail("truncated row key"); meta.insert(meta.end(), (unsigned char *)&kl, (unsigned char *)&kl + 2);
      std::vector<unsigned char> key((size_t)kl + 1); if (!rd.read(key.data(), key.size())) return fail("truncated row key"); meta.insert(meta.end(), key.begin(), key.end()); k = key.back(); }
    else { unsigned char x[8]; if (!rd.read(x, 8)) return fail("truncated row"); meta.insert(meta.end(), x, x + 8); k = x[7]; }
    if (k < 1 || k > 16) return fail("invalid row action count");
    const size_t at = vals.size(); vals.resize(at + 16 * (size_t)k); if (!rd.read(vals.data() + at, 16 * (size_t)k)) return fail("truncated row values");
    if (rowSync) { unsigned char s4[4]; if (!rd.read(s4, 4)) return fail("truncated row"); meta.insert(meta.end(), s4, s4 + 4); }
    if (vals.size() >= BLOCK_VALUES && !flushRows()) return fail("compression failed");
  }
  if (!flushRows()) return fail("compression failed");
  if (rd.pos != inSize) return fail("trailing bytes after the last row");
  r.rawSha256 = rd.sha.hex(); unsigned char digest[32]; for (int i = 0; i < 32; i++) digest[i] = (unsigned char)std::stoi(r.rawSha256.substr((size_t)i * 2, 2), nullptr, 16);
  const uint32_t end[4] = {2, (uint32_t)rd.pos, 8 + 32, 0}; const uint64_t total = rd.pos;
  if (!put(out, end, 16, written) || !put(out, &total, 8, written) || !put(out, digest, 32, written)) return fail("write failed");
  r.plainRowBlocks = plainRows; r.shuffledRowBlocks = shuffledRows;
  r.ok = true; r.rawBytes = rd.pos; r.packedBytes = written; r.ratio = rd.pos ? (double)written / (double)rd.pos : 0; return r;
}
// Decompresses EMZ1 from `in` to `out` (EMMW4 bytes), verifying every check.
inline Result decompress(FILE *in, FILE *out) {
  Result r; Reader rd{in}; rd.hash = false; emsha::Sha256 raw; uint64_t produced = 0, dummy = 0;
  auto fail = [&](const char *e) { r.ok = false; r.error = e; return r; };
  unsigned char head[16]; if (!rd.read(head, 16) || !isEMZ(head, 16)) return fail("not an EMZ1 compressed checkpoint");
  uint32_t version; std::memcpy(&version, head + 8, 4); if (version != 1) return fail("unsupported EMZ1 version");
  bool rowSync = false, rowKeys = false, first = true;
  for (;;) {
    uint32_t h[4]; if (!rd.read(h, 16)) return fail("truncated compressed checkpoint (missing end block)");
    if (h[0] == 2) {
      uint64_t total; unsigned char digest[32]; if (h[2] != 40 || !rd.read(&total, 8) || !rd.read(digest, 32)) return fail("truncated end block");
      if (total != produced) return fail("decompressed length does not match the recorded length");
      std::string hx = raw.hex(); char want[65]; for (int i = 0; i < 32; i++) std::snprintf(want + 2 * i, 3, "%02x", digest[i]);
      if (hx != want) return fail("SHA-256 of the decompressed checkpoint does not match (corrupted file)");
      unsigned char extra; if (std::fread(&extra, 1, 1, in) == 1) return fail("trailing bytes after the end block");
      r.ok = true; r.rawBytes = produced; r.rawSha256 = hx; r.packedBytes = rd.pos; return r;
    }
    if ((h[0] != 0 && h[0] != 1) || h[1] > (64u << 20) || h[2] > compressBound(h[1]) + 64) return fail("invalid block header (corrupted file)");
    std::vector<unsigned char> z(h[2]), block(h[1]); if (!rd.read(z.data(), z.size())) return fail("truncated block");
    uLongf len = h[1]; if (uncompress(block.data(), &len, z.data(), (uLong)z.size()) != Z_OK || len != h[1]) return fail("corrupted compressed block");
    std::vector<unsigned char> original;
    if (h[0] == 0) {
      original.swap(block);
      if (first) {
        if (original.size() < 12 || std::memcmp(original.data(), "EMMW4\0\0\0", 8)) return fail("compressed checkpoint does not contain EMMW4");
        uint32_t hl; std::memcpy(&hl, original.data() + 8, 4); if ((size_t)hl + 12 > original.size()) return fail("invalid EMMW4 header in block");
        char err[128] = ""; JV *j = json_parse((const char *)original.data() + 12, hl, err, sizeof err); if (!j) return fail("unreadable EMMW4 header");
        rowSync = jnum(jget(j, "rowSync"), 0) != 0; rowKeys = jnum(jget(j, "rowKeys"), 0) != 0; json_free(j);
      }
    } else {
      if (block.size() < 4) return fail("invalid row block");
      uint32_t ml; std::memcpy(&ml, block.data(), 4); if ((size_t)ml + 4 > block.size() || (block.size() - 4 - ml) % 8) return fail("invalid row block");
      const unsigned char *meta = block.data() + 4, *sh = meta + ml; const size_t nv = (block.size() - 4 - ml) / 8; size_t mo = 0, vi = 0;
      original.reserve(block.size() - 4);
      while (mo < ml) {
        size_t hdr = 4; if (rowKeys) { if (mo + 6 > ml) return fail("invalid row metadata"); uint16_t kl; std::memcpy(&kl, meta + mo + 4, 2); hdr += 2 + (size_t)kl + 1; } else hdr += 8;
        if (mo + hdr > ml) return fail("invalid row metadata");
        const int k = meta[mo + hdr - 1]; if (k < 1 || k > 16 || vi + 2 * (size_t)k > nv) return fail("invalid row metadata");
        original.insert(original.end(), meta + mo, meta + mo + hdr); mo += hdr;
        for (size_t v = 0; v < 2 * (size_t)k; v++, vi++) for (size_t b = 0; b < 8; b++) original.push_back(sh[b * nv + vi]);
        if (rowSync) { if (mo + 4 > ml) return fail("invalid row metadata"); original.insert(original.end(), meta + mo, meta + mo + 4); mo += 4; }
      }
      if (vi != nv) return fail("invalid row block");
    }
    if ((uint32_t)crc32(0, original.data(), (uInt)original.size()) != h[3]) return fail("block checksum failed (corrupted file)");
    raw.add(original.data(), original.size()); produced += original.size(); r.blocks++;
    if (!put(out, original.data(), original.size(), dummy)) return fail("write failed");
    first = false;
  }
}
} // namespace emz
