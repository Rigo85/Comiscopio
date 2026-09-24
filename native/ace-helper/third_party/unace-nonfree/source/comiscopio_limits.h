#ifndef COMISCOPIO_LIMITS_H
#define COMISCOPIO_LIMITS_H

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>

/* Internal helper protocol. The helper removes partial files on error. */
static void comiscopio_limit_failure(const char *reason)
{
  fprintf(stderr, "COMISCOPIO_LIMIT:%s\n", reason);
  fflush(stderr);
  exit(10);
}

static unsigned long long comiscopio_limit(const char *name)
{
  const char *text = getenv(name);
  char *end;
  unsigned long long value;
  if (!text) return ULLONG_MAX;
  if (*text < '0' || *text > '9') comiscopio_limit_failure("invalid_config");
  errno = 0;
  value = strtoull(text, &end, 10);
  if (errno || *end) comiscopio_limit_failure("invalid_config");
  return value;
}

#endif
