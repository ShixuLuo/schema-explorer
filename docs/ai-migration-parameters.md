# AI migration parameter contract

The UI is unchanged. This feature proposes query parameters, not schema edits or a dataset-specific migration.

## Input

The request contains native source and target schemas, backend-generated typed holes, existing assignments, sanitized structural edit intent, optional user guidance, and the same local source-data profiles and small filtered samples used by schema suggestions. Generated identities and declared business keys stay distinct. Stable native IDs bind fields and references; display names are not lookup rules.

`base` hashes bind source, target and current assignments. Changing those while a request is running invalidates its result. Structural intent omits legacy migration methods and literal data payloads. Concrete demo data is only a fixture; there are no table-name branches.

## Output and acceptance

The model proposes changed assignments for FROM bindings, scalar paths, WHERE equalities and foreign-key substitutions. The service merges those into one atomic candidate. Replacing an existing assignment must be explicit. It rejects unknown holes, malformed terms and unsupported values.

The entire candidate is sent to the actual CQL validator. Only a complete `valid` candidate is returned as `status: valid`; the model's own claim is never accepted. An invalid/incomplete first attempt may be repaired once using the same context and exact diagnostics. Both attempts share the original timeout and budget.

If that still does not validate, `status: needs-input` returns concrete questions and preserves the original assignments. The UI keeps its existing preview/accept/reject behavior. Neither generation nor acceptance executes a migration or changes a checkpoint. The user's Migrate action validates again and uses the normal run/apply path.

## Meaning and boundaries

CQL validation checks that the supported query is structurally well typed and preserves the stated schema equations. It is not proof that guessed business intent is correct. The prompt must preserve the user's edit intent and unchanged mappings, use data evidence without treating samples as proof, and ask rather than fabricate missing business choices. Full data and native key checks run during migration.

No generated SQL, CQL source, Java, file paths, or arbitrary executable code is accepted from the model. The API key remains server-side. No per-example correction rules are added.

Implementation: `scripts/migration-ai.mjs`, shared transport in `scripts/ai-server.mjs`, and `frontend/src/migration/ai-parameters.ts`.
