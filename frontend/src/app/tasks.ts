import type { Operation } from "../model/operations.ts";
import type { PreparedEdit } from "../application/preview.ts";
import type { EditBase, CsvInput } from "../application/ports.ts";
export type DataTask =
  | { kind: "import"; files: CsvInput[]; caseId: string }
  | {
      kind: "prepare_edit";
      caseId: string;
      operations: Operation[];
      base?: EditBase;
      schemaOnly?: boolean;
    };
export type DataResult =
  { kind: "complete" } | { kind: "edit_preview"; preview: PreparedEdit };
