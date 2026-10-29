import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  restoreWorkspace,
  type WorkspaceRecord,
} from "../model/restore-workspace.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
async function imports(directory: string) {
  const result: { file: string; target: string; relative: boolean }[] = [];
  for (const file of await readdir(path.join(root, directory))) {
    if (!/\.(ts|tsx)$/.test(file) || file.endsWith(".test.ts")) continue;
    const full = path.join(root, directory, file),
      text = await readFile(full, "utf8");
    const source = ts.createSourceFile(
      full,
      text,
      ts.ScriptTarget.Latest,
      true,
    );
    const add = (value: string) =>
      result.push({
        file,
        target: value.startsWith(".")
          ? path
              .relative(root, path.resolve(path.dirname(full), value))
              .replaceAll(path.sep, "/")
          : value,
        relative: value.startsWith("."),
      });
    const visit = (node: ts.Node) => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        add(node.moduleSpecifier.text);
      if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)
      )
        add(node.argument.literal.text);
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        add(node.arguments[0].text);
      node.forEachChild(visit);
    };
    visit(source);
  }
  return result;
}
test("model contracts do not depend on application, storage, or UI", async () => {
  for (const edge of await imports("model"))
    assert.ok(
      edge.relative && edge.target.startsWith("model/"),
      `${edge.file} -> ${edge.target}`,
    );
});
test("presentation and migration calculus do not import database bindings or SQL", async () => {
  for (const edge of (await imports("model")).filter(
    (edge) => edge.file === "presentation.ts" || edge.file === "migration.ts",
  ))
    assert.equal(
      edge.target,
      "model/presentation.ts",
      `${edge.file} -> ${edge.target}`,
    );
});
test("application workflows depend only on their contracts and model", async () => {
  for (const edge of await imports("application"))
    assert.ok(
      edge.relative && /^(application|model)\//.test(edge.target),
      `${edge.file} -> ${edge.target}`,
    );
});
test("storage and transport adapters do not own application policies", async () => {
  for (const edge of await imports("adapters"))
    if (edge.relative && edge.target.startsWith("application/"))
      assert.ok(
        /^application\/(ports|limits)\.ts$/.test(edge.target),
        `${edge.file} -> ${edge.target}`,
      );
});
test("UI capabilities are supplied by composition, not concrete adapters", async () => {
  for (const directory of ["schema", "diagram"])
    for (const edge of await imports(directory))
      if (edge.relative)
        assert.ok(
          !/^(app|adapters)\//.test(edge.target),
          `${edge.file} -> ${edge.target}`,
        );
});

test("legacy workspace restoration is a model policy independent of storage", () => {
  const legacy = {
    id: "legacy",
    name: "legacy",
    createdAt: 0,
    updatedAt: 0,
    tableIds: [],
    positions: {},
    relationships: [
      {
        id: "old",
        source: { tableId: "a", columnId: "a:id" },
        target: { tableId: "b", columnId: "b:id" },
        checked: 1,
        matched: 1,
        sourceDistinct: 1,
        cardinality: "1:1",
      },
    ],
  } as WorkspaceRecord;
  const current = restoreWorkspace(legacy);
  assert.equal(current.modelVersion, 6);
  assert.equal(current.relationships.length, 0);
  assert.equal("candidates" in current, false);
  assert.equal(legacy.relationships.length, 1);
  assert.throws(
    () =>
      restoreWorkspace({
        ...current,
        modelVersion: 7,
      } as unknown as WorkspaceRecord),
    /newer version/,
  );
});
