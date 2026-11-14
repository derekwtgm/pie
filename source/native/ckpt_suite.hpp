// EightMax 4.6: checkpoint-continuation diagnostics, used by mwcli.
//
//   mwcli --state-info <state>
//       header fields (iterations, trainingDeals, stateVisits, rng, actionRng,
//       rowCrc32, studyId), file size, SHA-256 of the file and of the body
//       (everything after the header: betting states, regret and average-strategy rows).
//
//   mwcli --continuation-suite <spec.json> <work-dir> [quick|standard|full] [threads]
//       Runs every training segment as a SEPARATE mwcli process (a cold start of
//       the engine each time, like restarting the application) and records, for
//       every process: the complete command, working directory, input checkpoint
//       (path, existence, size, SHA-256), output checkpoint (existence before and
//       after, size, SHA-256, header fields), exit code, standard output, standard
//       error and elapsed time. Resumed states are compared with uninterrupted
//       ones byte for byte; when they differ, every header field and the first
//       differing byte offset are reported. Exit 0 only when every comparison
//       passed. The JSON is printed and also written to <work-dir>/continuation-suite.json.
//
// Why this exists: the 4.5 Windows self-test ran these steps with their output
// discarded and without checking exit codes, so the report said only that
// icm45b.state did not exist. Every step here records why it failed.
#pragma once
#include <string>
#include <vector>
#include <thread>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cerrno>
#include <filesystem>
#include "sha256_portable.hpp"
#include "json.h"
#ifdef _WIN32
#include <windows.h>
#else
#include <unistd.h>
#include <sys/wait.h>
#include <poll.h>
#include <signal.h>
#include <fcntl.h>
#endif
namespace ckpt {
static std::string jsonStr(const std::string &s){
  std::string o="\"";
  for(unsigned char c:s){
    if(c=='"')o+="\\\"";else if(c=='\\')o+="\\\\";else if(c=='\n')o+="\\n";else if(c=='\r')o+="\\r";else if(c=='\t')o+="\\t";
    else if(c<0x20){char b[8];std::snprintf(b,sizeof b,"\\u%04x",c);o+=b;}else o+=(char)c;
  }
  return o+"\"";
}
static std::string clip(const std::string &s,size_t max=8192){return s.size()<=max?s:s.substr(0,max/2)+"\n...["+std::to_string(s.size()-max)+" bytes omitted]...\n"+s.substr(s.size()-max/2);}

// ---------- state file inspection ----------
struct StateInfo {
  bool exists=false,readable=false,validHeader=false;uint64_t bytes=0,headerEnd=0;
  std::string sha256,bodySha256,headerText,error;
  std::string field(const char *k) const {   // raw JSON token of a header field ("" if absent)
    if(!validHeader)return "";char e[128];JV *h=json_parse(headerText.data(),headerText.size(),e,sizeof e);if(!h)return "";
    const JV *v=jget(h,k);std::string out;
    if(v){if(v->type==J_STR)out=jsonStr(v->str);else if(v->type==J_NUM){char b[64];std::snprintf(b,sizeof b,"%.17g",v->num);out=b;}
      else if(v->type==J_BOOL)out=v->num!=0?"true":"false";else out="null";}
    json_free(h);return out;
  }
};
static StateInfo inspect(const std::string &path){
  StateInfo s;std::error_code ec;s.exists=std::filesystem::exists(path,ec);if(!s.exists)return s;
  FILE *f=std::fopen(path.c_str(),"rb");if(!f){s.error=std::string("cannot open: ")+std::strerror(errno);return s;}
  char magic[8];uint32_t len=0;
  if(std::fread(magic,1,8,f)==8&&!std::memcmp(magic,"EMMW4\0\0\0",8)&&std::fread(&len,4,1,f)==1&&len>0&&len<=4096){
    s.headerText.resize(len);if(std::fread(s.headerText.data(),1,len,f)==len){s.validHeader=true;s.headerEnd=12+len;}}
  else s.error="not an EMMW4 native state";
  std::fclose(f);
  s.sha256=emsha::fileHex(path.c_str(),&s.bytes,s.headerEnd,&s.bodySha256);s.readable=!s.sha256.empty();
  if(!s.readable&&s.error.empty())s.error="read failed";
  return s;
}
static const char *kFields[]={"iterations","trainingDeals","stateVisits","rng","actionRng","rowCrc32","studyId","protocol","specProtocol"};
static std::string infoJson(const StateInfo &s){
  std::string o="{\"exists\":"+std::string(s.exists?"true":"false");
  if(s.exists){o+=",\"bytes\":"+std::to_string(s.bytes)+",\"sha256\":"+jsonStr(s.sha256)+",\"bodySha256\":"+jsonStr(s.bodySha256)+",\"validHeader\":"+(s.validHeader?"true":"false");
    if(s.validHeader){o+=",\"header\":{";bool first=true;for(const char *k:kFields){std::string v=s.field(k);if(v.empty())continue;o+=(first?"":",")+jsonStr(k)+":"+v;first=false;}o+="}";}
    if(!s.error.empty())o+=",\"error\":"+jsonStr(s.error);}
  return o+"}";
}
// first differing byte, or -1 when equal; also -1 if either cannot be read (reported separately)
static long long firstDifference(const std::string &a,const std::string &b){
  FILE *x=std::fopen(a.c_str(),"rb"),*y=std::fopen(b.c_str(),"rb");if(!x||!y){if(x)std::fclose(x);if(y)std::fclose(y);return -2;}
  unsigned char p[65536],q[65536];long long pos=0,res=-1;
  for(;;){size_t n=std::fread(p,1,sizeof p,x),m=std::fread(q,1,sizeof q,y);size_t k=n<m?n:m;
    for(size_t i=0;i<k;i++)if(p[i]!=q[i]){res=pos+(long long)i;goto done;}
    if(n!=m){res=pos+(long long)k;break;}if(!n)break;pos+=(long long)n;}
done:std::fclose(x);std::fclose(y);return res;
}

// ---------- child processes ----------
struct Run { std::vector<std::string> args; std::string command,cwd,out,err; int exitCode=-1; bool started=false,timedOut=false; double ms=0; std::string startError; };
static std::string quoteArg(const std::string &a){
#ifdef _WIN32
  // CommandLineToArgvW / MSVCRT rules: backslashes are literal unless they precede a quote.
  if(!a.empty()&&a.find_first_of(" \t\n\v\"")==std::string::npos)return a;
  std::string o="\"";size_t bs=0;
  for(char c:a){if(c=='\\'){bs++;continue;}if(c=='"'){o.append(bs*2+1,'\\');o+='"';bs=0;continue;}o.append(bs,'\\');bs=0;o+=c;}
  o.append(bs*2,'\\');return o+"\"";
#else
  if(!a.empty()&&a.find_first_of(" \t\n'\"\\$`")==std::string::npos)return a;
  std::string o="'";for(char c:a){if(c=='\'')o+="'\\''";else o+=c;}return o+"'";
#endif
}
static std::string selfPath(const char *argv0){
#ifdef _WIN32
  wchar_t w[32768];DWORD n=GetModuleFileNameW(nullptr,w,32768);if(n&&n<32768)return std::filesystem::path(std::wstring(w,n)).string();
  return argv0;
#else
  std::error_code ec;auto p=std::filesystem::read_symlink("/proc/self/exe",ec);return ec?std::string(argv0):p.string();
#endif
}
static void setEnv(const char *k,const char *v){
#ifdef _WIN32
  SetEnvironmentVariableA(k,v);std::string s=std::string(k)+"="+(v?v:"");_putenv(s.c_str());
#else
  if(v)setenv(k,v,1);else unsetenv(k);
#endif
}
static Run spawn(const std::vector<std::string> &args,const std::string &cwd,double timeoutS,const std::vector<std::pair<std::string,std::string>> &env={}){
  Run r;r.args=args;r.cwd=cwd;for(size_t i=0;i<args.size();i++){if(i)r.command+=' ';r.command+=quoteArg(args[i]);}
  for(auto &e:env)setEnv(e.first.c_str(),e.second.c_str());
  const auto t0=std::chrono::steady_clock::now();
#ifdef _WIN32
  SECURITY_ATTRIBUTES sa{sizeof sa,nullptr,TRUE};HANDLE oR=nullptr,oW=nullptr,eR=nullptr,eW=nullptr;
  if(!CreatePipe(&oR,&oW,&sa,0)||!CreatePipe(&eR,&eW,&sa,0)){r.startError="CreatePipe failed ("+std::to_string(GetLastError())+")";}
  else{
    SetHandleInformation(oR,HANDLE_FLAG_INHERIT,0);SetHandleInformation(eR,HANDLE_FLAG_INHERIT,0);
    STARTUPINFOW si{};si.cb=sizeof si;si.dwFlags=STARTF_USESTDHANDLES;si.hStdOutput=oW;si.hStdError=eW;si.hStdInput=GetStdHandle(STD_INPUT_HANDLE);
    PROCESS_INFORMATION pi{};
    std::wstring cmd=std::filesystem::path(r.command).wstring();   // ACP -> UTF-16
    std::wstring wcwd=std::filesystem::path(cwd).wstring();
    std::vector<wchar_t> line(cmd.begin(),cmd.end());line.push_back(0);
    if(!CreateProcessW(nullptr,line.data(),nullptr,nullptr,TRUE,CREATE_NO_WINDOW,nullptr,wcwd.c_str(),&si,&pi)){
      DWORD e=GetLastError();char b[512]="";FormatMessageA(FORMAT_MESSAGE_FROM_SYSTEM|FORMAT_MESSAGE_IGNORE_INSERTS,nullptr,e,0,b,sizeof b,nullptr);
      r.startError="CreateProcess failed ("+std::to_string(e)+"): "+b;CloseHandle(oW);CloseHandle(eW);CloseHandle(oR);CloseHandle(eR);
    }else{
      r.started=true;CloseHandle(oW);CloseHandle(eW);
      auto pump=[](HANDLE h,std::string *dst){char b[4096];DWORD n;while(ReadFile(h,b,sizeof b,&n,nullptr)&&n)dst->append(b,n);};
      std::thread a(pump,oR,&r.out),b(pump,eR,&r.err);
      if(WaitForSingleObject(pi.hProcess,(DWORD)(timeoutS*1000))==WAIT_TIMEOUT){r.timedOut=true;TerminateProcess(pi.hProcess,124);WaitForSingleObject(pi.hProcess,INFINITE);}
      DWORD code=0;GetExitCodeProcess(pi.hProcess,&code);r.exitCode=(int)code;
      a.join();b.join();CloseHandle(oR);CloseHandle(eR);CloseHandle(pi.hProcess);CloseHandle(pi.hThread);
    }
  }
#else
  int po[2],pe[2];
  if(pipe(po)||pipe(pe)){r.startError=std::string("pipe failed: ")+std::strerror(errno);}
  else{
    pid_t pid=fork();
    if(pid==0){
      dup2(po[1],1);dup2(pe[1],2);close(po[0]);close(pe[0]);close(po[1]);close(pe[1]);
      if(chdir(cwd.c_str())){std::fprintf(stderr,"chdir %s: %s\n",cwd.c_str(),std::strerror(errno));_exit(127);}
      std::vector<char*> v;for(auto &s:args)v.push_back(const_cast<char*>(s.c_str()));v.push_back(nullptr);
      execv(v[0],v.data());std::fprintf(stderr,"exec %s: %s\n",v[0],std::strerror(errno));_exit(127);
    }
    close(po[1]);close(pe[1]);
    if(pid<0){r.startError=std::string("fork failed: ")+std::strerror(errno);close(po[0]);close(pe[0]);}
    else{
      r.started=true;pollfd fds[2]={{po[0],POLLIN,0},{pe[0],POLLIN,0}};int open=2;char b[4096];
      while(open){
        const double el=std::chrono::duration<double>(std::chrono::steady_clock::now()-t0).count();
        if(el>timeoutS&&!r.timedOut){r.timedOut=true;kill(pid,SIGKILL);}
        if(poll(fds,2,200)<0&&errno!=EINTR)break;
        for(auto &p:fds){if(p.fd<0||!(p.revents&(POLLIN|POLLHUP|POLLERR)))continue;ssize_t n=read(p.fd,b,sizeof b);
          if(n>0)(&p==&fds[0]?r.out:r.err).append(b,(size_t)n);else{close(p.fd);p.fd=-1;open--;}}
      }
      int st=0;waitpid(pid,&st,0);r.exitCode=WIFEXITED(st)?WEXITSTATUS(st):WIFSIGNALED(st)?128+WTERMSIG(st):-1;
    }
  }
#endif
  r.ms=std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-t0).count();
  for(auto &e:env)setEnv(e.first.c_str(),nullptr);
  return r;
}

