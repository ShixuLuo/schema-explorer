import type { AttributeParameters, Operation } from "./operations.ts";
export const attributeParameters = (
  op: Operation,
): AttributeParameters | undefined =>
  op.op === "add_attribute"
    ? op.parameters
    : op.op === "add_column"
      ? { template: "constant", value: op.value }
      : undefined;
// Incomplete actions may be diagrammed, but never evaluated, exported, or committed.
export function pendingAttribute(op: Operation): string | undefined {
  if ("method" in op && op.method === null) return "Choose a migration.";
  if (op.op === "add_reference" && op.method === "delta" && !op.image)
    return "Choose the existing path for Δ.";
  if (op.op !== "add_attribute") return;
  const p = op.parameters;
  if (p.template === "extension")
    return "Choose a migration and configure its value.";
  if (p.template === "constant" && !p.value) return "Set the fixed value.";
  if (p.template === "copy" && !p.source_column)
    return "Choose the source attribute.";
}
export const pendingAttributes = (ops: Operation[]) =>
  ops.flatMap((op, index) => {
    const message = pendingAttribute(op);
    return message ? [{ index, message }] : [];
  });
