#!/bin/sh
set -eu
cd /app
exec java -Djava.awt.headless=true -Dpolyglot.engine.WarnInterpreterOnly=false \
  -Dcql.recipe.dir=/app/backend/java/recipes \
  -cp /app/backend/java/build:/app/lib/cql.jar CqlWorker
