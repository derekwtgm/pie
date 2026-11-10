// Read-only EMMW4 oracle. Replay the actual betting rules; verify row identities
// with an external merge sort, so validation never constructs a second strategy.
#include <filesystem>
#include "num_safe.h"
#include <stdexcept>
namespace cp36 {
struct Reject { int status; const char *message; };
static void require(bool ok,const char *message){if(!ok)throw Reject{400,message};}
static void io(bool ok){if(!ok)throw Reject{errno==ENOSPC?507:500,"Checkpoint verification file I/O failed"};}
static void seek(FILE *f,uint64_t p){
#ifdef _WIN32
  io(_fseeki64(f,(int64_t)p,SEEK_SET)==0);
#else
  io(fseeko(f,(off_t)p,SEEK_SET)==0);
#endif
}
struct Reader {
  FILE *f;uint64_t total,pos=0;uint32_t crc=~0u;bool hashing=false;
  static const auto &crcTable(){static const auto tab=[](){std::array<uint32_t,256>a{};for(unsigned i=0;i<256;i++){unsigned v=i;for(int j=0;j<8;j++)v=(v>>1)^((v&1)?0xedb88320u:0);a[i]=v;}return a;}();return tab;}
  void take(void *dst,size_t n){require(n<=total-pos,"Truncated native checkpoint");io(fread(dst,1,n,f)==n);pos+=n;
    if(hashing){auto bytes=(const uint8_t*)dst;const auto &tab=crcTable();for(size_t i=0;i<n;i++)crc=tab[(crc^bytes[i])&255]^(crc>>8);}}
  template<typename T>T get(){T t;take(&t,sizeof t);return t;}
};
using File=std::unique_ptr<FILE,decltype(&fclose)>;
struct Run {
  int (*space)(uint64_t);size_t room=0;std::filesystem::path path; File file{nullptr,fclose};
  Run(const char *dir,int serial,int(*check)(uint64_t)):space(check),path(std::filesystem::path(dir)/("autosave.verify.sort."+std::to_string(serial))){
    std::error_code ec;std::filesystem::remove(path,ec);file.reset(fopen(path.string().c_str(),"w+b"));io(bool(file));}
  ~Run(){file.reset();std::error_code ec;std::filesystem::remove(path,ec);}
  void put(const std::string &s){if(room<s.size()+2){room=1u<<20;if(!space(room))throw Reject{507,"Insufficient disk reserve for uniqueness checks"};}room-=s.size()+2;auto n=(uint16_t)s.size();io(fwrite(&n,2,1,file.get())==1&&fwrite(s.data(),1,n,file.get())==n);}
  bool next(std::string &s){uint16_t n;if(fread(&n,2,1,file.get())!=1){io(feof(file.get())&&!ferror(file.get()));return false;}
    require(n>0&&n<=1032,"Invalid temporary key");s.resize(n);io(fread(s.data(),1,n,file.get())==n);return true;}
  void start(){io(fflush(file.get())==0);seek(file.get(),0);}
};
// One run per occupied binary level. Memory and simultaneously open handles
// are bounded independently of row count.
struct Unique {
  const char *dir;int (*stop)();int (*space)(uint64_t);int serial=0;size_t cost=0;std::vector<std::string> chunk;
  std::vector<std::unique_ptr<Run>> levels;
  Unique(const char *d,int(*s)(),int(*check)(uint64_t)):dir(d),stop(s),space(check){}
  std::unique_ptr<Run> merge(Run &a,Run &b){
    auto out=std::make_unique<Run>(dir,serial++,space);a.start();b.start();std::string x,y;
    bool ax=a.next(x),by=b.next(y);unsigned tick=0;
    while(ax||by){if((++tick&8191)==0&&stop())throw Reject{409,"Verification cancelled"};
      require(!ax||!by||x!=y,"Duplicate strategy row or betting edge");
      if(ax&&(!by||x<y)){out->put(x);ax=a.next(x);}else{out->put(y);by=b.next(y);}}
    return out;
  }
  void flush(){
    if(chunk.empty())return;std::sort(chunk.begin(),chunk.end());
    require(std::adjacent_find(chunk.begin(),chunk.end())==chunk.end(),"Duplicate strategy row or betting edge");
    auto current=std::make_unique<Run>(dir,serial++,space);for(auto &s:chunk)current->put(s);chunk.clear();cost=0;
    size_t i=0;while(i<levels.size()&&levels[i]){current=merge(*current,*levels[i]);levels[i++].reset();}
    if(i==levels.size())levels.emplace_back();levels[i]=std::move(current);
  }
  void add(char kind,uint32_t state,const void *key,size_t n){
    std::string s(1,kind);s.append((const char*)&state,4);s.append((const char*)key,n);
    cost+=sizeof(std::string)+s.size()+32;chunk.push_back(std::move(s));if(cost>=2u<<20)flush();
  }
  void finish(){flush();std::unique_ptr<Run> acc;for(auto &r:levels)if(r){if(!acc)acc=std::move(r);else{acc=merge(*acc,*r);r.reset();}}}
};
struct Stub {uint32_t parent;uint8_t slot,kind,actor,length,k;};
struct States {
  Reader &r;const MW &m;uint64_t offset;uint32_t count;bool materialized;
  struct Page{uint32_t id=UINT32_MAX;unsigned char bytes[256*9];};
  std::array<Page,32> pages{};
  struct Cache{uint32_t id=UINT32_MAX;es::BS value{};};std::array<Cache,256> cache{};
  static Stub unpack(const unsigned char *bytes){
    uint32_t parent;memcpy(&parent,bytes,sizeof parent);
    return {parent,bytes[4],bytes[5],bytes[6],bytes[7],bytes[8]};
  }
  Stub entry(uint32_t i){
    require(i<count,"Invalid state index");
    if(materialized){
      const auto &states=m.es->states;
      require(i<states.parent.size(),"Missing betting parent");
      return {states.parent[i],states.slot[i],states.kind[i],states.actor[i],states.length[i],states.k[i]};
    }
    uint32_t page=i/256;auto &p=pages[page%pages.size()];
    if(p.id!=page){seek(r.f,offset+uint64_t(page)*256*9);size_t n=std::min<uint32_t>(count-page*256,256)*9;
      io(fread(p.bytes,1,n,r.f)==n);seek(r.f,r.pos);p.id=page;}
    return unpack(p.bytes+(i%256)*9);}
  es::BS replay(uint32_t i){
    uint8_t actions[es::MAX_DEPTH+1];size_t depth=0;uint32_t j=i;
    while(j&&cache[j%cache.size()].id!=j){require(depth<es::MAX_DEPTH,"Betting path too deep");auto s=entry(j);
      require(s.parent<j&&s.slot<=7,"Invalid betting state");actions[depth++]=s.slot;j=s.parent;}
    es::BS bs=j?cache[j%cache.size()].value:m.es->rootState;
    while(depth){unsigned a=actions[--depth];es::BS next{};
      if(a==7){require(bs.kind==1,"Chance edge does not match betting rules");m.es->rules.nextStreet(bs,next);}
      else{require(bs.kind==0&&a<(unsigned)bs.k,"Action does not match betting rules");m.es->rules.advance(bs,(int)a,next);}bs=next;}
    cache[i%cache.size()]={i,bs};return bs;
  }
};
static void verify(Reader &r,MW &m,int iterations,const char *dir,int(*stop)(),int(*space)(uint64_t),bool load=false,void(*progress)(uint64_t,uint64_t)=nullptr){
  auto &g=*m.es;char magic[8];r.take(magic,8);require(!memcmp(magic,"EMMW4\0\0\0",8),"Invalid native magic");
  uint32_t len=r.get<uint32_t>();require(len>0&&len<=4096,"Invalid native header size");
  std::string header(len,'\0');r.take(header.data(),len);char err[256];std::unique_ptr<JV,decltype(&json_free)> h(json_parse(header.data(),len,err,sizeof err),json_free);
  require(bool(h),"Invalid native header");auto get=[&](const char *k){return jget(h.get(),k);};
  // 4.1: checked conversion; 4.0 compared with double(max), which rounds UINT64_MAX up to 2^64.
  auto integer=[&](const char *k,uint64_t max){const JV *v=get(k);unsigned long long x=0;require(em_jv_u64(v,0,max,&x)==EM_NUM_OK,"Invalid native counter");return(uint64_t)x;};
  auto flag=[&](const char *k,bool want){require(want?get(k)&&isInt(get(k))&&get(k)->num==1:!get(k),"Invalid native row format or weighting");};
  require(integer("protocol",1)==1&&integer("specProtocol",4)==4&&jstr(get("studyId"))&&m.studyId==jstr(get("studyId")),"State belongs to a different study");
  const auto updates=integer("iterations",10000000),deals=integer("trainingDeals",9007199254740991ULL);
  require((iterations<0||updates==(unsigned)iterations)&&deals==updates*m.batchDeals,"Inconsistent committed deal count or update count");
  const auto rng=integer("rng",UINT32_MAX),actionRng=integer("actionRng",UINT32_MAX),visits=integer("stateVisits",9007199254740991ULL);
  auto checkpoint=[&](){
    if(stop())throw Reject{409,"Checkpoint restoration cancelled"};
    if(progress)progress(r.pos,r.total);
  };
  auto budget=[](bool ok){if(!ok)throw Reject{503,"Native checkpoint exceeds the available solver RAM budget"};};
  flag("rowSync",g.dcfr);flag("rowKeys",g.groups.on);const char *crc=jstr(get("rowCrc32"));require(crc&&strlen(crc)==8,"Invalid native checksum");
  r.hashing=true;uint32_t sc=r.get<uint32_t>();require(sc&&sc<(1u<<27)&&sc<=(r.total-r.pos)/9,"Invalid state count");
  if(load){   // 3.8: the betting-state table alone (rows are checked once their count is read)
    const auto est=es::restoreEstimate(sc,0,0,1,0);const double need=est.states+est.stateHash;
    if(m.bytes+need>m.budgetBytes){static thread_local char text[256];snprintf(text,sizeof text,"Restoring this study needs at least %.0f MiB for its %u betting states alone; %.0f MiB is available. Close other programs or raise EIGHTMAX_RESTORE_MIB / EIGHTMAX_PROCESS_MIB.",need/1048576.0,sc,(m.budgetBytes-m.bytes)/1048576.0);throw Reject{503,text};}
  }
  States states{r,m,r.pos,sc,load};Unique keys(dir,stop,space);
  for(uint32_t i=0;i<sc;i++){if(!(i%8192))checkpoint();
    unsigned char raw[9];r.take(raw,9);auto s=States::unpack(raw);
    require(i?s.parent<i&&s.slot<=7:s.parent==UINT32_MAX,"Invalid betting parent");
    if(i){
      if(load){
        require(g.states.find(s.parent,s.slot)<0,"Duplicate betting edge");
        budget(g.states.add(s.parent,s.slot,s.kind,s.actor,s.length,s.k,m.bytes,m.budgetBytes)==(int)i);
      }else keys.add('s',s.parent,&s.slot,1);
    }
    auto b=states.replay(i);require(b.kind!=2&&s.kind==b.kind&&s.length==b.length&&
      (b.kind!=0||(s.actor==b.actor&&s.k==b.k)),"State disagrees with betting rules");
  }
  uint32_t rows=r.get<uint32_t>();require(rows<=(r.total-r.pos)/40,"Invalid row count");
  if(load&&!g.groups.on){
    // 3.8: estimate every live structure of the restored study before the
    // large allocations, and refuse with the numbers when it cannot fit.
    const uint64_t fixed=uint64_t(rows)*(12+(g.dcfr?4:0));
    if(fixed<=r.total-r.pos){
      auto est=es::restoreEstimate(sc,rows,(r.total-r.pos-fixed)/8,m.batchDeals,(double)sizeof(MW::RowMeta));
      m.restoreEstimate=est;
      if(est.total>m.budgetBytes-m.bytes+est.states+est.stateHash){
        static thread_local char text[320];snprintf(text,sizeof text,"Restoring this study needs an estimated %.0f MiB of solver tables (%.0f MiB values, %.0f MiB row index, %.0f MiB betting states); %.0f MiB is available. Close other programs or raise EIGHTMAX_RESTORE_MIB / EIGHTMAX_PROCESS_MIB.",
          est.total/1048576.0,est.values/1048576.0,(est.rowMeta+est.rowHash)/1048576.0,(est.states+est.stateHash)/1048576.0,(m.budgetBytes-m.bytes+est.states+est.stateHash)/1048576.0);
        throw Reject{503,text};
      }
    }
  }
  if(load){
    // Reserve exact physical value counts once. The PMR arena charges allocations
    // before they happen and also charges the eventual scratch for frozen batches.
    const uint64_t fixed=uint64_t(rows)*(12+(g.dcfr?4:0));
    if(!g.groups.on){
      require(fixed<=r.total-r.pos&&(r.total-r.pos-fixed)%8==0,"Truncated or invalid native row lengths");
      size_t values=(size_t)((r.total-r.pos-fixed)/8);
      require(values>=4ULL*rows && values<=14ULL*rows,"Truncated or invalid native value count");
      budget(values*8.0*(m.batchDeals>1?2:1)+rows*(double)sizeof(MW::RowMeta)<=m.budgetBytes-m.bytes);
      // Leave limited capacity for the next committed batch without forcing
      // three multi-gigabyte vector reallocations immediately after recovery.
      size_t headroom=std::min<size_t>(values/256+16,131072);
      if((values+headroom)*8.0*(m.batchDeals>1?2:1)+rows*(double)sizeof(MW::RowMeta)>m.budgetBytes-m.bytes)headroom=0;
      m.vals.reserve(values+headroom);if(m.batchDeals>1)m.delta.reserve(values+headroom);
    }
    size_t buckets=1024;
    while(buckets<2ULL*(rows+1ULL))buckets*=2;
    if(buckets>m.hkeys.size()){
      const size_t added=(buckets-m.hkeys.size())*12;
      budget(!m.hcount&&m.bytes+added<=m.budgetBytes);
      m.hkeys.assign(buckets,-1);m.hrow.resize(buckets);m.bytes+=added;
    }
    m.rows.reserve((size_t)rows+std::min<size_t>(rows/256+4,16384));
  }
  int board[5];std::copy_n(m.board,5,board);std::sort(board,board+std::min(3,m.startLen));
  for(uint32_t i=0;i<rows;i++){
    if(!(i%8192))checkpoint();
    uint32_t id=r.get<uint32_t>();require(id<sc,"Invalid strategy state");
    auto t=load?Stub{g.states.parent[id],g.states.slot[id],g.states.kind[id],g.states.actor[id],g.states.length[id],g.states.k[id]}:states.entry(id);
    uint16_t index=r.get<uint16_t>();
    require(t.kind==0&&t.actor<m.n&&t.k>=2&&t.k<=7,"Invalid strategy state");
    uint64_t identity=0;
    if(g.groups.on){uint64_t numeric=0;require(index&&index<=1024,"Invalid grouped key length");char key[1024];r.take(key,index);
      if(g.groups.detailed){int slash=0,street=-1;for(int j=0;j<g.groups.nl;j++)if(g.groups.lengths[j]==t.length)street=j;
        for(int j=0;j<index;j++){char c=key[j];if(c=='/')slash++;else require((c>='0'&&c<='9')||(c>='a'&&c<='z')||c==':'||c=='.'||c==',',"Invalid detailed key");}
        require(index>=2&&key[0]=='0'&&key[1]=='/'&&slash==street+1,"Invalid grouped key depth");}
      else{uint64_t v=0;require(index<=16&&(index==1||key[0]!='0'),"Invalid compact key");
        for(int j=0;j<index;j++){require(key[j]>='0'&&key[j]<='9',"Invalid compact key");v=10*v+key[j]-'0';}require(v<=9007199254740991ULL,"Unsafe compact key");numeric=v;}
      if(load){
        uint32_t group=g.groups.intern(std::string(key,index),numeric,m.bytes,m.budgetBytes);
        budget(group!=UINT32_MAX);identity=es::rowKey(id,0,group);
      }else keys.add('r',id,key,index);
    }else{unsigned char cards[5];r.take(cards,5);require(index<m.hands[t.actor].size(),"Invalid hand index");auto &hand=m.hands[t.actor][index];
      uint64_t seen=(1ULL<<hand.a)|(1ULL<<hand.b);require(hand.strategyHand==index,"Noncanonical grouped hand");
      for(int j=0;j<5;j++){int c=cards[j]-1;require(j<t.length?c>=0&&c<52:c==-1,"Invalid public card count");
        if(c>=0){require(!(seen>>c&1),"Blocked or duplicate public card");seen|=1ULL<<c;}
        if(j<m.startLen)require(c==board[j],"Board does not match study");}
      require(t.length<3||(cards[0]<cards[1]&&cards[1]<cards[2]),"Flop is not canonical");
      if(!m.turnGroups.empty()){int slot=t.length==5?cards[4]:0;require(m.turnGroups[t.actor][slot*m.hands[t.actor].size()+index]==slot*2048+index,"Noncanonical turn group");}
      unsigned char key[7];memcpy(key,&index,2);memcpy(key+2,cards,5);
      if(load){
        int publicCards[5];for(int j=0;j<5;j++)publicCards[j]=(int)cards[j]-1;
        identity=es::rowKey(id,index,es::cardsCode(publicCards,t.length));
      }else keys.add('r',id,key,7);}
    uint8_t k=r.get<uint8_t>();require(k==t.k,"Action count mismatch");
    double v[14];r.take(v,16*k);for(int j=0;j<2*k;j++)require(std::isfinite(v[j])&&(j<k||v[j]>=0),"Invalid regret or average value");
    uint32_t sync=g.dcfr?r.get<uint32_t>():0;
    require(sync<=updates,"Invalid discount counter");
    if(load){
      auto row=m.getOrCreate(identity,(int)id,k);budget(row>=0);
      auto &record=m.rows[(size_t)row];
      require(!record.visited,"Duplicate strategy row");
      record.visited=1;record.sync=sync;memcpy(m.vals.data()+record.off,v,16*k);
    }
  }
  char actual[9];snprintf(actual,sizeof actual,"%08x",~r.crc);
  require(r.pos==r.total&&!strcmp(actual,crc),"Native row checksum or length mismatch");if(!load)keys.finish();
  checkpoint();
  if(load){
    m.iterations=updates;m.trainingDeals=deals;m.stateVisits=visits;
    m.rng.state=(uint32_t)rng;g.actionRng.state=(uint32_t)actionRng;m.limitReached=false;
  }
}
}
extern "C" int mw_verify_stream(FILE *f,uint64_t size,const char *spec,int it,const char *dir,char *err,int cap,int(*stop)(),int(*space)(uint64_t)){
  try{std::unique_ptr<MW,decltype(&mw_free)> m(mw_create(spec,strlen(spec),64,err,cap),mw_free);
    if(!m||!m->es)return 400;cp36::Reader reader{f,size};cp36::verify(reader,*m,it,dir,stop,space);return 200;
  }catch(const cp36::Reject &e){snprintf(err,cap,"%s",e.message);return e.status;}
  catch(const std::bad_alloc &){snprintf(err,cap,"Verification workspace exhausted");return 503;}
  catch(const std::exception &){snprintf(err,cap,"Checkpoint scratch file failed");return 500;}
}

extern "C" int mw_load_stream(FILE *file,uint64_t size,const char *spec,double budgetMiB,
                              int expected,MW **out,char *err,int cap,int(*stop)(),
                              void(*progress)(uint64_t,uint64_t)){
  *out=nullptr;
  try{
    std::unique_ptr<MW,decltype(&mw_free)> candidate(mw_create(spec,strlen(spec),budgetMiB,err,cap),mw_free);
    if(!candidate)return 400;
    if(!candidate->es){snprintf(err,cap,"Native streaming requires an external-sampling study");return 422;}
    cp36::Reader reader{file,size};
    cp36::verify(reader,*candidate,expected,"",stop?stop:+[](){return 0;},nullptr,true,progress);
    *out=candidate.release();return 200;
  }catch(const cp36::Reject &e){snprintf(err,cap,"%s",e.message);return e.status;}
  catch(const std::bad_alloc &){snprintf(err,cap,"Native checkpoint exceeds the available solver RAM budget");return 503;}
  catch(const std::exception &){snprintf(err,cap,"Native checkpoint reconstruction failed");return 500;}
}
