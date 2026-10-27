import type { Operation } from "../model/operations.ts";
import type { Relation } from "../model/schema.ts";
export type EditTarget = {
  kind: Operation["op"];
  tableId: string;
  columnId?: string;
  relation?: Relation;
};
