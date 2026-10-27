import type { Relation, Table } from "../model/schema.ts";
import type { UseCase } from "../model/workspace.ts";
import type { Selection } from "./types.ts";
import { canBeInteger, typeHintId } from "../model/profile.ts";
import { relationColumns } from "../model/schema.ts";
import Icon from "../shared/Icon";
import type { EditTarget } from "../application/intents.ts";

export default function DetailsPopover({
  selection,
  tables,
  useCase,
  point,
  onClose,
  onPreview,
  onConfirm,
  onDismiss,
  onRemove,
  onEdit,
  disabled,
}: {
  selection: NonNullable<Selection>;
  tables: Table[];
  useCase: UseCase;
  point: { x: number; y: number };
  onClose: () => void;
  onPreview: (tableId: string) => void;
  onConfirm: (relation: Relation) => void;
  onDismiss: (id: string) => void;
  onRemove: (id: string) => void;
  onEdit: (target: EditTarget) => void;
  disabled?: boolean;
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
      ? [...useCase.relationships, ...useCase.candidates].find(
          (r) => r.id === selection.relationId,
        )
      : undefined;
  const confirmed =
    relation && useCase.relationships.some((r) => r.id === relation.id);
  const endpoint = (e: Relation["source"]) => {
    const t = tables.find((t) => t.id === e.tableId);
    return `${t?.name}.${(e.columnIds ?? [e.columnId]).map((id) => t?.columns.find((c) => c.id === id)?.name).join(", ")}`;
  };
  const hinted =
    column &&
    table &&
    canBeInteger(table, column) &&
    !useCase.dismissed.includes(typeHintId(column));
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
            ? confirmed
              ? "Foreign key"
              : "Suggested foreign key"
            : column
              ? `${table?.name}.${column.name}`
              : table?.name}
        </strong>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close details"
        >
          <Icon name="close" size={14} />
        </button>
      </div>
      {relation ? (
        <>
          <div className="relation-endpoints">
            <code>{endpoint(relation.source)}</code>
            <Icon name="arrow" size={14} />
            <code>{endpoint(relation.target)}</code>
          </div>
          <div className="relation-evidence">
            <span>{relation.cardinality}</span>
            <span>
              {relation.enforced
                ? `${relation.checked.toLocaleString()} rows checked`
                : `${relation.matched.toLocaleString()} / ${relation.checked.toLocaleString()} values match`}
            </span>
          </div>
          <div className="popover-actions">
            {confirmed ? (
              <button className="button" onClick={() => onRemove(relation.id)}>
                Remove foreign key
              </button>
            ) : (
              <>
                <button
                  className="button primary"
                  onClick={() => onConfirm(relation)}
                >
                  Add foreign key
                </button>
                <button
                  className="plain-button"
                  onClick={() => onDismiss(relation.id)}
                >
                  Dismiss
                </button>
              </>
            )}
          </div>
        </>
      ) : table ? (
        <>
          <dl className="compact-stats">
            <div>
              <dt>Rows</dt>
              <dd>{table.rowCount.toLocaleString()}</dd>
            </div>
            {column ? (
              <>
                <div>
                  <dt>Distinct</dt>
                  <dd>{column.distinctCount.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Empty</dt>
                  <dd>{column.emptyCount.toLocaleString()}</dd>
                </div>
                {(column.nullCount ?? 0) > 0 && (
                  <div>
                    <dt>NULL</dt>
                    <dd>{column.nullCount?.toLocaleString()}</dd>
                  </div>
                )}
              </>
            ) : (
              <div>
                <dt>Fields</dt>
                <dd>{table.columns.length}</dd>
              </div>
            )}
          </dl>
          {hinted && (
            <div className="type-suggestion">
              <span className="suggestion-caption">Suggested type</span>
              <div>
                <code>text</code>
                <Icon name="arrow" size={13} />
                <code>integer</code>
              </div>
              <p>
                {table.rowCount.toLocaleString()} values pass an integer check.
              </p>
              {column.formatChanges > 0 && (
                <p className="format-warning">
                  {column.formatChanges.toLocaleString()} values would change
                  formatting.
                </p>
              )}
            </div>
          )}
          <div className="key-actions">
            {(table.primaryKey ?? []).length ? (
              <button
                className="plain-button"
                disabled={disabled}
                onClick={() =>
                  onEdit({ kind: "drop_primary_key", tableId: table.id })
                }
              >
                Remove primary key
              </button>
            ) : (
              <button
                className="plain-button"
                disabled={disabled || !table.columns.length}
                onClick={() =>
                  onEdit({
                    kind: "add_primary_key",
                    tableId: table.id,
                    columnId: column?.id,
                  })
                }
              >
                Set primary key
              </button>
            )}
            {!column && (
              <button
                className="plain-button"
                disabled={disabled}
                onClick={() =>
                  onEdit({ kind: "add_foreign_key", tableId: table.id })
                }
              >
                Add foreign key
              </button>
            )}
          </div>
          <div className="popover-actions">
            <button className="button" onClick={() => onPreview(table.id)}>
              View data
            </button>
            <button
              className="button"
              disabled={disabled}
              onClick={() =>
                onEdit(
                  column
                    ? {
                        kind: "rename_column",
                        tableId: table.id,
                        columnId: column.id,
                      }
                    : { kind: "rename_table", tableId: table.id },
                )
              }
            >
              Rename
            </button>
            {column ? (
              <button
                className="plain-button danger-text"
                disabled={disabled}
                onClick={() =>
                  onEdit({
                    kind: "drop_column",
                    tableId: table.id,
                    columnId: column.id,
                  })
                }
              >
                Delete
              </button>
            ) : (
              <button
                className="button"
                disabled={disabled}
                onClick={() =>
                  onEdit({ kind: "add_column", tableId: table.id })
                }
              >
                Add field
              </button>
            )}
            {hinted && (
              <button
                className="plain-button"
                onClick={() => onDismiss(typeHintId(column))}
              >
                Hide suggestion
              </button>
            )}
            {!column && (
              <button
                className="plain-button danger-text"
                disabled={disabled}
                onClick={() =>
                  onEdit({ kind: "drop_table", tableId: table.id })
                }
              >
                Remove table
              </button>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
