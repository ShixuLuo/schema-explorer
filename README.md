# Schema Explorer

A local schema editor with CSV samples, checkpoints, PostgreSQL migration SQL and optional AI suggestions.

```sh
npm ci
npm run dev
```

Requires Node.js 22.12 or later. Open `http://127.0.0.1:5173/`.

## AI suggestions

Start the optional local AI service in another terminal:

```sh
npm run dev:ai
```

The service reads an OpenAI key from the git-ignored `.local/llm-api-key` file (permissions `0600`), or the path supplied through `OPENAI_API_KEY_FILE`. The key never goes to the browser. The frontend proxies `/api/ai` to the local service on port 5184; `AI_API_URL` can change that development target. Model: `gpt-6.1-sol`.

Use the rightmost AI icon. Guidance is optional; suggested directions are derived from the current model. The request includes the native schema, bounded local profiles and small filtered samples. New suggestions appear as temporary graph previews. Accept or reject them individually; accepted changes use the same commands, parameter controls, validation and Commit as manual edits. Hide preserves the suggestions and preview. Suggest again uses the current accepted model. A goal can be supplied for an empty model without inventing data.

The AI cannot import files, automatically configure migration parameters, or reference newly created IDs before those objects have been accepted. Examples are development-only fixtures, not production rules. CQL execution is available through the separate CQL workspace described below.

## CQL data execution

Start the local CQL backend in another terminal:

```sh
npm run dev:cql
```

Configure `CQL_JAR` and `CQL_JAVA_HOME` (or `JAVA_HOME`) in the git-ignored `.local/cql.env`; Rust/Cargo must be on PATH. See [backend setup and API](backend/README.md). The frontend proxies `/api/cql` to loopback port 5185; `CQL_API_URL` can override that development target.

Open a model and click **CQL**. The panel is hidden until requested. Its configured example prepares a new target and loads a separate source snapshot, then runs the backend and applies the returned rows to the prepared target. Apply is available only while that target is open. Existing models are not overwritten. Hiding the panel preserves its state; **Stop waiting** stops client polling, not server computation.

The native editor supports Text, Integer, exact Real and Boolean. Apply follows the target's declared primary/unique keys and ordered foreign-key columns, preserves target schema IDs, stages data and publishes one checkpoint. Data results are not old editor-operation logs, so SQL export refuses paths that cross a CQL result checkpoint. Click anywhere on a table card, including a field, to open its data below the graph.

The executor is driven by sealed server-owned plan definitions. The bundled dataset is an example configuration, not a special case in the engine. This is the verified PoC workflow; there is not yet a general UI that infers a migration between arbitrary models. Requests use JSON, background execution and paginated results; SSE, WebSocket and SQL-rule export are not added here.

## Edit and preview

Choose **New model** for an empty model, or **Open model** for a saved one. **Category** is the editing view. **Tables** shows the relational projection of the same model; switching views does not create another version or copy.

The Category view exposes seven elementary edits: add/remove object, add/remove arrow, add/remove path equation, and rename. Category remains a node-and-arrow graph. Built-in Text/Integer/Real/Boolean types are always defined and only appear when referenced. Shared Text/Integer nodes grow to provide separate, aligned incoming ports. Attribute labels sit on parallel horizontal runs; entities stay compact graph nodes. A single shared type distributes entity groups on both sides to reduce height. There are no table cards in Category. Both views arrange automatically; the manual Arrange/Fit buttons are removed.

