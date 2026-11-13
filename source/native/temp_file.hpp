// EightMax 4.9: secure anonymous temporary files (replaces std::tmpfile for EMZ1 restoration).
//
// Why: the 4.7/4.8 Windows build decompressed EMZ1 checkpoints into std::tmpfile(). MinGW links
// msvcrt.dll, whose tmpfile() creates its file in the ROOT of the current drive (for example C:\),
// which a standard (non-administrator) account may not write. The GitHub runner runs elevated, so
// CI passed while a normal PC failed with "cannot create a temporary file for decompression".
//
// openAnonymous(hintDir, why, usedDir) returns a FILE* opened "w+b" on a new, empty file that
//   * is created exclusively (CREATE_NEW / O_EXCL via mkstemp): never overwrites anything;
//   * has an unpredictable name (process id, counter and OS random bytes): no collisions between
//     concurrent restorations, no predictable-name attacks;
//   * is deleted automatically: FILE_FLAG_DELETE_ON_CLOSE on Windows (also after a crash, when the
//     handle is closed by the OS), unlink() right after creation on POSIX;
//   * is not shared (share mode 0 on Windows).
// Candidate directories, in order: EM_TEMP_DIR (if set; tests and administrators), the system
// temporary directory (GetTempPathW: TMP, TEMP, USERPROFILE, Windows directory; TMPDIR or /tmp on
// POSIX), then hintDir (the checkpoint's own folder). Windows paths are handled as UTF-16 (Unicode
// user names), long paths get the \\?\ prefix. Every failed attempt is listed in `why`.
#pragma once
#include <cstdio>
#include <cstdint>
#include <string>
#include <atomic>
#include <cerrno>
#include <cstring>
#include <cstdlib>
#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <bcrypt.h>
#include <io.h>
#include <fcntl.h>
#else
#include <unistd.h>
#include <stdlib.h>
#include <sys/types.h>
#endif
namespace emtmp {
inline std::atomic<unsigned> &counter() { static std::atomic<unsigned> c{0}; return c; }
#ifdef _WIN32
inline std::wstring widen(const std::string &s) {   // command-line paths arrive in the ANSI code page
  if (s.empty()) return L"";
  int n = MultiByteToWideChar(CP_ACP, 0, s.c_str(), (int)s.size(), nullptr, 0); if (n <= 0) return L"";
  std::wstring w((size_t)n, L'\0'); MultiByteToWideChar(CP_ACP, 0, s.c_str(), (int)s.size(), &w[0], n); return w;
}
inline std::string narrow(const std::wstring &w) {
  if (w.empty()) return "";
  int n = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), nullptr, 0, nullptr, nullptr); if (n <= 0) return "?";
  std::string s((size_t)n, '\0'); WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), &s[0], n, nullptr, nullptr); return s;
}
inline std::string lastError() {
  const DWORD e = GetLastError(); wchar_t *buf = nullptr;
  FormatMessageW(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS, nullptr, e, 0, (LPWSTR)&buf, 0, nullptr);
  std::string m = buf ? narrow(buf) : std::string("error"); if (buf) LocalFree(buf);
  while (!m.empty() && (m.back() == '\n' || m.back() == '\r' || m.back() == ' ' || m.back() == '.')) m.pop_back();
  return m + " (Win32 " + std::to_string((unsigned long)e) + ")";
}
inline FILE *tryDir(std::wstring dir, std::string &why) {
  if (dir.empty()) return nullptr;
  if (dir.back() != L'\\' && dir.back() != L'/') dir += L'\\';
  for (int attempt = 0; attempt < 16; attempt++) {
    unsigned char rnd[8] = {}; if (BCryptGenRandom(nullptr, rnd, sizeof rnd, BCRYPT_USE_SYSTEM_PREFERRED_RNG) != 0) { LARGE_INTEGER t; QueryPerformanceCounter(&t); std::memcpy(rnd, &t, 8); }
    wchar_t name[96]; swprintf(name, 96, L"EightMax-emz-%lu-%u-%02x%02x%02x%02x%02x%02x%02x%02x.tmp", (unsigned long)GetCurrentProcessId(), counter()++, rnd[0], rnd[1], rnd[2], rnd[3], rnd[4], rnd[5], rnd[6], rnd[7]);
    std::wstring full = dir + name;
    if (full.size() >= 240 && full.rfind(L"\\\\?\\", 0) != 0 && full.size() > 2 && full[1] == L':') { for (auto &c : full) if (c == L'/') c = L'\\'; full = L"\\\\?\\" + full; }
    HANDLE h = CreateFileW(full.c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_TEMPORARY | FILE_FLAG_DELETE_ON_CLOSE, nullptr);
    if (h == INVALID_HANDLE_VALUE) { if (GetLastError() == ERROR_FILE_EXISTS) continue; why += (why.empty() ? "" : "; ") + narrow(dir) + ": " + lastError(); return nullptr; }
    const int fd = _open_osfhandle((intptr_t)h, _O_RDWR | _O_BINARY); if (fd < 0) { CloseHandle(h); why += (why.empty() ? "" : "; ") + narrow(dir) + ": _open_osfhandle failed"; return nullptr; }
    FILE *f = _fdopen(fd, "w+b"); if (!f) { _close(fd); why += (why.empty() ? "" : "; ") + narrow(dir) + ": _fdopen failed"; return nullptr; }
    return f;
  }
  why += (why.empty() ? "" : "; ") + narrow(dir) + ": 16 name collisions"; return nullptr;
}
inline FILE *openAnonymous(const std::string &hintDir, std::string &why, std::string *usedDir = nullptr) {
  why.clear(); std::wstring cands[3];
  if (std::getenv("EM_TEST_TEMP_FAIL")) { why = "temporary file creation disabled by EM_TEST_TEMP_FAIL (fault injection)"; return nullptr; }
  if (const wchar_t *e = _wgetenv(L"EM_TEMP_DIR")) cands[0] = e;
  wchar_t buf[MAX_PATH + 2]; const DWORD n = GetTempPathW(MAX_PATH + 1, buf); if (n > 0 && n <= MAX_PATH + 1) cands[1].assign(buf, n);
  cands[2] = widen(hintDir.empty() ? std::string(".") : hintDir);
  for (const auto &d : cands) if (FILE *f = tryDir(d, why)) { if (usedDir) *usedDir = narrow(d); return f; }
  if (why.empty()) why = "no temporary directory is available";
  return nullptr;
}
#else
inline FILE *tryDir(std::string dir, std::string &why) {
  if (dir.empty()) return nullptr;
  if (dir.back() != '/') dir += '/';
  std::string tpl = dir + "EightMax-emz-" + std::to_string((long)getpid()) + "-" + std::to_string(counter()++) + "-XXXXXX";
  std::string buf = tpl; const int fd = mkstemp(&buf[0]);
  if (fd < 0) { why += (why.empty() ? "" : "; ") + dir + ": " + std::strerror(errno); return nullptr; }
  unlink(buf.c_str());   // anonymous from now on: removed when the descriptor is closed
  FILE *f = fdopen(fd, "w+b"); if (!f) { close(fd); why += (why.empty() ? "" : "; ") + dir + ": fdopen failed"; return nullptr; }
  return f;
}
inline FILE *openAnonymous(const std::string &hintDir, std::string &why, std::string *usedDir = nullptr) {
  why.clear(); std::string cands[3];
  if (std::getenv("EM_TEST_TEMP_FAIL")) { why = "temporary file creation disabled by EM_TEST_TEMP_FAIL (fault injection)"; return nullptr; }
  if (const char *e = std::getenv("EM_TEMP_DIR")) cands[0] = e;
  const char *t = std::getenv("TMPDIR"); cands[1] = t && *t ? t : "/tmp";
  cands[2] = hintDir.empty() ? std::string(".") : hintDir;
  for (const auto &d : cands) if (FILE *f = tryDir(d, why)) { if (usedDir) *usedDir = d; return f; }
  if (why.empty()) why = "no temporary directory is available";
  return nullptr;
}
#endif
} // namespace emtmp
