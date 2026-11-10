// Write a complete sibling temporary file and replace the destination only
// after the data has reached the filesystem. A failed export keeps the old file.
#include <filesystem>
#include <string>
#ifdef _WIN32
#include <windows.h>
#include <io.h>
#else
#include <unistd.h>
#endif
template<class Writer> static bool saveWith(const char *name,Writer write) {
#ifdef _WIN32
  auto dest=std::filesystem::absolute(name);
  wchar_t temp[MAX_PATH];
  if(!GetTempFileNameW(dest.parent_path().c_str(),L"EMs",0,temp))return false;
  FILE *out=_wfopen(temp,L"wb");
#else
  std::string pattern=std::string(name)+".XXXXXX";
  int fd=mkstemp(pattern.data());
  if(fd<0)return false;
  FILE *out=fdopen(fd,"wb");
  if(!out)close(fd);
#endif
  bool ok=out && write(out) && std::fflush(out)==0;
#ifdef _WIN32
  if(ok)ok=_commit(_fileno(out))==0;
#else
  if(ok)ok=fsync(fileno(out))==0;
#endif
  if(out && std::fclose(out)!=0)ok=false;
#ifdef _WIN32
  if(ok)ok=MoveFileExW(temp,dest.c_str(),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH)!=0;
  if(!ok)DeleteFileW(temp);
#else
  if(ok)ok=std::rename(pattern.c_str(),name)==0;
  if(!ok)unlink(pattern.c_str());
#endif
  return ok;
}

static bool saveState(const char *name,const unsigned char *bytes,size_t size){
  return bytes && size && saveWith(name,[&](FILE *f){return fwrite(bytes,1,size,f)==size;});
}
