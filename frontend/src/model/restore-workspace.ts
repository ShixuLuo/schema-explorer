import type { MigrationHistory, Operation, TableSpec } from "./operations.ts";
import { recordedOperation } from "./operations.ts";
import type { ForeignKeySpec, Table } from "./schema.ts";
import type {
  Checkpoint,
  EditingUndo,
  History,
  SavedWorkspace,
  UseCase,
} from "./workspace.ts";
import { retainedTables } from "./workspace.ts";

// Old storage formats are confined to this decoder. The application only sees
// the checkpoint graph and a single editing position.
type LegacyRelation = {
  id: string;
  name?: string;
  source: { tableId: string; columnId: string; columnIds?: string[] };
  target: { tableId: string; columnId: string; columnIds?: string[] };
  enforced?: boolean;
  lookup?: { source_columns: string[]; target_columns: string[] };
  matched?: number;
  checked?: number;
  sourceDistinct?: number;
  cardinality?: "1:1" | "N:1";
};
type StoredReference =
  (ForeignKeySpec & { lookup?: LegacyRelation["lookup"] }) | LegacyRelation;
const references = (values: StoredReference[]): ForeignKeySpec[] =>
  values.flatMap((r) => {
    if ("source_table" in r)
      return [
        {
          id: r.id,
          ...(r.name ? { name: r.name } : {}),
          source_table: r.source_table,
          source_columns: [...r.source_columns],
          target_table: r.target_table,
          target_columns: [...r.target_columns],
        },
      ];
    return r.enforced
      ? [
          {
            id: r.id,
            ...(r.name ? { name: r.name } : {}),
            source_table: r.source.tableId,
            source_columns: [...(r.source.columnIds ?? [r.source.columnId])],
            target_table: r.target.tableId,
            target_columns: [...(r.target.columnIds ?? [r.target.columnId])],
          },
        ]
      : [];
  });
// Retired lookup metadata designated physical carriers; retain that storage role
// while removing the lookup rule and statistics from the active representation.
export function restoredTables(
  tables: Table[],
  relationships: StoredReference[],
): Table[] {
  return tables.map((t) => ({
    ...t,
    columns: t.columns.map((c) =>
      relationships.some(
        (r) =>
          "lookup" in r &&
          r.lookup &&
          ("source_table" in r ? r.source_table : r.source.tableId) === t.id &&
          ("source_table" in r
            ? r.source_columns
            : (r.source.columnIds ?? [r.source.columnId])
          ).includes(c.id),
      )
        ? { ...c, storage: "reference" as const }
        : { ...c },
    ),
  }));
}
function restoredState(value: LegacyState): SavedWorkspace {
  const {
    candidates: _c,
    analysis: _a,
    dismissed: _d,
    migration: _m,
    ...state
  } = value;
  return {
    ...state,
    tables: restoredTables(state.tables, state.relationships),
    relationships: references(state.relationships),
  };
}
type LegacySnapshot = {
  tables: Table[];
  candidates?: StoredReference[];
  analysis?: { checkedPairs: number; limited: boolean };
  description: string;
  checkpointId?: string | null;
  historyHead?: string | null;
  relationships?: StoredReference[];
  removedRelationships?: StoredReference[];
  migration?: MigrationHistory;
  positions?: UseCase["positions"];
  viewport?: UseCase["viewport"];
  dismissed?: string[];
};
type LegacyFields = {
  candidates?: StoredReference[];
  analysis?: { checkedPairs: number; limited: boolean };
  dismissed?: string[];
};
type LegacyState = Omit<SavedWorkspace, "relationships"> & {
  relationships: StoredReference[];
} & LegacyFields & { migration?: MigrationHistory };
type LegacyCheckpoint = Omit<Checkpoint, "state"> & {
  state: LegacyState;
  branchId?: string;
  branchName?: string;
};
type LegacyBranch = {
  id: string;
  name: string;
  createdAt: number;
  checkpointId?: string;
  headId?: string | null;
  state: LegacyState;
  undo?: LegacySnapshot;
};
type LegacyWorkspace = Omit<
  UseCase,
  "modelVersion" | "history" | "undo" | "relationships"
> &
  LegacyFields & {
    modelVersion?: number;
    relationships: StoredReference[];
    undo?: LegacySnapshot;
    migration?: MigrationHistory;
    exploration?: {
      active: Omit<LegacyBranch, "state" | "undo">;
      branches: LegacyBranch[];
      checkpoints: LegacyCheckpoint[];
      liveId?: string;
    };
  };
type PreviousWorkspace = Omit<
  UseCase,
  "modelVersion" | "relationships" | "history"
> & {
  modelVersion: 3 | 4 | 5;
  relationships: StoredReference[];
  history: Omit<History, "checkpoints"> & { checkpoints: LegacyCheckpoint[] };
};
export type WorkspaceRecord = UseCase | PreviousWorkspace | LegacyWorkspace;

