import type { Operation } from "../model/operations.ts";
import type { PreparedEdit } from "../application/preview.ts";
export type DataTask =
  | { kind: "import"; files: File[]; caseId: string }
  | { kind: "prepare_edit"; caseId: string; operations: Operation[] };
export type DataResult =
  { kind: "complete" } | { kind: "edit_preview"; preview: PreparedEdit };
