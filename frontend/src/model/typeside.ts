import type { TypeSide } from "./presentation.ts";
// Fixed, explicitly nullable SQL value domains. NULL is one distinguished
// value, not an existential/labelled null. Integer is signed 64-bit.
export const SQL_TYPESIDE: TypeSide = {
  id: "sql-values-v1",
  sorts: [
    { id: "type:text", carrier: "sql-text", nullable: true },
    { id: "type:integer", carrier: "signed-int64", nullable: true },
  ],
};
