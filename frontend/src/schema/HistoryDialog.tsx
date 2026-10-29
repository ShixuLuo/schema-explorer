import { useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
  useNodesInitialized,
  useReactFlow,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { PRESET_TAGS, liveCheckpointId } from "../model/history.ts";
import type { ComparisonMode } from "../model/comparison.ts";
import type { HistoryInfo, SavedComparison } from "../application/history.ts";
import { layoutHistory, type HistoryGraphNode } from "./history-graph.ts";
import Icon from "../shared/Icon";

type Props = {
  value: HistoryInfo;
  onRestore: (id: string) => Promise<void>;
  onCompare: (id: string) => Promise<void>;
  onExport: (id: string) => void;
  onAddTag: (id: string, tag: string) => Promise<void>;
  onRemoveTag: (id: string, tag: string) => Promise<void>;
  obscured?: boolean;
  onClose: () => void;
};
type Selection = { id: string; x: number; y: number };
type GraphData = Record<string, unknown> &
  HistoryGraphNode & {
    editing: boolean;
    live: boolean;
    selected: boolean;
    working: boolean;
    hasChildren: boolean;
    onSelect: (selection: Selection) => void;
  };
type HistoryNode = Node<GraphData>;
function CheckpointNode({ data }: NodeProps<HistoryNode>) {
  const checkpoint = data.checkpoint;
  const tags = [...(checkpoint.tags ?? [])].sort(
    (a, b) =>
      Number(a.toLowerCase() !== "live") - Number(b.toLowerCase() !== "live"),
  );
  return (
    <div
      className={`history-event ${data.selected ? "is-selected" : ""} ${data.editing ? "is-editing" : ""} ${data.live ? "is-live" : ""}`}
      data-checkpoint-id={checkpoint.id}
      style={{ height: data.height }}
    >
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        style={{ left: 13, top: 4 }}
      />
      {data.hasChildren && (
        <span className="history-event-stem" aria-hidden="true" />
      )}
      <span className="history-event-marker" aria-hidden="true" />
      <button
        className="history-event-body nodrag nopan"
        aria-label={`Checkpoint: ${checkpoint.name}`}
        disabled={data.working}
        onClick={(event) => {
          event.stopPropagation();
          data.onSelect({
            id: checkpoint.id,
            x: event.clientX,
            y: event.clientY,
          });
        }}
        title={`${checkpoint.name}\n${new Date(checkpoint.createdAt).toLocaleString("en-US")}`}
      >
        <strong>{checkpoint.name}</strong>
        <span className="history-event-meta">
          {checkpoint.operationCount !== undefined
            ? `${checkpoint.operationCount} ${checkpoint.operationCount === 1 ? "operation" : "operations"}`
            : ""}
          {data.editing && (
            <span className="history-editing-position">
              <Icon name="arrow" size={11} />
              Editing
            </span>
          )}
        </span>
      </button>
      {!!tags.length && (
        <div
          className="history-event-tags nodrag nopan nowheel"
          aria-label="Checkpoint tags"
        >
          {tags.slice(0, 2).map((tag) => (
            <span
              className="history-tag"
              data-tag={tag.toLowerCase()}
              key={tag}
              title={tag}
            >
              {tag}
            </span>
          ))}
          {tags.length > 2 && (
            <span
              className="history-more-tags"
              title={tags.slice(2).join(", ")}
            >
              +{tags.length - 2}
            </span>
          )}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        style={{ left: 13, bottom: 0 }}
      />
    </div>
  );
}
const nodeTypes = { checkpoint: CheckpointNode };
export default function HistoryDialog(props: Props) {
  return (
    <ReactFlowProvider>
      <HistoryGraph {...props} />
    </ReactFlowProvider>
  );
}
function HistoryGraph({
  value,
  onRestore,
  onCompare,
  onExport,
  onAddTag,
  onRemoveTag,
  obscured = false,
  onClose,
}: Props) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [tagEditor, setTagEditor] = useState(false);
  const [name, setName] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLElement>(null),
    flow = useReactFlow(),
    initialized = useNodesInitialized();
  const liveId = liveCheckpointId(value.checkpoints);
  const layout = useMemo(() => layoutHistory(value), [value]);
  const clear = () => {
    setSelection(null);
    setTagEditor(false);
    setError("");
  };
  useEffect(() => {
    clear();
  }, [value.editing, value.checkpoints.length]);
  useEffect(() => {
    if (initialized) void flow.fitView({ padding: 0.18, maxZoom: 1 });
  }, [initialized, layout, flow]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || working || obscured) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (selection) clear();
      else onClose();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [selection, working, obscured, onClose]);
  const run = async (action: () => Promise<void>, keepOpen = false) => {
    if (working) return;
    setWorking(true);
    setError("");
    try {
      await action();
      if (!keepOpen) clear();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setWorking(false);
    }
  };
  const nodes: HistoryNode[] = layout.nodes.map((node) => ({
    id: node.id,
    position: node.position,
    type: "checkpoint",
    data: {
      ...node,
      editing: value.editing === node.id,
      live: liveId === node.id,
      selected: selection?.id === node.id,
      working,
      hasChildren: layout.edges.some((edge) => edge.source === node.id),
      onSelect: (next) => {
        setSelection(next);
        setTagEditor(false);
        setError("");
      },
    },
  }));
  const edges = layout.edges.map((edge) => ({
    ...edge,
    type: "smoothstep",
    style: { stroke: "#b3afa6", strokeWidth: 1.8 },
    ariaLabel: "Checkpoint sequence",
  }));
  const checkpoint = selection
    ? value.checkpoints.find((c) => c.id === selection.id)
    : undefined;
  const bounds = dialog.current?.getBoundingClientRect();
  const point =
    selection && bounds
      ? {
          left: Math.max(
            12,
            Math.min(selection.x - bounds.left + 12, bounds.width - 270),
          ),
          top: Math.max(
            12,
            Math.min(selection.y - bounds.top + 12, bounds.height - 340),
          ),
        }
      : undefined;
  return (
    <div
      className="modal-backdrop history-backdrop"
      aria-hidden={obscured || undefined}
      inert={obscured}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !working) onClose();
      }}
    >
      <section
        ref={dialog}
        className="history-graph"
        role="dialog"
        aria-modal="true"
        aria-label="History"
        aria-busy={working}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          onNodeClick={(event, node) => {
            setSelection({ id: node.id, x: event.clientX, y: event.clientY });
            setTagEditor(false);
            setError("");
          }}
          fitView
          fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
          deleteKeyCode={null}
          onPaneClick={() => {
            if (!working) clear();
          }}
          onMoveStart={(event) => {
            if (event && !working) clear();
          }}
          minZoom={0.12}
          maxZoom={1.4}
          proOptions={{ hideAttribution: true }}
        />
        <span className="history-caption">History</span>
        {value.editing === null && (
          <button
            className={`history-empty-editing ${nodes.length ? "is-root-position" : ""}`}
            onClick={onClose}
          >
            <span className="history-editing-position">Editing</span>Empty model
          </button>
        )}
        <div className="history-graph-controls">
          <button
            className="icon-button"
            aria-label="Fit history"
            title="Fit history"
            onClick={() =>
              void flow.fitView({ padding: 0.18, maxZoom: 1, duration: 150 })
            }
          >
            <Icon name="fit" size={17} />
          </button>
          <button
            className="icon-button"
            autoFocus
            aria-label="Close history"
            title="Close history"
            disabled={working}
            onClick={onClose}
          >
            <Icon name="close" size={17} />
          </button>
        </div>
        {checkpoint && (
          <div
            className="history-node-menu"
            role="dialog"
            aria-label={tagEditor ? "Checkpoint tags" : "History node actions"}
            style={point}
          >
            {tagEditor ? (
              <form
                className="history-tag-editor"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await onAddTag(checkpoint.id, name);
                    setName("");
                  }, true);
                }}
              >
                <div
                  className="history-preset-tags"
                  role="group"
                  aria-label="Preset tags"
                >
                  {PRESET_TAGS.map((tag) => {
                    const selected =
                      checkpoint.tags?.some(
                        (t) => t.toLowerCase() === tag.toLowerCase(),
                      ) ?? false;
                    return (
                      <button
                        key={tag}
                        type="button"
                        className="history-preset-tag"
                        data-tag={tag.toLowerCase()}
                        aria-pressed={selected}
                        disabled={working}
                        title={
                          tag === "Live"
                            ? "Confirmed deployed externally; only one checkpoint can be Live"
                            : undefined
                        }
                        onClick={() =>
                          void run(
                            () =>
                              selected
                                ? onRemoveTag(checkpoint.id, tag)
                                : onAddTag(checkpoint.id, tag),
                            true,
                          )
                        }
                      >
                        {selected && <Icon name="check" size={12} />}
                        <span>{tag}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="history-custom-tags">
                  {(checkpoint.tags ?? [])
                    .filter(
                      (tag) =>
                        !PRESET_TAGS.some(
                          (p) => p.toLowerCase() === tag.toLowerCase(),
                        ),
                    )
                    .map((tag) => (
                      <span className="history-tag" key={tag}>
                        {tag}
                        <button
                          type="button"
                          className="icon-button"
                          disabled={working}
                          aria-label={`Remove tag ${tag}`}
                          onClick={() =>
                            void run(
                              () => onRemoveTag(checkpoint.id, tag),
                              true,
                            )
                          }
                        >
                          <Icon name="close" size={11} />
                        </button>
                      </span>
                    ))}
                </div>
                <label className="edit-label">
                  Custom tag
                  <input
                    aria-label="Tag name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={40}
                    disabled={working}
                    autoComplete="off"
                  />
                </label>
                <div className="dialog-actions">
                  <button
                    className="button"
                    type="button"
                    disabled={working}
                    onClick={() => {
                      setTagEditor(false);
                      setError("");
                    }}
                  >
                    Done
                  </button>
                  <button
                    className="button primary"
                    disabled={working || !name.trim()}
                  >
                    Add tag
                  </button>
                </div>
              </form>
            ) : (
              <>
                <button
                  disabled={working}
                  title="Restore this checkpoint and continue editing"
                  onClick={() =>
                    void run(async () => {
                      await onRestore(checkpoint.id);
                      onClose();
                    })
                  }
                >
                  Continue from here
                </button>
                <button
                  disabled={working}
                  onClick={() => void run(() => onCompare(checkpoint.id))}
                >
                  Compare with Editing
                </button>
                <button
                  disabled={working}
                  onClick={() => {
                    setName("");
                    setError("");
                    setTagEditor(true);
                  }}
                >
                  Tags
                </button>
                <button
                  disabled={working}
                  onClick={() => {
                    clear();
                    onExport(checkpoint.id);
                  }}
                >
                  Export from here
                </button>
              </>
            )}
            {error && (
              <p className="edit-error" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

export function HistoryComparisonBar({
  value,
  mode,
  onMode,
  onClose,
  onExport,
}: {
  value: SavedComparison;
  mode: ComparisonMode;
  onMode: (mode: ComparisonMode) => void;
  onClose: () => void;
  onExport?: () => void;
}) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <>
      <section
        className="graph-preview-controls"
        role="region"
        aria-label="Saved version comparison"
      >
        <div className="graph-preview-heading">
          <strong>Compare</strong>
          <span>
            {value.beforeName} → {value.afterName}
          </span>
        </div>
        <div className="graph-preview-actions">
          <div
            className="preview-modes"
            role="group"
            aria-label="Comparison view"
          >
            {(["before", "changes", "after"] as const).map((view) => (
              <button
                key={view}
                aria-pressed={mode === view}
                onClick={() => onMode(view)}
                title={
                  view === "before"
                    ? value.beforeName
                    : view === "after"
                      ? value.afterName
                      : undefined
                }
              >
                {view[0].toUpperCase() + view.slice(1)}
              </button>
            ))}
          </div>
          <span className="toolbar-spacer" />
          {onExport && value.range && (
            <button className="button" onClick={onExport}>
              Export SQL
            </button>
          )}
          <button className="button" onClick={onClose}>
            Close comparison
          </button>
        </div>
      </section>
      {mode === "changes" && (
        <div className="graph-preview-legend" aria-label="Change legend">
          <span className="change-added">+ Added</span>
          <span className="change-removed">− Removed</span>
          <span className="change-changed">~ Changed</span>
        </div>
      )}
    </>
  );
}
