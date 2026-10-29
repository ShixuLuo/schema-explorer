import { useId } from "react";
import type { Operation, SchemaSpec } from "../model/operations.ts";
import { databasePresentation } from "../model/database-presentation.ts";
import { pathLabel, type ArrowDef, type ObjectDef, type Presentation } from "../model/presentation.ts";
import "./review.css";

export type MigrationReviewProps = {
  source: SchemaSpec;
  target: SchemaSpec;
  operations?: Operation[];
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const changedIds = <T extends { id: string }>(before: T[], after: T[]) =>
  new Set([...before, ...after].filter(item => !same(before.find(a => a.id === item.id), after.find(a => a.id === item.id))).map(item => item.id));

function Endpoint({ object, x, tone }: { object: ObjectDef; x: number; tone?: string }) {
  return <g className={tone}>
    <rect x={x} y={34} width={130} height={38} rx={object.kind === "entity" ? 19 : 6} />
    <text x={x + 65} y={57} textAnchor="middle">{object.label.length > 19 ? `${object.label.slice(0, 18)}…` : object.label}<title>{object.label}</title></text>
  </g>;
}
function ArrowPreview({ arrow, presentation, tone, marker, objectChanges }: {
  arrow: ArrowDef; presentation: Presentation; tone: string; marker: string; objectChanges: Set<string>;
}) {
  const source = presentation.objects.find(o => o.id === arrow.source);
  const target = presentation.objects.find(o => o.id === arrow.target);
  if (!source || !target) return <div className="migration-review-detail">{arrow.label}</div>;
  return <svg className="migration-review-arrow" viewBox="0 0 450 100" role="img" aria-label={`${source.label} — ${arrow.label} → ${target.label}`}>
    <defs><marker className={tone} id={marker} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 1 L7 4 L1 7" fill="none" stroke="currentColor" strokeWidth="1.4" /></marker></defs>
    <Endpoint object={source} x={8} tone={objectChanges.has(source.id) ? tone : undefined} />
    <g className={tone}>
      <path d="M139 53 H305" markerEnd={`url(#${marker})`} />
      <text x={223} y={35} textAnchor="middle">{arrow.label.length > 25 ? `${arrow.label.slice(0, 24)}…` : arrow.label}<title>{arrow.label}</title></text>
    </g>
    <Endpoint object={target} x={312} tone={objectChanges.has(target.id) ? tone : undefined} />
  </svg>;
}

// Compare stable model IDs, not operation descriptions or display names. Storage
// carriers remain hidden, just as they do on the category canvas.
export function MigrationReview({ source, target }: MigrationReviewProps) {
  const id = useId().replace(/:/g, "");
  const before = databasePresentation(source), after = databasePresentation(target);
  const arrows = changedIds(before.arrows, after.arrows);
  const objects = changedIds(before.objects, after.objects);
  const equations = changedIds(source.equations ?? [], target.equations ?? []);
  const orderedArrows = [...new Set([...before.arrows, ...after.arrows].map(a => a.id))].filter(a => arrows.has(a));
  // Align an unambiguous replacement from the same source in one visual row;
  // this is layout only, never a claim that the generators share an ID.
  const rows: { before?: ArrowDef; after?: ArrowDef }[] = [];
  const usedAfter = new Set<string>();
  for (const arrowId of orderedArrows) {
    const old = before.arrows.find(a => a.id === arrowId);
    if (!old) continue;
    let next = after.arrows.find(a => a.id === arrowId);
    if (!next) {
      const removed = before.arrows.filter(a => arrows.has(a.id) && a.source === old.source && !after.arrows.some(b => b.id === a.id));
      const added = after.arrows.filter(a => arrows.has(a.id) && a.source === old.source && !before.arrows.some(b => b.id === a.id));
      if (removed.length === 1 && added.length === 1) next = added[0];
    }
    if (next) usedAfter.add(next.id);
    rows.push({ before: old, after: next });
  }
  for (const arrow of after.arrows) if (arrows.has(arrow.id) && !usedAfter.has(arrow.id)) rows.push({ after: arrow });
  const isolatedObjects = [...objects].filter(object => ![...before.arrows, ...after.arrows].some(a => arrows.has(a.id) && (a.source === object || a.target === object)));
  const details = (schema: SchemaSpec, other: SchemaSpec) => schema.tables.flatMap(table => {
    const old = other.tables.find(t => t.id === table.id);
    if (!old) return [];
    const names = (ids: string[]) => ids.map(key => table.columns.find(c => c.id === key)?.name ?? key).join(", ");
    const result: string[] = [];
    if (!same(table.primaryKey, old.primaryKey)) result.push(`${table.name} · Primary key: ${names(table.primaryKey) || "none"}`);
    if (!same(table.uniqueKeys ?? [], old.uniqueKeys ?? [])) result.push(`${table.name} · Unique: ${table.uniqueKeys?.map(names).join("; ") || "none"}`);
    for (const column of table.columns) {
      const previous = old.columns.find(c => c.id === column.id);
      if (previous && column.nullable !== previous.nullable) result.push(`${table.name}.${column.name} · ${column.nullable ? "nullable" : "required"}`);
      // Physical-only changes cannot be represented faithfully as category arrows.
      if (previous && (column.storage !== previous.storage || column.generated !== previous.generated)) result.push(`${table.name}.${column.name} · ${column.generated ?? column.storage ?? "attribute"}`);
    }
    return result;
  });
  const leftDetails = details(source, target), rightDetails = details(target, source);
  const renderSide = (presentation: Presentation, schema: SchemaSpec, tone: string, extra: string[]) => <div className="migration-review-side">
    <div className="migration-review-label">{tone === "removed" ? "Before" : "After"}</div>
    {rows.map((row, i) => {
      const arrow = tone === "removed" ? row.before : row.after;
      return <div className="migration-review-slot" key={i}>{arrow ? <ArrowPreview arrow={arrow} presentation={presentation} tone={tone} marker={`${id}-${tone}-${i}`} objectChanges={objects} /> : <span className="migration-review-absent" aria-label="Not present">—</span>}</div>;
    })}
    {isolatedObjects.map(objectId => {
      const object = presentation.objects.find(o => o.id === objectId);
      return <div className="migration-review-slot" key={objectId}>{object ? <svg viewBox="0 0 450 100" className="migration-review-arrow" role="img" aria-label={object.label}><Endpoint object={object} x={160} tone={tone} /></svg> : <span className="migration-review-absent" aria-label="Not present">—</span>}</div>;
    })}
    {[...equations].map(equationId => {
      const equation = schema.equations?.find(e => e.id === equationId);
      return <div className={`migration-review-detail ${tone}`} key={equationId}>{equation ? `${pathLabel(presentation, equation.left)} = ${pathLabel(presentation, equation.right)}` : "—"}</div>;
    })}
    {extra.map((detail, i) => <div className={`migration-review-detail ${tone}`} key={i}>{detail}</div>)}
  </div>;
  if (!arrows.size && !objects.size && !equations.size && !leftDetails.length && !rightDetails.length) return <div className="migration-review-empty">No schema changes.</div>;
  return <div className="migration-review" aria-label="Schema changes">
    {renderSide(before, source, "removed", leftDetails)}
    <span className="migration-review-transition" aria-hidden="true">→</span>
    {renderSide(after, target, "added", rightDetails)}
  </div>;
}
