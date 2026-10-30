# AI migration parameter contract

The UI is unchanged. This feature proposes query parameters, not schema edits or a dataset-specific migration.

## Input

The request contains native source and target schemas, backend-generated typed holes, existing assignments, sanitized structural edit intent, optional user guidance, and the same local source-data profiles and small filtered samples used by schema suggestions. Generated identities and declared business keys stay distinct. Stable native IDs bind fields and references; display names are not lookup rules.

`base` hashes bind source, target and current assignments. Changing those while a request is running invalidates its result. Structural intent omits legacy migration methods and literal data payloads. Concrete demo data is only a fixture; there are no table-name branches.

## Output and acceptance

The model proposes changed assignments for FROM bindings, scalar paths and registered conversions, WHERE equalities, foreign-key substitutions, and complete population plans. The service merges those into one atomic candidate. Replacing an existing assignment must be explicit. It rejects unknown holes, malformed terms and unsupported values.

The entire candidate is sent to the actual CQL validator. Only a complete `valid` candidate is returned as `status: valid`; the model's own claim is never accepted. An invalid/incomplete first attempt may be repaired once using the same context and exact diagnostics. Both attempts share a five-minute deadline. Each migration response has a 16,000-token output budget to cover multi-branch populations.

If that still does not validate, `status: needs-input` returns concrete questions and preserves the original assignments. The UI keeps its existing preview/accept/reject behavior. Neither generation nor acceptance executes a migration or changes a checkpoint. The user's Migrate action validates again and uses the normal run/apply path.

## Meaning and boundaries

For a single query, CQL validation checks typing and preservation of schema equations. For population plans, it checks branch typing and collection mappings; target equations are checked on the final quotient instance during execution. A valid population candidate is therefore not a promise that full-data checks will pass. It is not proof that guessed business intent is correct. The prompt must preserve the user's edit intent and unchanged mappings, use data evidence without treating samples as proof, and ask rather than fabricate missing business choices. Full data and native key checks run during migration.

No generated SQL, CQL source, Java, file paths, or arbitrary executable code is accepted from the model. The API key remains server-side. No per-example correction rules are added.

Implementation: `scripts/migration-ai.mjs`, shared transport in `scripts/ai-server.mjs`, and `frontend/src/migration/ai-parameters.ts`.

## Registered conversions and populations

Unary `cast:integer`, `cast:real`, `cast:boolean`, and `cast:text` terms use the closed conversion registry in `assignment-contract.ts` / `ScalarFunctions.java`. Fractional-to-integer conversion, invalid text, and Int64 overflow fail. Text boolean conversion accepts true/false or exact numeric 0/1. Decimal values remain exact. No function bodies come from callers.

An assignment to `<entityId>.population` replaces that entity's FROM/WHERE/attribute/reference mappings atomically. `branches` contains named source bindings, equalities, all target attributes, and all target foreign-key substitutions. `deduplicateBy` lists visible target attributes; no keys preserves all occurrences and no branches creates an empty entity. References select a destination branch and substitute its variables before quotienting. Conflicting non-key attributes or references are rejected rather than choosing a representative.

The compiler extracts an occurrence instance and uses CQL `sigma_chase` to collect branches. The displayed `quotient_query` is an equivalent declarative plan; runtime hashes the closed typeside’s ground key values to supply a spanning set of equality pairs to the official CQL identity-mapping `SigmaChaseAlgebra`. CQL computes the quotient and redirects references. The adapter retains its native instance rather than the pinned release’s `SaturatedInstance` wrapper, which reproduced cross-entity row-ID collisions after a quotient. No consistency checks are disabled. The pinned jar is unchanged; one documented CQL class override skips rescanning substitutions that contain no Skolem variables. See `backend/java/vendor/cql/NOTICE.md` for the precise change, upstream source and license. It checks source equations, target equations, exact values, and that quotienting did not collapse any entity without a deduplication key. Existing native Apply checks still enforce physical keys and references before saving.

The occurrence evaluator subclasses the official `EvalInstance` only to index its generator-to-entity lookup. The same native evaluator, `validate`, and `validateMore` still run. This avoids a linear scan for each generator lookup during validation on wider populations. Structured phase logs contain only compiler-generated names and numeric durations; other worker stderr is discarded.

The population preview exposes a controlled deduplication selector for one target scalar field or no deduplication. Existing composite selections are preserved and displayed, while creating new composite selections is outside this UI scope. Edits use the same atomic assignment replacement as AI proposals, retain branch projections and reference substitutions, and invalidate old validation. Empty populations can be selected explicitly for new empty tables.
