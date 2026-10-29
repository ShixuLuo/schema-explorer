#!/bin/sh
# Shared by server and worker; local operator configuration is never committed.
CQL_BACKEND_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
CQL_PROJECT_ROOT=$(CDPATH= cd -- "$CQL_BACKEND_ROOT/.." && pwd)
if [ -f "$CQL_PROJECT_ROOT/.local/cql.env" ]; then
  set -a
  . "$CQL_PROJECT_ROOT/.local/cql.env"
  set +a
fi
