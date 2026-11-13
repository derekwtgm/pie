// Score disjoint ranges of a frozen deal batch before any traversal reads it.
// Calibration includes packing, transfers, synchronization and CPU scoring.
class ScoreSchedule {
  CudaScore device;
  bool attempted=false,available=false;
  struct Trial { int route=0; unsigned remaining=0; size_t units=0; };
  std::array<Trial,32> trials{};
  std::vector<unsigned char> cards;
  std::vector<int> scores,reference;
  static double now(){return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count();}
public:
  template<class Work> void run(MW &m,std::vector<Work> &work,size_t units){
    auto cpu=[&](size_t from){for(size_t i=from;i<units;i++)m.score(work[i].w);};
    if(m.mode=="cpu"){cpu(0);return;}
    // River starts read precomputed per-hand scores; sending them to a GPU would
    // only add transfers (3.0 did this in GPU, Hybrid and Automatic modes).
    if(m.startLen==5){m.route="CPU (river hand scores are precomputed; GPU not needed)";cpu(0);return;}
    if(m.cpuScoreReuse && m.cpuScoreUnits==units){
      --m.cpuScoreReuse;m.route="CPU scoring (measured faster than CUDA for this batch size, cached)";cpu(0);return;
    }
    // 4.9: Automatic does not open CUDA for a job whose whole scoring work is too small for any
    // device to repay the context creation and calibration (about 0.1 s on an RTX 4060 Ti in the 4.8
    // field report: 2,400 deals took 168 ms in Automatic vs 64 ms CPU Only, same strategy bytes).
    // The first batch is scored on the CPU and timed; projected = that time x the batches this
    // training call will run. Below EM_AUTO_MIN_SCORE_SECONDS (default 0.5 s) the call stays on the
    // CPU without touching the driver. GPU Preferred and Hybrid are explicit requests and keep their
    // 4.8 behaviour (open, calibrate, fall back to the CPU when it measures faster). The CPU path
    // computes the same scores, so results are identical in every mode.
    if(!attempted && m.mode=="auto" && m.plannedUpdates>0){
      static const double minSeconds=[]{const char *e=std::getenv("EM_AUTO_MIN_SCORE_SECONDS");const double v=e?std::atof(e):0.5;return v>=0?v:0.5;}();
      const double t=now();cpu(0);const double one=now()-t;
      const double projected=one*(double)m.plannedUpdates;m.autoProjectedScoreSeconds=projected;
      if(projected<minSeconds){attempted=true;available=false;m.autoDeviceSkipped=true;
        char b[200];std::snprintf(b,sizeof b,"CPU scoring (Automatic: projected scoring work %.3f s is below %.2f s, CUDA not opened)",projected,minSeconds);m.route=b;return;}
      // large enough: continue to the measured calibration below, rescoring this batch (scores are deterministic)
    }
    if(!attempted){available=device.open();attempted=true;m.cuda=device.info;}
    if(!available){if(m.autoDeviceSkipped){cpu(0);return;}if(!device.info.available)m.route="CPU (CUDA unavailable: "+device.info.reason+")";cpu(0);return;}
    const size_t count=units*m.n;
    auto &trial=trials[std::bit_width(count)-1];
    auto evaluate=[&](int route){
      if(!route){cpu(0);return true;}
      // 1 assigns all lanes to CUDA. 2, 3 and 4 try 25%, 50% and 75%.
      const size_t gpuUnits=route==1?units:std::clamp<size_t>((route-1)*units/4,1,units-1);
      if(!gpuUnits)return false;
      int lanes=(int)(gpuUnits*m.n);
      const bool packed=device.packedDeals();
      const size_t stride=packed?5+2*m.n:7*m.n;
      cards.resize(gpuUnits*stride);scores.resize(lanes);
      for(size_t i=0;i<gpuUnits;i++){
        auto &w=work[i].w;auto dst=cards.data()+i*stride;
        if(packed)std::copy_n(w.cards,5,dst);
        for(int p=0;p<m.n;p++){const auto &h=m.hands[p][w.seat[p]];
          if(packed){dst[5+2*p]=h.a;dst[6+2*p]=h.b;}
          else{std::copy_n(w.cards,5,dst+7*p);dst[7*p+5]=h.a;dst[7*p+6]=h.b;}}
      }
      if(!device.begin(cards.data(),lanes,m.gpuBudget,packed?m.n:0))return false;
      cpu(gpuUnits);
      if(!device.finish(scores.data(),lanes))return false;
      for(size_t i=0;i<gpuUnits;i++)std::copy_n(scores.data()+i*m.n,m.n,work[i].w.score);
      m.peakGpuBytes=std::max(m.peakGpuBytes,device.allocated());
      return true;
    };
    bool calibrated=!trial.remaining || trial.units!=units;
    if(calibrated){
      const double started=now();double t=started;cpu(0);double best=now()-t,deviceBest=INFINITY;int chosen=0;
      reference.resize(count);
      for(size_t i=0;i<units;i++)std::copy_n(work[i].w.score,m.n,reference.data()+i*m.n);
      size_t previousSplit=0;const double cpuSeconds=best;
      for(int route=1;route<=4;route++){
        if((route>=2 && (units<2 || m.mode=="gpu")) || (route==1 && m.mode=="hybrid" && units>=2))continue;
        if(route>=2){
          size_t split=std::clamp<size_t>((route-1)*units/4,1,units-1);
          if(split==previousSplit)continue;
          previousSplit=split;
        }
        t=now();bool ok=evaluate(route);double elapsed=now()-t;
        if(ok)deviceBest=std::min(deviceBest,elapsed);
        if(ok)for(size_t i=0;i<units;i++)if(!std::equal(work[i].w.score,work[i].w.score+m.n,reference.data()+i*m.n)) {ok=false;break;}
        if(!ok){available=false;device.releaseBuffers();m.route="CPU (CUDA validation, allocation or VRAM reserve check failed)";cpu(0);return;}
        // Calibrate the complete scoring stage, including copies and synchronization.
        if(elapsed<best && elapsed<cpuSeconds*0.90){best=elapsed;chosen=route;}
      }
      m.scoreCalibrationSeconds+=now()-started;m.scoreCalibrations++;
      m.cpuScoreProbeSeconds=cpuSeconds;m.bestDeviceScoreSeconds=std::isfinite(deviceBest)?deviceBest:0;
      if(!chosen){m.cpuScoreUnits=units;m.cpuScoreReuse=255;}
      trial.route=chosen;trial.remaining=chosen?256:1;trial.units=units;
    }
    --trial.remaining;
    // All calibration outputs matched the CPU reference for this same batch.
    if(!calibrated && !evaluate(trial.route)){available=false;device.releaseBuffers();m.route="CPU (CUDA task failed; batch rescored on CPU)";cpu(0);return;}
    m.route=trial.route>=2?"Hybrid scoring":trial.route==1?"CUDA scoring":"CPU scoring (measured faster than CUDA for this batch size)";
  }
};
