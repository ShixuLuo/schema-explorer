# CQL backend

Rust serves loopback HTTP on `127.0.0.1:5185` and supervises one resident Java worker using the official CQL parser/evaluator. Native schema JSON remains authoritative. The API and generic query runner are preserved; sealed plans are pinned by the checked-in manifest.

## Run

Supply JDK 21, the official CQL jar, and Cargo with its cached dependencies. The launchers load the project-root `.local/cql.env` when present. This file is local operator configuration and must remain ignored by Git. Example (replace placeholders with your installation):

```sh
CQL_JAR="/path/to/cql.jar"
CQL_JAVA_HOME="/path/to/jdk-21/Contents/Home"
# JAVA_HOME is also supported; otherwise java/javac are resolved on PATH.
# PATH="/path/to/cargo/bin:$PATH"
# CARGO_HOME="/path/to/cached/cargo/home"
# CQL_JAVA_BUILD_DIR="/path/to/optional/java-build"
```

From the project root:

```sh
./backend/scripts/run-server.sh
curl http://127.0.0.1:5185/api/cql/health
```

Builds run offline. Java classes default to ignored `backend/java/build`; Rust outputs default to ignored `backend/rust/target`. `CQL_WORKER_COMMAND` can override the worker executable path, never shell text. Ctrl-C or SIGTERM stops accepting connections, kills only the owned worker process group and reaps its direct child. No existing service is stopped by a launcher.

The listener remains loopback-only. CORS allows localhost/127.0.0.1 on 5173, 5182 and 5183; no-Origin proxy requests remain supported. Host restrictions, bounded standard HTTP framing, async runs, timeout/restart handling and graceful shutdown remain in the Rust implementation. `CQL_WORKER_TIMEOUT_MS` defaults to 15000; `CQL_RUN_TIMEOUT_MS` defaults to 180000. HTTP restart clears in-memory run results.

Endpoints: GET `/api/cql/health`; POST `/api/cql/schema/validate`, `/api/cql/draft`, `/api/cql/validate`, `/api/cql/runs`; GET `/api/cql/runs/:id` and `/api/cql/runs/:id/tables/:nativeTableId?offset=0&limit=100`. Run submission verifies canonical target/data SHA-256 snapshot bindings. Java’s [contract and limitations](java/README.md) documents DTOs, native IDs, exact scalar handling, sealed recipes and unsupported inputs. No stored result artifacts or caller CQL/filesystem/JDBC paths are consumed.

## Small verification

```sh
cargo test --offline --manifest-path backend/rust/Cargo.toml
python3 backend/java/smoke.py
python3 backend/java/evaluate-smoke.py
python3 backend/java/typed-smoke.py
python3 backend/java/test-sealed-plans.py
```

The sealed-plan test uses the bundled tiny Library fixture and does not execute Evan data. Optional `scripts/http-run-smoke.py` needs a running service; `scripts/http-framing-smoke.py` also expects its configured Vite proxy. `scripts/shutdown-smoke.py` requires port 5185 free and uses a fake worker; never run it against an occupied port. No JDK, jar, CSV copy, compiled classes, large run result or local absolute configuration is bundled.
