// 5.0: per-call scheduling state for BOTH training paths (mw_train: sampled deals with simultaneous,
// alternating or enumerated updates; es::train: external sampling). Called once at the start of every
// training call, so a resumed call, a later short call on the same engine or a call after a long one
// starts from clean per-call diagnostics. plannedUpdates = the updates THIS call will run (a resumed
// call counts only its own work; a call cut short by memory pressure was planned with its request).
inline double autoMinScoreSeconds(){static const double v=[]{const char *e=std::getenv("EM_AUTO_MIN_SCORE_SECONDS");const double x=e?std::atof(e):0.5;return x>=0?x:0.5;}();return v;}
// 5.1: EM_ROUTE_REUSE=0 restores the 5.0 rule (a measurement is reused only for the identical batch size).
inline bool routeReuseEnabled(){static const bool v=[]{const char *e=std::getenv("EM_ROUTE_REUSE");return !(e&&*e=='0');}();return v;}
// Test-only cost control for route-selection tests (0 = off): busy-wait this many nanoseconds per
// scored unit on the CPU, so a test double can make a device route profitable or not on purpose.
inline long long testCpuScoreDelayNs(){static const long long v=[]{const char *e=std::getenv("EM_TEST_CPU_SCORE_NS");return e?std::atoll(e):0LL;}();return v;}
// Test-only per-batch trace (EM_TEST_ROUTE_TRACE=<file>): one line per scored batch: units, route used
// (0 CPU, 1 CUDA, 2-4 hybrid splits), whether it was measured, and the measured CPU / device seconds.
inline FILE *routeTrace(){static FILE *f=[]{const char *e=std::getenv("EM_TEST_ROUTE_TRACE");return e&&*e?std::fopen(e,"a"):nullptr;}();return f;}
inline void traceRoute(size_t units,int route,bool measured,double cpu,double dev){if(FILE *f=routeTrace()){std::fprintf(f,"%zu %d %d %.7f %.7f\n",units,route,measured?1:0,cpu,dev);std::fflush(f);}}
inline void beginScoringCall(MW &m,long long iterations,const char *path){
  m.plannedUpdates=iterations;m.autoDeviceSkipped=false;m.autoProjectedScoreSeconds=-1;m.trainingPath=path;
  m.autoThresholdSeconds=autoMinScoreSeconds();m.callCalibrations=0;m.callCalibrationSeconds=0;m.callGpuPeakBytes=0;m.callCudaOpened=false;
  m.callCalibrationReuses=0;m.callBatchesScored=0;m.callUnitsMin=0;m.callUnitsMax=0;m.callDriverInitSeconds=-1;m.callScoreSeconds=0;m.callDeviceSeconds=0;m.callRecalibrationReasons.clear();
  m.scheduleDecision=m.mode=="cpu"?"CPU Only requested":"not decided (no batch scored by the scheduler)";m.scheduleReason="";
}
inline void schedulingJson(JB *out,const MW &m){
  jb_puts(out,",\"scheduling\":{\"trainingPath\":");jb_str(out,m.trainingPath.c_str());
  jb_printf(out,",\"requestedDevice\":\"%s\",\"plannedUpdates\":%lld,\"projectedCpuScoreSeconds\":%.6f,\"thresholdSeconds\":%.6f,\"automaticSkippedCuda\":%s,\"cudaOpenedThisCall\":%s,\"calibrationsThisCall\":%u,\"calibrationSecondsThisCall\":%.7f,\"gpuBufferPeakBytesThisCall\":%zu,\"decision\":",
    m.mode.c_str(),m.plannedUpdates,m.autoProjectedScoreSeconds,m.autoThresholdSeconds,m.autoDeviceSkipped?"true":"false",m.callCudaOpened?"true":"false",m.callCalibrations,m.callCalibrationSeconds,m.callGpuPeakBytes);
  jb_str(out,m.scheduleDecision.c_str());jb_puts(out,",\"reason\":");jb_str(out,m.scheduleReason.c_str());
  // 5.1: measurement reuse and a time breakdown of the scoring stage (traversal = training time - scoring)
  jb_printf(out,",\"batchesScored\":%u,\"batchUnitsMin\":%zu,\"batchUnitsMax\":%zu,\"calibrationReusesThisCall\":%u,\"driverInitSecondsThisCall\":%.7f,\"scoringSecondsThisCall\":%.7f,\"deviceTransferAndKernelSecondsThisCall\":%.7f,\"routeMeasurementsHeld\":%zu,\"routeReuseRule\":\"%s\",\"recalibrationReasons\":{",
    m.callBatchesScored,m.callUnitsMin,m.callUnitsMax,m.callCalibrationReuses,m.callDriverInitSeconds,m.callScoreSeconds,m.callDeviceSeconds,m.routeMeasures.size(),routeReuseEnabled()?"5.1 nearby batch sizes":"5.0 exact batch size");
  bool first=true;for(auto &[k,v]:m.callRecalibrationReasons){if(!first)jb_putc(out,',');first=false;jb_str(out,k.c_str());jb_printf(out,":%u",v);}
  jb_puts(out,"}}");
}
#include "route_reuse.hpp"
// Score disjoint ranges of a frozen deal batch before any traversal reads it.
// Calibration includes packing, transfers, synchronization and CPU scoring.
//
// 5.1 measurement reuse. Enumerated and short final batches vary in size from batch to batch; 5.0
// re-measured every new size (96 calibrations for the 100-update turn of "Compare processing modes").
// A measurement of batch size u0 gives the CPU time c*u0 and the best device-route time D(u0). For
// an affine device cost D(u)=a+b*u (fixed launch/transfer overhead a>=0, per-unit cost b>=0) and a
// linear CPU cost, the ratio rho(u)=D(u)/(c*u) can only fall as u grows and only rise as u shrinks,
// and rho(u) >= rho(u0)*u0/u for u>u0, rho(u) <= rho(u0)*u0/u for u<u0. Hence:
//   CPU chosen (rho0 >= 0.9):   still correct for every u <= u0 and, with a safety factor S=1.5,
//                               for u <= u0*rho0/(0.9*S); window capped to [u0/4, 4*u0].
//   device chosen (rho0 < 0.9): still correct for u >= u0 and for u >= u0*rho0*S/0.9;
//                               window capped to [u0/4, 2*u0] (device memory grows with u).
// A measurement near the crossover therefore covers almost only its own side, and a batch outside
// every window is measured again (reason "no measurement covers ..."). Measurements expire after 256
// uses, are keyed by device mode and GPU memory budget, and a device route that fails is discarded
// together with CUDA for the rest of the call, exactly as in 5.0. Scores are identical on every
// route, so reuse never changes strategy bytes, RNG or counters.
class ScoreSchedule {
  CudaScore device;
  bool attempted=false,available=false;
  std::vector<unsigned char> cards;
  std::vector<int> scores,reference;
  static constexpr double crossover=0.90,safety=1.5;
  static double now(){return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count();}
  static void spin(long long ns){if(ns<=0)return;const auto end=std::chrono::steady_clock::now()+std::chrono::nanoseconds(ns);while(std::chrono::steady_clock::now()<end){}}
  static bool covers(const MW::RouteMeasure &r,size_t u){return routeMeasureCovers(r.route,r.units,r.cpuSeconds,r.deviceSeconds,u,routeReuseEnabled());}
  MW::RouteMeasure *find(MW &m,size_t units,std::string &why){
    MW::RouteMeasure *best=nullptr;size_t nearest=0;
    for(auto &r:m.routeMeasures){
      if(r.mode!=m.mode||r.budget!=m.gpuBudget)continue;
      if(!nearest||(r.units>units?r.units-units:units-r.units)<(nearest>units?nearest-units:units-nearest))nearest=r.units;
      if(!covers(r,units))continue;
      if(r.uses>=256){why="measurement expired after 256 uses";continue;}
      if(!best||(r.units>units?r.units-units:units-r.units)<(best->units>units?best->units-units:units-best->units))best=&r;
    }
    if(!best&&why.empty())why=nearest?"no measurement covers this batch size (outside the reuse window)":"first measurement in this job";
    return best;
  }
  void remember(MW &m,const MW::RouteMeasure &x){
    for(auto &r:m.routeMeasures)if(r.mode==x.mode&&r.budget==x.budget&&r.units==x.units){r=x;return;}
    if(m.routeMeasures.size()>=16)m.routeMeasures.erase(m.routeMeasures.begin());
    m.routeMeasures.push_back(x);
  }
public:
  template<class Work> void run(MW &m,std::vector<Work> &work,size_t units){
    const double runStarted=now();m.callBatchesScored++;
    m.callUnitsMin=m.callUnitsMin?std::min(m.callUnitsMin,units):units;m.callUnitsMax=std::max(m.callUnitsMax,units);
    struct Clock{MW &m;double t;~Clock(){m.callScoreSeconds+=now()-t;}} clock{m,runStarted};
    const long long delay=testCpuScoreDelayNs();
    auto cpu=[&](size_t from){for(size_t i=from;i<units;i++){m.score(work[i].w);if(delay)spin(delay);}};
    if(m.mode=="cpu"){cpu(0);return;}
    // River starts read precomputed per-hand scores; sending them to a GPU would
    // only add transfers (3.0 did this in GPU, Hybrid and Automatic modes).
    if(m.startLen==5){m.route="CPU (river hand scores are precomputed; GPU not needed)";m.scheduleDecision="CPU";m.scheduleReason="river start: hand scores are precomputed";cpu(0);return;}
    // A CPU measurement already held by this engine (an earlier call) covers this batch: stay on the
    // CPU without opening CUDA (5.0 did this only for the identical batch size).
    if(!attempted){std::string why;if(auto *r=find(m,units,why);r&&r->route==0){r->uses++;m.callCalibrationReuses++;traceRoute(units,0,false,r->cpuSeconds,r->deviceSeconds);
      m.route="CPU scoring (measured faster than CUDA for this batch size, cached)";m.scheduleDecision="CPU";m.scheduleReason="an earlier calibration on this engine measured the CPU faster for a covering batch size";cpu(0);return;}}
    // 4.9: Automatic does not open CUDA for a job whose whole scoring work is too small for any
    // device to repay the context creation and calibration (about 0.1 s on an RTX 4060 Ti in the 4.8
    // field report: 2,400 deals took 168 ms in Automatic vs 64 ms CPU Only, same strategy bytes).
    // The first batch is scored on the CPU and timed; projected = that time x the batches this
    // training call will run. Below EM_AUTO_MIN_SCORE_SECONDS (default 0.5 s) the call stays on the
    // CPU without touching the driver. GPU Preferred and Hybrid are explicit requests and keep their
    // 4.8 behaviour (open, calibrate, fall back to the CPU when it measures faster). The CPU path
    // computes the same scores, so results are identical in every mode.
    if(!attempted && m.mode=="auto" && m.plannedUpdates>0){
      const double minSeconds=m.autoThresholdSeconds;
      const double t=now();cpu(0);const double one=now()-t;
      const double projected=one*(double)m.plannedUpdates;m.autoProjectedScoreSeconds=projected;
      if(projected<minSeconds){attempted=true;available=false;m.autoDeviceSkipped=true;
        char b[200];std::snprintf(b,sizeof b,"CPU scoring (Automatic: projected scoring work %.3f s is below %.2f s, CUDA not opened)",projected,minSeconds);m.route=b;
        m.scheduleDecision="CPU without opening CUDA";std::snprintf(b,sizeof b,"Automatic: projected CPU scoring %.6f s for %lld updates is below the %.3f s threshold",projected,m.plannedUpdates,minSeconds);m.scheduleReason=b;return;}
      m.scheduleReason="Automatic: projected CPU scoring is above the threshold; CUDA is measured";
      // large enough: continue to the measured calibration below, rescoring this batch (scores are deterministic)
    }
    if(!attempted){const double t=now();available=device.open();m.callDriverInitSeconds=now()-t;attempted=true;m.cuda=device.info;m.callCudaOpened=true;}
    if(!available){if(m.autoDeviceSkipped){cpu(0);return;}if(!device.info.available){m.route="CPU (CUDA unavailable: "+device.info.reason+")";m.scheduleDecision="CPU";m.scheduleReason="CUDA unavailable: "+device.info.reason;}cpu(0);return;}
    const size_t count=units*m.n;
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
      double t=now();
      if(!device.begin(cards.data(),lanes,m.gpuBudget,packed?m.n:0))return false;
      m.callDeviceSeconds+=now()-t;
      cpu(gpuUnits);
      t=now();const bool ok=device.finish(scores.data(),lanes);m.callDeviceSeconds+=now()-t;
      if(!ok)return false;
      for(size_t i=0;i<gpuUnits;i++)std::copy_n(scores.data()+i*m.n,m.n,work[i].w.score);
      m.peakGpuBytes=std::max(m.peakGpuBytes,device.allocated());m.callGpuPeakBytes=std::max(m.callGpuPeakBytes,device.allocated());
      return true;
    };
    std::string why;MW::RouteMeasure *held=find(m,units,why);
    if(!held){
      m.callRecalibrationReasons[why]++;
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
        if(elapsed<best && elapsed<cpuSeconds*crossover){best=elapsed;chosen=route;}
      }
      m.scoreCalibrationSeconds+=now()-started;m.scoreCalibrations++;m.callCalibrationSeconds+=now()-started;m.callCalibrations++;
      m.cpuScoreProbeSeconds=cpuSeconds;m.bestDeviceScoreSeconds=std::isfinite(deviceBest)?deviceBest:0;
      MW::RouteMeasure x;x.units=units;x.route=chosen;x.cpuSeconds=cpuSeconds;x.deviceSeconds=std::isfinite(deviceBest)?deviceBest:0;x.uses=1;x.mode=m.mode;x.budget=m.gpuBudget;
      remember(m,x);traceRoute(units,chosen,true,cpuSeconds,x.deviceSeconds);
      m.route=chosen>=2?"Hybrid scoring":chosen==1?"CUDA scoring":"CPU scoring (measured faster than CUDA for this batch size)";
      m.scheduleDecision=chosen>=2?"Hybrid":chosen==1?"CUDA":"CPU after measuring CUDA";
      char b[260];std::snprintf(b,sizeof b,"calibration: CPU %.6f s, best device route %.6f s for %zu units (a device route needs under 90%% of the CPU time)",m.cpuScoreProbeSeconds,m.bestDeviceScoreSeconds,units);m.scheduleReason=b;
      return;   // every calibration output matched the CPU reference for this batch
    }
    held->uses++;m.callCalibrationReuses++;const int route=held->route;traceRoute(units,route,false,held->cpuSeconds,held->deviceSeconds);
    if(!evaluate(route)){available=false;device.releaseBuffers();m.routeMeasures.clear();m.route="CPU (CUDA task failed; batch rescored on CPU)";cpu(0);return;}
    m.route=route>=2?"Hybrid scoring":route==1?"CUDA scoring":"CPU scoring (measured faster than CUDA for this batch size)";
    m.scheduleDecision=route>=2?"Hybrid":route==1?"CUDA":"CPU after measuring CUDA";
  }
};
