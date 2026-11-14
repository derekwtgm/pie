// EightMax 5.1: checks the route-measurement reuse rule (native/route_reuse.hpp) against an exact cost
// model. For a grid of affine device costs D(u)=a+b*u and linear CPU costs C(u)=c*u, a simulated job
// walks through batch sizes (rising, falling, random); a batch is "measured" (exact costs, the
// scheduler's 90% rule) unless an earlier measurement covers it. Every reused decision must equal the
// decision an exact measurement of that batch would make, so reuse never picks a slower route under
// the model; the job must reuse measurements and must switch routes across the crossover.
#include "route_reuse.hpp"
#include <cstdio>
#include <vector>
#include <random>
struct M{size_t u;int route;double cpu,dev;};
static int decide(double cpu,double dev){return dev<cpu*0.90?1:0;}
int main(){
  long long checks=0,fail=0,reused=0,measured=0,switches=0,jobs=0;
  std::mt19937_64 rng(51);
  for(double a:{0.0,1e-5,1e-4,1e-3,1e-2})for(double b:{0.0,1e-8,5e-8,2e-7})for(double c:{1e-8,5e-8,1e-7,1e-6}){
    for(int pattern=0;pattern<3;pattern++){
      std::vector<size_t> sizes;
      if(pattern==0)for(size_t u=8;u<=200000;u=u*11/10+1)sizes.push_back(u);
      else if(pattern==1)for(size_t u=200000;u>=8;u=u*10/11)sizes.push_back(u);
      else for(int i=0;i<400;i++)sizes.push_back(8+rng()%50000);
      std::vector<M> held;int last=-1;jobs++;
      for(size_t u:sizes){
        const double cpu=c*u,dev=a+b*u;const int truth=decide(cpu,dev);
        const M *hit=nullptr;for(auto &h:held)if(routeMeasureCovers(h.route,h.u,h.cpu,h.dev,u,true)){hit=&h;break;}
        int route;
        if(hit){route=hit->route;reused++;}else{route=truth;held.push_back({u,route,cpu,dev});measured++;}
        checks++;
        // reuse must agree with an exact measurement, except exact ties at the 90% boundary
        if(route!=truth && std::fabs(dev-cpu*0.90)>1e-12*cpu){fail++;if(fail<10)std::printf("FAIL a=%g b=%g c=%g u=%zu reused route %d truth %d\n",a,b,c,u,route,truth);}
        if(last>=0&&route!=last)switches++;
        last=route;
      }
    }
  }
  // exact-size mode never reuses across sizes
  bool exactOk=!routeMeasureCovers(0,100,1,2,101,false)&&routeMeasureCovers(0,100,1,2,100,false);
  // windows: far CPU decision extends to 4x, near-crossover CPU decision covers only <= its own size
  bool windows=routeMeasureCovers(0,100,1e-5,1e-3,400,true)&&!routeMeasureCovers(0,100,1e-5,1e-3,401,true)
    &&routeMeasureCovers(0,100,1.0,0.95,100,true)&&!routeMeasureCovers(0,100,1.0,0.95,101,true)&&routeMeasureCovers(0,100,1.0,0.95,25,true)&&!routeMeasureCovers(0,100,1.0,0.95,24,true)
    &&routeMeasureCovers(1,100,1.0,0.1,200,true)&&!routeMeasureCovers(1,100,1.0,0.1,201,true)&&routeMeasureCovers(1,100,1.0,0.1,25,true)
    &&!routeMeasureCovers(1,100,1.0,0.85,99,true)&&routeMeasureCovers(1,100,1.0,0.85,100,true);
  std::printf("{\"jobs\":%lld,\"batches\":%lld,\"measured\":%lld,\"reused\":%lld,\"routeSwitches\":%lld,\"wrongReusedDecisions\":%lld,\"exactMode\":%s,\"windows\":%s}\n",jobs,checks,measured,reused,switches,fail,exactOk?"true":"false",windows?"true":"false");
  return fail||!exactOk||!windows||!reused||!switches;
}
