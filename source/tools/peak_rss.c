/* Runs a command and prints its peak resident set size (KiB, from wait4) to stderr
 * as "peakRssKiB=<n>". Linux/POSIX benchmark helper for tools/grouped33.js. */
#include <stdio.h>
#include <stdlib.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <unistd.h>
int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: peak_rss command [args]\n"); return 2; }
  pid_t pid = fork();
  if (pid < 0) return 2;
  if (!pid) { execvp(argv[1], argv + 1); _exit(127); }
  int status = 0; struct rusage ru;
  if (wait4(pid, &status, 0, &ru) < 0) return 2;
  fprintf(stderr, "peakRssKiB=%ld\n", ru.ru_maxrss);
  return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}
