import type { WorkspaceStore } from "../application/ports.ts";
import type { CellValue, Table } from "../model/schema.ts";
import { restoreWorkspace, type UseCase } from "../model/workspace.ts";
import { rowWriter } from "./row-writer.ts";

export function createMemoryStore(): WorkspaceStore {
  const cases = new Map<string, UseCase>(),
    tables = new Map<string, Table>();
  const records = new Map<string, CellValue[][]>();
  const clone = <T>(value: T): T => structuredClone(value);
  const ref = (table: Table) => table.dataId ?? table.id;
  const live = () =>
    new Set(
      [
        ...tables.values(),
        ...[...cases.values()].flatMap((c) => c.undo?.tables ?? []),
      ].map(ref),
    );
  const discardReferences = async (references: string[]) => {
    const retained = live();
    for (const id of references) if (!retained.has(id)) records.delete(id);
  };
  const readCase = async (id: string) => {
    const c = cases.get(id);
    return c ? clone(restoreWorkspace(c)) : undefined;
  };
  return {
    async listCases() {
      return [...cases.values()]
        .map((c) => clone(restoreWorkspace(c)))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async addCase(c) {
      if (cases.has(c.id)) throw new Error("This use case already exists.");
      cases.set(c.id, clone(c));
    },
    readCase,
    async snapshot(id) {
      const useCase = await readCase(id);
      if (!useCase) throw new Error("This use case no longer exists.");
      return {
        useCase,
        tables: useCase.tableIds.map((id) => {
          const t = tables.get(id);
          if (!t) throw new Error("Stored table metadata is unavailable.");
          return clone(t);
        }),
      };
    },
    async patchInfo(id, patch) {
      const raw = cases.get(id);
      const current = raw ? restoreWorkspace(raw) : undefined;
      if (!current) throw new Error("This use case no longer exists.");
      if (
        Object.keys(patch).some(
          (key) =>
            !["name", "positions", "viewport", "dismissed"].includes(key),
        )
      )
        throw new Error("Model changes must use Preview and Apply.");
      const next = { ...current, ...clone(patch), updatedAt: Date.now() };
      cases.set(id, next);
      return clone(next);
    },
    async deleteEmpty(id) {
      if (cases.get(id)?.tableIds.length === 0) cases.delete(id);
    },
    async *rows(table) {
      if (!table.rowCount) return;
      const data = records.get(ref(table));
      if (!data || data.length !== table.rowCount)
        throw new Error("Some stored data is unavailable.");
      // Deliberately differs from IndexedDB chunking to exercise the boundary.
      for (let offset = 0; offset < data.length; offset += 17)
        yield { offset, rows: clone(data.slice(offset, offset + 17)) };
    },
    async readRows(table, offset, limit = 50) {
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
    async commit(id, expectedRevision, update) {
      const raw = cases.get(id);
      const current = raw ? restoreWorkspace(raw) : undefined;
      if (!current) throw new Error("This use case no longer exists.");
      if ((current.revision ?? 0) !== expectedRevision)
        throw new Error("The model changed. Preview this edit again.");
      for (const t of update.tables)
        if (
          t.caseId !== id ||
          (tables.has(t.id) && tables.get(t.id)!.caseId !== id)
        )
          throw new Error("A table belongs to another use case.");
      const obsolete = [
        ...current.tableIds.map((id) => tables.get(id)!),
        ...(current.undo?.tables ?? []),
      ];
      for (const tableId of current.tableIds)
        if (!update.tables.some((t) => t.id === tableId))
          tables.delete(tableId);
      for (const t of update.tables) tables.set(t.id, clone(t));
      const { tables: _, ...model } = update;
      cases.set(
        id,
        clone({
          ...current,
          ...model,
          tableIds: update.tables.map((t) => t.id),
          revision: expectedRevision + 1,
          updatedAt: Date.now(),
          modelVersion: 2,
        }),
      );
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
