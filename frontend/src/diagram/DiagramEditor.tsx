import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  useViewport,
  type Edge,
  type Viewport,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { comparisonView } from "../model/comparison.ts";
import { databasePresentation } from "../model/database-presentation.ts";
import { pathLabel } from "../model/presentation.ts";
import { schemaSpec } from "../model/wire.ts";
import Icon from "../shared/Icon";
import CategoryDiagram from "./CategoryDiagram.tsx";
import DetailsPopover from "./DetailsPopover.tsx";
import {
  arrangeTables,
  detailsAnchor,
  projectAnchor,
  relationPaths,
  type DiagramAnchor,
} from "./diagram";
import DiagramToolbar from "./DiagramToolbar.tsx";
import { routeRelationships } from "./relationship-routing";
import RelationshipEdge from "./RelationshipEdge";
import TableNode, { type TableFlowNode } from "./TableNode";
import type { Selection } from "./types.ts";
import type { DiagramProps } from "./view-types.ts";
const nodeTypes = { table: TableNode };
const edgeTypes = { relationship: RelationshipEdge };
type Point = { x: number; y: number };
export default function DiagramEditor(props: DiagramProps) {
  return (
    <ReactFlowProvider key={props.mode}>
      {props.mode === "category" ? (
        <CategoryDiagram {...props} />
      ) : (
        <TablesDiagram {...props} />
      )}
    </ReactFlowProvider>
  );
}
function TablesDiagram({
  useCase,
  tables: currentTables,
  comparison = null,
  comparisonMode = "changes",
  busy,
  mode,
  onMode,
  disabled,
  fitNewData,
  toolbar,
  footer,
  onLayout: save,
  onPreview,
}: DiagramProps) {
  const [selection, setSelection] = useState<Selection>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<DiagramAnchor>({
    point: { x: 0, y: 0 },
  });
  const [nodes, setNodes, onNodesChange] = useNodesState<TableFlowNode>([]);
  const flow = useReactFlow<TableFlowNode>();
  const viewport = useViewport();
  const canvas = useRef<HTMLDivElement>(null);
  const nodesInitialized = useNodesInitialized();
  const pendingView = useRef(true);
  const placedSignature = useRef("");
  const previewViewport = useRef<Viewport | null>(null);
  const pendingPreviewFit = useRef(false);
  const restoringViewport = useRef(false);
  useEffect(() => {
    if (comparison) {
      previewViewport.current ??= flow.getViewport();
      pendingPreviewFit.current = true;
      setSelection(null);
      setHoveredEdgeId(null);
    } else if (!comparison && previewViewport.current) {
      const previous = previewViewport.current;
      previewViewport.current = null;
      pendingPreviewFit.current = false;
      restoringViewport.current = true;
      void flow.setViewport(previous).finally(() => {
        restoringViewport.current = false;
      });
    }
  }, [comparison, flow]);
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
  const normalRelations = useCase.relationships;
  const displayed = useMemo(
    () =>
      comparison
        ? comparisonView(comparison, comparisonMode)
        : {
            tables: currentTables,
            relationships: normalRelations,
            equations: useCase.equations,
          },
    [
      comparison,
      comparisonMode,
      currentTables,
      normalRelations,
      useCase.equations,
    ],
  );
  const tables = displayed.tables,
    relations = displayed.relationships;
  const marks =
    comparison && comparisonMode === "changes" ? comparison.changes : undefined;
  const presentation = useMemo(
    () =>
      databasePresentation(schemaSpec(tables, relations, displayed.equations)),
    [tables, relations, displayed.equations],
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
  const layoutSignature = JSON.stringify([
    tables.map((table) => [
      table.id,
      table.columns.map((column) => column.id),
      (displayed.equations ?? []).filter((e) => e.left.source === table.id)
        .length,
    ]),
    relations.map((r) => [
      r.id,
      r.source_table,
      r.source_columns,
      r.target_table,
      r.target_columns,
    ]),
  ]);
  const defaultPositions = useMemo(
    () =>
      arrangeTables(
        tables,
        relations,
        Object.fromEntries(
          tables.map((table) => [
            table.id,
            {
              width: 280,
              height:
                53 +
                table.columns.length * 32 +
                (displayed.equations ?? []).filter(
                  (e) => e.left.source === table.id,
                ).length *
                  28,
            },
          ]),
        ),
      ),
    [layoutSignature],
  );

  useEffect(() => {
    if (!useCase) {
      setNodes([]);
      return;
    }
    const arrange = placedSignature.current !== layoutSignature;
    placedSignature.current = layoutSignature;
    if (arrange) {
      pendingView.current = true;
      if (comparison) pendingPreviewFit.current = true;
    }
    const relevant = new Set(
      focusedRelation
        ? [focusedRelation.source_table, focusedRelation.target_table]
        : [],
    );
    setNodes((current) =>
      tables.map((table) => ({
        ...current.find((n) => n.id === table.id),
        id: table.id,
        type: "table",
        position: arrange
          ? defaultPositions[table.id]
          : (current.find((n) => n.id === table.id)?.position ??
            defaultPositions[table.id]),
        dragHandle: ".table-header",
        selected: selection?.kind === "table" && selection.tableId === table.id,
        data: {
          layoutSignature,
          table,
          editable: false,
          activeColumns: focusedRelation
            ? [
                ...(focusedRelation.source_table === table.id
                  ? focusedRelation.source_columns
                  : []),
                ...(focusedRelation.target_table === table.id
                  ? focusedRelation.target_columns
                  : []),
              ]
            : [],
          selectedColumn:
            selection?.kind === "column" && selection.tableId === table.id
              ? selection.columnId
              : undefined,
          faded: !!focusedRelation && !relevant.has(table.id),
          readOnly:
            disabled ||
            (!!comparison &&
              (comparisonMode === "before" ||
                marks?.tables[table.id]?.kind === "removed")),
          change: marks?.tables[table.id],
          columnChanges: marks?.columns,
          equations: (displayed.equations ?? [])
            .filter((e) => e.left.source === table.id)
            .map((e) => ({
              id: e.id,
              label: `${pathLabel(presentation, e.left)} = ${pathLabel(presentation, e.right)}`,
              change: marks?.equations?.[e.id]?.kind,
            })),
          onColumn: selectColumn,
          onTable: selectTable,
          onPreview: previewTable,
        },
      })),
    );
  }, [
    tables,
    disabled,
    comparison,
    comparisonMode,
    marks,
    useCase?.id,
    useCase?.positions,
    useCase?.relationships,
    selection,
    focusedRelation,
    selectColumn,
    selectTable,
    previewTable,
    setNodes,
    defaultPositions,
    layoutSignature,
    displayed.equations,
    presentation,
    busy,
  ]);
  useEffect(() => {
    if (
      comparison ||
      !pendingView.current ||
      !nodesInitialized ||
      nodes.length !== tables.length ||
      !nodes.every((node) => node.data.layoutSignature === layoutSignature) ||
      !tables.length
    )
      return;
    pendingView.current = false;
    void save({
      positions: Object.fromEntries(
        nodes.map((node) => [node.id, node.position]),
      ),
    });
    void flow.fitView({ padding: 0.12, maxZoom: 1 });
  }, [
    comparison,
    nodesInitialized,
    nodes,
    tables.length,
    layoutSignature,
    flow,
    useCase.viewport,
    fitNewData,
  ]);
  useEffect(() => {
    if (
      !comparison ||
      !pendingPreviewFit.current ||
      !nodesInitialized ||
      nodes.length !== tables.length ||
      !tables.length ||
      !nodes.every(
        (node) => node.data.table === tables.find((t) => t.id === node.id),
      )
    )
      return;
    const frame = requestAnimationFrame(() => {
      if (!previewViewport.current) return;
      pendingPreviewFit.current = false;
      void flow.fitView({ padding: 0.15, maxZoom: 1, duration: 160 });
    });
    return () => cancelAnimationFrame(frame);
  }, [comparison, nodesInitialized, nodes, tables, flow]);
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
  const endpointName = (tableId: string, columns: string[]) => {
    const table = tables.find((t) => t.id === tableId);
    return `${table?.name}.${columns.map((id) => table?.columns.find((c) => c.id === id)?.name).join(", ")}`;
  };
  const edges: Edge[] = paths.map(({ relation, group, index }) => {
    const selected =
      selection?.kind === "relation" && selection.relationId === group.id;
    const focused = focusedRelation?.id === group.id;
    const change = marks?.relationships[group.id];
    const color =
      change?.kind === "added"
        ? "#43826a"
        : change?.kind === "removed"
          ? "#b66663"
          : change
            ? "#aa8542"
            : focused
              ? "#3569ad"
              : "#778493";
    const route = routes[relation.id];
    return {
      id: relation.id,
      source: relation.source_table,
      target: relation.target_table,
      sourceHandle: `out-${route?.sourceSide ?? "left"}:${relation.source_columns[0]}`,
      targetHandle: `in-${route?.targetSide ?? "right"}:${relation.target_columns[0]}`,
      type: "relationship",
      selected,
      zIndex: focused ? 5 : 0,
      data: { route, focused, relationId: group.id, labelVisible: index === 0 },
      className: change ? `is-${change.kind}` : undefined,
      ariaLabel: `${endpointName(relation.source_table, relation.source_columns)} to ${endpointName(relation.target_table, relation.target_columns)}`,
      label:
        group.name ??
        `${endpointName(group.source_table, group.source_columns)} → ${endpointName(group.target_table, group.target_columns)}`,
      domAttributes: {
        onFocus: () => setHoveredEdgeId(relation.id),
        onBlur: () => setHoveredEdgeId(null),
      },
      style: {
        stroke: color,
        strokeWidth: focused ? 2.3 : 1.5,
        strokeDasharray: change?.kind === "removed" ? "5 4" : undefined,
        opacity: !focusedRelation || focused ? 1 : 0.16,
      },
    };
  });
  const saveViewport = (
    _event: MouseEvent | TouchEvent | null,
    viewport: Viewport,
  ) => {
    if (tables.length && !comparison && !restoringViewport.current)
      void save({ viewport });
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
      <DiagramToolbar mode={mode} onMode={onMode} busy={!!busy}>
        {toolbar}
      </DiagramToolbar>
      <main className="diagram-workspace">
        <div className="canvas-container" ref={canvas}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
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
              if (
                (comparisonMode === "before" && comparison) ||
                marks?.relationships[
                  (edge.data?.relationId as string) ?? edge.id
                ]?.kind === "removed"
              )
                return;
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
            nodesConnectable={false}
            nodesDraggable={!busy && !disabled && !comparison}
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
          {!tables.length && !busy && !disabled && (
            <button className="empty-import" onClick={() => onMode("category")}>
              <Icon name="plus" size={18} />
              Add objects in Category
            </button>
          )}
          {!disabled &&
            (!comparison || comparisonMode !== "before") &&
            selection &&
            anchorVisible && (
              <DetailsPopover
                mode="tables"
                selection={selection}
                tables={currentTables}
                useCase={useCase}
                point={popoverPoint}
                onClose={() => setSelection(null)}
                onPreview={previewTable}
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
