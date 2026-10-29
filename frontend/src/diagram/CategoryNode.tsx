import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { useState, useLayoutEffect } from "react";
import InlineLabel from "./InlineLabel.tsx";
export type CategoryNodeData = Record<string, unknown> & {
  label: string;
  kind: "entity" | "type";
  change?: string;
  faded: boolean;
  readOnly: boolean;
  canConnect: boolean;
  onSelect: () => void;
  onRename?: (name: string) => Promise<void>;
  onDelete?: () => void;
  primaryKey?: {
    id: string;
    name: string;
    onRename?: (name: string) => Promise<void>;
  }[];
  width?: number;
  height?: number;
  ports?: {
    id: string;
    type: "source" | "target";
    side: "left" | "right";
    offset: number;
  }[];
};
export type CategoryFlowNode = Node<CategoryNodeData, "object">;
export default function CategoryNode({
  data,
  selected,
  id,
}: NodeProps<CategoryFlowNode>) {
  const [editRequest, setEditRequest] = useState(0);
  const updateInternals = useUpdateNodeInternals();
  const portSignature = JSON.stringify([data.width, data.height, data.ports]);
  useLayoutEffect(() => {
    updateInternals(id);
  }, [id, portSignature, updateInternals]);
  return (
    <div
      onDoubleClick={() => {
        if (!data.readOnly && !data.connectionMode && data.kind === "entity")
          setEditRequest((value) => value + 1);
      }}
      style={{ width: data.width, height: data.height }}
      className={`category-node ${data.kind} ${selected ? "selected" : ""} ${data.change ? `is-${data.change}` : ""} ${data.faded ? "faded" : ""} ${data.connectionTarget ? "connection-target" : ""} ${data.connectionMode ? "connecting" : ""}`}
    >
      {[
        ["left", Position.Left],
        ["right", Position.Right],
      ].flatMap(([id, position]) =>
        (data.kind === "entity"
          ? (["source", "target"] as const)
          : (["target"] as const)
        ).map((type) => (
          <Handle
            key={`${id}:${type}`}
            type={type}
            id={id}
            position={position as Position}
            className="render-only-handle"
            aria-hidden="true"
            style={{ width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
            isConnectable={false}
            isConnectableStart={false}
          />
        )),
      )}
      {data.ports?.map((port) => (
        <Handle
          key={`${port.id}:${port.type}`}
          id={port.id}
          type={port.type}
          position={port.side === "left" ? Position.Left : Position.Right}
          className="render-only-handle"
          aria-hidden="true"
          style={{
            top: port.offset,
            width: 1,
            height: 1,
            opacity: 0,
            pointerEvents: "none",
          }}
          isConnectable={false}
          isConnectableStart={false}
        />
      ))}
      <div className="category-node-content">
        <InlineLabel
          label={data.label}
          name={`${data.kind} ${data.label}`}
          disabled={data.readOnly}
          onSelect={data.onSelect}
          onRename={data.onRename}
          editRequest={editRequest}
        />
        {data.kind === "entity" && (
          <div className="category-primary-key">
            {data.primaryKey?.length ? (
              <>
                <span className="primary-key-badge" title="Record identity">
                  PK
                </span>
                {data.primaryKey.map((key) => (
                  <InlineLabel
                    key={key.id}
                    label={key.name}
                    name={`primary key ${data.label}.${key.name}`}
                    disabled={data.readOnly}
                    onSelect={data.onSelect}
                    onRename={key.onRename}
                  />
                ))}
              </>
            ) : (
              <span
                className="missing-primary-key"
                title="This saved object has no declared primary key"
              >
                No primary key
              </span>
            )}
          </div>
        )}
      </div>
      {!data.readOnly && data.onDelete && (
        <button
          className="graph-delete nodrag nopan"
          aria-label={`Delete ${data.kind} ${data.label}`}
          title="Delete"
          onClick={(e) => {
            e.stopPropagation();
            data.onDelete?.();
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
