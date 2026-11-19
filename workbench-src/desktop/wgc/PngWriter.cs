// Self-contained PNG writer (BGRA8 -> opaque RGB+A8, filter type 0, zlib deflate): no System.Drawing dependency.
using System.IO;
using System.IO.Compression;
using System.Text;
namespace EightMax.Workbench.Wgc {
public static class PngWriter {
    static uint[] crcTable;
    static uint Crc(byte[] type, byte[] data) {
        if (crcTable == null) { var t = new uint[256]; for (uint n = 0; n < 256; n++) { uint c = n; for (int k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1; t[n] = c; } crcTable = t; }
        uint crc = 0xFFFFFFFFu; foreach (byte b in type) crc = crcTable[(crc ^ b) & 0xFF] ^ (crc >> 8); foreach (byte b in data) crc = crcTable[(crc ^ b) & 0xFF] ^ (crc >> 8); return crc ^ 0xFFFFFFFFu;
    }
    static void Be32(Stream s, uint v) { s.WriteByte((byte)(v >> 24)); s.WriteByte((byte)(v >> 16)); s.WriteByte((byte)(v >> 8)); s.WriteByte((byte)v); }
    static void Chunk(Stream s, string name, byte[] data) { var t = Encoding.ASCII.GetBytes(name); Be32(s, (uint)data.Length); s.Write(t, 0, 4); s.Write(data, 0, data.Length); Be32(s, Crc(t, data)); }
    public static byte[] Encode(byte[] bgra, int w, int h) {
        var raw = new byte[(w * 4 + 1) * h];
        for (int y = 0; y < h; y++) { int o = y * (w * 4 + 1); raw[o] = 0; for (int x = 0; x < w; x++) { int i = (y * w + x) * 4, j = o + 1 + x * 4; raw[j] = bgra[i + 2]; raw[j + 1] = bgra[i + 1]; raw[j + 2] = bgra[i]; raw[j + 3] = 255; } }
        var idat = new MemoryStream(); using (var z = new ZLibStream(idat, CompressionLevel.Fastest, true)) z.Write(raw, 0, raw.Length);
        var ihdr = new MemoryStream(); Be32(ihdr, (uint)w); Be32(ihdr, (uint)h); ihdr.WriteByte(8); ihdr.WriteByte(6); ihdr.WriteByte(0); ihdr.WriteByte(0); ihdr.WriteByte(0);
        var png = new MemoryStream(); png.Write(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }, 0, 8);
        Chunk(png, "IHDR", ihdr.ToArray()); Chunk(png, "IDAT", idat.ToArray()); Chunk(png, "IEND", new byte[0]); return png.ToArray();
    }
}
}