The persistent lower-right **+** menu contains **Object**, **Arrow**, and **Relation**. Object creates an entity with a primary key whose name defaults to `_id`, and includes CSV import. The key name appears below the entity name in Category and supports double-click renaming. Renaming changes the storage column name, while record values and reference bindings retain their IDs. CSV import asks for a primary-key column per file; leaving it unselected generates one-based `_id` row numbers, preserving duplicate records. Explicit keys are validated for empty and duplicate values across the complete file. A conflicting existing `_id` column must be selected or renamed before importing; it is never overwritten. Arrow opens a compact form for Source, Target, and Name. Its target selector offers entities or built-in Text/Integer types; clicking graph nodes also fills source and target. Types are chosen here rather than in Object creation. There are no connection ports or drag-to-connect interaction; dragging nodes only adjusts layout. Double-click a node or arrow label to rename it and use its corner **×** to delete it. Select an arrow and choose **Edit arrow** to change source, target, field or type. Existing configuration is prefilled. Endpoint changes are composed as one draft; well-typed dependent relations are preserved and incompatible ones appear as removed in the schema diff. Recreating an attribute on another source or type does not copy its values. Use the pencil beside a relation to edit its selected loop; an unchanged existing relation, including one with repeated paths, is preserved.

Relation uses one selection of arrows. Click an arrow to select it; click it again to deselect it. Each arrow is selected at most once in the current UI. Stored paths and the model still support repeated composition. No path validation runs during selection. **Confirm** searches for two directed walks with the same source and target that use exactly the selected occurrences. An unambiguous closed selection creates the equation; incompatible directions produce an error while retaining the selection. If a directed cycle has multiple meanings, choose the displayed equation and confirm. The editor never silently selects an identity base point.

A new entity-to-type arrow starts as an unconfigured attribute action; no NULL value or Δ migration is silently selected. Its explicit value configuration supports a fixed Text/Integer/NULL value or a same-type attribute on the same entity. These are Δ mappings. Free scalar Σ (labelled unknowns) and exhaustive scalar Π are not implemented. A pending action cannot be committed, read as migrated data, or exported as SQL; configuring it recomputes the draft from its original validated data.

Entity-to-entity arrows use explicitly selected target keys and source fields. Reusing a business field is a choice; the editor never matches by name, assigns a singleton target, or chooses Σ/Π. Declaring a new unique key requires its checkbox. A new reference allocates separate storage carrier fields. Internal IDs, CSV columns explicitly designated as identity, and generated reference carriers are not business attributes in Category; Tables retains the physical representation. Business fields reused as key bindings remain business attributes.

The old matching workflow no longer creates actions or persistent equations. Legacy match metadata is ignored when loading the model and emitting constraints. Existing populated references and saved data remain intact; historical population operations can still be replayed. Only explicitly declared Relations create ongoing business path constraints.

The **Σ | Δ | Π** segmented selector uses equal-width symbol buttons. Each Action occupies one row. All enabled buttons use the same configuration routing: a migration with editable parameters opens its configuration dialog, while a migration with no editable parameters applies directly. Types and a single compatible source field are inferred, and controls with no actual choice are hidden. A selected configurable symbol can be clicked again. Explain describes only the current selection; disabled-button tooltips explain unavailable choices. Commit stays disabled until all actions are configured, with a hover/focus tooltip identifying the action and missing choice. New object, reference, relation and rename actions wait for an explicit migration choice. Historical method-less operations retain their recorded execution behavior, except that retired automatic matching equations are no longer installed.

| Edit | Executable migration | Current limits |
| --- | --- | --- |
| Add isolated object | Σ: empty; Π: one record | Π allows only a generated identity at creation; other attributes need explicit values. |
| Remove object | Δ | Removes incident arrows/relations and their dedicated, unused storage carriers. |
| Add entity arrow with new carriers | Σ: free completion; Π: finite path choices; Δ: explicit existing path | Free Σ requires acyclic reachable targets with internal identities and no unknown business values. Π supports acyclic upstream paths, declared path relations, generated identities and incoming storage references; business uniqueness cannot survive arbitrary duplication. |
| Bind existing source fields | Σ: complete missing target keys; Π: maximal closed restriction | Σ does not invent business attributes or chase arbitrary outgoing key constraints. |
| Add scalar attribute | Δ: explicitly configured constant or same-type local attribute | Labelled scalar unknowns for Σ, exhaustive Text/Integer Π, and arbitrary expressions remain unavailable. |
| Remove arrow | Δ | Deletes a dedicated unused carrier and FK constraint. A separately existing business attribute is retained. |
| Add relation | Σ: congruence quotient; Π: maximal closed subinstance | Σ rewrites all incoming references and closes under all arrows. Conflicting fixed business values fail atomically. Shared storage carriers are not supported by the quotient template. |
| Remove relation | Δ | Removes its enforcement; records remain. |
| Rename | Σ, Δ or Π through an isomorphism | All three retain records and values. |

