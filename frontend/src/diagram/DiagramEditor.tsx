import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  ReactFlow,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  useViewport,
  type Connection,
  type Edge,
  type Viewport,
} from "@xyflow/react";
import { canBeInteger, typeHintId } from "../model/profile.ts";
import type { Relation, Table } from "../model/schema.ts";
import type { UseCase } from "../model/workspace.ts";
import type { Selection } from "./types.ts";
import TableNode, { type TableFlowNode } from "./TableNode";
import RelationshipEdge from "./RelationshipEdge";
import DetailsPopover from "./DetailsPopover.tsx";
import Icon from "../shared/Icon";
import type { EditTarget } from "../application/intents.ts";
import { routeRelationships } from "./relationship-routing";
import {
  arrangeTables,
  initialTablePositions,
  relationPaths,
  detailsAnchor,
  projectAnchor,
  type DiagramAnchor,
} from "./diagram";
const nodeTypes = { table: TableNode };
const edgeTypes = { relationship: RelationshipEdge };
type Point = { x: number; y: number };
type Props = {
  useCase: UseCase;
  tables: Table[];
  busy: string;
  disabled: boolean;
  fitNewData: boolean;
  toolbar: ReactNode;
  footer: ReactNode;
  onLayout: (
    patch: Pick<Partial<UseCase>, "positions" | "viewport">,
  ) => Promise<void>;
  onEdit: (target: EditTarget) => void;
  onPreview: (id: string) => void;
  onAcceptRelation: (relation: Relation) => void;
  onDismiss: (id: string) => void;
  onCreateTable: () => void;
};
export default function Diagram({
  useCase,
  tables,
  busy,
  disabled,
  fitNewData,
  toolbar,
  footer,
  onLayout: save,
  onEdit,
  onPreview,
  onAcceptRelation,
  onDismiss: dismiss,
  onCreateTable: createTable,
}: Props) {
  const [selection, setSelection] = useState<Selection>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<DiagramAnchor>({
    point: { x: 0, y: 0 },
  });
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [nodes, setNodes, onNodesChange] = useNodesState<TableFlowNode>([]);
  const flow = useReactFlow<TableFlowNode>();
  const viewport = useViewport();
  const canvas = useRef<HTMLDivElement>(null);
  const nodesInitialized = useNodesInitialized();
  const pendingView = useRef(true);
  const confirmRelation = (relation: Relation) => {
    setSelection(null);
    onAcceptRelation(relation);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelection(null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const selectColumn = useCallback(
    (tableId: string, columnId: string, point: Point) => {
      setSelection({ kind: "column", tableId, columnId });
      setAnchor(
        detailsAnchor(flow.screenToFlowPosition(point), flow.getNode(tableId)),
      );
    },
    [flow],
  );
  const selectTable = useCallback(
    (tableId: string, point: Point) => {
      setSelection({ kind: "table", tableId });
      setAnchor(
        detailsAnchor(flow.screenToFlowPosition(point), flow.getNode(tableId)),
      );
    },
    [flow],
  );
  const previewTable = useCallback(
    (tableId: string) => {
      onPreview(tableId);
      setSelection(null);
    },
    [onPreview],
  );
  const candidates = useMemo(
    () =>
      useCase?.candidates.filter(
        (r) =>
          !useCase.dismissed.includes(r.id) &&
          !useCase.relationships.some((link) => link.id === r.id),
      ) ?? [],
    [useCase],
  );
  const relations = useMemo(
    () => [
      ...(useCase?.relationships ?? []),
      ...(showSuggestions ? candidates : []),
    ],
    [useCase?.relationships, candidates, showSuggestions],
  );
  const hints = useMemo(
    () =>
      tables.flatMap((t) =>
        t.columns.filter(
          (c) =>
            canBeInteger(t, c) && !useCase?.dismissed.includes(typeHintId(c)),
        ),
      ),
    [tables, useCase?.dismissed],
  );
  const paths = useMemo(() => relationPaths(relations), [relations]);
  const hoveredRelationId = paths.find(
    (path) => path.relation.id === hoveredEdgeId,
  )?.group.id;
  const selectedRelation =
    selection?.kind === "relation"
      ? relations.find((r) => r.id === selection.relationId)
      : undefined;
  const focusedRelation =
    selectedRelation ?? relations.find((r) => r.id === hoveredRelationId);
  const defaultPositions = useMemo(
    () =>
      initialTablePositions(
        tables,
        [...(useCase?.relationships ?? []), ...candidates],
        useCase.positions,
      ),
    [tables, useCase?.relationships, useCase.positions, candidates],
  );

  useEffect(() => {
    if (!useCase) {
      setNodes([]);
      return;
    }
    const relevant = new Set(
      focusedRelation
        ? [focusedRelation.source.tableId, focusedRelation.target.tableId]
        : [],
    );
    setNodes((current) =>
      tables.map((table) => ({
        ...current.find((n) => n.id === table.id),
        id: table.id,
        type: "table",
        position:
          current.find((n) => n.id === table.id)?.position ??
          useCase.positions[table.id] ??
          defaultPositions[table.id],
        dragHandle: ".table-header",
        selected: selection?.kind === "table" && selection.tableId === table.id,
        data: {
          table,
          activeColumns: focusedRelation
            ? [focusedRelation.source, focusedRelation.target]
                .filter((endpoint) => endpoint.tableId === table.id)
                .flatMap(
                  (endpoint) => endpoint.columnIds ?? [endpoint.columnId],
                )
            : [],
          selectedColumn:
            selection?.kind === "column" && selection.tableId === table.id
              ? selection.columnId
              : undefined,
          faded: !!focusedRelation && !relevant.has(table.id),
          hints: showSuggestions,
          dismissed: useCase.dismissed,
          onColumn: selectColumn,
          onTable: selectTable,
          onPreview: previewTable,
        },
      })),
    );
  }, [
    tables,
    useCase?.id,
    useCase?.positions,
    useCase?.dismissed,
    useCase?.relationships,
    selection,
    focusedRelation,
    showSuggestions,
    candidates,
    selectColumn,
    selectTable,
    previewTable,
    setNodes,
    defaultPositions,
  ]);
  useEffect(() => {
    if (
      !pendingView.current ||
      !nodesInitialized ||
      nodes.length !== tables.length ||
      !tables.length
    )
      return;
    pendingView.current = false;
    if (!fitNewData && useCase.viewport)
      void flow.setViewport(useCase.viewport);
    else void flow.fitView({ padding: 0.12, maxZoom: 1 });
  }, [
    nodesInitialized,
    nodes.length,
    tables.length,
    flow,
    useCase.viewport,
    fitNewData,
  ]);
  const routes = useMemo(
    () =>
      routeRelationships(
        paths.map((path) => path.relation),
        nodes.map((node) => ({
          id: node.id,
          position: node.position,
          width: node.measured?.width ?? 280,
          height:
            node.measured?.height ?? 53 + node.data.table.columns.length * 32,
          columns: node.data.table.columns.map((column) => column.id),
        })),
      ),
    [paths, nodes],
  );
  const endpointName = (endpoint: Relation["source"]) => {
    const table = tables.find((table) => table.id === endpoint.tableId);
    return `${table?.name}.${(endpoint.columnIds ?? [endpoint.columnId]).map((id) => table?.columns.find((column) => column.id === id)?.name).join(", ")}`;
  };
  const edges: Edge[] = paths.map(({ relation, group, index }) => {
    const confirmed = useCase?.relationships.some((r) => r.id === group.id);
    const selected =
      selection?.kind === "relation" && selection.relationId === group.id;
    const focused = focusedRelation?.id === group.id;
    const color = focused ? "#3569ad" : confirmed ? "#778493" : "#a28b57";
    const route = routes[relation.id];
    return {
      id: relation.id,
      source: relation.source.tableId,
      target: relation.target.tableId,
      sourceHandle: `out-${route?.sourceSide ?? "left"}:${relation.source.columnId}`,
      targetHandle: `in-${route?.targetSide ?? "right"}:${relation.target.columnId}`,
      type: "relationship",
      selected,
      zIndex: focused ? 5 : 0,
      data: { route, focused, relationId: group.id, labelVisible: index === 0 },
      ariaLabel: `${endpointName(relation.source)} to ${endpointName(relation.target)}, ${relation.cardinality}${confirmed ? "" : ", suggested"}`,
      label: `${endpointName(group.source)} → ${endpointName(group.target)} · ${group.cardinality}`,
      domAttributes: {
        onFocus: () => setHoveredEdgeId(relation.id),
        onBlur: () => setHoveredEdgeId(null),
      },
      style: {
        stroke: color,
        strokeWidth: focused ? 2.3 : 1.5,
        strokeDasharray: confirmed ? undefined : "5 4",
        opacity: !focusedRelation || focused ? 1 : 0.16,
      },
    };
  });
  const onConnect = (connection: Connection) => {
    if (
      busy ||
      disabled ||
      !connection.sourceHandle ||
      !connection.targetHandle
    )
      return;
    const sourceColumn = connection.sourceHandle.slice(
        connection.sourceHandle.indexOf(":") + 1,
      ),
      targetColumn = connection.targetHandle.slice(
        connection.targetHandle.indexOf(":") + 1,
      );
    confirmRelation({
      id: `link:${sourceColumn}:${targetColumn}`,
      source: { tableId: connection.source, columnId: sourceColumn },
      target: { tableId: connection.target, columnId: targetColumn },
      checked: 0,
      matched: 0,
      sourceDistinct: 0,
      cardinality: "N:1",
    });
  };
  const autoArrange = () => {
    if (!useCase) return;
    const sizes = Object.fromEntries(
      nodes.map((node) => [
        node.id,
        {
          width: node.measured?.width ?? 280,
          height:
            node.measured?.height ?? 53 + node.data.table.columns.length * 32,
        },
      ]),
    );
    const positions = arrangeTables(
      tables,
      relations,
      sizes,
      canvas.current
        ? canvas.current.clientWidth / Math.max(1, canvas.current.clientHeight)
        : 1.6,
    );
    setNodes((current) =>
      current.map((n) => ({ ...n, position: positions[n.id] })),
    );
    void save({ positions, viewport: undefined });
    requestAnimationFrame(
      () => void flow.fitView({ padding: 0.12, maxZoom: 1, duration: 200 }),
    );
  };
  const saveViewport = (
    _event: MouseEvent | TouchEvent | null,
    viewport: Viewport,
  ) => {
    if (tables.length) void save({ viewport });
  };
  const canvasBounds = canvas.current?.getBoundingClientRect();
  const projectedAnchor = projectAnchor(
    anchor,
    Object.fromEntries(nodes.map((node) => [node.id, node.position])),
    viewport,
  );
  const anchorVisible =
    projectedAnchor &&
    projectedAnchor.x >= 0 &&
    projectedAnchor.y >= 0 &&
    projectedAnchor.x <= (canvasBounds?.width ?? innerWidth) &&
    projectedAnchor.y <= (canvasBounds?.height ?? innerHeight);
  const popoverPoint = {
    x: Math.max(
      12,
      Math.min(
        (projectedAnchor?.x ?? 0) + 12,
        (canvasBounds?.width ?? innerWidth) - 292,
      ),
    ),
    y: Math.max(
      12,
      Math.min(
        (projectedAnchor?.y ?? 0) + 12,
        (canvasBounds?.height ?? innerHeight) - 270,
      ),
    ),
  };

  return (
    <section className="diagram-editor">
      <header className="diagram-toolbar">
        {toolbar}
        <button
          className={`toolbar-button suggestions-control ${showSuggestions ? "active" : ""}`}
          role="switch"
          aria-checked={showSuggestions}
          aria-label="Show suggestions"
          title={
            useCase.analysis.limited
              ? "Relationship scan limited to 32 candidate pairs"
              : "Show data-backed suggestions"
          }
          onClick={() => {
            setShowSuggestions((v) => !v);
            setSelection(null);
          }}
        >
          Suggestions
          <span className="suggestion-count">
            {candidates.length + hints.length}
          </span>
        </button>

        <button
          className="toolbar-button"
          onClick={autoArrange}
          disabled={!tables.length || !!busy || disabled}
          aria-label="Arrange by relationships"
          title="Arrange by relationships"
        >
          <Icon name="layout" size={16} />
          Arrange
        </button>
        <button
          className="icon-button"
          disabled={!tables.length}
          onClick={() =>
            void flow.fitView({ padding: 0.16, maxZoom: 1, duration: 200 })
          }
          aria-label="Fit diagram"
          title="Fit diagram"
        >
          <Icon name="fit" size={16} />
        </button>
      </header>
      <main className="diagram-workspace">
        <div className="canvas-container" ref={canvas}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onConnect={onConnect}
            onNodeDragStop={(_event, node) => {
              const positions = Object.fromEntries(
                nodes.map((n) => [
                  n.id,
                  n.id === node.id ? node.position : n.position,
                ]),
              );
              void save({ positions });
            }}
            onMoveEnd={saveViewport}
            onMoveStart={() => setHoveredEdgeId(null)}
            onPaneClick={() => setSelection(null)}
            onEdgeMouseEnter={(_event, edge) => setHoveredEdgeId(edge.id)}
            onEdgeMouseLeave={(_event, edge) =>
              setHoveredEdgeId((id) => (id === edge.id ? null : id))
            }
            onEdgeClick={(event, edge) => {
              setSelection({
                kind: "relation",
                relationId: (edge.data?.relationId as string) ?? edge.id,
              });
              setAnchor(
                detailsAnchor(
                  flow.screenToFlowPosition({
                    x: event.clientX,
                    y: event.clientY,
                  }),
                ),
              );
            }}
            minZoom={0.15}
            maxZoom={1.6}
            defaultViewport={{ x: 0, y: 0, zoom: 1 }}
            deleteKeyCode={null}
            nodesConnectable={!busy && !disabled}
            nodesDraggable={!busy && !disabled}
            connectionMode={ConnectionMode.Loose}
            connectionRadius={32}
            proOptions={{ hideAttribution: true }}
            connectionLineStyle={{ stroke: "#557aa9", strokeWidth: 1.5 }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1}
              color="#dfe2e6"
            />
          </ReactFlow>
          {!tables.length && !busy && (
            <button className="empty-import" onClick={createTable}>
              <Icon name="plus" size={18} />
              Create table
            </button>
          )}
          {!!tables.length && (
            <div className="canvas-controls">
              <button
                aria-label="Zoom out"
                title="Zoom out"
                onClick={() => void flow.zoomOut({ duration: 100 })}
              >
                <Icon name="minus" size={15} />
              </button>
              <button
                aria-label="Zoom in"
                title="Zoom in"
                onClick={() => void flow.zoomIn({ duration: 100 })}
              >
                <Icon name="plus" size={15} />
              </button>
            </div>
          )}
          {selection && anchorVisible && (
            <DetailsPopover
              selection={selection}
              tables={tables}
              useCase={useCase}
              point={popoverPoint}
              onClose={() => setSelection(null)}
              onPreview={previewTable}
              onConfirm={confirmRelation}
              onDismiss={(id) => {
                setSelection(null);
                dismiss(id);
              }}
              onRemove={(id) => {
                const relation = useCase.relationships.find((r) => r.id === id);
                if (relation) {
                  setSelection(null);
                  onEdit({
                    kind: "drop_foreign_key",
                    tableId: relation.source.tableId,
                    relation,
                  });
                }
              }}
              disabled={!!busy || disabled}
              onEdit={(target) => {
                if (!busy) {
                  setSelection(null);
                  onEdit(target);
                }
              }}
            />
          )}
          {busy && (
            <div className="import-progress" role="status">
              <span className="spinner" />
              {busy}
            </div>
          )}
        </div>
        {footer}
      </main>
    </section>
  );
}
