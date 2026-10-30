import test from "node:test";
import assert from "node:assert/strict";
import {
  migrationRequest,
  pathOptions,
  variableTerm,
  stableDefaults,
  updateAssignment,
  nextVariable,
} from "./migration-client.ts";
import type { SchemaSpec } from "../model/operations.ts";
const schema: SchemaSpec = {
  tables: [
    {
      id: "person",
      name: "Person",
      columns: [
        { id: "name", name: "Name", dataType: "text", nullable: false },
        {
          id: "pk",
          name: "ID",
          dataType: "integer",
          nullable: false,
          storage: "identity",
        },
      ],
      primaryKey: ["pk"],
    },
  ],
  foreign_keys: [],
};
test("migration client submits native assignments and unwraps worker envelope", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "/api/cql/draft");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        source: schema,
        target: schema,
        assignments: [],
      });
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            status: "incomplete",
            holes: [
              {
                holeId: "person.from",
                kind: "sourceEntityBindings",
                filled: false,
              },
            ],
            assignments: [],
          },
        }),
        { status: 200 },
      );
    };
    assert.equal(
      (await migrationRequest("draft", schema, schema, [])).holes?.[0].holeId,
      "person.from",
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("path choices use native IDs and include explicit identity columns", () => {
  const options = pathOptions(
    schema,
    [{ variable: "p", entity: "person" }],
    true,
  );
  assert.deepEqual(
    options.map((o) => [o.label, o.dataType]),
    [
      ["p.Name", "text"],
      ["p.ID", "integer"],
    ],
  );
  assert.deepEqual(options[1].term, {
    ...variableTerm("pk"),
    arguments: [variableTerm("p")],
  });
});

test("stable defaults copy native IDs and leave new columns unresolved", () => {
  const target = structuredClone(schema);
  target.tables[0].columns.push({
    id: "new",
    name: "New",
    dataType: "text",
    nullable: false,
  });
  const defaults = stableDefaults(schema, target);
  assert.deepEqual(
    defaults.map((a) => a.holeId),
    ["person.from", "person.attribute.name", "person.attribute.pk"],
  );
});
test("FROM edits clear dependent terms and incoming reference substitutions", () => {
  const target: SchemaSpec = {
    ...schema,
    foreign_keys: [
      {
        id: "self",
        source_table: "person",
        target_table: "person",
        source_columns: ["pk"],
        target_columns: ["pk"],
      },
    ],
  };
  const defaults = [
    ...stableDefaults(schema, schema),
    { holeId: "person.where", value: { equations: [] } },
    { holeId: "person.foreignKey.self", value: { bindings: [] } },
  ];
  const updated = updateAssignment(defaults, target, "person.from", {
    bindings: [{ variable: "other", entity: "person" }],
  });
  assert.deepEqual(
    updated.map((a) => a.holeId),
    ["person.from"],
  );
  assert.equal(
    nextVariable([
      { variable: "x1", entity: "person" },
      { variable: "x3", entity: "person" },
    ]),
    "x2",
  );
});

test("population edits replace only the owned entity mapping and retain branches and incoming references", () => {
  const branch={id:"original",bindings:[{variable:"x",entity:"person"}],where:[],attributes:[{columnId:"name",term:variableTerm("x")}],foreignKeys:[]};
  const population={deduplicateBy:["pk"],branches:[branch]};
  const incoming={holeId:"other.foreignKey.person",value:{branch:"original",bindings:[{targetVariable:"x",term:variableTerm("row")}]}};
  const baseline=[...stableDefaults(schema,schema),incoming];
  const initial=updateAssignment(baseline,schema,"person.population",{population});
  assert.deepEqual(initial.map(a=>a.holeId),[incoming.holeId,"person.population"]);
  const changed=updateAssignment(initial,schema,"person.population",{population:{...population,deduplicateBy:["name"]}});
  assert.deepEqual(changed[0],incoming);
  assert.deepEqual(changed[1].value.population?.branches,[branch]);
  assert.deepEqual(changed[1].value.population?.deduplicateBy,["name"]);
  assert.deepEqual(initial[1].value.population?.deduplicateBy,["pk"]);
  const empty=updateAssignment(baseline,schema,"person.population",{population:{deduplicateBy:[],branches:[]}});
  assert.deepEqual(empty.map(a=>a.holeId),[incoming.holeId,"person.population"]);
});
