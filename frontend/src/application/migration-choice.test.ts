import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { createMemoryStore } from "../adapters/memory-store.ts";
import { createIndexedDbStore } from "../adapters/indexeddb-store.ts";
import { createPostgresEngine } from "../adapters/postgres-engine.ts";
import { EditSession, createEditActions } from "./editor.ts";
import { createUseCase, publishImport } from "./workspaces.ts";
import { exportSql } from "./export.ts";
import type { Table } from "../model/schema.ts";
for (const kind of ["memory", "indexeddb"])
  test(`${kind}: changing Sigma/Pi recomputes from one base, commits exact results and exports the selected SQL`, async () => {
    const store =
      kind === "memory"
        ? createMemoryStore()
        : createIndexedDbStore({
            factory: new IDBFactory(),
            name: "choice-" + crypto.randomUUID(),
          });
    const useCase = await createUseCase(store),
      tables: Table[] = [];
    for (const id of ["A", "B"]) {
      const table: Table = {
        id,
        caseId: useCase.id,
        name: id,
        fileName: "",
        bytes: 0,
        rowCount: 2,
        primaryKey: id === "B" ? ["bid"] : [],
        columns: [
          {
            id: id === "B" ? "bid" : "value",
            name: id === "B" ? "id" : "value",
            index: 0,
            dataType: "integer",
            nullable: false,
            ...(id === "B" ? { generated: "identity" as const } : {}),
          },
        ],
      };
      const writer = store.stage(table);
      await writer.append(id === "A" ? [["10"], ["20"]] : [["1"], ["2"]]);
      tables.push(await writer.finish(table));
    }
    await publishImport(store, await store.snapshot(useCase.id), tables);
    const original = await store.snapshot(useCase.id),
      session = new EditSession(
        useCase.id,
        createEditActions(store, createPostgresEngine()),
        () => {},
      );
    await session.append([
      {
        op: "add_reference",
        table_id: "A",
        columns: [
          {
            id: "target",
            name: "target",
            dataType: "integer",
            nullable: false,
          },
        ],
        foreign_key: {
          id: "f",
          source_table: "A",
          source_columns: ["target"],
          target_table: "B",
          target_columns: ["bid"],
        },
        method: "sigma",
      },
    ]);
    assert.equal((await session.readRows("B", 0)).length, 4);
    const changed = await session.chooseMethod(0, "pi");
    assert.equal(changed.plan?.length, 1);
    assert.equal(
      changed.comparison.after.tables.find((t) => t.id === "A")?.rowCount,
      4,
    );
    assert.equal((await session.readRows("B", 0)).length, 2);
    await session.commit();
    const saved = await store.snapshot(useCase.id);
    assert.equal(saved.tables.find((t) => t.id === "A")?.rowCount, 4);
    const sql = await exportSql(store, createPostgresEngine(), useCase.id, {
      from: original.useCase.history.editing!,
      to: saved.useCase.history.editing!,
    });
    assert.match(sql.migration ?? "", /CROSS JOIN/);
    assert.doesNotMatch(sql.migration ?? "", /nextval/);
    session.dispose();
    await store.close();
  });
