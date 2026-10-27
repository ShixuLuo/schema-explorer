# Schema Explorer

A local CSV and schema workspace. Code and UI are in English. No LLM is connected.

## Run

Requires Node.js 22.12+ and a current Rust toolchain.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/`. Rust listens on `127.0.0.1:7331`; Vite forwards `/api`. Ctrl+C stops both processes. A custom Rust toolchain can be configured through `SCHEMA_CARGO` or ignored `.local/runtime.json`.

For a static build, run `npm run build`, then `cargo run --manifest-path backend/Cargo.toml --features server --bin server`. `SCHEMA_PORT` and `SCHEMA_WEB_DIR` configure that service.

## Manual operations

All model edits use Preview, Apply, and one saved Undo point. Table and field menus expose the operations. Create table is available in the toolbar; New use case starts an empty workspace.

| Primitive | Behavior |
|---|---|
| CreateTable | Creates an empty table with explicitly defined fields and types. |
| DropTable | Removes the table and records. The UI explicitly composes removal of connected foreign keys, and previews the complete change. |
| RenameTable | Renames the table while preserving stable IDs, records, and references. |
| AddColumn | Fills existing records with an explicit text/integer constant or nullable NULL. |
| DropColumn | Removes a field and its cells. Keys using that field must be removed first. |
| RenameColumn | Renames the field while preserving its ID and values. |
| AddPrimaryKey | Declares an ordered single-field or composite primary key after validating every record. |
| DropPrimaryKey | Removes the key; rejects foreign-key dependencies. The fields remain non-nullable, matching PostgreSQL behavior. |
| AddForeignKey | Declares an ordered field mapping to a complete primary key with matching types. Every record is checked. |
| DropForeignKey | Removes the constraint without deleting fields or records. |

Primary keys reject duplicate tuples and NULL. Foreign keys use MATCH SIMPLE: a source tuple containing any NULL is exempt; an empty string is a real value and must match. There are no automatic repairs. Duplicate keys and orphan references report a failing row.

The diagram connects specific fields. A PK badge marks key fields. Dashed links are suggestions; solid links are declared foreign keys. Composite foreign keys remain one constraint and display every field pair as grouped lines. Hovering or selecting any part highlights the whole mapping; details show the complete constraint. Previous versions' confirmed annotations are preserved as candidates, because those annotations never declared a primary key or enforced a foreign key. Set the target primary key, then explicitly validate a candidate to promote it.

Undo restores the previous schema, relationships, data references, and committed migration history. It survives reload. A later model edit replaces that Undo point; importing CSV clears it. Restoring a snapshot is distinct from proving a migration reversible. Plans and previews are temporary and are not persisted as separate objects.

## PostgreSQL SQL export

Export SQL offers Changes, Baseline schema, and Current schema. The database-independent generator replays committed primitives through the same operation core. A SqlDialect implementation renders each validated step; PostgreSQL is the first implementation.

The baseline is the model immediately before the first recorded edit. Legacy edits already present in a saved use case are part of its baseline. Applied operations are recorded only to generate migration SQL; cancelled previews never enter that history. Later imports are recorded as table creations. Undo removes the undone operations from the history.

Changes must run against a database matching the baseline. CSV records are not exported. AddColumn includes the data initialization and nullability change, without inventing a permanent default. Current schema and Baseline schema create empty schemas. Generated scripts use transactions and quoted identifiers. PostgreSQL identifiers exceeding 63 UTF-8 bytes and unsupported NUL text are rejected. No database credentials or automatic SQL execution are involved. Generated scripts do not pretend to restore data removed by destructive operations.

## Module boundaries

Frontend dependencies point toward the model contracts. Concrete adapters are selected only in `app/runtime.ts` and the worker entry point.

- `frontend/src/model/`: platform-independent schema, workspace, wire contracts and evidence. No React, React Flow, IndexedDB, network or worker imports.
- `frontend/src/application/`: preparation, migration history, Undo, import publication and export. It depends on `WorkspaceStore` and `ModelEngine` capabilities, not concrete adapters.
- `frontend/src/adapters/`: IndexedDB, memory storage, CSV and Rust HTTP implementations. Data references, chunking, buffering, reclamation and transaction details stay here.
- `frontend/src/app/`: composition, worker transport and navigation.
- `frontend/src/diagram/`: graph state, field-level selection, details, layout and routing.
- `frontend/src/schema/`: operation forms, preview presentation, data preview and SQL export UI. These receive capabilities from the composition root.
- `frontend/src/shared/`: shared icon component.

`WorkspaceStore` publishes a complete model update using an expected revision. The application constructs history and Undo; the adapter owns atomic publication and safe data reclamation. Sealed writers cannot modify published rows. Prepared changes expose no physical chunk keys, and UI receives only reports and samples. The same editor runs against memory and IndexedDB stores, including when their read batches differ.

`ModelEngine` owns batch evaluation, complete candidate validation and SQL generation. The Rust HTTP adapter follows a scan plan selected by Rust; it does not infer primary-key/reference phases itself. Public engine calls contain no IndexedDB access. Application code contains no HTTP URLs or browser worker construction.

Backend boundaries are explicit:

- `backend/src/domain/`: a curated public boundary over private model, value, operation and constraint implementations. Schema and record invariants live with the model; complete-data constraints use that model in one direction. Cell validation and integer parsing have one owner.
- `backend/src/analysis/`: profiling and provider-independent bounded context, depending on the domain.
- `backend/src/migration/`: operation replay and the SQL dialect contract. Dialects receive both schema versions and own SQL syntax and script boundaries. PostgreSQL is the implemented production dialect.
- `backend/src/adapters/csv.rs`: explicit CSV decoding into domain values.
- `backend/src/application/validation.rs`: temporary validation lifetimes, capacity, expiry and failure cleanup, without HTTP or Tokio dependencies.
- `backend/src/http/`: payload conversion, routing and runtime scheduling. Enabled only by the `server` Cargo feature.

A normal library/CLI build has no Axum, Tokio, Tower or Tower HTTP dependency. Use `--features server` to build the local HTTP adapter. No separate core crate or dependency-injection framework is required.

The same Rust primitives and constraint checker serve CLI, HTTP and SQL generation. `preview` checks a complete bounded state; `preview_batch` is explicitly partial and requires complete candidate validation before publication. The Worker streams affected records and requested constraint projections. The local service retains at most two temporary validation indexes, each capped at 40 MiB of key content. Completion, failure, cancellation or inactivity releases them; they are not persisted.

## Storage and resource policy

Data remains in IndexedDB for the current browser profile and origin. CSV imports must be UTF-8, comma-delimited, and have unique nonempty headers. Empty strings, whitespace, quoted newlines, and leading zeros are preserved. Imported business fields stay text; `integer?` is only a deterministic hint.

| Limit | Default |
|---|---:|
| File / import batch | 5 MiB / 20 MiB |
| Files per import | 10 |
| Rows / fields per table | 50,000 / 100 |
| Cells per table | 200,000 |
| Cell / record content | 8 KiB / 256 KiB |
| Current use-case cell content | 40 MiB |
| Tables / fields / foreign keys per use case | 24 / 400 / 32 |
| Parser chunk | 128 KiB |
| Stored row chunk | 200 rows or approximately 256 KiB of cell content |
| Rust operation batch | 200 rows and 2 MiB of cell content |
| Operation / validation HTTP request | 4 MiB |
| Operations per edit / recorded SQL history | 32 / 256 |
| SQL export HTTP request | 16 MiB |
| Relationship analysis | 32 candidate pairs, 16 suggestions |
| Data preview | 50 rows per page, maximum 100 per read |

Full record sets never accumulate in React state. The checker retains only primary-key indexes and coverage, not complete records. Bounds apply before expanding values. Browser quotas may reject writes. Undo can retain an additional previous data version. Abrupt termination can leave unreferenced temporary data slots; it cannot publish a partial edit. Heap usage has not been benchmarked.

## Checks

```sh
npm run build
npm test
cargo test --manifest-path backend/Cargo.toml --no-default-features
cargo test --manifest-path backend/Cargo.toml --features server
cargo tree --manifest-path backend/Cargo.toml --no-default-features --edges normal --depth 1
```

`npm test` starts an isolated Rust service on an available port and runs the same editor scenarios against memory and IndexedDB adapters. The Node IndexedDB tests use fake-indexeddb as a development-only dependency; the browser uses native IndexedDB. Tests cover migration, layout preservation, Undo, stale revisions, cross-batch duplicate keys, orphan references, draft disposal, failed validation cleanup, data immutability, ownership and SQL export. Architecture tests check imports, including dynamic and type imports, so contracts/application code cannot silently acquire concrete storage or UI dependencies.

Rust tests cover primitive composition, schema/value invariants, composite keys, NULL and empty strings, coverage, integer precision, bounds, SQL replay, quoting, HTTP behavior and validation lifetimes. A test dialect verifies that planning is independent of PostgreSQL syntax and transaction wrappers; it is not a second supported database. Browser checks cover native IndexedDB, real CSV import and existing saved use cases.
