import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import {
  compilePlan,
  schemaStatements,
} from "../frontend/src/adapters/postgres-compiler.ts";
const config = existsSync(".local/cql.json")
  ? JSON.parse(readFileSync(".local/cql.json", "utf8"))
  : {};
config.java = process.env.CQL_JAVA || config.java;
config.jar = process.env.CQL_JAR || config.jar;
if (!config.java || !config.jar)
  throw new Error(
    "Offline verification requires CQL_JAVA and CQL_JAR. The app itself does not need CQL.",
  );
mkdirSync(".local/verification", { recursive: true });
const javac = path.join(path.dirname(config.java), "javac");
let run = spawnSync(
  javac,
  [
    "-cp",
    config.jar,
    "-d",
    ".local/verification",
    "verification/CqlOracle.java",
  ],
  { encoding: "utf8" },
);
if (run.status !== 0) throw new Error(run.stderr);
run = spawnSync(
  config.java,
  [
    "-Djava.awt.headless=true",
    "-Dpolyglot.engine.WarnInterpreterOnly=false",
    "-Dpolyglotimpl.AttachLibraryFailureAction=ignore",
    "-cp",
    `${config.jar}${path.delimiter}.local/verification`,
    "CqlOracle",
    "verification/adjoints.cql",
  ],
  { encoding: "utf8", timeout: 45000 },
);
if (run.status !== 0) throw new Error(run.stderr || run.stdout);
const reference = JSON.parse(run.stdout),
  input = JSON.parse(readFileSync("verification/input.json", "utf8"));
const table = (id) => ({
  id,
  name: id,
  primaryKey: [],
  columns: [
    { id: id + "v", name: "value", dataType: "text", nullable: true },
    { id: id + "n", name: "number", dataType: "integer", nullable: false },
  ],
});
const base = { tables: [table("left"), table("right")], foreign_keys: [] };
const combine = (id, sources, method) => ({
  op: "combine_tables",
  inputs: sources.map((table_id) => ({
    table_id,
    column_ids: [table_id + "v", table_id + "n"],
  })),
  table: table(id),
  method,
});
const operations = [
  combine("sum", ["left", "right"], "sigma"),
  combine("matched", ["left", "right"], "pi"),
  {
    op: "copy_table",
    table_id: "matched",
    column_ids: ["matchedv", "matchedn"],
    table: table("copy"),
  },
  combine("mixed", ["matched", "copy"], "sigma"),
];
const db = new PGlite();
try {
  await db.exec(schemaStatements(base).join("\n"));
  for (const id of ["left", "right"])
    for (const row of input[id])
      await db.query(`INSERT INTO "${id}" VALUES ($1,$2)`, row);
  const plan = compilePlan(base, operations);
  await db.exec(plan.steps.flatMap((s) => s.statements).join("\n"));
  const results = {};
  for (const [id, ref] of [
    ["sum", reference.Sum.T],
    ["matched", reference.Matched.T],
    ["copy", reference.Copies.A],
    ["mixed", reference.Mixed.T],
  ]) {
    const actual = (
      await db.query(`SELECT value,number::text FROM "${id}"`, [], {
        rowMode: "array",
      })
    ).rows;
    const expected = ref.map((row) =>
      [row.value ?? row.av, row.number ?? row.an].map((value) =>
        value === "n" ? null : value.slice(1),
      ),
    );
    const normalized = (rows) => rows.map(JSON.stringify).sort();
    assert.deepEqual(normalized(actual), normalized(expected));
    results[id] = actual.length;
  }
  writeFileSync(
    "verification/cql-reference.json",
    JSON.stringify(
      { cqlVersion: config.version, templateVersion: 1, results, reference },
      null,
      2,
    ),
  );
  console.log("CQL and PostgreSQL templates agree:", results);
} finally {
  await db.close();
}
