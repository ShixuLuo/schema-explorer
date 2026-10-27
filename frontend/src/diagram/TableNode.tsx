import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { Table } from "../model/schema.ts";
import { canBeInteger, typeHintId } from "../model/profile.ts";
import Icon from "../shared/Icon";
export type TableNodeData = {
  table: Table;
  activeColumns: string[];
  selectedColumn?: string;
  faded: boolean;
  hints: boolean;
  dismissed: string[];
  onColumn: (
    tableId: string,
    columnId: string,
    point: { x: number; y: number },
  ) => void;
  onTable: (tableId: string, point: { x: number; y: number }) => void;
  onPreview: (tableId: string) => void;
};
export type TableFlowNode = Node<TableNodeData, "table">;
export default function TableNode({
  data,
  selected,
}: NodeProps<TableFlowNode>) {
  const { table } = data;
  return (
    <div
      className={`table-card ${selected ? "is-selected" : ""} ${data.faded ? "is-faded" : ""}`}
    >
      <div
        className="table-header"
        onDoubleClick={() => data.onPreview(table.id)}
      >
        <Icon name="table" size={15} />
        <button
          className="table-title"
          onClick={(event) =>
            data.onTable(table.id, { x: event.clientX, y: event.clientY })
          }
          title={table.name}
        >
          {table.name}
        </button>
        <span className="table-row-count">
          {table.rowCount.toLocaleString()} rows
        </span>
        <button
          className="node-data-button nodrag"
          onClick={(event) => {
            event.stopPropagation();
            data.onPreview(table.id);
          }}
          aria-label={`View ${table.name} data`}
          title="View data"
        >
          <Icon name="eye" size={14} />
        </button>
      </div>
      <div className="table-columns">
        {table.columns.map((column) => {
          const hint =
            data.hints &&
            canBeInteger(table, column) &&
            !data.dismissed.includes(typeHintId(column));
          const active =
            data.activeColumns.includes(column.id) ||
            data.selectedColumn === column.id;
          return (
            <div
              key={column.id}
              className={`column-row ${active ? "is-active" : ""}`}
            >
              <Handle
                type="target"
                position={Position.Left}
                id={`in-left:${column.id}`}
              />
              <Handle
                type="source"
                position={Position.Left}
                id={`out-left:${column.id}`}
              />
              <button
                className="column-button nodrag"
                onClick={(e) => {
                  e.stopPropagation();
                  data.onColumn(table.id, column.id, {
                    x: e.clientX,
                    y: e.clientY,
                  });
                }}
                aria-label={`Inspect ${table.name}.${column.name}`}
              >
                {(table.primaryKey ?? []).includes(column.id) && (
                  <span className="primary-key-badge" title="Primary key">
                    PK
                  </span>
                )}
                <span className="column-name" title={column.name}>
                  {column.name}
                </span>
                {hint && (
                  <span
                    className="type-hint"
                    title="Suggested type: integer. Click the field to see the check."
                  >
                    integer?
                  </span>
                )}
                <span className="column-type">{column.dataType ?? "text"}</span>
              </button>
              <Handle
                type="target"
                position={Position.Right}
                id={`in-right:${column.id}`}
              />
              <Handle
                type="source"
                position={Position.Right}
                id={`out-right:${column.id}`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
