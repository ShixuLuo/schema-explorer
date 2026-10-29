import type { SchemaSpec, Operation } from "../model/operations.ts";
import { translateCommand } from "../model/database-commands.ts";
import { databasePresentation } from "../model/database-presentation.ts";
import {
  humanActionOperations,
  type AiEditorAction,
} from "./ai-capabilities.ts";
import { acceptancePlan, type ActionReview } from "./ai-action-review.ts";
export type PreviewFocus = {
  arrowId?: string;
  objectId?: string;
  equationId?: string;
};
export type PendingPlan = {
  operations: Operation[];
  groupOperations: Record<string, Operation[]>;
  focus: Record<string, PreviewFocus>;
  groupIds: string[];
  skippedIds: string[];
};
function writes(a: AiEditorAction) {
  switch (a.kind) {
    case "edit_arrow":
    case "rename_arrow":
    case "delete_arrow":
      return ["arrow:" + a.arrowId];
    case "rename_primary_key":
      return ["arrow:attribute:" + a.columnId];
    case "rename_object":
    case "delete_object":
      return ["object:" + a.objectId];
    case "edit_equation":
    case "drop_equation":
      return ["equation:" + a.equationId];
    default:
      return [];
  }
}
function objects(a: AiEditorAction, schema: SchemaSpec): string[] {
  if ("objectId" in a) return [a.objectId];
  if (a.kind === "create_arrow" || a.kind === "edit_arrow")
    return [
      a.sourceId,
      ...(a.targetId.startsWith("type:") ? [] : [a.targetId]),
    ];
  if (a.kind === "add_equation" || a.kind === "edit_equation")
    return [a.left.source, a.right.source];
  if (a.arrowId) {
    const arrow = databasePresentation(schema).arrows.find(
      (x) => x.id === a.arrowId,
    );
    return arrow
      ? [
          arrow.source,
          ...(arrow.target.startsWith("type:") ? [] : [arrow.target]),
        ]
      : [];
  }
  return [];
}
function focusFor(
  operations: Operation[],
  actions: AiEditorAction[],
): PreviewFocus {
  for (const op of [...operations].reverse()) {
    if (op.op === "add_reference" || op.op === "add_foreign_key")
      return { arrowId: "reference:" + op.foreign_key.id };
    if (op.op === "create_table") return { objectId: op.table.id };
    if (op.op === "add_equation") return { equationId: op.equation.id };
    if (op.op === "rename_table" || op.op === "drop_table")
      return { objectId: op.table_id };
  }
  const last = actions.at(-1);
  if (!last) return {};
  if (last.kind === "rename_primary_key") return { objectId: last.objectId };
  if (last.kind === "drop_equation") return { equationId: last.equationId };
  return last.arrowId ? { arrowId: last.arrowId } : {};
}
// Compile through the shared native builders only. Rendering still comes from EditSession.prepare.
export function pendingPreviewPlan(
  review: ActionReview,
  schema: SchemaSpec,
  uuid?: () => string,
): PendingPlan {
  const result: PendingPlan = {
    operations: [],
    groupOperations: {},
    focus: {},
    groupIds: [],
    skippedIds: [],
  };
  let working = schema;
  const planned = new Set<string>(),
    skipped = new Set<string>(),
    owners = new Map<string, string>(),
    objectOwners = new Map<string, Set<string>>();
  for (const suggestion of review.suggestions) {
    if (
      suggestion.status !== "pending" ||
      planned.has(suggestion.id) ||
      skipped.has(suggestion.id)
    )
      continue;
    let closure;
    try {
      closure = acceptancePlan(review, suggestion.id);
    } catch {
      skipped.add(suggestion.id);
      continue;
    }
    const dependencies = new Set(closure.map((g) => g.id));
    for (const group of closure) {
      if (planned.has(group.id) || skipped.has(group.id)) continue;
      if (group.dependsOn.some((id) => skipped.has(id))) {
        skipped.add(group.id);
        continue;
      }
      try {
        for (const action of group.actions) {
          for (const key of writes(action)) {
            const owner = owners.get(key);
            if (owner && !dependencies.has(owner))
              throw Error("Conflicting pending suggestions.");
          }
          if (
            action.kind === "delete_object" &&
            [...(objectOwners.get(action.objectId) ?? [])].some(
              (id) => !dependencies.has(id),
            )
          )
            throw Error("Conflicting object deletion.");
        }
        let candidate = working;
        const operations: Operation[] = [];
        for (const action of group.actions) {
          for (const operation of humanActionOperations(
            action,
            candidate,
            uuid,
          )) {
            candidate = translateCommand(candidate, operation).after;
            operations.push(operation);
          }
        }
        for (const action of group.actions) {
          for (const key of writes(action)) owners.set(key, group.id);
          for (const id of objects(action, working)) {
            const groups = objectOwners.get(id) ?? new Set<string>();
            groups.add(group.id);
            objectOwners.set(id, groups);
          }
        }
        working = candidate;
        planned.add(group.id);
        result.groupIds.push(group.id);
        result.operations.push(...operations);
        result.groupOperations[group.id] = operations;
        result.focus[group.id] = focusFor(operations, group.actions);
      } catch {
        skipped.add(group.id);
      }
    }
  }
  result.skippedIds = [...skipped];
  return result;
}
