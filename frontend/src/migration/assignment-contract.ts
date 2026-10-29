import type { SchemaSpec } from "../model/operations.ts";
export type Term = { tag: "raw_term"; annotation: null; head: string; arguments: Term[] };
export type Binding = { variable: string; entity: string };
export type Substitution = { targetVariable: string; term: Term };
export type PopulationBranch = {
  id: string;
  bindings: Binding[];
  where: { left: Term; right: Term }[];
  attributes: { columnId: string; term: Term }[];
  foreignKeys: { foreignKeyId: string; branch?: string | null; bindings: Substitution[] }[];
};
export type Population = { deduplicateBy: string[]; branches: PopulationBranch[] };
export type AssignmentValue = {
  bindings?: (Binding | Substitution)[];
  term?: Term;
  equations?: { left: Term; right: Term }[];
  branch?: string;
  population?: Population;
};
export type Assignment = { holeId: string; value: AssignmentValue };
export function mappingIds(target: SchemaSpec, entity: string): string[] {
  const table = target.tables.find(t => t.id === entity);
  if (!table) throw Error("Unknown population entity.");
  return [`${entity}.from`, `${entity}.where`, ...table.columns.map(c => `${entity}.attribute.${c.id}`), ...target.foreign_keys.filter(f => f.source_table === entity).map(f => `${entity}.foreignKey.${f.id}`)];
}
export function replacedAssignments(baseline: Assignment[], changes: Assignment[], target: SchemaSpec): string[] {
  const replaced = new Set(changes.map(a => a.holeId));
  for (const table of target.tables) if (changes.some(a => a.holeId === `${table.id}.population`)) {
    const ids = mappingIds(target, table.id);
    if (changes.some(a => ids.includes(a.holeId))) throw Error("A population replaces the whole entity mapping; do not also supply its legacy mappings.");
    ids.forEach(id => replaced.add(id));
  }
  return baseline.filter(a => replaced.has(a.holeId)).map(a => a.holeId);
}
export function mergeAssignments(baseline: Assignment[], changes: Assignment[], target: SchemaSpec): Assignment[] {
  const removed = new Set(replacedAssignments(baseline, changes, target));
  return [...baseline.filter(a => !removed.has(a.holeId)), ...changes];
}
export function populationValue(assignments: Assignment[], entity: string): Population | undefined {
  return assignments.find(a => a.holeId === `${entity}.population`)?.value.population;
}
export const conversionTargets: Record<string, string[]> = {
  text: ["integer", "real", "boolean"], integer: ["real", "text"], real: ["integer", "text"], boolean: ["text"],
};
export const migrationCapabilities = {
  conversions: { heads: ["cast:integer", "cast:real", "cast:boolean", "cast:text"], inputs: conversionTargets, policy: "Exact conversions only; invalid input, fractional integer conversion, and Int64 overflow fail the migration. Boolean text accepts true/false and exact numeric 0/1." },
  population: { hole: "<targetEntityId>.population", meaning: "Replaces the entire mapping of this target entity. Each branch is a source query projection. Branches are unioned by CQL and then quotiented by deduplicateBy target attributes. Empty key list preserves occurrences; empty branch list produces no rows. Conflicting values for the same key are rejected.", references: "Each foreign key selects a destination branch and substitutes all of that branch's source variables. Use a corresponding source occurrence/path when preserving existing records, rather than adding unnecessary joins. A referenced entity with one branch may omit branch; legacy single-source mappings use branch default.", validation: "Types and mappings are checked before execution. Full-data key conflicts and all source/target equations are checked during execution. No arbitrary executable code is accepted." },
};
