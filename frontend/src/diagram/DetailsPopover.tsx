import type { ViewTable } from "../model/comparison.ts";
import type { UseCase } from "../model/workspace.ts";
import Icon from "../shared/Icon";
import type { Selection } from "./types.ts";
import type { DiagramMode } from "./view-types.ts";
export default function DetailsPopover({
  mode,
  selection,
  tables,
  useCase,
  point,
  onClose,
  onPreview,
}: {
  mode: DiagramMode;
  selection: NonNullable<Selection>;
  tables: ViewTable[];
  useCase: UseCase;
  point: { x: number; y: number };
  onClose: () => void;
  onPreview: (id: string) => void;
}) {
  const table =
    selection.kind !== "relation"
      ? tables.find((t) => t.id === selection.tableId)
      : undefined;
  const column =
    selection.kind === "column"
      ? table?.columns.find((c) => c.id === selection.columnId)
      : undefined;
  const relation =
    selection.kind === "relation"
      ? useCase.relationships.find((r) => r.id === selection.relationId)
      : undefined;
  const endpoint = (tableId: string, columns: string[]) => {
    const t = tables.find((t) => t.id === tableId);
    return `${t?.name}.${columns.map((id) => t?.columns.find((c) => c.id === id)?.name).join(", ")}`;
  };
  return (
    <div
      className="details-popover nodrag nopan"
      role="dialog"
      aria-label="Selection details"
      style={{ left: point.x, top: point.y }}
    >
      <div className="popover-title">
        <strong>
          {relation
            ? mode === "tables"
              ? "Foreign key"
              : (relation.name ?? "Arrow")
            : column
              ? `${table?.name}.${column.name}`
              : table?.name}
        </strong>
        <button
          className="icon-button"
          aria-label="Close details"
          onClick={onClose}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
      {relation && (
        <div className="relation-endpoints">
          <code>
            {endpoint(relation.source_table, relation.source_columns)}
          </code>
          <Icon name="arrow" size={14} />
          <code>
            {endpoint(relation.target_table, relation.target_columns)}
          </code>
        </div>
      )}
      {table && (
        <>
          <div className="projection-stats">
            {table.dataStatus === "unverified"
              ? "Sample data not migrated"
              : `${table.rowCount.toLocaleString()} rows`}
            {column ? ` · ${column.dataType ?? "text"}` : ""}
          </div>
          <button className="button" onClick={() => onPreview(table.id)}>
            View data
          </button>
        </>
      )}
    </div>
  );
}
