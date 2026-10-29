FROM node:22-bookworm-slim AS web
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts ./
COPY frontend ./frontend
RUN npm run build

FROM rust:1.90-bookworm AS rust
WORKDIR /build/backend/rust
COPY backend/rust/Cargo.toml backend/rust/Cargo.lock ./
COPY backend/rust/src ./src
RUN cargo build --release --locked --jobs 1

FROM eclipse-temurin:21-jdk-jammy AS cql
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /build
# Same official release and checksum used for the local UI verification.
RUN curl -fL --retry 3 https://github.com/CategoricalData/CQL/releases/download/20261024/cql.jar -o cql.jar \
 && echo 'e2c9c14db1acf31dfbcf51c5cedab1bc2228a9688ddc0efb74a3a3f68b5b0079  cql.jar' | sha256sum -c -
COPY backend/java/*.java ./
COPY backend/java/vendor/cql ./vendor/cql
RUN mkdir classes && javac --release 21 -cp cql.jar -d classes vendor/cql/TalgSimplifier.java IndexedEvalInstance.java PopulationCompiler.java ScalarFunctions.java SchemaCompiler.java QueryCompiler.java CqlWorker.java DataEvaluator.java SealedPlanRegistry.java SealedPlanRunner.java

FROM eclipse-temurin:21-jre-jammy AS jre
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tini libfontconfig1 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 10001 app && useradd --uid 10001 --gid app --create-home app
WORKDIR /app
COPY --from=jre /opt/java/openjdk /opt/java/openjdk
COPY --from=web /build/dist ./dist
COPY --from=rust /build/backend/rust/target/release/cql-http ./bin/cql-http
COPY --from=cql /build/cql.jar ./lib/cql.jar
COPY --from=cql /build/classes ./backend/java/build
COPY backend/java/vendor/cql/NOTICE.md backend/java/vendor/cql/BSD-3-Clause.txt ./licenses/cql/
COPY backend/java/recipes ./backend/java/recipes
COPY frontend/src ./frontend/src
COPY scripts ./scripts
COPY package.json ./package.json
COPY deploy/run-worker.sh ./deploy/run-worker.sh
RUN chmod +x /app/deploy/run-worker.sh
ENV NODE_ENV=production PORT=8080 JAVA_HOME=/opt/java/openjdk PATH="/opt/java/openjdk/bin:${PATH}" \
    CQL_WORKER_COMMAND=/app/deploy/run-worker.sh CQL_HTTP_COMMAND=/app/bin/cql-http
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--experimental-strip-types", "scripts/demo-server.mjs"]
