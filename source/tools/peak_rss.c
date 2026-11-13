/* Runs a command and prints its peak resident set size (KiB, from wait4) to stderr
 * as "peakRssKiB=<n>" (4.0: followed by " cpuSeconds=<user+system>").
 * Linux/POSIX benchmark helper for tools/grouped33.js, bench40.js, threads40.js. */
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
  fprintf(stderr, "peakRssKiB=%ld cpuSeconds=%.3f\n", ru.ru_maxrss, ru.ru_utime.tv_sec + ru.ru_stime.tv_sec + (ru.ru_utime.tv_usec + ru.ru_stime.tv_usec) / 1e6);
  return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}
