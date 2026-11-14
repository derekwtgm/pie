// EightMax 5.1: route-measurement reuse rule (see ScoreSchedule in score_schedule.hpp).
#pragma once
#include <algorithm>
#include <cmath>
#include <cstddef>
// 5.1: does a measurement of u0 units (route chosen, CPU and best device seconds) cover a batch of u
// units? Free function so tests/route51.cpp can check it against an exact cost model.
inline bool routeMeasureCovers(int route,size_t units0,double cpuSeconds,double deviceSeconds,size_t u,bool nearby){
  constexpr double crossover=0.90,safety=1.5;
  if(!nearby)return u==units0;
  const double u0=(double)units0,uu=(double)u,rho=deviceSeconds>0&&cpuSeconds>0?deviceSeconds/cpuSeconds:INFINITY;
  if(uu<u0/4)return false;
  if(route==0){const double hi=std::min(4.0,std::max(1.0,rho/(crossover*safety)));return uu<=u0*hi;}
  const double lo=std::max(0.25,std::min(1.0,rho*safety/crossover));return uu>=u0*lo && uu<=2*u0;
}