Finite templates reject unsupported cycles and oversized path expansions with a reason. Π preview checks sample expansion before materializing data; exported SQL does not have the local sample row limit. No enabled option silently substitutes a different migration.

The new-reference Σ and Π templates and constant-term Δ have been independently compared against CQL in `verification/elementary-arrows.cql`. The comparison checks complete attributed-graph isomorphism, including identities and every reference, across a downstream chain, incoming references, duplicate records and an empty target. It also rejects a deliberately miswired graph with unchanged row counts. This does not claim a generic SQL compiler for arbitrary Kan extensions. Refinement SQL temporarily rebuilds reference/equation constraints inside the migration transaction, and restores all final constraints before commit; failure rolls back the entire transaction.

The storage presentation derives reference-key equations from explicit physical bindings. Category shows business attributes and reference arrows without exposing generated identities or dedicated carriers as business attributes. Foreign-key constraints enforce the key bindings; only explicitly recorded path equations add ongoing business constraints. Historical lookup metadata does not install new matching triggers.

If sample execution fails while the schema and its SQL remain valid, **Precheck failed** lists the errors and offers **Force schema change** or **Cancel**. Force creates a schema-only draft: it never disables foreign keys, uniqueness, null checks, or path equations. Commit records it with data marked unverified; original samples remain in the previous validated checkpoint. Data previews are unavailable until the data is migrated or a validated checkpoint is restored. Later edits to an unverified schema remain schema-only. Exported SQL retains its transaction and runtime constraints and aborts on incompatible real data.

Every structural change joins the current draft. The footer offers **Schema diff**, **Before** and **After**. Its inset **Details** drawer opens upward with compact **Actions** and **Preview** tabs. Preview shows all affected tables with before/after samples, per-table collapse and scrolling; forced schema-only changes show **No preview**. **Commit** creates one checkpoint; **Rollback** discards the draft. The current UI intentionally exposes only these elementary edits; copy/combine and other higher-level transformations are deferred.

## SQL, checkpoints and tags

**SQL** selects a starting checkpoint and generates its recorded forward migration to **Editing**. Checkpoint labels include tags; with a Live tag, Live is the default start. Copy the generated SQL into the existing PostgreSQL database corresponding to that checkpoint.

The export contains table-level SQL, not CSV records or per-record updates. Adding a constant field uses a temporary column default and removes the default afterward. PostgreSQL checks constraints when each statement executes. Historical copy/combine operations remain readable and exportable.

History keeps recorded parents. Continue from here moves Editing; subsequent commits create another path. Tags label checkpoints without changing the model or invalidating a draft. Live denotes a user-confirmed external deployment and only moves when explicitly changed. A non-ancestor checkpoint has no recorded forward migration to Editing; the app does not invent one from a schema diff.

## Abstraction and interpretation

`model/presentation.ts` defines the seven edits: add/drop object, add/drop arrow, add/drop path equation, and rename. Paths, equation evidence and functor composition are checked without SQL, table bindings or records. `model/migration.ts` composes Δ/Σ/Π, checks and supplied interpretations with matching input/output presentations.

Database actions are macros. `model/database-commands.ts` updates their bindings, and `model/database-presentation.ts` translates them to elementary edits and explicit mappings. Copy uses a pullback; the aligned-combination macro uses a pullback followed by the selected pushforward. SQL row templates read those functor images, not UI operation names or sample values. Keys and supplied attribute values remain explicit database interpretations rather than being claimed as ordinary path equations.

