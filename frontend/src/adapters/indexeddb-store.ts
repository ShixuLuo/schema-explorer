import type { WorkspaceStore, CaseInfoPatch } from "../application/ports.ts";
import { restoreWorkspace, type UseCase } from "../model/workspace.ts";
import type { Table, CellValue } from "../model/schema.ts";
import { rowWriter } from "./row-writer.ts";
type StoredChunk = { tableId: string; index: number; rows: CellValue[][] };
const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
const finished = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () =>
      reject(tx.error ?? new Error("Storage transaction was cancelled."));
  });

export function createIndexedDbStore(
  options: { name?: string; factory?: IDBFactory } = {},
): WorkspaceStore {
  const name = options.name ?? "schema-explorer-v0",
    factory = options.factory ?? globalThis.indexedDB;
  let connection: Promise<IDBDatabase> | undefined;
  function database(): Promise<IDBDatabase> {
    return (connection ??= new Promise((resolve, reject) => {
      const req = factory.open(name, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore("useCases", { keyPath: "id" });
        db.createObjectStore("tables", { keyPath: "id" });
        const chunks = db.createObjectStore("chunks", {
          keyPath: ["tableId", "index"],
        });
        chunks.createIndex("tableId", "tableId");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () =>
        reject(
          new Error(
            "Browser storage is unavailable. Check your browser settings.",
          ),
        );
    }));
  }
  async function writeChunk(chunk: StoredChunk) {
    const db = await database();
    const tx = db.transaction("chunks", "readwrite");
    const done = finished(tx);
    tx.objectStore("chunks").put(chunk);
    await done;
  }
  async function removeReferences(tableIds: string[]) {
    const db = await database();
    for (const id of tableIds) {
      const tx = db.transaction("chunks", "readwrite");
      const done = finished(tx);
      const cursor = tx
        .objectStore("chunks")
        .index("tableId")
        .openKeyCursor(IDBKeyRange.only(id));
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (item) {
          tx.objectStore("chunks").delete(item.primaryKey);
          item.continue();
        }
      };
      await done;
    }
  }
  async function readRows(
    table: Table,
    offset: number,
    limit = 50,
  ): Promise<CellValue[][]> {
    limit = Math.min(100, Math.max(1, limit));
    const db = await database();
    const tableId = table.dataId ?? table.id;
    const cursor = await request(
      db
        .transaction("chunks")
        .objectStore("chunks")
        .openCursor(IDBKeyRange.bound([tableId, 0], [tableId, offset]), "prev"),
    );
    if (!cursor) return [];
    let chunk = cursor.value as StoredChunk | undefined;
    const result: CellValue[][] = [];
    while (chunk && result.length < limit) {
      result.push(
        ...chunk.rows.slice(
          Math.max(0, offset - chunk.index),
          Math.max(0, offset - chunk.index) + limit - result.length,
        ),
      );
      const next = chunk.index + chunk.rows.length;
      chunk = await request<StoredChunk | undefined>(
        db.transaction("chunks").objectStore("chunks").get([tableId, next]),
      );
    }
    return result;
  }

  const ref = (table: Table) => table.dataId ?? table.id;
  const readCase = async (id: string) => {
    const db = await database();
    const value = await request<UseCase | undefined>(
      db.transaction("useCases").objectStore("useCases").get(id),
    );
    return value ? restoreWorkspace(value) : undefined;
  };
  const snapshot = async (id: string) => {
    const db = await database(),
      tx = db.transaction(["useCases", "tables"]);
    const raw = await request<UseCase | undefined>(
      tx.objectStore("useCases").get(id),
    );
    if (!raw) throw new Error("This use case no longer exists.");
    const useCase = restoreWorkspace(raw);
    const tables = await Promise.all(
      useCase.tableIds.map((id) =>
        request<Table | undefined>(tx.objectStore("tables").get(id)),
      ),
    );
    if (tables.some((t) => !t))
      throw new Error("Stored table metadata is unavailable.");
    return { useCase, tables: tables as Table[] };
  };
  const discardReferences = async (references: string[]) => {
    if (!references.length) return;
    const db = await database(),
      tx = db.transaction(["tables", "useCases"]);
    const [tables, cases] = await Promise.all([
      request<Table[]>(tx.objectStore("tables").getAll()),
      request<UseCase[]>(tx.objectStore("useCases").getAll()),
    ]);
    const live = new Set(
      [...tables, ...cases.flatMap((c) => c.undo?.tables ?? [])].map(ref),
    );
    await removeReferences(
      [...new Set(references)].filter((id) => !live.has(id)),
    );
  };
  return {
    async listCases() {
      const db = await database();
      return (
        await request<UseCase[]>(
          db.transaction("useCases").objectStore("useCases").getAll(),
        )
      )
        .map(restoreWorkspace)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async addCase(value) {
      const db = await database(),
        tx = db.transaction("useCases", "readwrite"),
        done = finished(tx);
      tx.objectStore("useCases").add(value);
      await done;
    },
    readCase,
    snapshot,
    async patchInfo(id, patch: CaseInfoPatch) {
      const db = await database(),
        tx = db.transaction("useCases", "readwrite"),
        done = finished(tx),
        store = tx.objectStore("useCases");
      try {
        const stored = await request<UseCase | undefined>(store.get(id));
        if (!stored) throw new Error("This use case no longer exists.");
        if (
          Object.keys(patch).some(
            (key) =>
              !["name", "positions", "viewport", "dismissed"].includes(key),
          )
        )
          throw new Error("Model changes must use Preview and Apply.");
        const next = {
          ...restoreWorkspace(stored),
          ...patch,
          id,
          updatedAt: Date.now(),
        };
        store.put(next);
        await done;
        return next;
      } catch (error) {
        try {
          tx.abort();
        } catch {}
        await done.catch(() => {});
        throw error;
      }
    },
    async deleteEmpty(id) {
      const db = await database(),
        tx = db.transaction("useCases", "readwrite"),
        done = finished(tx),
        store = tx.objectStore("useCases");
      const c = await request<UseCase | undefined>(store.get(id));
      if (c && !c.tableIds.length) store.delete(id);
      await done;
    },
    async *rows(table) {
      const db = await database();
      for (let offset = 0; offset < table.rowCount;) {
        const chunk = await request<StoredChunk | undefined>(
          db
            .transaction("chunks")
            .objectStore("chunks")
            .get([ref(table), offset]),
        );
        if (
          !chunk ||
          !chunk.rows.length ||
          chunk.index !== offset ||
          offset + chunk.rows.length > table.rowCount
        )
          throw new Error(
            "Some stored data is unavailable. Reimport this table in a new use case.",
          );
        for (let i = 0; i < chunk.rows.length; i += 200)
          yield { offset: offset + i, rows: chunk.rows.slice(i, i + 200) };
        offset += chunk.rows.length;
      }
    },
    readRows,
    stage(table) {
      return rowWriter(table, {
        put: async (reference, index, rows) =>
          writeChunk({ tableId: reference, index, rows }),
        discard: async (reference) => discardReferences([reference]),
      });
    },
    async commit(id, expectedRevision, update) {
      const db = await database(),
        tx = db.transaction(["useCases", "tables"], "readwrite"),
        done = finished(tx);
      const cases = tx.objectStore("useCases"),
        metadata = tx.objectStore("tables");
      let obsolete: Table[] = [];
      try {
        const raw = await request<UseCase | undefined>(cases.get(id));
        if (!raw) throw new Error("This use case no longer exists.");
        const current = restoreWorkspace(raw);
        if ((current.revision ?? 0) !== expectedRevision)
          throw new Error("The model changed. Preview this edit again.");
        const owned = await Promise.all(
          update.tables.map((t) =>
            request<Table | undefined>(metadata.get(t.id)),
          ),
        );
        if (
          update.tables.some(
            (t, i) => t.caseId !== id || (owned[i] && owned[i]!.caseId !== id),
          )
        )
          throw new Error("A table belongs to another use case.");
        obsolete = [
          ...(await Promise.all(
            current.tableIds.map((id) => request<Table>(metadata.get(id))),
          )),
          ...(current.undo?.tables ?? []),
        ];
        const retained = new Set(update.tables.map((t) => t.id));
        for (const oldId of current.tableIds)
          if (!retained.has(oldId)) metadata.delete(oldId);
        for (const table of update.tables) metadata.put(table);
        const { tables: _, ...model } = update;
        cases.put({
          ...current,
          ...model,
          tableIds: update.tables.map((t) => t.id),
          revision: expectedRevision + 1,
          updatedAt: Date.now(),
          modelVersion: 2,
        });
        await done;
      } catch (error) {
        try {
          tx.abort();
        } catch {}
        await done.catch(() => {});
        throw error;
      }
      await discardReferences(obsolete.map(ref)).catch(() => {});
    },
    async discard(tables) {
      await discardReferences(tables.map(ref));
    },
    async close() {
      if (connection) {
        (await connection).close();
        connection = undefined;
      }
    },
  };
}
