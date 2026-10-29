import { importFiles } from "../application/import.ts";
import { createUseCase } from "../application/workspaces.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readCsv, readCsvHeaders } from "./csv.ts";
import { createMemoryStore } from "./memory-store.ts";
class TestFileReader {
  onload?: (event: { target: { result: string } }) => void;
  onerror?: (error: unknown) => void;
  readAsText(blob: Blob) {
    void blob.text().then(
      (result) => this.onload?.({ target: { result } }),
      (error) => this.onerror?.(error),
    );
  }
}
globalThis.FileReader = TestFileReader as unknown as typeof FileReader;
async function parse(text: string, primaryKey?: string) {
  const store = createMemoryStore();
  const table = await readCsv(
    new File([text], "input.csv"),
    "test-case",
    "test-table",
    store,
    () => {},
    primaryKey,
  );
  return {
    columns: table.columns.map((c) => c.name),
    rows: await store.readRows(table, 0, 1000),
  };
}
test("CSV omits unnamed empty fields consistently, retaining named empty columns and exact values", async () => {
  assert.deepEqual(
    await parse("name,,code,empty,\nAlice,,001,,\nBob,,002,,\n"),
    {
      columns: ["_id", "name", "code", "empty"],
      rows: [
        ["1", "Alice", "001", ""],
        ["2", "Bob", "002", ""],
      ],
    },
  );
});
test("CSV rejects unnamed values, even after staged rows, and still rejects duplicate names and width mismatches", async () => {
  await assert.rejects(
    parse(
      "name,\n" +
        Array.from({ length: 250 }, (_, i) => `row${i},`).join("\n") +
        "\nlast,not empty\n",
    ),
    /column 2 has data but no header/,
  );
  await assert.rejects(parse("name,name,\na,b,\n"), /unique column headers/);
  await assert.rejects(parse("name,\na\n"), /expected 2 fields/);
  await assert.rejects(parse("name,\na, \n"), /no header/);
});

test("CSV identity is an explicit selected column or a one-based generated row number", async () => {
  const file = new File(["code,name\n001,Ada\n002,Ada\n"], "people.csv");
  assert.deepEqual(await readCsvHeaders(file), ["code", "name"]);
  const store = createMemoryStore();
  const selected = await readCsv(
    file,
    "x",
    "selected",
    store,
    () => {},
    "code",
  );
  assert.deepEqual(selected.primaryKey, ["selected:0"]);
  assert.equal(selected.columns[0].storage, "identity");
  assert.deepEqual(await store.readRows(selected, 0), [
    ["001", "Ada"],
    ["002", "Ada"],
  ]);
  const numbered = await readCsv(
    new File(["name\nAda\nAda\n"], "people.csv"),
    "x",
    "numbered",
    store,
    () => {},
  );
  assert.equal(numbered.columns[0].name, "_id");
  assert.equal(numbered.columns[0].generated, "identity");
  assert.deepEqual(numbered.primaryKey, [numbered.columns[0].id]);
  assert.deepEqual(await store.readRows(numbered, 0), [
    ["1", "Ada"],
    ["2", "Ada"],
  ]);
  await store.close();
});
test("CSV primary key checks reject empty or repeated values across chunks and do not infer from names", async () => {
  await assert.rejects(parse("id,name\n,a\n", "id"), /primary key id is empty/);
  const rows = Array.from({ length: 250 }, (_, i) => `${i},person${i}`).join(
    "\n",
  );
  await assert.rejects(
    parse(`id,name\n${rows}\n0,duplicate\n`, "id"),
    /duplicate value/,
  );
  await assert.rejects(
    parse("id,name\n1,a\n", "missing"),
    /selected primary key column/,
  );
  await assert.rejects(parse("_id,name\n1,a\n"), /already has an _id/);
  assert.deepEqual(await parse("_id,name\n1,a\n", "_id"), {
    columns: ["_id", "name"],
    rows: [["1", "a"]],
  });
});

test("a failed selected-key import publishes no partial tables or checkpoint", async () => {
  const store = createMemoryStore(),
    useCase = await createUseCase(store);
  try {
    await assert.rejects(
      importFiles(
        store,
        readCsv,
        useCase.id,
        [
          { file: new File(["name\nAda\n"], "good.csv") },
          { file: new File(["code\n1\n1\n"], "bad.csv"), primaryKey: "code" },
        ],
        () => {},
      ),
      /duplicate value/,
    );
    let saved = await store.snapshot(useCase.id);
    assert.equal(saved.tables.length, 0);
    assert.equal(saved.useCase.history.checkpoints.length, 0);
    await importFiles(
      store,
      readCsv,
      useCase.id,
      [
        {
          file: new File(["code\n001\n002\n"], "good.csv"),
          primaryKey: "code",
        },
      ],
      () => {},
    );
    saved = await store.snapshot(useCase.id);
    assert.equal(saved.tables.length, 1);
    assert.equal(saved.useCase.history.checkpoints.length, 1);
    assert.deepEqual(await store.readRows(saved.tables[0], 0), [
      ["001"],
      ["002"],
    ]);
  } finally {
    await store.close();
  }
});
