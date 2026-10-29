import path from "node:path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  compilePlan,
  schemaStatements,
  sqlScript,
} from "../frontend/src/adapters/postgres-compiler.ts";
const config = existsSync(".local/cql.json")
  ? JSON.parse(readFileSync(".local/cql.json", "utf8"))
  : {};
config.java = process.env.CQL_JAVA || config.java;
config.jar = process.env.CQL_JAR || config.jar;
if (!config.java || !config.jar)
  throw new Error("Offline verification requires CQL_JAVA and CQL_JAR.");
mkdirSync(".local/verification", { recursive: true });
const compiled = spawnSync(
  path.join(path.dirname(config.java), "javac"),
  [
    "-cp",
    config.jar,
    "-d",
    ".local/verification",
    "verification/CqlOracle.java",
  ],
  { encoding: "utf8" },
);
if (compiled.status !== 0) throw new Error(compiled.stderr);
const run = spawnSync(
  config.java,
  [
    "-Djava.awt.headless=true",
    "-Dpolyglot.engine.WarnInterpreterOnly=false",
    "-Dpolyglotimpl.AttachLibraryFailureAction=ignore",
    "-cp",
    `${config.jar}${path.delimiter}.local/verification`,
    "CqlOracle",
    "verification/elementary-arrows.cql",
  ],
  { encoding: "utf8", timeout: 45000 },
);
if (run.status !== 0) throw new Error(run.stderr || run.stdout);
const oracle = JSON.parse(run.stdout),
  results = [];
