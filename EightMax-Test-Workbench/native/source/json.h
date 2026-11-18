#ifndef EM_JSON_H
#define EM_JSON_H
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif
// 4.5: the decimal parser behind every JSON number (see json.c); the engine installs em_parse_double.
extern double (*json_number_parser)(const char *, char **);
// growable output buffer
typedef struct JB { char *s; size_t n, cap; int failed; } JB;
void jb_init(JB *b);
void jb_free(JB *b);
void jb_putc(JB *b, char c);
void jb_puts(JB *b, const char *s);
void jb_putn(JB *b, const char *s, size_t n);
void jb_printf(JB *b, const char *fmt, ...);
void jb_num(JB *b, double v, int dec);          // fixed decimals, trailing zeros trimmed; non-finite -> null
void jb_farr(JB *b, const float *a, int n, int dec);
void jb_str(JB *b, const char *s);             // quoted + escaped
// parsed value
enum { J_NULL, J_BOOL, J_NUM, J_STR, J_ARR, J_OBJ };
typedef struct JV { int type; double num; char *str; int n, cap; struct JV **items; char **keys; } JV;
JV *json_parse(const char *s, size_t len, char *err, int errlen);
void json_free(JV *v);
JV *jget(const JV *obj, const char *key);
double jnum(const JV *v, double def);
const char *jstr(const JV *v);
#ifdef __cplusplus
}
#endif
#endif
