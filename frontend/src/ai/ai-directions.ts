import type { SchemaSpec } from "../model/operations.ts";
export function suggestionDirections(
  schema: SchemaSpec,
): { label: string; guidance: string }[] {
  const fields = schema.tables.flatMap((t) =>
    t.columns.filter((c) => !c.generated && !c.storage),
  );
  const result = [];
  if (schema.tables.length)
    result.push({
      label: "Check names",
      guidance: "Review names for clarity.",
    });
  if (fields.length)
    result.push({
      label: "Check types",
      guidance:
        "Review all types using data, including Boolean; preserve IDs and leading zeros.",
    });
  if (schema.foreign_keys.length || schema.tables.length > 1)
    result.push({
      label: "Review references",
      guidance: "Review the links between objects.",
    });
  const prefixes = fields
    .map((c) => c.name.split("_")[0])
    .filter((_, i) => fields[i].name.includes("_"));
  if (new Set(prefixes).size < prefixes.length)
    result.push({
      label: "Simplify structure",
      guidance: "Look for ways to simplify this structure.",
    });
  return result.slice(0, 4);
}