// Decode the short-lived CQL prototype into the same elementary operation log.
// Saved model/data snapshots remain unchanged.
function normalizeOperations(record: UseCase): UseCase {
  const checkpoints = record.history.checkpoints.map((checkpoint) => {
    const { categorical, ...current } = checkpoint as Checkpoint & {
      categorical?: {
        plan: {
          steps: {
            operator: "delta" | "sigma" | "pi";
            inputs: { table_id: string; column_ids: string[] }[];
            target: TableSpec;
          }[];
        };
      };
    };
    if (!categorical)
      return {
        ...checkpoint,
        ...(checkpoint.operations
          ? { operations: checkpoint.operations.map(recordedOperation) }
          : {}),
      };
    const operations: Operation[] = categorical.plan.steps.map((step) =>
      step.operator === "delta"
        ? {
            op: "copy_table",
            table_id: step.inputs[0].table_id,
            column_ids: step.inputs[0].column_ids,
            table: step.target,
          }
        : {
            op: "combine_tables",
            inputs: step.inputs,
            table: step.target,
            method: step.operator,
          },
    );
    return {
      ...current,
      operations: operations.map(recordedOperation),
      operationCount: operations.length,
    };
  });
  return { ...record, history: { ...record.history, checkpoints } };
}

// Compare metadata and immutable row references, never materialized CSV rows.
function key(value: unknown): string {
  return (
    JSON.stringify(value, (_name, item) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((name) => [name, item[name]]),
          )
        : item,
    ) ?? "undefined"
  );
}
const modelKey = ({ positions: _p, viewport: _v, ...model }: SavedWorkspace) =>
  key(model);
const capture = (
  value: Pick<
    LegacyWorkspace,
    "relationships" | "equations" | "positions" | "viewport"
  >,
  tables: Table[],
): SavedWorkspace =>
  structuredClone({
    tables: restoredTables(tables, value.relationships),
    relationships: references(value.relationships),
    ...(value.equations ? { equations: value.equations } : {}),
    positions: value.positions,
    viewport: value.viewport,
  });
function meaningfulName(name: string): string | undefined {
  if (/^(main|branch\s+\d+|exploration\s+\d+)$/i.test(name)) return;
  // A former route name must never attest to an external deployment.
  return /^(live|editing)$/i.test(name) ? `Saved exploration: ${name}` : name;
}

export function loadedWorkspace(record: WorkspaceRecord): UseCase {
  if ((record.modelVersion ?? 0) > 6)
    throw new Error("This use case was created by a newer version of the app.");
  if (record.modelVersion !== 6)
    throw new Error("Load this use case before accessing or modifying it.");
  const current = record as UseCase;
  if (
    !current.history ||
    (current.history.editing !== null &&
      !current.history.checkpoints.some(
        (c) => c.id === current.history.editing,
      ))
  )
    throw new Error("Stored checkpoint history is unavailable.");
  if (
    current.undo &&
    current.undo.checkpointId !== null &&
    !current.history.checkpoints.some(
      (c) => c.id === current.undo!.checkpointId,
    )
  )
    throw new Error("Stored Undo position is unavailable.");
  const {
    candidates: _c,
    analysis: _a,
    dismissed: _d,
    ...active
  } = current as UseCase & LegacyFields;
  return normalizeOperations(active);
}

// Garbage collection must also retain unopened legacy records, without
// upgrading them or creating recovered versions as a side effect of reading.
export function storedTables(record: WorkspaceRecord): Table[] {
  if (record.modelVersion === 6) return retainedTables(loadedWorkspace(record));
  if (
    (record.modelVersion === 3 ||
      record.modelVersion === 4 ||
      record.modelVersion === 5) &&
    "history" in record
  )
    return record.history.checkpoints.flatMap((c) => c.state.tables);
  if ((record.modelVersion ?? 0) > 6)
    throw new Error("This use case was created by a newer version of the app.");
  const old = record as LegacyWorkspace;
  return [
    ...(old.undo?.tables ?? []),
    ...(old.exploration?.checkpoints.flatMap((c) => c.state.tables) ?? []),
    ...(old.exploration?.branches.flatMap((b) => [
      ...b.state.tables,
      ...(b.undo?.tables ?? []),
    ]) ?? []),
  ];
}

