import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import test from "node:test";
import {
  compilePlan,
  schemaStatements,
  sqlScript,
} from "../adapters/postgres-compiler.ts";
import { pendingAttributes } from "../model/attribute-template.ts";
import {
  bindingEquations,
  databasePresentation,
} from "../model/database-presentation.ts";
import type { ColumnSpec, Operation, SchemaSpec } from "../model/operations.ts";
import { fieldArrowOperations } from "./foreign-key-plan.ts";
const c = (id: string, generated = false, storage = false): ColumnSpec => ({
  id,
  name: id,
  dataType: "integer",
  nullable: false,
  ...(generated ? { generated: "identity" as const } : {}),
  ...(storage ? { storage: "reference" as const } : {}),
});
const schema: SchemaSpec = {
  tables: [
    {
      id: "A",
      name: "A",
      columns: [
        c("aid", true),
        c("left", false, true),
        c("right", false, true),
      ],
      primaryKey: ["aid"],
    },
    {
      id: "B",
      name: "B",
      columns: [c("bid", true), c("value"), c("next", false, true)],
      primaryKey: ["bid"],
    },
    {
      id: "C",
      name: "C",
      columns: [c("cid", true), c("label")],
      primaryKey: ["cid"],
    },
    {
      id: "X",
      name: "X",
      columns: [c("parent", false, true)],
      primaryKey: [],
    },
  ],
  foreign_keys: [
    {
      id: "l",
      source_table: "A",
      source_columns: ["left"],
      target_table: "B",
      target_columns: ["bid"],
    },
    {
      id: "r",
      source_table: "A",
      source_columns: ["right"],
      target_table: "B",
      target_columns: ["bid"],
    },
    {
      id: "next",
      source_table: "B",
      source_columns: ["next"],
      target_table: "C",
      target_columns: ["cid"],
    },
    {
      id: "parent",
      source_table: "X",
      source_columns: ["parent"],
      target_table: "B",
      target_columns: ["bid"],
    },
  ],
};
const eq: Operation = {
  op: "add_equation",
  table_id: "A",
  method: "sigma",
  equation: {
    id: "eq",
    left: { source: "A", arrows: ["reference:l"] },
    right: { source: "A", arrows: ["reference:r"] },
  },
};
async function seeded(conflict = false) {
  const db = new PGlite();
  await db.exec(schemaStatements(schema).join("\n"));
  await db.exec(
    `INSERT INTO "C" VALUES(1,90),(2,90);INSERT INTO "B" VALUES(1,10,1),(2,${conflict ? 20 : 10},2);INSERT INTO "A" VALUES(1,1,2);INSERT INTO "X" VALUES(2);`,
  );
  return db;
}
test("Sigma relation performs congruence closure, rewrites incoming arrows, and composes with later rename/drop", async () => {
  const db = await seeded();
  try {
    const plan = compilePlan(schema, [
      eq,
      { op: "rename_table", table_id: "B", new_name: "People", method: "pi" },
      { op: "drop_foreign_key", table_id: "A", foreign_key_id: "r" },
    ]);
    await db.exec(sqlScript(plan.steps.flatMap((s) => s.statements)));
    assert.equal((await db.query('SELECT * FROM "People"')).rows.length, 1);
    assert.equal((await db.query('SELECT * FROM "C"')).rows.length, 1);
    assert.deepEqual((await db.query('SELECT * FROM "X"')).rows, [
      { parent: 1 },
    ]);
    assert.deepEqual((await db.query('SELECT * FROM "A"')).rows, [
      { aid: 1, left: 1 },
    ]);
    assert.equal(plan.steps[1].abstract.migration.kind, "pi");
    assert.equal(plan.schema.equations?.length, 0);
  } finally {
    await db.close();
  }
});
test("Sigma conflicting fixed attributes fails atomically without choosing an arbitrary value", async () => {
  const db = await seeded(true);
  try {
    await assert.rejects(
      db.exec(
        sqlScript(compilePlan(schema, [eq]).steps.flatMap((s) => s.statements)),
      ),
      /different business attribute values/,
    );
    await db.exec("ROLLBACK;");
    assert.equal((await db.query('SELECT * FROM "B"')).rows.length, 2);
    assert.deepEqual((await db.query('SELECT * FROM "X"')).rows, [
      { parent: 2 },
    ]);
  } finally {
    await db.close();
  }
});
test("Internal identities and carrier columns are not category attributes; legacy lookup adds no business relation", () => {
  const input = structuredClone(schema);
  Object.assign(input.foreign_keys[0], {
    lookup: {
      source_columns: ["aid"],
      target_columns: ["bid"],
    },
  });
  const p = databasePresentation(input);
  assert.ok(
    !p.arrows.some(
      (a) => a.id === "attribute:bid" || a.id === "attribute:left",
    ),
  );
  assert.ok(p.arrows.some((a) => a.id === "attribute:value"));
  assert.equal(p.equations.length, 0);
  assert.ok(bindingEquations(input).every((e) => !e.id.includes(":lookup:")));
});
test("Unselected migration is a schema draft and is rejected by SQL export", () => {
  const op: Operation = {
    op: "create_table",
    table: { id: "N", name: "N", columns: [], primaryKey: [] },
    method: null,
  };
  assert.equal(pendingAttributes([op]).length, 1);
  assert.throws(
    () => compilePlan(schema, [op]),
    /Complete the action parameters/,
  );
});
test("Manual arrow planning never reuses a same-name field or picks a migration", () => {
  let n = 0;
  const ops = fieldArrowOperations(
    schema,
    "A",
    "C",
    "new_target",
    { targetColumns: ["cid"], sourceColumns: ["__new__"] },
    () => `new${n++}`,
  );
  const op = ops.at(-1)!;
  assert.equal(op.op, "add_reference");
  assert.equal("method" in op ? op.method : undefined, null);
  assert.equal(pendingAttributes(ops).length, 1);
  assert.ok(!ops.some((o) => o.op === "populate_reference"));
  assert.ok(
    !(
      "lookup" in
      (op as Extract<Operation, { op: "add_reference" }>).foreign_key
    ),
  );
});
test("Free Sigma follows an acyclic chain of storage-only targets", async () => {
  const base: SchemaSpec = {
    tables: [
      { id: "A", name: "A", columns: [c("value")], primaryKey: [] },
      {
        id: "B",
        name: "B",
        columns: [c("bid", true), c("next", false, true)],
        primaryKey: ["bid"],
      },
      { id: "C", name: "C", columns: [c("cid", true)], primaryKey: ["cid"] },
    ],
    foreign_keys: [schema.foreign_keys[2]],
  };
  const op: Operation = {
    op: "add_reference",
    table_id: "A",
    columns: [c("target")],
    foreign_key: {
      id: "new",
      source_table: "A",
      source_columns: ["target"],
      target_table: "B",
      target_columns: ["bid"],
    },
    method: "sigma",
  };
  const db = new PGlite();
  try {
    await db.exec(schemaStatements(base).join("\n"));
    await db.exec(
      'INSERT INTO "A" VALUES(10),(20);INSERT INTO "C" DEFAULT VALUES;INSERT INTO "B" ("next") VALUES(1);',
    );
    await db.exec(
      sqlScript(compilePlan(base, [op]).steps.flatMap((s) => s.statements)),
    );
    assert.deepEqual(
      (
        await db.query(
          'SELECT a.value,b."next",c.cid FROM "A" a JOIN "B" b ON a.target=b.bid JOIN "C" c ON b."next"=c.cid ORDER BY a.value',
        )
      ).rows,
      [
        { value: 10, next: 2, cid: 2 },
        { value: 20, next: 3, cid: 3 },
      ],
    );
    assert.equal((await db.query('SELECT * FROM "B"')).rows.length, 3);
  } finally {
    await db.close();
  }
});
test("Free Pi duplicates upstream cones and rewrites generated identities and incoming arrows", async () => {
  const base: SchemaSpec = {
    tables: [
      {
        id: "A",
        name: "A",
        columns: [c("aid", true), c("value")],
        primaryKey: ["aid"],
      },
      { id: "B", name: "B", columns: [c("bid", true)], primaryKey: ["bid"] },
      {
        id: "X",
        name: "X",
        columns: [c("xid", true), c("one", false, true), c("two", false, true)],
        primaryKey: ["xid"],
      },
    ],
    foreign_keys: [
      {
        id: "one",
        source_table: "X",
        source_columns: ["one"],
        target_table: "A",
        target_columns: ["aid"],
      },
      {
        id: "two",
        source_table: "X",
        source_columns: ["two"],
        target_table: "A",
        target_columns: ["aid"],
      },
    ],
  };
  const op: Operation = {
    op: "add_reference",
    table_id: "A",
    columns: [c("target")],
    foreign_key: {
      id: "new",
      source_table: "A",
      source_columns: ["target"],
      target_table: "B",
      target_columns: ["bid"],
    },
    method: "pi",
  };
  const db = new PGlite();
  try {
    await db.exec(schemaStatements(base).join("\n"));
    await db.exec(
      'INSERT INTO "A" (value) VALUES(10);INSERT INTO "B" DEFAULT VALUES;INSERT INTO "B" DEFAULT VALUES;INSERT INTO "X" (one,two) VALUES(1,1);',
    );
    await db.exec(
      sqlScript(compilePlan(base, [op]).steps.flatMap((s) => s.statements)),
    );
    assert.equal((await db.query('SELECT * FROM "A"')).rows.length, 2);
    assert.equal((await db.query('SELECT * FROM "X"')).rows.length, 4);
    assert.deepEqual(
      (
        await db.query(
          'SELECT a.target AS l,b.target AS r FROM "X" x JOIN "A" a ON x.one=a.aid JOIN "A" b ON x.two=b.aid ORDER BY l,r',
        )
      ).rows,
      [
        { l: 1, r: 1 },
        { l: 1, r: 2 },
        { l: 2, r: 1 },
        { l: 2, r: 2 },
      ],
    );
  } finally {
    await db.close();
  }
});
test("Delta for a new arrow uses the explicitly selected composite path, preserving business data", async () => {
  const op: Operation = {
    op: "add_reference",
    table_id: "A",
    columns: [c("direct")],
    foreign_key: {
      id: "direct",
      name: "direct",
      source_table: "A",
      source_columns: ["direct"],
      target_table: "C",
      target_columns: ["cid"],
    },
    method: "delta",
    image: { source: "A", arrows: ["reference:l", "reference:next"] },
  };
  const db = await seeded();
  try {
    const plan = compilePlan(schema, [op]);
    assert.equal(plan.steps[0].abstract.migration.kind, "delta");
    await db.exec(sqlScript(plan.steps.flatMap((s) => s.statements)));
    assert.deepEqual(
      (await db.query('SELECT aid,"left","right",direct FROM "A"')).rows,
      [{ aid: 1, left: 1, right: 2, direct: 1 }],
    );
    assert.equal((await db.query('SELECT * FROM "B"')).rows.length, 2);
    assert.equal(plan.schema.equations?.length ?? 0, 0);
  } finally {
    await db.close();
  }
});
test("Free Pi quotients source-path choices by declared relations", async () => {
  const relation: Operation = { ...eq, method: "pi" };
  const op: Operation = {
    op: "add_reference",
    table_id: "B",
    columns: [c("other")],
    foreign_key: {
      id: "other",
      name: "other",
      source_table: "B",
      source_columns: ["other"],
      target_table: "C",
      target_columns: ["cid"],
    },
    method: "pi",
  };
  const db = await seeded();
  try {
    await db.exec('UPDATE "A" SET "right"="left";');
    const plan = compilePlan(schema, [relation, op]);
    await db.exec(sqlScript(plan.steps.flatMap((s) => s.statements)));
    assert.equal((await db.query('SELECT * FROM "B"')).rows.length, 4);
    assert.equal((await db.query('SELECT * FROM "A"')).rows.length, 2);
    assert.equal((await db.query('SELECT * FROM "X"')).rows.length, 2);
    assert.equal(
      (await db.query('SELECT * FROM "A" WHERE "left"<>"right"')).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
