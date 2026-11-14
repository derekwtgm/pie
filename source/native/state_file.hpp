// Write a complete sibling temporary file and replace the destination only
// after the data has reached the filesystem. A failed export keeps the old file.
//
// 4.6: every failure now reports WHICH stage failed and the operating-system
// error (errno text, or the Win32 error code and message), so a failed save is
// never reported only as "cannot write". The 4.5 Windows self-test could not
// say why icm45b.state was missing because the CLI said nothing more than that
// and the script discarded it.
//   * Windows: replacing the destination is retried for up to ~3 s when the
//     error is transient (ERROR_ACCESS_DENIED, ERROR_SHARING_VIOLATION,
//     ERROR_LOCK_VIOLATION). On-access scanners and indexers open freshly closed
//     files and can make MoveFileExW fail for a short time; the destination is
//     still replaced atomically or not at all. The number of retries is reported.
//   * EM_TEST_SAVE_FAULT (tests only) injects a failure at one stage:
//     "create", "write", "flush", "rename" (fail before the replace) or "crash"
//     (terminate the process with exit code 86 after the temporary file is
//     written and before the replace, as a power loss or kill would).
#include <filesystem>
#include <string>
#include <cstring>
#include <cerrno>
#include <cstdlib>
#include <cstdio>
#include <thread>
#include <chrono>
#ifdef _WIN32
#include <windows.h>
#include <io.h>
#else
#include <unistd.h>
#endif
struct SaveReport {
  bool ok=false;
  std::string stage;      // create-temp | open-temp | write | flush | commit | close | replace | injected-*
  int code=0;             // errno or Win32 GetLastError()
  std::string message;    // operating-system text
  std::string tempPath;   // the sibling temporary file
  int replaceRetries=0;   // Windows: transient replace failures that were retried
  std::string text() const {
    if(ok)return "ok";
    std::string s="save failed at stage '"+stage+"'";
    if(code)s+=" (os error "+std::to_string(code)+(message.empty()?"":": "+message)+")";
    else if(!message.empty())s+=" ("+message+")";
    if(!tempPath.empty())s+="; temporary file "+tempPath;
    return s;
  }
};
static std::string emOsText(int code){
#ifdef _WIN32
  char buf[512]="";
  DWORD n=FormatMessageA(FORMAT_MESSAGE_FROM_SYSTEM|FORMAT_MESSAGE_IGNORE_INSERTS,nullptr,(DWORD)code,0,buf,sizeof buf,nullptr);
  while(n&&(buf[n-1]=='\n'||buf[n-1]=='\r'||buf[n-1]==' '||buf[n-1]=='.'))buf[--n]=0;
  return buf;
#else
  return std::strerror(code);
#endif
}
static const char *emSaveFault(){const char *f=std::getenv("EM_TEST_SAVE_FAULT");return f&&*f?f:nullptr;}
template<class Writer> static bool saveWithReport(const char *name,Writer write,SaveReport &rep) {
  rep=SaveReport{};
  const char *fault=emSaveFault();
  auto failC=[&](const char *stage,int code){rep.stage=stage;rep.code=code;rep.message=code?emOsText(code):"";return false;};
  if(fault&&!std::strcmp(fault,"create")){rep.stage="injected-create";rep.message="EM_TEST_SAVE_FAULT";return false;}
#ifdef _WIN32
  std::error_code aec;auto dest=std::filesystem::absolute(name,aec);
  if(aec)return failC("resolve-path",aec.value());
  wchar_t temp[MAX_PATH];
  if(!GetTempFileNameW(dest.parent_path().c_str(),L"EMs",0,temp))return failC("create-temp",(int)GetLastError());
  rep.tempPath=std::filesystem::path(temp).string();
  FILE *out=_wfopen(temp,L"wb");
  if(!out){int e=errno;DeleteFileW(temp);return failC("open-temp",e);}
#else
  std::string pattern=std::string(name)+".XXXXXX";
  int fd=mkstemp(pattern.data());
  if(fd<0)return failC("create-temp",errno);
  rep.tempPath=pattern;
  FILE *out=fdopen(fd,"wb");
  if(!out){int e=errno;close(fd);unlink(pattern.c_str());return failC("open-temp",e);}
#endif
  auto discard=[&](){
#ifdef _WIN32
    DeleteFileW(temp);
#else
    unlink(pattern.c_str());
#endif
  };
  errno=0;
  if(!write(out)||(fault&&!std::strcmp(fault,"write"))){int e=errno;std::fclose(out);discard();
    rep.stage=fault&&!std::strcmp(fault,"write")?"injected-write":"write";rep.code=e;rep.message=e?emOsText(e):"the writer reported an error";return false;}
  if(std::fflush(out)!=0||(fault&&!std::strcmp(fault,"flush"))){int e=errno;std::fclose(out);discard();return failC(fault&&!std::strcmp(fault,"flush")?"injected-flush":"flush",e);}
#ifdef _WIN32
  if(_commit(_fileno(out))!=0){int e=errno;std::fclose(out);discard();return failC("commit",e);}
#else
  if(fsync(fileno(out))!=0){int e=errno;std::fclose(out);discard();return failC("commit",e);}
#endif
  if(std::fclose(out)!=0){int e=errno;discard();return failC("close",e);}
  if(fault&&!std::strcmp(fault,"crash")){std::fflush(stdout);std::fflush(stderr);std::_Exit(86);}
  if(fault&&!std::strcmp(fault,"rename")){discard();rep.stage="injected-replace";rep.message="EM_TEST_SAVE_FAULT";return false;}
#ifdef _WIN32
  for(int attempt=0;;attempt++){
    if(MoveFileExW(temp,dest.c_str(),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH))break;
    DWORD e=GetLastError();
    const bool transient=e==ERROR_ACCESS_DENIED||e==ERROR_SHARING_VIOLATION||e==ERROR_LOCK_VIOLATION;
    if(!transient||attempt>=30){discard();return failC("replace",(int)e);}
    rep.replaceRetries++;std::this_thread::sleep_for(std::chrono::milliseconds(attempt<5?20:100));
  }
#else
  if(std::rename(pattern.c_str(),name)!=0){int e=errno;discard();return failC("replace",e);}
#endif
  rep.ok=true;rep.tempPath.clear();
  return true;
}
template<class Writer> static bool saveWith(const char *name,Writer write){SaveReport r;return saveWithReport(name,write,r);}
static bool saveState(const char *name,const unsigned char *bytes,size_t size){
  return bytes && size && saveWith(name,[&](FILE *f){return fwrite(bytes,1,size,f)==size;});
}
