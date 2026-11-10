#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <math.h>
#include "solver.h"
#include "num_safe.h"
/* ---------------- config parsing ---------------- */
// size tokens: 33 or 33% (of the pot), 2.5x (raises: times the bet faced), g (bets: geometric, all-in by
// the river), a (all-in). Encoded as floats: > 0 % of pot, SZ_ALLIN, SZ_GEO, or SZ_X(m) for multiples.
static int parse_sizes(const JV *v, float *out, int *n, int isRaise, char *bad, size_t badn) {
  *n = 0;
  if (!v) return 1;
  const char *s = jstr(v);
  if (!s) return 0;
  while (*s) {
    while (*s == ' ' || *s == ',' || *s == ';' || *s == '\t') s++;
    if (!*s) break;
    const char *tok = s;
    while (*s && *s != ',' && *s != ' ' && *s != ';' && *s != '\t') s++;
    const size_t L = (size_t)(s - tok);
    snprintf(bad, badn, "%.*s", (int)(L < 20 ? L : 20), tok);
    if (*n >= 8) return 0;
    if (tok[0] == 'a' || tok[0] == 'A') { out[(*n)++] = SZ_ALLIN; continue; }
    if ((tok[0] == 'g' || tok[0] == 'G') && (L == 1 || (L == 3 && (tok[1] == 'e' || tok[1] == 'E')))) { if (isRaise) return 0; out[(*n)++] = SZ_GEO; continue; }
    char *e; double d = strtod(tok, &e);
    if (e == tok) return 0;
    if (e < s && (*e == 'x' || *e == 'X')) {
      if (!isRaise || !(d >= 1.5) || d > 20 || e + 1 != s) return 0;
      out[(*n)++] = SZ_X(d); continue;
    }
    if (e < s && *e == '%') e++;
    if (e != s || !(d > 0) || d > 2000) return 0;
    out[(*n)++] = (float)d;
  }
  return 1;
}
int solver_parse_cfg(const char *json, GameCfg *cfg, char *err, int errlen) {
  memset(cfg, 0, sizeof *cfg);
  if (!json) json = "{}";
  JV *v = json_parse(json, strlen(json), err, errlen);
  if (!v) return 0;
  JV *b = jget(v, "board"), *rg = jget(v, "ranges"), *sz = jget(v, "sizes");
  if (!b || b->type != J_ARR || b->n < 3 || b->n > 5) { snprintf(err, (size_t)errlen, "Board needs 3-5 cards"); json_free(v); return 0; }
  cfg->nb = b->n;
  for (int i = 0; i < b->n; i++) {
    JV *c = b->items[i];
    /* 3.3: card identifiers must be whole numbers 0..51 (2.5 was truncated to 2 before). */
    if (c->type != J_NUM || floor(c->num) != c->num || c->num < 0 || c->num > 51) { snprintf(err, (size_t)errlen, "Board cards must be whole numbers from 0 to 51"); json_free(v); return 0; }
    cfg->board[i] = (int)c->num;
  }
  /* 3.3: pot, stack and the bet cap must be finite numbers of the right type when present. */
  { static const char *NUMS[] = { "pot", "stack", "maxBets", "forceAllin", "compressAboveMB", "gamma" };
    for (unsigned i = 0; i < sizeof NUMS / sizeof *NUMS; i++) { JV *x = jget(v, NUMS[i]);
      if (x && (x->type != J_NUM || !isfinite(x->num))) { snprintf(err, (size_t)errlen, "%s must be a finite number", NUMS[i]); json_free(v); return 0; } } }
  cfg->pot = jnum(jget(v, "pot"), 0); cfg->stack = jnum(jget(v, "stack"), 0);
  if (!(cfg->pot > 0) || cfg->stack < 0) { snprintf(err, (size_t)errlen, cfg->stack < 0 ? "Stack must be 0 or more" : "Pot must be above 0"); json_free(v); return 0; }
  { JV *mb = jget(v, "maxBets"); if (mb && (floor(mb->num) != mb->num || mb->num < 0 || mb->num > 8)) { snprintf(err, (size_t)errlen, "maxBets must be a whole number from 0 to 8"); json_free(v); return 0; } }
  cfg->maxBets = (int)jnum(jget(v, "maxBets"), 3); cfg->forceAllin = jnum(jget(v, "forceAllin"), 0.2);
  if (!(cfg->forceAllin >= 0)) cfg->forceAllin = 0;
  if (cfg->forceAllin > 1) cfg->forceAllin = 1;
  cfg->compressAboveMB = jnum(jget(v, "compressAboveMB"), 4000);
  /* 4.1: integer switches are converted with checks (4.0: (int)jnum(), undefined
     for out-of-range doubles). true/false remain accepted as 1/0. */
  { static const char *SW[] = { "compress", "iso", "gpu" }; static const int LO[] = { -1, 0, 0 }, HI[] = { 1, 1, 1 }, DEF[] = { -1, 1, 1 };
    int *dst[] = { &cfg->compress, &cfg->iso, &cfg->gpu };
    for (int i = 0; i < 3; i++) {
      const JV *x = jget(v, SW[i]); *dst[i] = DEF[i];
      if (x && x->type == J_BOOL) { *dst[i] = x->num != 0; continue; }
      const int rc = em_jv_int(x, LO[i], HI[i], dst[i]);
      if (rc < 0) { em_num_msg(err, (size_t)errlen, SW[i], rc, LO[i], HI[i], 1); json_free(v); return 0; }
    } }
  cfg->gamma = jnum(jget(v, "gamma"), 3);
  { const char *rr = jstr(jget(v, "reraise")); cfg->reraiseAllin = rr && !strcmp(rr, "allin"); }
  JV *ic = jget(v, "icm");
  if (ic && ic->type == J_OBJ) {
    JV *u0 = jget(ic, "u0"), *u1 = jget(ic, "u1");
    if (!u0 || !u1 || u0->type != J_ARR || u1->type != J_ARR || u0->n != u1->n || u0->n < 2 || u0->n > 1024) { snprintf(err, (size_t)errlen, "Bad ICM table"); json_free(v); return 0; }
    cfg->icm = 1; cfg->icmN = u0->n;
    cfg->icmX0 = jnum(jget(ic, "x0"), 0); cfg->icmDx = jnum(jget(ic, "dx"), 1); cfg->icmB0 = jnum(jget(ic, "b0"), 0);
    if (!(cfg->icmDx > 0)) { snprintf(err, (size_t)errlen, "Bad ICM table"); json_free(v); return 0; }
    if (!isfinite(cfg->icmX0) || !isfinite(cfg->icmDx) || !isfinite(cfg->icmB0)) { snprintf(err, (size_t)errlen, "Bad ICM table"); json_free(v); return 0; }
    for (int i = 0; i < u0->n; i++) {
      JV *a = u0->items[i], *c = u1->items[i];
      /* 4.1: float narrowing is checked (|x| <= FLT_MAX); 4.0 converted any finite double. */
      if (a->type != J_NUM || c->type != J_NUM || em_dbl_to_f32(a->num, &cfg->icmU[0][i]) || em_dbl_to_f32(c->num, &cfg->icmU[1][i])) { snprintf(err, (size_t)errlen, "Bad ICM table"); json_free(v); return 0; }
    }
  }
  if (!rg || rg->type != J_ARR || rg->n != 2) { snprintf(err, (size_t)errlen, "Missing ranges"); json_free(v); return 0; }
  for (int p = 0; p < 2; p++) {
    JV *a = rg->items[p];
    if (!a || a->type != J_ARR || a->n != 1326) { snprintf(err, (size_t)errlen, "Range needs 1326 weights"); json_free(v); return 0; }
    for (int i = 0; i < 1326; i++) {
      /* 3.3: negative, non-numeric or non-finite weights were silently treated as 0 before. */
      JV *w = a->items[i];
      if (w->type != J_NUM || !isfinite(w->num) || w->num < 0 || w->num > 3.0e38) { snprintf(err, (size_t)errlen, "Range weights must be finite and nonnegative (%s, combo %d)", p ? "IP" : "OOP", i); json_free(v); return 0; }
      cfg->ranges[p][i] = (float)w->num;
    }
  }
  if (!sz) { snprintf(err, (size_t)errlen, "Missing bet sizes"); json_free(v); return 0; }
  JV *bet = jget(sz, "bet"), *raise = jget(sz, "raise"), *donk = jget(sz, "donk");
  static const char *ST[3] = { "flop", "turn", "river" };
  char bad[32] = "";
  for (int s = 0; s < 3; s++) for (int p = 0; p < 2; p++) {
    JV *x = bet && bet->type == J_ARR && s < bet->n && bet->items[s]->type == J_ARR && p < bet->items[s]->n ? bet->items[s]->items[p] : NULL;
    JV *y = raise && raise->type == J_ARR && s < raise->n && raise->items[s]->type == J_ARR && p < raise->items[s]->n ? raise->items[s]->items[p] : NULL;
    if (!parse_sizes(x, cfg->bet[s][p], &cfg->nbet[s][p], 0, bad, sizeof bad)) {
      snprintf(err, (size_t)errlen, "Bad %s %s bet size \"%s\": use %% of pot (33), g (geometric) or a (all-in), up to 8 sizes", ST[s], p ? "IP" : "OOP", bad); json_free(v); return 0;
    }
    if (!parse_sizes(y, cfg->raise[s][p], &cfg->nraise[s][p], 1, bad, sizeof bad)) {
      snprintf(err, (size_t)errlen, "Bad %s %s raise size \"%s\": use %% of pot (75), a multiple (3x) or a (all-in), up to 8 sizes", ST[s], p ? "IP" : "OOP", bad); json_free(v); return 0;
    }
  }
  // OOP leads on the turn and river after calling IP's bet ("donk" bets); without this list they use OOP's bet sizes
  if (donk && donk->type == J_ARR) {
    cfg->hasDonk = 1;
    for (int s = 0; s < 3; s++) {
      JV *x = s < donk->n ? donk->items[s] : NULL;
      if (!parse_sizes(x, cfg->donk[s], &cfg->ndonk[s], 0, bad, sizeof bad)) { snprintf(err, (size_t)errlen, "Bad %s donk size \"%s\"", ST[s], bad); json_free(v); return 0; }
    }
  }
  json_free(v);
  return 1;
}
