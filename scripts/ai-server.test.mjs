import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createAiServer,
  AI_REQUEST_MAX_BYTES,
  validateRequest,
  validateSuggestions,
  parseResponse,
} from "./ai-server.mjs";
const canonical = (x) =>
  Array.isArray(x)
    ? "[" + x.map(canonical).join(",") + "]"
    : x && typeof x === "object"
      ? "{" +
        Object.keys(x)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(x[k]))
          .join(",") +
        "}"
      : JSON.stringify(x);
const schema = {
  tables: [
    {
      id: "t",
      name: "Thing",
      columns: [
        {
          id: "id",
          name: "id",
          dataType: "integer",
          nullable: false,
          generated: "identity",
          storage: "identity",
        },
        { id: "label", name: "label", dataType: "text", nullable: true },
      ],
      primaryKey: ["id"],
    },
  ],
  foreign_keys: [],
  equations: [],
};
const fp =
  "sha256:" + createHash("sha256").update(canonical(schema)).digest("hex");
const request = {
  requestId: "r",
  caseId: "c",
  base: { revision: 1, fingerprint: fp, schema },
  guidance: "",
  feedback: { acceptedIds: [], rejectedIds: [] },
  pending: [],
  context: {
    protocol: "schema-context/v1",
    schemaFingerprint: fp,
    dataFingerprint: fp,
    profiles: [{ tableId: "t", scannedRows: 2 }],
    samples: [],
  },
};
const result = {
  suggestions: [
    {
      id: "s",
      title: "Clarify label",
      dependsOn: [],
      actions: [
        {
          kind: "edit_arrow",
          arrowId: "attribute:label",
          sourceId: "t",
          targetId: "type:text",
          name: "description",
        },
      ],
    },
  ],
};
test("returns shared human editor actions without candidate snapshots", () => {
  const output = validateSuggestions(structuredClone(result), request);
  assert.equal(output.protocol, "schema-actions/v1");
  assert.equal(output.candidate, undefined);
  assert.deepEqual(
    output.suggestions[0].actions,
    result.suggestions[0].actions,
  );
  assert.deepEqual(
    request.base.schema.tables[0].columns[0],
    schema.tables[0].columns[0],
  );
  assert.equal(request.base.schema.tables[0].columns[1].name, "label");
});
test("reject stale schema, missing data, and incomplete/refused outputs", () => {
  assert.throws(
    () =>
      validateRequest({
        ...request,
        base: { ...request.base, fingerprint: "stale" },
      }),
    /stale/,
  );
  assert.throws(
    () =>
      validateRequest({
        ...request,
        context: { ...request.context, profiles: [] },
      }),
    /load data/i,
  );
  assert.throws(
    () => parseResponse({ status: "incomplete" }, request),
    /incomplete/,
  );
  assert.throws(
    () =>
      parseResponse(
        { status: "completed", output: [{ content: [{ type: "refusal" }] }] },
        request,
      ),
    /declined/,
  );
});
test("reject unsupported changes and dependency cycles", () => {
  assert.throws(
    () =>
      validateSuggestions(
        {
          suggestions: [
            {
              ...result.suggestions[0],
              actions: [{ kind: "execute", code: "anything" }],
            },
          ],
        },
        request,
      ),
    /Unsupported/,
  );
  assert.throws(
    () =>
      validateSuggestions(
        { suggestions: [{ ...result.suggestions[0], dependsOn: ["s"] }] },
        request,
      ),
    /dependency/,
  );
});
test("HTTP proxy rejects nonlocal origins and limits body without calling AI", async () => {
  let calls = 0;
  const server = createAiServer({
    generateImpl: async () => {
      calls++;
      return {};
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const url =
      "http://127.0.0.1:" + server.address().port + "/api/ai/suggestions";
    let r = await fetch(url, {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
    assert.equal(r.status, 403);
    r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, guidance: "x".repeat(AI_REQUEST_MAX_BYTES + 1) }),
    });
    assert.equal(r.status, 413);
    assert.equal(calls, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a supplied goal permits an empty model without invented data", () => {
  const empty = { tables: [], foreign_keys: [], equations: [] };
  const emptyHash =
    "sha256:" + createHash("sha256").update(canonical(empty)).digest("hex");
  const req = {
    ...request,
    guidance: "Create Shipment",
    base: { revision: 0, fingerprint: emptyHash, schema: empty },
    context: {
      ...request.context,
      schemaFingerprint: emptyHash,
      profiles: [],
      samples: [],
    },
  };
  assert.equal(validateRequest(req), req);
  const out = validateSuggestions(
    {
      suggestions: [
        {
          id: "new",
          title: "Create Shipment",
          dependsOn: [],
          actions: [
            { kind: "create_object", name: "Shipment", keyName: "_id", key: { mode: "generated" } },
          ],
        },
      ],
    },
    req,
  );
  assert.equal(out.suggestions[0].actions[0].kind, "create_object");
  assert.deepEqual(req.base.schema, empty);
});
test("conflicting groups are rejected before reaching the user", () => {
  assert.throws(
    () =>
      validateSuggestions(
        {
          suggestions: [
            {
              id: "drop",
              title: "Delete Thing",
              dependsOn: [],
              actions: [{ kind: "delete_object", objectId: "t" }],
            },
            { ...result.suggestions[0], dependsOn: ["drop"] },
          ],
        },
        request,
      ),
    /could not be applied:.*no longer available/,
  );
});
