import type { DataType } from "./schema.ts";
export const isDataType = (value: string): value is DataType =>
  ["text", "integer", "real", "boolean"].includes(value);
// Decimal strings stay decimal strings throughout storage and SQL compilation.
export function validScalar(type: DataType, value: string): boolean {
  if (type === "text") return !value.includes("\0");
  if (type === "boolean") return value === "true" || value === "false";
  if (type === "real")
    return /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(
      value,
    );
  return (
    /^[+-]?[0-9]+$/.test(value) &&
    BigInt(value) >= -(1n << 63n) &&
    BigInt(value) < 1n << 63n
  );
}
