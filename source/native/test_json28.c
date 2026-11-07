#include "json.h"
#include <assert.h>
#include <string.h>
#include <math.h>
int main(void){
  const char *invalid[]={"true x","NaN","1e999","01","-","2.","[1,]","0x42"};
  for(unsigned i=0;i<sizeof invalid/sizeof invalid[0];i++){char err[128];assert(!json_parse(invalid[i],strlen(invalid[i]),err,sizeof err));}
  JB b;jb_init(&b);jb_num(&b,1e200,6);assert(!b.failed&&b.n<64);
  char err[128];JV *j=json_parse(b.s,b.n,err,sizeof err);assert(j&&j->num==1e200);json_free(j);jb_free(&b);
}
