import type { WorkspaceStore } from "../application/ports.ts";
import { publishModel, publishTags } from "../model/publication.ts";
import {
  loadedWorkspace,
  restoreWorkspace,
  restoredTables,
  storedTables,
  type WorkspaceRecord,
} from "../model/restore-workspace.ts";
import type { CellValue, Table } from "../model/schema.ts";
import { caseInfo, retainedTables } from "../model/workspace.ts";
import { rowWriter } from "./row-writer.ts";

export function createMemoryStore(): WorkspaceStore {
  const cases = new Map<string, WorkspaceRecord>(),
    tables = new Map<string, Table>();
  const records = new Map<string, CellValue[][]>();
  const clone = <T>(value: T): T => structuredClone(value);
  const ref = (table: Table) => table.dataId ?? table.id;
  const state = (id: string) => {
    const raw = cases.get(id);
    if (!raw) return;
    const current = loadedWorkspace(raw);
    const loaded = current.tableIds.map((id) => {
      const table = tables.get(id);
      if (!table) throw new Error("Stored table metadata is unavailable.");
      return clone(table);
    });
    return { useCase: clone(current), tables: loaded };
  };
  const live = () =>
    new Set(
      [...tables.values(), ...[...cases.values()].flatMap(storedTables)].map(
        ref,
      ),
    );
  const discardReferences = async (references: string[]) => {
    const retained = live();
    for (const id of references) if (!retained.has(id)) records.delete(id);
  };
  const readCase = async (id: string) => {
    const raw = cases.get(id);
    return raw ? clone(loadedWorkspace(raw)) : undefined;
  };
  return {
    async listCases() {
      return [...cases.values()]
        .map(caseInfo)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async load(id) {
      const raw = cases.get(id);
      if (!raw) throw new Error("This use case no longer exists.");
      const loaded = restoredTables(
        raw.tableIds.map((id) => {
          const table = tables.get(id);
          if (!table) throw new Error("Stored table metadata is unavailable.");
          return clone(table);
        }),
        raw.relationships,
      );
      const useCase = {
        ...restoreWorkspace(clone(raw), loaded),
        updatedAt: Date.now(),
      };
      for (const table of loaded) tables.set(table.id, clone(table));
      cases.set(id, clone(useCase));
      return { useCase: clone(useCase), tables: loaded };
    },
    async updateTags(id, change) {
      const raw = cases.get(id);
      if (!raw) throw new Error("This use case no longer exists.");
      cases.set(id, clone(publishTags(loadedWorkspace(raw), change)));
    },
    async addCase(c) {
      if (cases.has(c.id)) throw new Error("This use case already exists.");
      cases.set(c.id, clone(c));
    },
    readCase,
    async snapshot(id) {
      const result = state(id);
      if (!result) throw new Error("This use case no longer exists.");
      return result;
    },
    async patchInfo(id, patch) {
      const raw = cases.get(id);
      const current = raw ? clone(loadedWorkspace(raw)) : undefined;
      if (!current) throw new Error("This use case no longer exists.");
      if (
        Object.keys(patch).some(
          (key) => !["name", "positions", "viewport"].includes(key),
        )
      )
        throw new Error("Model changes must use a draft and Commit.");
      const next = { ...current, ...clone(patch), updatedAt: Date.now() };
      cases.set(id, next);
      return clone(next);
    },
    async deleteEmpty(id) {
      const current = state(id)?.useCase;
      if (
        current &&
        !current.tableIds.length &&
        !current.history.checkpoints.length
      )
        cases.delete(id);
    },
    async *rows(table) {
      if (table.dataStatus === "unverified")
        throw new Error(
          "Sample data has not been migrated to this schema. The original data is retained in the previous validated checkpoint.",
        );
      if (!table.rowCount) return;
      const data = records.get(ref(table));
      if (!data || data.length !== table.rowCount)
        throw new Error("Some stored data is unavailable.");
      // Deliberately differs from IndexedDB chunking to exercise the boundary.
      for (let offset = 0; offset < data.length; offset += 17)
        yield { offset, rows: clone(data.slice(offset, offset + 17)) };
    },
    async readRows(table, offset, limit = 50) {
      if (table.dataStatus === "unverified")
        throw new Error(
          "Sample data has not been migrated to this schema. The original data is retained in the previous validated checkpoint.",
        );
      const data = records.get(ref(table));
      if (!table.rowCount) return [];
      if (!data) throw new Error("Some stored data is unavailable.");
      return clone(
        data.slice(offset, offset + Math.min(100, Math.max(1, limit))),
      );
    },
    stage(table) {
      return rowWriter(table, {
        async put(reference, offset, rows) {
          const data = records.get(reference) ?? [];
          if (data.length !== offset)
            throw new Error("Data writes are out of order.");
          data.push(...clone(rows));
          records.set(reference, data);
        },
        async discard(reference) {
          await discardReferences([reference]);
        },
      });
    },
    async commit(id, expectedRevision, publication) {
      const current = state(id)?.useCase;
      if (!current) throw new Error("This use case no longer exists.");
      const next = publishModel(current, expectedRevision, publication);
      for (const t of next.tables)
        if (
          t.caseId !== id ||
          (tables.has(t.id) && tables.get(t.id)!.caseId !== id)
        )
          throw new Error("A table belongs to another use case.");
      const obsolete = [
        ...current.tableIds.map((id) => tables.get(id)!),
        ...retainedTables(current),
      ];
      for (const tableId of current.tableIds)
        if (!next.tables.some((t) => t.id === tableId)) tables.delete(tableId);
      for (const t of next.tables) tables.set(t.id, clone(t));
      cases.set(id, clone(next.useCase));
      await discardReferences(obsolete.map(ref));
    },
    async discard(candidate) {
      await discardReferences(candidate.map(ref));
    },
    async close() {
      cases.clear();
      tables.clear();
      records.clear();
    },
  };
}
