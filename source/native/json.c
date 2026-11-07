#include "json.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <stdarg.h>
#include <math.h>
#include <stdint.h>
#include <limits.h>

static int jb_grow(JB *b, size_t extra) {
  if(b->failed)return 0;
  if(extra>=SIZE_MAX-b->n){b->failed=1;return 0;}
  size_t need=b->n+extra+1,cap=b->cap?b->cap:256;
  if(need<=b->cap)return 1;
  while(cap<need){if(cap>SIZE_MAX/2){cap=need;break;}cap*=2;}
  char *grown=realloc(b->s,cap);
  if(!grown){b->failed=1;return 0;}
  b->s=grown;b->cap=cap;return 1;
}
void jb_init(JB *b){memset(b,0,sizeof(*b));if(jb_grow(b,0))b->s[0]=0;}
void jb_free(JB *b){free(b->s);memset(b,0,sizeof(*b));}
void jb_putc(JB *b,char c){if(jb_grow(b,1)){b->s[b->n++]=c;b->s[b->n]=0;}}
void jb_putn(JB *b,const char *s,size_t n){if(jb_grow(b,n)){memcpy(b->s+b->n,s,n);b->n+=n;b->s[b->n]=0;}}
void jb_puts(JB *b, const char *s) { jb_putn(b, s, strlen(s)); }
void jb_printf(JB *b, const char *fmt, ...) {
  va_list ap; va_start(ap, fmt);
  char tmp[512]; int k = vsnprintf(tmp, sizeof tmp, fmt, ap); va_end(ap);
  if(k<0){b->failed=1;return;}
  if (k < (int)sizeof tmp) { jb_putn(b, tmp, (size_t)k); return; }
  if(!jb_grow(b,(size_t)k))return;
  va_start(ap, fmt); vsnprintf(b->s + b->n, (size_t)k + 1, fmt, ap); va_end(ap); b->n += (size_t)k;
}
void jb_num(JB *b, double v, int dec) {
  if (!(v == v) || v > 1e300 || v < -1e300) { jb_puts(b, "null"); return; }
  char tmp[64]; int k = snprintf(tmp, sizeof tmp, "%.*f", dec, v);
  if(k<0){b->failed=1;return;}
  if(k>=(int)sizeof tmp){jb_printf(b,"%.17g",v);return;}
  if (dec > 0) { while (k > 1 && tmp[k - 1] == '0') k--; if (tmp[k - 1] == '.') k--; }
  if (k == 2 && tmp[0] == '-' && tmp[1] == '0') { tmp[0] = '0'; k = 1; }
  jb_putn(b, tmp, (size_t)k);
}
void jb_farr(JB *b, const float *a, int n, int dec) {
  jb_putc(b, '[');
  for (int i = 0; i < n; i++) { if (i) jb_putc(b, ','); jb_num(b, a[i], dec); }
  jb_putc(b, ']');
}
void jb_str(JB *b, const char *s) {
  jb_putc(b, '"');
  for (; *s; s++) {
    unsigned char c = (unsigned char)*s;
    if (c == '"' || c == '\\') { jb_putc(b, '\\'); jb_putc(b, (char)c); }
    else if (c < 0x20) jb_printf(b, "\\u%04x", c);
    else jb_putc(b, (char)c);
  }
  jb_putc(b, '"');
}

