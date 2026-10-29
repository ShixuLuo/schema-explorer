import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { ViewTable, ModelChange } from "../model/comparison.ts";
import Icon from "../shared/Icon";
export type TableNodeData = {
  layoutSignature?: string;
  table: ViewTable;
  readOnly?: boolean;
  editable?: boolean;
  change?: ModelChange;
  columnChanges?: Record<string, ModelChange>;
  activeColumns: string[];
  selectedColumn?: string;
  faded: boolean;
  equations?: { id: string; label: string; change?: string }[];
  onEquation?: (id: string) => void;
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
      className={`table-card ${selected ? "is-selected" : ""} ${data.faded ? "is-faded" : ""} ${data.readOnly ? "is-readonly" : ""} ${data.change ? `is-${data.change.kind}` : ""}`}
      data-change={data.change?.kind}
      onClick={(event) => {
        if (
          !data.readOnly &&
          !(event.target as HTMLElement).closest("button, .react-flow__handle")
        ) {
          data.onPreview(table.id);
        }
      }}
    >
      <div className="table-header">
        <Icon
          name={
            data.change?.kind === "added"
              ? "plus"
              : data.change?.kind === "removed"
                ? "minus"
                : data.change
                  ? "edit"
                  : "table"
          }
          size={15}
        />
        <button
          className="table-title"
          disabled={data.readOnly}
          onClick={(event) => {
            event.stopPropagation();
            data.onPreview(table.id);
          }}
          title={table.name}
        >
          {data.change?.previousName && (
            <>
              <span className="previous-name">{data.change.previousName}</span>
              <span className="rename-arrow">→</span>
            </>
          )}
          <span className="current-name">{table.name}</span>
        </button>
        <span className="table-row-count">
          {table.dataStatus === "unverified"
            ? "data unverified"
            : `${table.rowCount.toLocaleString()} rows`}
        </span>
        <button
          className="node-data-button nodrag"
          disabled={data.readOnly}
          aria-hidden={data.readOnly}
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
          const change = data.columnChanges?.[column.id];
          const readOnly = data.readOnly || change?.kind === "removed";
          const active =
            data.activeColumns.includes(column.id) ||
            data.selectedColumn === column.id;
          return (
            <div
              key={column.id}
              className={`column-row ${active ? "is-active" : ""} ${change ? `is-${change.kind}` : ""}`}
              data-column-id={column.id}
              data-change={change?.kind}
            >
              <Handle
                isConnectable={!readOnly && data.editable !== false}
                type="target"
                position={Position.Left}
                id={`in-left:${column.id}`}
              />
              <Handle
                isConnectable={!readOnly && data.editable !== false}
                type="source"
                position={Position.Left}
                id={`out-left:${column.id}`}
              />
              <button
                className="column-button nodrag"
                disabled={readOnly}
                onClick={(e) => {
                  e.stopPropagation();
                  data.onPreview(table.id);
                }}
                aria-label={`View ${table.name} data from ${column.name}`}
              >
                {(table.primaryKey ?? []).includes(column.id) && (
                  <span className="primary-key-badge" title="Primary key">
                    PK
                  </span>
                )}
                {!(table.primaryKey ?? []).includes(column.id) &&
                  table.uniqueKeys?.some((key) => key.includes(column.id)) && (
                    <span className="primary-key-badge" title="Unique key">
                      UK
                    </span>
                  )}
                <span className="column-name" title={column.name}>
                  {change?.previousName && (
                    <>
                      <span className="previous-name">
                        {change.previousName}
                      </span>
                      <span className="rename-arrow">→</span>
                    </>
                  )}
                  <span className="current-name">{column.name}</span>
                </span>
                <span className="column-type">{column.dataType ?? "text"}</span>
              </button>
              <Handle
                isConnectable={!readOnly && data.editable !== false}
                type="target"
                position={Position.Right}
                id={`in-right:${column.id}`}
              />
              <Handle
                isConnectable={!readOnly && data.editable !== false}
                type="source"
                position={Position.Right}
                id={`out-right:${column.id}`}
              />
            </div>
          );
        })}
      </div>
      {!!data.equations?.length && (
        <div className="table-equations">
          {data.equations.map((e) => (
            <button
              key={e.id}
              className={`equation-chip ${e.change ?? ""}`}
              disabled={data.readOnly || e.change === "removed"}
              title={e.label}
              aria-label={
                data.editable === false
                  ? `Equation ${e.label}`
                  : `Remove equation ${e.label}`
              }
              onClick={() => data.onEquation?.(e.id)}
            >
              <span>{e.label}</span>
              {data.editable !== false && <span aria-hidden="true">×</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
