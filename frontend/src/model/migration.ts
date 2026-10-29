import {
  type Mapping,
  type Presentation,
  type Path,
  samePresentation,
  endpoint,
  identityMapping,
  validatePresentation,
} from "./presentation.ts";

export type Migration =
  | { kind: "delta" | "sigma" | "pi"; mapping: Mapping }
  | {
      kind: "check";
      source: Presentation;
      target: Presentation;
      equations: { left: Path; right: Path }[];
    }
  | {
      kind: "interpret";
      source: Presentation;
      target: Presentation;
      parameters: string[];
    }
  | {
      kind: "pending";
      source: Presentation;
      target: Presentation;
      parameters: string[];
    }
  | { kind: "compose"; steps: Migration[] };
export function migrationEndpoints(
  migration: Migration,
): [Presentation, Presentation] {
  if (migration.kind === "compose") {
    if (!migration.steps.length)
      throw new Error("A composed migration needs a component.");
    const first = migrationEndpoints(migration.steps[0]);
    let output = first[1];
    for (const step of migration.steps.slice(1)) {
      const [input, next] = migrationEndpoints(step);
      if (!samePresentation(output, input))
        throw new Error("Migration endpoints do not compose.");
      output = next;
    }
    return [first[0], output];
  }
  if (migration.kind === "check") {
    if (
      !samePresentation(
        { ...migration.source, equations: [] },
        { ...migration.target, equations: [] },
      )
    )
      throw new Error("A relation check cannot change generators.");
    identityMapping(migration.source, migration.target);
    for (const equation of migration.equations)
      if (
        equation.left.source !== equation.right.source ||
        endpoint(migration.source, equation.left) !==
          endpoint(migration.source, equation.right)
      )
        throw new Error("A check must compare parallel paths.");
    return [migration.source, migration.target];
  }
  if (migration.kind === "interpret" || migration.kind === "pending") {
    validatePresentation(migration.source);
    validatePresentation(migration.target);
    return [migration.source, migration.target];
  }
  return migration.kind === "delta"
    ? [migration.mapping.target, migration.mapping.source]
    : [migration.mapping.source, migration.mapping.target];
}
export function composeMigrations(steps: Migration[]): Migration {
  const result: Migration = {
    kind: "compose",
    steps: steps.flatMap((step) =>
      step.kind === "compose" ? step.steps : [step],
    ),
  };
  migrationEndpoints(result);
  return result;
}
