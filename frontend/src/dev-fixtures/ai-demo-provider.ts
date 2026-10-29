import commerce from "./ai-commerce.fixture.json" with { type: "json" };
import type { SchemaSpec } from "../model/operations.ts";
import type { CsvInput } from "../application/ports.ts";
import type { ActionSuggestion } from "../ai/ai-action-review.ts";
import type { AiEditorAction } from "../ai/ai-capabilities.ts";
import { humanCommandGroupLabel } from "../application/human-commands.ts";
export type DemoFixture = {
  name: string;
  inputs: { fileName: string; primaryKey: string; csv: string }[];
  recommendations: (
    | {
        kind: "rename_attribute";
        id: string;
        tableName: string;
        columnName: string;
        name: string;
        afterFirstPass?: boolean;
      }
    | {
        kind: "link_attribute";
        id: string;
        tableName: string;
        columnName: string;
        targetTableName: string;
        name: string;
        afterFirstPass?: boolean;
      }
  )[];
};
export type DemoSuggestionInput = {
  schema: SchemaSpec;
  iteration: number;
  hasPriorSuggestions: boolean;
};
const defaultFixture = commerce as DemoFixture;
// This adapter is loaded only by explicit development flags. It does not infer business rules.
export function demoSuggestions(
  { schema, iteration, hasPriorSuggestions }: DemoSuggestionInput,
  fixture: DemoFixture = defaultFixture,
): Omit<ActionSuggestion, "status">[] {
  const suggestions: Omit<ActionSuggestion, "status">[] = [];
  for (const item of fixture.recommendations) {
    if (item.afterFirstPass && !hasPriorSuggestions) continue;
    const source = schema.tables.find((t) => t.name === item.tableName),
      column = source?.columns.find(
        (c) => c.name === item.columnName && !c.storage && !c.generated,
      );
    if (!source || !column) continue;
    let action: AiEditorAction;
    if (item.kind === "rename_attribute")
      action = {
        kind: "edit_arrow",
        arrowId: "attribute:" + column.id,
        sourceId: source.id,
        targetId: "type:" + (column.dataType ?? "text"),
        name: item.name,
        choice: { targetColumns: [], sourceColumns: [] },
      };
    else {
      const target = schema.tables.find((t) => t.name === item.targetTableName);
      if (!target) continue;
      action = {
        kind: "edit_arrow",
        arrowId: "attribute:" + column.id,
        sourceId: source.id,
        targetId: target.id,
        name: item.name,
        choice: { targetColumns: target.primaryKey, sourceColumns: [] },
      };
    }
    suggestions.push({
      id: `demo-${iteration}-${item.id}`,
      title: humanCommandGroupLabel(schema, [action]),
      dependsOn: [],
      actions: [action],
    });
  }
  return suggestions;
}
export function demoExample(fixture: DemoFixture = defaultFixture): {
  name: string;
  files: CsvInput[];
} {
  return {
    name: fixture.name,
    files: fixture.inputs.map((input) => ({
      file: new File([input.csv], input.fileName, { type: "text/csv" }),
      primaryKey: input.primaryKey,
    })),
  };
}
