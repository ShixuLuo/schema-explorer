import { databasePresentation } from "../model/database-presentation.ts";
import { schemaSpec } from "../model/wire.ts";
import {
  validatePresentation,
  type Presentation,
  type Path,
} from "../model/presentation.ts";
import type {
  ModelView,
  ModelComparison,
  ComparisonMode,
  ModelChange,
} from "../model/comparison.ts";

// Eliminate a carrier generator a = f ; key. The column remains a database
// binding, while the category expresses its value by composition. Cyclic
// definitions must retain their generators; they are constraints, not aliases.
export function reducedCategory(p: Presentation): Presentation {
  const definitions = new Map<string, Path>();
  for (const e of p.equations) {
    if (
      e.origin === "binding" &&
      e.id.includes(":key:") &&
      e.left.arrows.length === 1 &&
      !definitions.has(e.left.arrows[0])
    )
      definitions.set(e.left.arrows[0], e.right);
  }
  const cyclic = new Set<string>(),
    done = new Set<string>();
  const visit = (id: string, stack: string[]) => {
    const at = stack.indexOf(id);
    if (at >= 0) {
      stack.slice(at).forEach((a) => cyclic.add(a));
      return;
    }
    if (done.has(id) || !definitions.has(id)) return;
    for (const next of definitions.get(id)!.arrows) visit(next, [...stack, id]);
    done.add(id);
  };
  for (const id of definitions.keys()) visit(id, []);
  const removable = new Set(
    [...definitions.keys()].filter((id) => !cyclic.has(id)),
  );
  const expand = (id: string): string[] =>
    removable.has(id) ? definitions.get(id)!.arrows.flatMap(expand) : [id];
  const rewrite = (path: Path): Path => ({
    ...path,
    arrows: path.arrows.flatMap(expand),
  });
  const result: Presentation = {
    ...p,
    arrows: p.arrows.filter((a) => !removable.has(a.id)),
    equations: p.equations
      .map((e) => ({ ...e, left: rewrite(e.left), right: rewrite(e.right) }))
      .filter(
        (e) =>
          !(
            e.origin === "binding" &&
            JSON.stringify(e.left) === JSON.stringify(e.right)
          ),
      ),
  };
  validatePresentation(result);
  return result;
}
export const modelCategory = (view: ModelView) =>
  databasePresentation(
    schemaSpec(view.tables, view.relationships, view.equations),
  );
export function categoryComparison(
  view: ModelView,
  comparison?: ModelComparison | null,
  mode: ComparisonMode = "after",
): Presentation & { arrowChanges: Record<string, ModelChange> } {
  if (!comparison) return { ...modelCategory(view), arrowChanges: {} };
  const before = modelCategory(comparison.before),
    after = modelCategory(comparison.after),
    arrowChanges: Record<string, ModelChange> = {};
  if (mode !== "changes")
    return { ...(mode === "before" ? before : after), arrowChanges };
  for (const a of before.arrows)
    if (!after.arrows.some((n) => n.id === a.id))
      arrowChanges[a.id] = { kind: "removed" };
  for (const a of after.arrows) {
    const old = before.arrows.find((n) => n.id === a.id);
    if (!old) arrowChanges[a.id] = { kind: "added" };
    else if (JSON.stringify(old) !== JSON.stringify(a))
      arrowChanges[a.id] = { kind: "changed" };
  }
  return {
    ...after,
    objects: [
      ...after.objects,
      ...before.objects.filter(
        (o) => !after.objects.some((n) => n.id === o.id),
      ),
    ],
    arrows: [
      ...after.arrows,
      ...before.arrows.filter((a) => !after.arrows.some((n) => n.id === a.id)),
    ],
    equations: [
      ...after.equations,
      ...before.equations.filter(
        (e) => !after.equations.some((n) => n.id === e.id),
      ),
    ],
    arrowChanges,
  };
}