// ---------- the suite ----------
struct Suite {
  std::string self,spec,dir;int threads=4;double timeoutS=900;
  std::vector<std::string> steps,checks;int failed=0,passedChecks=0;
  std::string p(const std::string &name){return (std::filesystem::path(dir)/name).string();}
  // one training process: [in] -> out, records everything
  Run train(const std::string &label,long long updates,const std::string &out,const std::string &in="",int t=-1,
            const std::vector<std::pair<std::string,std::string>> &env={},bool expectFailure=false){
    std::vector<std::string> a{self,spec,std::to_string(updates),std::to_string(t>0?t:threads),out,"512"};if(!in.empty())a.push_back(in);
    StateInfo inBefore=in.empty()?StateInfo{}:inspect(in);StateInfo outBefore=inspect(out);
    Run r=spawn(a,dir,timeoutS,env);StateInfo outAfter=inspect(out);
    std::string s="{\"label\":"+jsonStr(label)+",\"kind\":\"train\",\"updates\":"+std::to_string(updates)+",\"command\":"+jsonStr(r.command)+",\"workingDirectory\":"+jsonStr(r.cwd);
    if(!env.empty()){s+=",\"environment\":{";for(size_t i=0;i<env.size();i++)s+=(i?",":"")+jsonStr(env[i].first)+":"+jsonStr(env[i].second);s+="}";}
    if(!in.empty())s+=",\"input\":{\"path\":"+jsonStr(in)+",\"state\":"+infoJson(inBefore)+"}";
    s+=",\"output\":{\"path\":"+jsonStr(out)+",\"before\":"+infoJson(outBefore)+",\"after\":"+infoJson(outAfter)+"}";
    s+=",\"started\":"+std::string(r.started?"true":"false")+",\"startError\":"+jsonStr(r.startError)+",\"exitCode\":"+std::to_string(r.exitCode)+",\"timedOut\":"+(r.timedOut?"true":"false");
    s+=",\"ms\":"+std::to_string((long long)(r.ms+0.5))+",\"stdout\":"+jsonStr(clip(r.out))+",\"stderr\":"+jsonStr(clip(r.err))+",\"expectFailure\":"+(expectFailure?"true":"false")+"}";
    steps.push_back(s);
    if(!expectFailure&&(r.exitCode!=0||!outAfter.exists))
      check(label+": process succeeded and wrote its checkpoint",false,"exit code "+std::to_string(r.exitCode)+(r.timedOut?" (timed out)":"")+(outAfter.exists?"":", output checkpoint missing")+(r.err.empty()?"":"; stderr: "+clip(r.err,600)));
    return r;
  }
  Run ev(const std::string &label,const std::string &state,const std::string &request){
    const std::string q=p("continuation-ev-request.json");FILE *f=std::fopen(q.c_str(),"wb");if(f){std::fputs(request.c_str(),f);std::fclose(f);}
    StateInfo before=inspect(state);Run r=spawn({self,"--ev",spec,state,q},dir,timeoutS);StateInfo after=inspect(state);
    std::string s="{\"label\":"+jsonStr(label)+",\"kind\":\"evaluation\",\"command\":"+jsonStr(r.command)+",\"request\":"+jsonStr(request)+",\"exitCode\":"+std::to_string(r.exitCode)+",\"ms\":"+std::to_string((long long)(r.ms+0.5))+
      ",\"stateBefore\":"+infoJson(before)+",\"stateAfter\":"+infoJson(after)+",\"stdout\":"+jsonStr(clip(r.out,2048))+",\"stderr\":"+jsonStr(clip(r.err))+"}";
    steps.push_back(s);
    check(label+": evaluation succeeded and left the checkpoint unchanged",r.exitCode==0&&before.sha256==after.sha256&&!before.sha256.empty(),
          "exit "+std::to_string(r.exitCode)+", sha before "+before.sha256+", after "+after.sha256+(r.err.empty()?"":"; stderr: "+clip(r.err,600)));
    return r;
  }
  // 4.8: the evaluation requests name range indices of the seat that acts at the root of THIS
  // spec. 4.6/4.7 hard-coded indices of the 4.5 eight-player study (hands [3] and [0]); on a spec
  // whose root actor holds fewer hands (the 4.7 four-player bubble study: 2 hands) the engine
  // correctly refused the request with HTTP 400 and the suite reported 24/25. The actor comes from
  // the engine itself (--node, path []), the range size from the spec's hands[actor]. The preferred
  // index is kept when it is valid (so the 4.5 sequence is unchanged: [3] and [0]); otherwise the
  // last index of the range is used and the substitution is recorded. A spec whose root cannot be
  // queried or whose acting range is empty fails the check - it is never skipped.
  struct RootRange{bool ok=false;int actor=-1;long long size=0;std::string error;};
  RootRange rootRange(const std::string &state){
    RootRange R;const std::string q=p("continuation-node-request.json");
    FILE *f=std::fopen(q.c_str(),"wb");if(!f){R.error="cannot write "+q;return R;}std::fputs("{\"path\":[]}",f);std::fclose(f);
    Run r=spawn({self,"--node",spec,state,q},dir,timeoutS);
    if(r.exitCode!=0){R.error="mwcli --node exit "+std::to_string(r.exitCode)+": "+clip(r.err,400);return R;}
    char e[160];JV *n=json_parse(r.out.data(),r.out.size(),e,sizeof e);
    if(!n){R.error=std::string("--node output is not JSON: ")+e;return R;}
    const JV *node=jget(n,"node");const JV *a=node?jget(node,"actor"):nullptr;const JV *kind=node?jget(node,"kind"):nullptr;
    if(!a||a->type!=J_NUM||!kind||!jstr(kind)||std::strcmp(jstr(kind),"decision")){json_free(n);R.error="the root of the spec is not a decision node";return R;}
    R.actor=(int)a->num;json_free(n);
    std::string text;{FILE *g=std::fopen(spec.c_str(),"rb");if(!g){R.error="cannot read "+spec;return R;}char b[65536];size_t k;while((k=std::fread(b,1,sizeof b,g))>0)text.append(b,k);std::fclose(g);}
    JV *sp=json_parse(text.data(),text.size(),e,sizeof e);if(!sp){R.error=std::string("spec is not JSON: ")+e;return R;}
    const JV *h=jget(sp,"hands");
    if(!h||h->type!=J_ARR||R.actor<0||R.actor>=h->n||h->items[R.actor]->type!=J_ARR){json_free(sp);R.error="spec hands[] has no entry for root actor "+std::to_string(R.actor);return R;}
    R.size=h->items[R.actor]->n;json_free(sp);
    if(R.size<=0){R.error="the root actor's range is empty";return R;}
    R.ok=true;return R;
  }
  std::vector<std::string> handPicks;
  // the request with "hands":[<index>] filled in, or "" (and a failed check) when no valid index exists
  std::string withHand(const std::string &label,const std::string &state,int preferred,const std::string &rest){
    RootRange R=rootRange(state);
    if(!R.ok){check(label+": legal hand index for the root actor",false,R.error);return "";}
    const long long idx=preferred<R.size?preferred:R.size-1;
    handPicks.push_back("{\"label\":"+jsonStr(label)+",\"rootActor\":"+std::to_string(R.actor)+",\"rangeSize\":"+std::to_string(R.size)+",\"preferredIndex\":"+std::to_string(preferred)+",\"usedIndex\":"+std::to_string(idx)+",\"substituted\":"+(idx!=preferred?"true":"false")+"}");
    return "{\"path\":[],\"hands\":["+std::to_string(idx)+"],"+rest+"}";
  }
  Run evAt(const std::string &label,const std::string &state,int preferred,const std::string &rest){
    const std::string req=withHand(label,state,preferred,rest);
    if(req.empty()){Run r;r.exitCode=-1;return r;}
    return ev(label,state,req);
  }
  void check(const std::string &name,bool ok,const std::string &detail=""){
    checks.push_back("{\"name\":"+jsonStr(name)+",\"passed\":"+(ok?"true":"false")+(detail.empty()?"":",\"detail\":"+jsonStr(detail))+"}");
    ok?passedChecks++:failed++;
    std::fprintf(stderr,"%s  %s%s\n",ok?"PASS":"FAIL",name.c_str(),ok||detail.empty()?"":("\n      "+detail).c_str());
  }
  // canonical equivalence: byte-identical files; on a difference say exactly what differs
  void same(const std::string &name,const std::string &a,const std::string &b){
    StateInfo x=inspect(a),y=inspect(b);
    if(!x.exists||!y.exists){check(name,false,std::string(x.exists?"":"missing "+a+" ")+(y.exists?"":"missing "+b));return;}
    std::string d;
    if(x.sha256!=y.sha256){
      for(const char *k:kFields){std::string u=x.field(k),v=y.field(k);if(u!=v)d+=std::string(k)+": "+u+" vs "+v+"; ";}
      if(x.bodySha256!=y.bodySha256)d+="body (betting states, regret and average-strategy rows) differs; ";
      d+="first differing byte "+std::to_string(firstDifference(a,b))+"; sizes "+std::to_string(x.bytes)+" vs "+std::to_string(y.bytes);
    }
    check(name,x.sha256==y.sha256,x.sha256==y.sha256?"sha256 "+x.sha256+", iterations "+x.field("iterations")+", rng "+x.field("rng")+", actionRng "+x.field("actionRng")+", trainingDeals "+x.field("trainingDeals")+", stateVisits "+x.field("stateVisits"):d);
  }
  void segments(const std::string &tag,long long first,long long second,bool evaluate){
    const std::string A=p(tag+"-a.state"),B=p(tag+"-b.state"),R=p(tag+"-direct.state");
    train(tag+": first segment ("+std::to_string(first)+" updates)",first,A);
    if(evaluate)evAt(tag+": deadline-limited sampled evaluation between segments",A,3,"\"range\":true,\"method\":\"sampled\",\"samples\":2000000,\"timeLimitMs\":250,\"threads\":4,\"coverageMiB\":1");
    train(tag+": resumed segment (+"+std::to_string(second)+" updates, new process)",second,B,A);
    train(tag+": uninterrupted reference ("+std::to_string(first+second)+" updates)",first+second,R);
    same(tag+": "+std::to_string(first)+" + "+std::to_string(second)+" resumed updates == "+std::to_string(first+second)+" uninterrupted (byte-identical state: counters, RNG, regrets, averages)",B,R);
  }
  int run(const std::string &level){
    std::error_code ec;std::filesystem::create_directories(dir,ec);
    const auto t0=std::chrono::steady_clock::now();
    // 1. the exact 4.5 failing sequence
    segments("icm45",150,150,true);
    // 2. longer continuations
    segments("c500",500,500,false);
    if(level!="quick")segments("c1000",1000,1000,false);
    // 3. multiple sequential generations with an evaluation in the middle, compared with direct runs
    {
      const long long g=level=="full"?500:250;std::string prev;
      for(int k=1;k<=4;k++){
        const std::string cur=p("gen"+std::to_string(k)+".state");
        train("generation "+std::to_string(k)+" (+"+std::to_string(g)+" updates)",g,cur,prev);
        if(k==2)evAt("generation 2: evaluation before the next generation",cur,0,"\"method\":\"sampled\",\"samples\":3000,\"seed\":7,\"threads\":2");
        prev=cur;
      }
      train("generations: uninterrupted reference ("+std::to_string(4*g)+" updates)",4*g,p("gen-direct.state"));
      same("four sequential generations == one uninterrupted run",p("gen4.state"),p("gen-direct.state"));
      train("generations: uninterrupted reference ("+std::to_string(2*g)+" updates)",2*g,p("gen-direct2.state"));
      same("generation 2 == uninterrupted run of the same length",p("gen2.state"),p("gen-direct2.state"));
    }
    // 4. repeated saves of one state, then restoration: re-saving with 0 updates is the identity
    train("resave 1: restore and save with 0 updates",0,p("resave1.state"),p("icm45-a.state"));
    train("resave 2: restore the re-saved state and save again",0,p("resave2.state"),p("resave1.state"));
    same("re-saving a restored checkpoint (0 updates) reproduces it byte for byte",p("resave1.state"),p("icm45-a.state"));
    same("a second save/restore cycle reproduces it again",p("resave2.state"),p("icm45-a.state"));
    train("resave: continue from the twice re-saved state",150,p("resave-cont.state"),p("resave2.state"));
    same("continuing from a twice re-saved state == uninterrupted",p("resave-cont.state"),p("icm45-direct.state"));
    // 5. thread-count independence of a resumed segment
    train("resumed with 1 worker thread",150,p("t1.state"),p("icm45-a.state"),1);
    train("resumed with 8 worker threads",150,p("t8.state"),p("icm45-a.state"),8);
    same("resumed segment with 1 thread == uninterrupted",p("t1.state"),p("icm45-direct.state"));
    same("resumed segment with 8 threads == uninterrupted",p("t8.state"),p("icm45-direct.state"));
    // 6. interrupted saves: the destination keeps its last committed checkpoint
    for(const char *fault:{"rename","write","crash"}){
      const std::string D=p(std::string("fault-")+fault+".state");
      std::filesystem::copy_file(p("icm45-a.state"),D,std::filesystem::copy_options::overwrite_existing,ec);
      const StateInfo before=inspect(D);
      Run r=train(std::string("interrupted save (")+fault+")",150,D,p("icm45-a.state"),-1,{{"EM_TEST_SAVE_FAULT",fault}},true);
      const StateInfo after=inspect(D);
      size_t leftovers=0;std::vector<std::string> names;
      for(auto &e:std::filesystem::directory_iterator(dir,ec)){std::string n=e.path().filename().string();
        if((n.rfind("EMs",0)==0&&n.size()>4&&n.substr(n.size()-4)==".tmp")||n.rfind(std::string("fault-")+fault+".state.",0)==0){leftovers++;names.push_back(n);}}
      const bool crash=!std::strcmp(fault,"crash");
      check(std::string("interrupted save (")+fault+"): nonzero exit, error names the stage, previous checkpoint intact",
            r.exitCode!=0&&(crash?r.exitCode==86:r.err.find("stage")!=std::string::npos)&&before.sha256==after.sha256&&!after.sha256.empty(),
            "exit "+std::to_string(r.exitCode)+"; stderr: "+clip(r.err,400)+"; sha before "+before.sha256+" after "+after.sha256);
      if(crash){
        check("crash before commit leaves at most one orphaned temporary file (never the destination)",leftovers<=1,std::to_string(leftovers)+" temporary file(s)");
        for(auto &n:names)std::filesystem::remove(p(n),ec);
      }else check(std::string("interrupted save (")+fault+"): no temporary file left behind",leftovers==0,std::to_string(leftovers)+" left");
      train(std::string("continue from the preserved checkpoint after the failed save (")+fault+")",150,p(std::string("after-")+fault+".state"),D);
      same(std::string("continuation after a failed save (")+fault+") == uninterrupted",p(std::string("after-")+fault+".state"),p("icm45-direct.state"));
    }
    // 7. cancellation: committed updates are kept, the update in progress is discarded
    {
      Run r=train("training cancelled after 300 ms (committed updates are saved)",5000000,p("cancel.state"),p("icm45-a.state"),-1,{{"EM_TRAIN_CANCEL_AFTER_MS","300"}});
      StateInfo c=inspect(p("cancel.state"));long long k=c.validHeader?std::atoll(c.field("iterations").c_str()):-1;
      check("cancelled training reports a whole number of committed updates",k>=150&&r.out.find("\"cancelled\":true")!=std::string::npos,"iterations "+std::to_string(k));
      if(k>=150){train("reference: the same number of updates without cancellation",k-150,p("cancel-ref.state"),p("icm45-a.state"));
        same("cancelled run == uninterrupted run with the same committed update count (no partial update kept)",p("cancel.state"),p("cancel-ref.state"));}
    }
    // 8. missing and truncated input checkpoints are refused with a reason and create nothing
    {
      Run r=train("missing input checkpoint",150,p("from-missing.state"),p("does-not-exist.state"),-1,{},true);
      check("missing input checkpoint: nonzero exit, the message names the file, no output written",r.exitCode!=0&&r.err.find("does-not-exist.state")!=std::string::npos&&!inspect(p("from-missing.state")).exists,"exit "+std::to_string(r.exitCode)+"; stderr: "+clip(r.err,400));
      std::filesystem::copy_file(p("icm45-a.state"),p("truncated.state"),std::filesystem::copy_options::overwrite_existing,ec);
      std::filesystem::resize_file(p("truncated.state"),inspect(p("icm45-a.state")).bytes/2,ec);
      Run t=train("truncated input checkpoint",150,p("from-truncated.state"),p("truncated.state"),-1,{},true);
      check("truncated input checkpoint: refused with a reason, no output written",t.exitCode!=0&&!t.err.empty()&&!inspect(p("from-truncated.state")).exists,"exit "+std::to_string(t.exitCode)+"; stderr: "+clip(t.err,400));
    }
    const double secs=std::chrono::duration<double>(std::chrono::steady_clock::now()-t0).count();
    std::string o="{\"tool\":\"mwcli continuation-suite 4.8\",\"build\":\"" EM_BUILD_ID "\",\"level\":"+jsonStr(level)+",\"executable\":"+jsonStr(self)+",\"spec\":"+jsonStr(spec)+",\"workDirectory\":"+jsonStr(dir)+
      ",\"threads\":"+std::to_string(threads)+",\"seconds\":"+std::to_string(secs)+",\"checksPassed\":"+std::to_string(passedChecks)+",\"checksFailed\":"+std::to_string(failed)+",\"passed\":"+(failed?"false":"true")+
      ",\"equivalence\":\"byte-identical EMMW4 state files: header counters (iterations, trainingDeals, stateVisits), both RNG states, row checksum, and the body with every betting state, regret and average-strategy value\",\"checks\":[";
    for(size_t i=0;i<checks.size();i++)o+=(i?",":"")+checks[i];
    o+="],\"evaluationHands\":[";for(size_t i=0;i<handPicks.size();i++)o+=(i?",":"")+handPicks[i];
    o+="],\"steps\":[";for(size_t i=0;i<steps.size();i++)o+=(i?",\n":"")+steps[i];o+="]}";
    FILE *f=std::fopen(p("continuation-suite.json").c_str(),"wb");if(f){std::fputs(o.c_str(),f);std::fclose(f);}
    std::printf("%s\n",o.c_str());
    return failed?1:0;
  }
};
}
