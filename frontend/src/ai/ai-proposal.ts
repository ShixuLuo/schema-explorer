import type { SchemaSpec } from "../model/operations.ts";
import type { WorkspaceSnapshot } from "../application/ports.ts";
import { schemaSpec } from "../model/wire.ts";
export const canonical = (x: unknown): string =>
  Array.isArray(x)
    ? "[" + x.map(canonical).join(",") + "]"
    : x && typeof x === "object"
      ? "{" +
        Object.keys(x)
          .sort()
          .map(
            (k) =>
              JSON.stringify(k) +
              ":" +
              canonical((x as Record<string, unknown>)[k]),
          )
          .join(",") +
        "}"
      : JSON.stringify(x);
export async function fingerprint(x: unknown) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical(x)),
  );
  return (
    "sha256:" +
    Array.from(new Uint8Array(bytes), (v) =>
      v.toString(16).padStart(2, "0"),
    ).join("")
  );
}
export function snapshotSchema(s: WorkspaceSnapshot): SchemaSpec {
  return {
    ...schemaSpec(s.tables, s.useCase.relationships, s.useCase.equations),
    equations: s.useCase.equations ?? [],
  };
}