`planCommands` translates the ordered actions into existing `DatabaseChange` values once. Each records the before/after bindings, abstract migration and explicit storage parameters. `adapters/postgres-compiler.ts` consumes these changes; SQL lowering does not inspect the original UI command. Each SQL rule returns its statements and the tables it actually writes, plus finite expansion information where needed. Preview persists those returned tables, including downstream creations, and Actions displays the prepared change descriptions without rebuilding schemas during rendering. Compound gestures retain configuration controls for every pending step. The application returns planning facts and the compiler's written-table IDs. UI-only action grouping and explanations live in `schema/migration-plan.ts`; the kernel does not choose controls or require an Actions tab. Before/after sample rows are loaded only when Preview is opened, rather than being computed and transported during every edit. Unused step statistics and removed-relation lists are no longer generated.

The compiler includes identity-sequence synchronization in the exported program, so preview and exported SQL share the same allocation prerequisites. Existing sequences are never decreased.

`adapters/postgres-compiler.ts` instantiates the abstract changes against database bindings. The same abstract change can be bound to different table/field names and data without changing its algorithm. The preview adapter executes the resulting SQL in PGlite inside a Worker. SQL export uses that same compiler. Production data stays in the existing database; exported statements operate on its tables.

Path equations are edited on the source object and shown on the canvas. They can compare composed references and typed attributes. New relation edits wait for the user to select Σ or Π. Π removes violating rows and closes the remaining instance under every reference. Σ computes congruence closure, validates business values, chooses storage representatives and rewrites references. SQL statement triggers enforce the resulting equation. Renaming or removing generators refreshes or removes corresponding constraints. Historical method-less relation operations retain their original check semantics; they are never silently changed during history replay. Scalar conflicts are reported rather than resolved by choosing a business value.

The application stages local sample results and publishes model/data references, operations and Editing atomically in IndexedDB. Checkpoints retain immutable row chunks. Draft baselines carry the model, data references and revision without copying checkpoint history. Full history remains owned by the store and publication reads its current state transactionally. Existing saved data and historical operation field names are decoded on the explicit workspace load path. The v6 load boundary decodes older relation shapes, removes retired statistics and recommendation fields, and preserves compound-key order and dedicated carrier roles. Checkpoint IDs, parents, tags, row references and recorded migration behavior remain intact; row chunks are not rewritten. The format gate prevents older pages from writing the retired relation shape. Legacy lookup operations decode to explicit carrier metadata and their recorded population operation; they do not create matching constraints.

Table, column and foreign-key structure share one definition between bindings and view metadata. References use the same ordered column arrays in SQL, saved models and both diagram views; there is no separate UI relation representation or relation statistics. The retired generic operation editor, suggestion state, per-cell profiling, unused diff component and forwarding modules have been removed. The app directly opens the object editor and the graph delegates arrow construction/replacement to application functions.

CQL is an offline oracle for the existing Δ/Σ/Π templates. Those SQL templates were written in this project and checked against CQL results; they were not generated by CQL. Embedding SQL actually emitted by CQL remains deferred. CQL is not called by the application. The reference program and recorded comparison are in `verification/`; to rerun the independent CQL/PostgreSQL comparison, provide `CQL_JAVA` and `CQL_JAR` (or an ignored `.local/cql.json`) and run:

```sh
npm run verify:templates
node --experimental-strip-types scripts/verify-elementary-arrows.mjs
```

There is no Java service or Rust HTTP runtime in the app. The diagram shows user-declared arrows; heuristic relationship and type suggestions have been removed from the editor.

## Checks

```sh
npm test
npm run build
```

Tests cover the same workflows with memory and IndexedDB stores, multi-step composition, SQL/preview equivalence, empty-model evolution, constraints, checkpoints, tags, Undo and saved-data loading. Local CSV sample limits remain bounded; they do not limit the rows affected by exported SQL on the user's database.