export function restoreWorkspace(
  record: WorkspaceRecord,
  tables: Table[] = [],
): UseCase {
  if (!record) throw new Error("This use case no longer exists.");
  if ((record.modelVersion ?? 0) > 6)
    throw new Error("This use case was created by a newer version of the app.");
  if (record.modelVersion === 6) return loadedWorkspace(record as UseCase);
  // The version gate prevents older pages from writing the retired reference shape.
  if (
    (record.modelVersion === 3 ||
      record.modelVersion === 4 ||
      record.modelVersion === 5) &&
    "history" in record
  ) {
    return loadedWorkspace({
      ...record,
      modelVersion: 6,
      relationships: references(record.relationships),
      history: {
        ...record.history,
        checkpoints: record.history.checkpoints.map((c) => ({
          ...c,
          state: restoredState(c.state),
        })),
      },
    });
  }
  if (
    tables.length !== record.tableIds.length ||
    record.tableIds.some((id, index) => tables[index]?.id !== id)
  )
    throw new Error(
      "Stored table metadata is required to migrate this use case.",
    );
  const old = structuredClone(record) as LegacyWorkspace;
  if ((old.modelVersion ?? 0) < 2) {
    old.candidates = [
      ...new Map(
        [...(old.candidates ?? []), ...old.relationships].map((r) => [
          r.id,
          { ...r, enforced: false },
        ]),
      ).values(),
    ];
    old.relationships = [];
    if (old.undo)
      old.undo = {
        ...old.undo,
        relationships: [],
        candidates: [
          ...(old.undo.candidates ?? []),
          ...(old.undo.removedRelationships ?? []),
        ],
      };
  }
  const legacy = old.exploration;
  const history: History = {
    checkpoints: (legacy?.checkpoints ?? []).map(
      ({
        branchId: _id,
        branchName: _name,
        state: oldState,
        ...checkpoint
      }) => {
        const { migration } = oldState;
        return {
          ...checkpoint,
          state: restoredState(oldState),
          ...(migration ? { legacyMigration: migration } : {}),
        };
      },
    ),
    editing: null,
  };
  if (legacy?.liveId && history.checkpoints.some((c) => c.id === legacy.liveId))
    for (const checkpoint of history.checkpoints) {
      checkpoint.tags = (checkpoint.tags ?? []).filter(
        (tag) => tag.toLowerCase() !== "live",
      );
      if (checkpoint.id === legacy.liveId) checkpoint.tags.push("Live");
    }
  const activeState = capture(old, tables);
  // Match model/data versions without treating camera or layout differences as
  // new versions. IDs are deterministic until the first v4 write. Unknown
  // ancestry and operations stay unknown.
  const recover = (
    state: SavedWorkspace,
    slot: string,
    description: string,
    preferred?: string | null,
    log?: MigrationHistory,
  ): string => {
    const matches = (checkpoint: Checkpoint) =>
      modelKey(checkpoint.state) === modelKey(state) &&
      key(checkpoint.legacyMigration) === key(log);
    const preferredPoint = preferred
      ? history.checkpoints.find((c) => c.id === preferred && matches(c))
      : undefined;
    const existing = preferredPoint ?? history.checkpoints.find(matches);
    if (existing) return existing.id;
    let id = `recovered:${old.id}:${slot}`,
      index = 1;
    while (history.checkpoints.some((c) => c.id === id))
      id = `recovered:${old.id}:${slot}:${index++}`;
    history.checkpoints.push({
      id,
      name: description,
      createdAt: old.updatedAt,
      tags: ["Recovered"],
      state,
      ...(log ? { legacyMigration: log } : {}),
    });
    return id;
  };
  const label = (checkpointId: string, name: string) => {
    const tag = meaningfulName(name),
      point = history.checkpoints.find((c) => c.id === checkpointId)!;
    if (tag && !point.tags?.includes(tag))
      point.tags = [...(point.tags ?? []), tag];
  };
  const snapshotState = (
    undo: LegacySnapshot,
    layout: SavedWorkspace,
  ): SavedWorkspace => ({
    ...layout,
    tables: restoredTables(undo.tables, undo.relationships ?? []),
    relationships: references(undo.relationships ?? []),
    ...(undo.positions
      ? {
          positions: undo.positions,
          viewport: undo.viewport,
        }
      : {}),
  });
  for (const branch of legacy?.branches ?? []) {
    const { migration: log } = branch.state;
    const state = restoredState(branch.state);
    const id = recover(
      state,
      `saved:${branch.id}`,
      "Recovered saved state",
      branch.headId,
      log,
    );
    label(id, branch.name);
    if (branch.undo)
      recover(
        snapshotState(branch.undo, state),
        `undo:${branch.id}`,
        "Recovered undo state",
        branch.undo.historyHead ?? branch.undo.checkpointId,
        branch.undo.migration,
      );
  }
  const preferred = legacy?.active.headId;
  if (preferred === null && !tables.length) history.editing = null;
  else if (tables.length || legacy || old.undo)
    history.editing = recover(
      activeState,
      "editing",
      "Recovered editing state",
      preferred,
      old.migration,
    );
  if (history.editing && legacy) label(history.editing, legacy.active.name);
  let undo: EditingUndo | undefined;
  if (old.undo) {
    const state = snapshotState(old.undo, activeState);
    const checkpointId =
      (old.undo.historyHead === null || old.undo.checkpointId === null) &&
      !old.undo.tables.length
        ? null
        : recover(
            state,
            "undo:editing",
            "Recovered undo state",
            old.undo.historyHead ?? old.undo.checkpointId,
            old.undo.migration,
          );
    undo = {
      checkpointId,
      description: old.undo.description,
      ...(old.undo.positions
        ? {
            positions: old.undo.positions,
            viewport: old.undo.viewport,
          }
        : {}),
    };
  }
  const {
    candidates: _c,
    analysis: _a,
    dismissed: _d,
    exploration: _exploration,
    modelVersion: _version,
    undo: _undo,
    migration: _log,
    ...workspace
  } = old;
  return normalizeOperations({
    ...workspace,
    relationships: references(workspace.relationships),
    modelVersion: 6,
    history,
    undo,
  });
}
