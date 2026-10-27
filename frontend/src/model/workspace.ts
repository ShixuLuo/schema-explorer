import type { Table, Relation } from "./schema.ts";
export type Point = { x: number; y: number };
export type Viewport = { x: number; y: number; zoom: number };
export type UseCase = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  tableIds: string[];
  positions: Record<string, Point>;
  viewport?: Viewport;
  relationships: Relation[];
  candidates: Relation[];
  dismissed: string[];
  analysis: { checkedPairs: number; limited: boolean };
  revision?: number;
  modelVersion?: number;
  migration?: import("./operations.ts").MigrationHistory;
  undo?: ModelSnapshot;
};
export type ModelSnapshot = {
  tables: Table[];
  candidates: Relation[];
  analysis: UseCase["analysis"];
  description: string;
  removedRelationships?: Relation[];
  relationships?: Relation[];
  migration?: import("./operations.ts").MigrationHistory;
};

export function restoreWorkspace(value: UseCase): UseCase {
  if (!value) throw new Error("This use case no longer exists.");
  if (value.modelVersion === 2) return value;
  if ((value.modelVersion ?? 0) > 2)
    throw new Error("This use case was created by a newer version of the app.");
  // Previous solid links were annotations, not declared constraints. Preserve
  // them as candidates until the user explicitly validates them as foreign keys.
  const candidates = [
    ...new Map(
      [...value.candidates, ...value.relationships].map((r) => [
        r.id,
        { ...r, enforced: false },
      ]),
    ).values(),
  ];
  return {
    ...value,
    modelVersion: 2,
    relationships: [],
    candidates,
    undo: value.undo
      ? {
          ...value.undo,
          relationships: [],
          candidates: [
            ...value.undo.candidates,
            ...(value.undo.removedRelationships ?? []),
          ],
        }
      : undefined,
  };
}