typedef struct { const char *s, *e; char *err; int errlen; } P;
static void perr(P *p, const char *m) { if (p->err && !p->err[0]) snprintf(p->err, (size_t)p->errlen, "JSON: %s", m); }
static void ws(P *p) { while (p->s < p->e && (*p->s == ' ' || *p->s == '\t' || *p->s == '\n' || *p->s == '\r')) p->s++; }
static JV *newv(P *p,int type){
  JV *v=calloc(1,sizeof(*v));if(v)v->type=type;else perr(p,"out of memory");return v;
}
static int push(JV *a,JV *it,char *key){
  if(a->n==a->cap){
    if(a->cap>INT_MAX/2)return 0;
    int cap=a->cap?a->cap*2:8;
    JV **items=realloc(a->items,(size_t)cap*sizeof(*items));if(!items)return 0;a->items=items;
    if(a->type==J_OBJ){char **keys=realloc(a->keys,(size_t)cap*sizeof(*keys));if(!keys)return 0;a->keys=keys;}
    a->cap=cap;
  }
  a->items[a->n]=it;if(key)a->keys[a->n]=key;a->n++;return 1;
}
static char *pstr(P *p) {
  if (p->s >= p->e || *p->s != '"') { perr(p, "expected string"); return NULL; }
  p->s++;
  size_t cap = 16, n = 0; char *o = (char *)malloc(cap);
  if (!o) { perr(p, "out of memory"); return NULL; }
  while (p->s < p->e && *p->s != '"') {
    char c = *p->s++;
    if (c == '\\' && p->s < p->e) {
      char d = *p->s++;
      if (d == 'n') c = '\n'; else if (d == 't') c = '\t'; else if (d == 'r') c = '\r'; else if (d == 'b') c = '\b'; else if (d == 'f') c = '\f';
      else if (d == 'u') { unsigned u = 0; for (int i = 0; i < 4 && p->s < p->e; i++) { char h = *p->s++; u = u * 16 + (unsigned)(h >= 'a' ? h - 'a' + 10 : h >= 'A' ? h - 'A' + 10 : h - '0'); } c = u < 128 ? (char)u : '?'; }
      else c = d;
    }
    if (n + 2 > cap) { cap *= 2; char *grown = (char *)realloc(o, cap); if (!grown) { free(o); perr(p, "out of memory"); return NULL; } o = grown; }
    o[n++] = c;
  }
  if (p->s >= p->e) { perr(p, "unterminated string"); free(o); return NULL; }
  p->s++; o[n] = 0; return o;
}
static JV *pval(P *p, int depth) {
  ws(p);
  if (p->s >= p->e || depth > 64) { perr(p, "unexpected end"); return NULL; }
  char c = *p->s;
  if (c == '{') {
    p->s++; JV *o = newv(p,J_OBJ); if(!o)return NULL; ws(p);
    if (p->s < p->e && *p->s == '}') { p->s++; return o; }
    for (;;) {
      ws(p); char *k = pstr(p); if (!k) { json_free(o); return NULL; }
      ws(p); if (p->s >= p->e || *p->s != ':') { free(k); json_free(o); perr(p, "expected :"); return NULL; }
      p->s++; JV *v = pval(p, depth + 1); if (!v) { free(k); json_free(o); return NULL; }
      if(!push(o,v,k)){free(k);json_free(v);json_free(o);perr(p,"out of memory");return NULL;} ws(p);
      if (p->s < p->e && *p->s == ',') { p->s++; continue; }
      if (p->s < p->e && *p->s == '}') { p->s++; return o; }
      json_free(o); perr(p, "expected , or }"); return NULL;
    }
  }
  if (c == '[') {
    p->s++; JV *a = newv(p,J_ARR); if(!a)return NULL; ws(p);
    if (p->s < p->e && *p->s == ']') { p->s++; return a; }
    for (;;) {
      JV *v = pval(p, depth + 1); if (!v) { json_free(a); return NULL; }
      if(!push(a,v,NULL)){json_free(v);json_free(a);perr(p,"out of memory");return NULL;} ws(p);
      if (p->s < p->e && *p->s == ',') { p->s++; continue; }
      if (p->s < p->e && *p->s == ']') { p->s++; return a; }
      json_free(a); perr(p, "expected , or ]"); return NULL;
    }
  }
  if (c == '"') { char *s = pstr(p); if (!s) return NULL; JV *v = newv(p,J_STR); if(!v){free(s);return NULL;} v->str = s; return v; }
  if (p->e-p->s>=4 && !strncmp(p->s, "true", 4)) { p->s += 4; JV *v = newv(p,J_BOOL); if(!v)return NULL; v->num = 1; return v; }
  if (p->e-p->s>=5 && !strncmp(p->s, "false", 5)) { p->s += 5; return newv(p,J_BOOL); }
  if (p->e-p->s>=4 && !strncmp(p->s, "null", 4)) { p->s += 4; return newv(p,J_NULL); }
  const char *start=p->s,*cur=start;
  if(cur<p->e&&*cur=='-')cur++;
  if(cur==p->e||*cur<'0'||*cur>'9')goto bad_number;
  if(*cur=='0')cur++;else while(cur<p->e&&*cur>='0'&&*cur<='9')cur++;
  if(cur<p->e&&*cur=='.'){
    cur++;const char *digits=cur;while(cur<p->e&&*cur>='0'&&*cur<='9')cur++;
    if(cur==digits)goto bad_number;
  }
  if(cur<p->e&&(*cur=='e'||*cur=='E')){
    cur++;if(cur<p->e&&(*cur=='-'||*cur=='+'))cur++;
    const char *digits=cur;while(cur<p->e&&*cur>='0'&&*cur<='9')cur++;
    if(cur==digits)goto bad_number;
  }
  char number[128];size_t length=(size_t)(cur-start);
  if(length>=sizeof number)goto bad_number;
  memcpy(number,start,length);number[length]=0;
  double value=strtod(number,NULL);if(!isfinite(value))goto bad_number;
  JV *v=newv(p,J_NUM);if(v)v->num=value;p->s=cur;return v;
bad_number: perr(p,"invalid or out-of-range number");return NULL;
}
JV *json_parse(const char *s, size_t len, char *err, int errlen) {
  P p = { s, s + len, err, errlen };
  if (err && errlen) err[0] = 0;
  JV *val=pval(&p,0);ws(&p);
  if(val&&p.s!=p.e){json_free(val);perr(&p,"trailing data");return NULL;}return val;
}
void json_free(JV *v) {
  if (!v) return;
  for (int i = 0; i < v->n; i++) { json_free(v->items[i]); if (v->keys) free(v->keys[i]); }
  free(v->items); free(v->keys); free(v->str); free(v);
}
JV *jget(const JV *o, const char *key) {
  if (!o || o->type != J_OBJ) return NULL;
  for (int i = 0; i < o->n; i++) if (!strcmp(o->keys[i], key)) return o->items[i];
  return NULL;
}
double jnum(const JV *v, double def) { return v && (v->type == J_NUM || v->type == J_BOOL) ? v->num : def; }
const char *jstr(const JV *v) { return v && v->type == J_STR ? v->str : NULL; }
