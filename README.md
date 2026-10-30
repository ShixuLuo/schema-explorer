# Schema Explorer

A browser-based schema editor with local CSV data, AI suggestions, CQL-backed migrations, and checkpoint history.

[Open the demo](https://schema-explorer.luo.sx) · [Container deployment](deploy/README.md)

## Run locally

Requires Node.js 22.12 or later. The CQL service additionally needs Rust/Cargo, JDK 21, and the official CQL jar; see [backend setup](backend/README.md).

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/`. Start the two optional services in separate terminals:

```sh
npm run dev:ai
npm run dev:cql
```

The frontend proxies `/api/ai` to `127.0.0.1:5184` and `/api/cql` to `127.0.0.1:5185`. Set `AI_API_URL` or `CQL_API_URL` to change development proxy targets. These services currently accept loopback requests; production hosting needs a reverse proxy and access control.

The AI service reads its OpenAI key from the ignored `.local/llm-api-key` file with permissions `0600`, or `OPENAI_API_KEY_FILE`. The key stays on the server. CQL runtime paths belong in the ignored `.local/cql.env`; no jar, JDK, credentials, or local datasets are included in this repository.

## Editor workflow

Create a model or import CSV files. **Category** edits objects, attributes, references, names, and path equations; **Tables** shows the relational projection and record counts. Click a table card to inspect its rows. Both views use the same model.

The **+** menu creates an Object, Arrow, or Relation. Arrow creation asks for Source, Name, and Target. A type target creates an attribute; an object target references its primary key. Storage fields are assigned by the shared editor logic. Double-click labels to rename, and use the hover **×** controls to delete. Relation creation selects arrows that form parallel paths, then records an equation between them.

Object creation defaults to an automatically generated integer key. **Key values → Use business values** creates a named, non-null single-column Text or Integer key whose values must come from the data. Manual creation and AI use the same builder; AI suggestions display the chosen key policy. CSV import keeps its existing primary-key selector.

Edits form a structural draft. **Schema diff**, **Before**, and **After** preview it. **Rollback** discards the draft. **Commit** opens a migration wizard:

1. Review only the changed structure.
2. Configure data mappings. Unchanged mappings are retained; the default form shows unresolved or changed choices. **Advanced · all mappings** exposes source bindings, field paths, row equalities, and reference substitutions.
   Population mappings expose **Deduplicate by**: choose a scalar field or keep every source record. Existing multi-field choices remain visible. Changing the choice invalidates the previous validation; Migrate checks the new assignments. New empty tables can select **No records · empty table**.
3. **Migrate** validates through CQL, runs against the source snapshot, verifies returned keys and references, and publishes a new checkpoint. The original checkpoint remains in History.

Run/apply is bound to the source revision, schemas, and data/result hashes. Staged results are published atomically; failures do not replace the source checkpoint.

## AI

Schema and migration AI metadata requests share a **256 KiB UTF-8 request cap** (`AI_REQUEST_MAX_BYTES`). Source sample limits remain bounded independently. Schema suggestions allow 8,000 output tokens; migration parameters allow 16,000 for multi-branch plans.

AI requests have a **five-minute total deadline**. Migration parameter generation, its one bounded repair, and CQL validation share that budget; CQL validator/execution limits remain separate. Server `[ai-timing]` lines use an internal trace ID and log only phase timing/status, attempt counts, and cancellation source—never prompts, payloads, samples, or credentials.

**Suggestions** uses the native schema, bounded local profiles, and filtered samples. Guidance is optional. Generated actions preview on the graph; accept or reject each group before Commit. AI and manual edits use the same command implementation. The model cannot supply SQL, executable code, or arbitrary storage bindings.

The migration wizard has a separate **Parameters** assistant. Leave guidance blank to request a complete candidate, inspect the preview, then Accept or Reject. A proposal must pass the actual CQL validator. A failed first attempt may be repaired once within the same request deadline; unresolved cases return a specific question and retain existing assignments. Accepting parameters does not execute the migration. See [the parameter contract](docs/ai-migration-parameters.md).

## Tutorial and history

The home screen's **Tutorial** creates a separate Bookshop sample with two customers and three orders. Three chapters cover basic editing and path equations, AI suggestion review, then parameter filling, migration, checkpoint history, and row verification. Contextual hints float beside the active controls without rearranging the editor.

History retains checkpoint parents and the current Editing checkpoint. Restoring a checkpoint continues editing from it; tags label saved checkpoints. SQL export uses recorded compatible forward operations. It does not invent a SQL migration across a CQL result checkpoint.

## Storage and boundaries

Models, checkpoints, and immutable row chunks are stored locally in IndexedDB. Preview SQL uses PGlite in a browser worker. Uploaded data does not become a shared cloud database. AI receives only the bounded context described above; CQL receives the source snapshot needed for an explicitly requested migration.

Generic UI migrations support source bindings, unary value/reference paths, equality conditions, exact registered scalar conversions, and branch unions with explicit key deduplication for normalized entities. Population plans compile to CQL extraction, collection, and quotient operations. Conflicting attributes or references for the same key fail; full source/target equations are checked during execution. Arbitrary functions, aggregation, constants, and null semantics remain unsupported. These operators have been checked with small independent datasets; this does not guarantee a complete migration for every AI-generated target.

The deployed UI verification on October 29 used the original DB1B data and AI-generated parameters. Type conversion completed in 24 seconds; the next migration combined conversions with five-source airport/state populations in 31 seconds, producing 500 / 821 / 1,178 / 182 / 49 rows. An independent comparison checked every output scalar and reference. The AI-proposed schema still retains generated identities and some redundant columns/direct references; it is not an exact column-for-column copy of the article.

The Rust HTTP service supervises a Java worker using the pinned CQL parser/evaluator with documented performance adapters and a small [version-pinned substitution patch](backend/java/vendor/cql/NOTICE.md). Generic native-schema query runs and separately configured example plans share that boundary. See [CQL contract and limitations](backend/java/README.md). In-memory backend run results do not survive a service restart; applied browser checkpoints do.

## Development checks

```sh
npm run build
npm test
```

Focused checks and backend smoke commands are documented in [backend/README.md](backend/README.md). The October 29 UI review used a TypeScript check and real tutorial operations, including live AI and CQL migration; the full test suite was intentionally not run during that review.