// Compare finite attributed graphs up to a bijection on each entity, including
// duplicates and every foreign-key edge. Storage IDs need not equal CQL terms.
function isomorphic(actual, expected, arrows) {
  const entities = Object.keys(actual);
  if (entities.some((e) => actual[e].length !== expected[e].length))
    return false;
  const assigned = Object.fromEntries(entities.map((e) => [e, new Map()]));
  const used = Object.fromEntries(entities.map((e) => [e, new Set()]));
  const rows = entities.flatMap((e) =>
    actual[e].map((row) => ({ entity: e, row })),
  );
  const values = (e, r) =>
    Object.entries(r)
      .filter(
        ([k]) =>
          k !== "__id" && !arrows.some((a) => a.source === e && a.name === k),
      )
      .sort(([a], [b]) => a.localeCompare(b));
  const candidates = rows.map(({ entity: e, row }) =>
    expected[e].filter(
      (r) => JSON.stringify(values(e, row)) === JSON.stringify(values(e, r)),
    ),
  );
  const order = rows
    .map((_, i) => i)
    .sort((a, b) => candidates[a].length - candidates[b].length);
  function consistent() {
    for (const a of arrows)
      for (const [id, target] of assigned[a.source]) {
        const source = actual[a.source].find((r) => r.__id === id);
        if (
          !actual[a.target].some((r) => r.__id === source[a.name]) ||
          !expected[a.target].some((r) => r.__id === target[a.name])
        )
          return false;
        const mapped = assigned[a.target].get(source[a.name]);
        if (mapped && mapped.__id !== target[a.name]) return false;
      }
    return true;
  }
  function visit(at) {
    if (at === order.length) return true;
    const i = order[at],
      { entity: e, row } = rows[i];
    for (const r of candidates[i])
      if (!used[e].has(r.__id)) {
        assigned[e].set(row.__id, r);
        used[e].add(r.__id);
        if (consistent() && visit(at + 1)) return true;
        assigned[e].delete(row.__id);
        used[e].delete(r.__id);
      }
    return false;
  }
  return visit(0);
}
const id = (table) => ({
  id: table + "id",
  name: "id",
  dataType: "integer",
  nullable: false,
  generated: "identity",
});
const text = (name) => ({ id: name, name, dataType: "text", nullable: false });
const carrier = (name) => ({
  id: name,
  name,
  dataType: "integer",
  nullable: false,
  storage: "reference",
});
const fk = (name, source, target) => ({
  id: name,
  source_table: source,
  source_columns: [name],
  target_table: target,
  target_columns: [target + "id"],
});
const elementary = {
  tables: [
    { id: "A", name: "A", columns: [text("value")], primaryKey: [] },
    { id: "B", name: "B", columns: [id("B")], primaryKey: ["Bid"] },
  ],
  foreign_keys: [],
};
const chain = {
  tables: [
    {
      id: "X",
      name: "X",
      columns: [id("X"), text("xvalue"), carrier("incoming")],
      primaryKey: ["Xid"],
    },
    {
      id: "A",
      name: "A",
      columns: [id("A"), text("value")],
      primaryKey: ["Aid"],
    },
    {
      id: "B",
      name: "B",
      columns: [id("B"), carrier("next")],
      primaryKey: ["Bid"],
    },
    { id: "C", name: "C", columns: [id("C")], primaryKey: ["Cid"] },
  ],
  foreign_keys: [fk("incoming", "X", "A"), fk("next", "B", "C")],
};
const datasets = [
  {
    name: "Added",
    schema: elementary,
    rows: { A: [["v10"], ["v20"]], B: [[7], [12]] },
  },
  {
    name: "Chain",
    schema: chain,
    rows: {
      X: [
        [4, "v10", 5],
        [9, "v20", 8],
      ],
      A: [
        [5, "v10"],
        [8, "v20"],
      ],
      B: [
        [7, 11],
        [12, 11],
      ],
      C: [[11]],
    },
  },
  {
    name: "Duplicate",
    schema: chain,
    rows: {
      X: [
        [4, "v10", 5],
        [9, "v10", 5],
      ],
      A: [
        [5, "v10"],
        [8, "v10"],
      ],
      B: [[7, 11]],
      C: [[11]],
    },
  },
  {
    name: "EmptyTarget",
    schema: chain,
    rows: { X: [[4, "v10", 5]], A: [[5, "v10"]], B: [], C: [] },
  },
];
for (const data of datasets)
  for (const method of ["sigma", "pi"]) {
    const db = new PGlite();
    try {
      await db.exec(
        schemaStatements({ ...data.schema, foreign_keys: [] }).join("\n"),
      );
      for (const [name, rows] of Object.entries(data.rows))
        for (const row of rows)
          await db.query(
            `INSERT INTO "${name}" VALUES(${row.map((_, i) => "$" + (i + 1)).join(",")})`,
            row,
          );
      // Enforce the source graph after bulk loading, just as preview does.
      const constraints = schemaStatements(data.schema).filter((s) =>
        s.includes("FOREIGN KEY"),
      );
      await db.exec(constraints.join("\n"));
      const operation = {
        op: "add_reference",
        table_id: "A",
        columns: [carrier("f")],
        foreign_key: fk("f", "A", "B"),
        method,
      };
      const plan = compilePlan(data.schema, [operation]);
      await db.exec(sqlScript(plan.steps.flatMap((s) => s.statements)));
      const graph = {};
      for (const table of plan.schema.tables) {
        const fields = [
          table.primaryKey.length
            ? 'id::text AS "__id"'
            : 'row_number() OVER ()::text AS "__id"',
          ...table.columns
            .filter((c) => !c.generated)
            .map((c) =>
              c.storage ? `"${c.name}"::text AS "${c.name}"` : `"${c.name}"`,
            ),
        ];
        graph[table.id] = (
          await db.query(`SELECT ${fields.join(",")} FROM "${table.name}"`)
        ).rows;
      }
      const arrows = plan.schema.foreign_keys.map((f) => ({
        name: f.id,
        source: f.source_table,
        target: f.target_table,
      }));
      const expected =
        oracle[data.name + (method === "sigma" ? "Sigma" : "Pi")];
      assert.ok(
        isomorphic(graph, expected, arrows),
        JSON.stringify({ name: data.name, method, graph, expected }),
      );
      // A same-row-count graph with a redirected incoming edge must be rejected.
      if (data.name === "Chain" && method === "sigma") {
        const wrong = structuredClone(graph);
        wrong.X[0].incoming = wrong.X[1].incoming;
        assert.equal(isomorphic(wrong, expected, arrows), false);
      }
      results.push({
        dataset: data.name,
        method,
        rows: Object.fromEntries(
          Object.entries(graph).map(([e, r]) => [e, r.length]),
        ),
        fullGraphIsomorphic: true,
      });
    } finally {
      await db.close();
    }
  }
const db = new PGlite();
try {
  await db.exec(schemaStatements(elementary).join("\n"));
  await db.exec(
    `INSERT INTO "A" VALUES('v10'),('v20');INSERT INTO "B" DEFAULT VALUES;INSERT INTO "B" DEFAULT VALUES;`,
  );
  const plan = compilePlan(elementary, [
    {
      op: "add_attribute",
      table_id: "A",
      column: text("added"),
      parameters: { template: "constant", value: { type: "text", value: "n" } },
    },
  ]);
  await db.exec(sqlScript(plan.steps.flatMap((s) => s.statements)));
  const actual = {
    A: (
      await db.query(
        'SELECT row_number() OVER ()::text AS "__id",value,added FROM "A"',
      )
    ).rows,
    B: (await db.query('SELECT id::text AS "__id" FROM "B"')).rows,
  };
  assert.ok(isomorphic(actual, oracle.AddedConstant, []));
  results.push({
    dataset: "AddedConstant",
    method: "delta",
    fullGraphIsomorphic: true,
  });
} finally {
  await db.close();
}
writeFileSync(
  "verification/elementary-arrows-reference.json",
  JSON.stringify(
    {
      cqlVersion: config.version,
      comparison: "attributed graph isomorphism, all identities and references",
      results,
      oracle,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "CQL agrees with SQL for all " +
    results.length +
    " complete-instance comparisons.",
);
