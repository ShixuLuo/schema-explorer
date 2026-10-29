import type { CaseInfoPatch, WorkspaceStore } from "../application/ports.ts";
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
  async function readRows(
    table: Table,
    offset: number,
    limit = 50,
  ): Promise<CellValue[][]> {
    limit = Math.min(100, Math.max(1, limit));
    if (table.dataStatus === "unverified")
      throw new Error(
        "Sample data has not been migrated to this schema. The original data is retained in the previous validated checkpoint.",
      );
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
  async function loadTables(
    store: IDBObjectStore,
    ids: string[],
  ): Promise<Table[]> {
    const values = await Promise.all(
      ids.map((id) => request<Table | undefined>(store.get(id))),
    );
    if (values.some((table) => !table))
      throw new Error("Stored table metadata is unavailable.");
    return values as Table[];
  }
  const readWorkspace = async (id: string) => {
    const db = await database(),
      tx = db.transaction(["useCases", "tables"]);
    const raw = await request<WorkspaceRecord | undefined>(
      tx.objectStore("useCases").get(id),
    );
    if (!raw) return;
    const useCase = loadedWorkspace(raw);
    const tables = await loadTables(tx.objectStore("tables"), useCase.tableIds);
    return { useCase, tables };
  };
  const readCase = async (id: string) => {
    const db = await database();
    const raw = await request<WorkspaceRecord | undefined>(
      db.transaction("useCases").objectStore("useCases").get(id),
    );
    return raw ? loadedWorkspace(raw) : undefined;
  };
  const snapshot = async (id: string) => {
    const value = await readWorkspace(id);
    if (!value) throw new Error("This use case no longer exists.");
    return value;
  };
  const discardReferences = async (references: string[]) => {
    if (!references.length) return;
    // Keep the live-reference check and reclamation in the same transaction.
    // A concurrent checkpoint publication cannot race this deletion.
    const db = await database(),
      tx = db.transaction(["tables", "useCases", "chunks"], "readwrite"),
      done = finished(tx);
    try {
      const [tables, cases] = await Promise.all([
        request<Table[]>(tx.objectStore("tables").getAll()),
        request<WorkspaceRecord[]>(tx.objectStore("useCases").getAll()),
      ]);
      const byId = new Map(tables.map((table) => [table.id, table]));
      if (cases.some((record) => record.tableIds.some((id) => !byId.has(id))))
        throw new Error("Stored table metadata is unavailable.");
      const live = new Set(
        [...tables, ...cases.flatMap(storedTables)].map(ref),
      );
      const chunks = tx.objectStore("chunks");
      for (const id of new Set(references)) {
        if (live.has(id)) continue;
        const cursor = chunks
          .index("tableId")
          .openKeyCursor(IDBKeyRange.only(id));
        cursor.onsuccess = () => {
          const item = cursor.result;
          if (item) {
            chunks.delete(item.primaryKey);
            item.continue();
          }
        };
      }
      await done;
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw error;
    }
  };
  return {
    async listCases() {
      const db = await database();
      const cases = await request<WorkspaceRecord[]>(
        db.transaction("useCases").objectStore("useCases").getAll(),
      );
      return cases.map(caseInfo).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async load(id) {
      const db = await database(),
        tx = db.transaction(["useCases", "tables"], "readwrite"),
        done = finished(tx);
      try {
        const records = tx.objectStore("useCases");
        const raw = await request<WorkspaceRecord | undefined>(records.get(id));
        if (!raw) throw new Error("This use case no longer exists.");
        const tables = restoredTables(
          await loadTables(tx.objectStore("tables"), raw.tableIds),
          raw.relationships,
        );
        const useCase = {
          ...restoreWorkspace(raw, tables),
          updatedAt: Date.now(),
        };
        for (const table of tables) tx.objectStore("tables").put(table);
        records.put(useCase);
        await done;
        return { useCase, tables };
      } catch (error) {
        try {
          tx.abort();
        } catch {}
        await done.catch(() => {});
        throw error;
      }
    },
    async updateTags(id, change) {
      const db = await database(),
        tx = db.transaction("useCases", "readwrite"),
        done = finished(tx);
      try {
        const records = tx.objectStore("useCases");
        const raw = await request<WorkspaceRecord | undefined>(records.get(id));
        if (!raw) throw new Error("This use case no longer exists.");
        records.put(publishTags(loadedWorkspace(raw), change));
        await done;
      } catch (error) {
        try {
          tx.abort();
        } catch {}
        await done.catch(() => {});
        throw error;
      }
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
        const stored = await request<WorkspaceRecord | undefined>(
          store.get(id),
        );
        if (!stored) throw new Error("This use case no longer exists.");
        if (
          Object.keys(patch).some(
            (key) => !["name", "positions", "viewport"].includes(key),
          )
        )
          throw new Error("Model changes must use a draft and Commit.");
        const next = {
          ...loadedWorkspace(stored),
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
      const c = await request<WorkspaceRecord | undefined>(store.get(id));
      if (
        c &&
        !c.tableIds.length &&
        !loadedWorkspace(c).history.checkpoints.length
      )
        store.delete(id);
      await done;
    },
    async *rows(table) {
      if (table.dataStatus === "unverified")
        throw new Error(
          "Sample data has not been migrated to this schema. The original data is retained in the previous validated checkpoint.",
        );
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
    async commit(id, expectedRevision, publication) {
      const db = await database(),
        tx = db.transaction(["useCases", "tables"], "readwrite"),
        done = finished(tx);
      const cases = tx.objectStore("useCases"),
        metadata = tx.objectStore("tables");
      let obsolete: Table[] = [];
      try {
        const raw = await request<WorkspaceRecord | undefined>(cases.get(id));
        if (!raw) throw new Error("This use case no longer exists.");
        const currentTables = await loadTables(metadata, raw.tableIds);
        const current = loadedWorkspace(raw);
        const next = publishModel(current, expectedRevision, publication);
        const owned = await Promise.all(
          next.tables.map((t) =>
            request<Table | undefined>(metadata.get(t.id)),
          ),
        );
        if (
          next.tables.some(
            (t, i) => t.caseId !== id || (owned[i] && owned[i]!.caseId !== id),
          )
        )
          throw new Error("A table belongs to another use case.");
        obsolete = [...currentTables, ...retainedTables(current)];
        const retained = new Set(next.tables.map((t) => t.id));
        for (const oldId of current.tableIds)
          if (!retained.has(oldId)) metadata.delete(oldId);
        for (const table of next.tables) metadata.put(table);
        cases.put(next.useCase);
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
