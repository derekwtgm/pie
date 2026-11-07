// Score disjoint ranges of a frozen deal batch before any traversal reads it.
// Calibration includes packing, transfers, synchronization and CPU scoring.
class ScoreSchedule {
  CudaScore device;
  bool attempted=false,available=false;
  struct Trial { int route=0; unsigned remaining=0; };
  std::array<Trial,32> trials{};
  std::vector<unsigned char> cards;
  std::vector<int> scores,reference;
  static double now(){return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count();}
public:
  void run(MW &m,std::vector<DealWork> &work,size_t units){
    auto cpu=[&](size_t from){for(size_t i=from;i<units;i++)m.score(work[i].w);};
    if(m.mode=="cpu"){cpu(0);return;}
    if(!attempted){available=device.open();attempted=true;}
    if(!available){m.route="CPU (CUDA unavailable)";cpu(0);return;}
    const size_t count=units*m.n;
    auto &trial=trials[std::bit_width(count)-1];
    auto evaluate=[&](int route){
      if(!route){cpu(0);return true;}
      // 1 assigns all lanes to CUDA. 2, 3 and 4 try 25%, 50% and 75%.
      const size_t gpuUnits=route==1?units:std::clamp<size_t>((route-1)*units/4,1,units-1);
      if(!gpuUnits)return false;
      int lanes=(int)(gpuUnits*m.n);
      cards.resize((size_t)lanes*7);scores.resize(lanes);
      for(size_t i=0;i<gpuUnits;i++)for(int p=0;p<m.n;p++){
        auto &w=work[i].w; auto &h=m.hands[p][w.seat[p]];
        auto dst=cards.data()+(i*m.n+p)*7;
        std::copy_n(w.cards,5,dst);dst[5]=h.a;dst[6]=h.b;
      }
      if(!device.begin(cards.data(),lanes,m.gpuBudget))return false;
      cpu(gpuUnits);
      if(!device.finish(scores.data(),lanes))return false;
      for(size_t i=0;i<gpuUnits;i++)std::copy_n(scores.data()+i*m.n,m.n,work[i].w.score);
      m.peakGpuBytes=std::max(m.peakGpuBytes,device.allocated());
      return true;
    };
    if(!trial.remaining){
      double t=now();cpu(0);double best=now()-t;int chosen=0;
      reference.resize(count);
      for(size_t i=0;i<units;i++)std::copy_n(work[i].w.score,m.n,reference.data()+i*m.n);
      double hybridBest=1e300;
      for(int route=1;route<=4;route++){
        if((route>=2 && (units<2 || m.mode=="gpu")) || (route==1 && m.mode=="hybrid" && units>=2))continue;
        t=now();bool ok=evaluate(route);double elapsed=now()-t;
        if(ok)for(size_t i=0;i<units;i++)if(!std::equal(work[i].w.score,work[i].w.score+m.n,reference.data()+i*m.n)) {ok=false;break;}
        if(!ok){available=false;m.route="CPU (CUDA validation or allocation failed)";cpu(0);return;}
        if(m.mode=="hybrid" && route>=2){
          if(elapsed<hybridBest){hybridBest=elapsed;chosen=route;}
        }else if(elapsed<best*0.90){best=elapsed;chosen=route;}
      }
      trial.route=chosen;trial.remaining=256;
    }
    --trial.remaining;
    if(!evaluate(trial.route)){available=false;m.route="CPU (CUDA task failed)";cpu(0);return;}
    m.route=trial.route>=2?"Hybrid scoring":trial.route==1?"CUDA scoring":"CPU scoring";
  }
};
