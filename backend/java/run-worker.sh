#!/bin/sh
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$HERE/../scripts/runtime-env.sh"
: "${CQL_JAR:?Set CQL_JAR to the official CQL jar (or configure .local/cql.env)}"
JDK=${CQL_JAVA_HOME:-${JAVA_HOME:-}}
if [ -n "$JDK" ]; then
  JAVAC="$JDK/bin/javac"
  JAVA="$JDK/bin/java"
else
  JAVAC=javac
  JAVA=java
fi
BUILD=${CQL_JAVA_BUILD_DIR:-$HERE/build}
mkdir -p "$BUILD"
"$JAVAC" -cp "$CQL_JAR" -d "$BUILD" "$HERE/SchemaCompiler.java" "$HERE/QueryCompiler.java" "$HERE/CqlWorker.java" "$HERE/DataEvaluator.java" "$HERE/SealedPlanRegistry.java" "$HERE/SealedPlanRunner.java"
exec "$JAVA" -Dcql.recipe.dir="$HERE/recipes" -Djava.awt.headless=true -Dpolyglot.engine.WarnInterpreterOnly=false -cp "$BUILD:$CQL_JAR" CqlWorker
