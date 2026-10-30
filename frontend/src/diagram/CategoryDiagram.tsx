import {
  humanCommandOperations,
  renameObjectOperations,
  deleteObjectOperations,
  renamePrimaryKeyOperations,
  renameArrowOperations,
  deleteArrowOperations,
  equationOperations,
  dropEquationOperations,
} from "../application/human-commands.ts";
import {
  Background,
  BackgroundVariant,
  getViewportForBounds,
  MarkerType,
  ReactFlow,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Edge,
} from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { comparisonView } from "../model/comparison.ts";
import {
  attributeId,
  bindingEquations,
  referenceId,
  storagePresentation,
} from "../model/database-presentation.ts";
import type { Operation } from "../model/operations.ts";
import {
  pathLabel,
  qualifiedArrowLabel,
  type Equation,
  type Path,
} from "../model/presentation.ts";
import {
  relationCandidates,
  type RelationCandidate,
} from "../model/relation-selection.ts";
import { schemaSpec } from "../model/wire.ts";
import ArrowCreator from "../schema/ArrowCreator.tsx";
import Icon from "../shared/Icon";
import {
  categoryLayout,
  categoryProjection,
  routeCategoryReferences,
} from "./category-graph.ts";
import { categoryComparison } from "./category-presentation.ts";
import CategoryEdge from "./CategoryEdge.tsx";
import CategoryNode, { type CategoryFlowNode } from "./CategoryNode.tsx";
import DiagramToolbar from "./DiagramToolbar.tsx";
import type { DiagramProps } from "./view-types.ts";
import { placePopover } from "../shared/floating-placement.ts";
const nodeTypes = { object: CategoryNode },
  edgeTypes = { arrow: CategoryEdge };
export default function CategoryDiagram(props: DiagramProps) {
  const {
    useCase,
    tables,
    comparison,
    comparisonMode = "changes",
    busy,
    disabled,
  } = props;
  const displayed = useMemo(
    () =>
      comparison
        ? comparisonView(comparison, comparisonMode)
        : {
            tables,
            relationships: useCase.relationships,
            equations: useCase.equations,
          },
    [
      tables,
      useCase.relationships,
      useCase.equations,
      comparison,
      comparisonMode,
    ],
  );
  const bound = useMemo(
    () =>
      schemaSpec(
        displayed.tables,
        displayed.relationships,
        displayed.equations,
      ),
    [displayed],
  );
  const presentation = useMemo(
    () => categoryComparison(displayed, comparison, comparisonMode),
    [displayed, comparison, comparisonMode],
  );
  const [mode, setMode] = useState<"inspect" | "arrow" | "relation">("inspect"),
    [source, setSource] = useState<string>(),
    [pending, setPending] = useState<{ source: string; target: string }>(),
    [selection, setSelection] = useState<string>(),
    [object, setObject] = useState<string>(),
    [equation, setEquation] = useState<string>(),
    [picked, setPicked] = useState<string[]>([]),
    [candidates, setCandidates] = useState<RelationCandidate[]>([]),
    [candidate, setCandidate] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    setSelection(props.focusArrowId);
    setObject(props.focusObjectId);
    setEquation(props.focusEquationId);
  }, [props.focusArrowId, props.focusObjectId, props.focusEquationId]);
  const [editingArrow, setEditingArrow] = useState<string>(),
    [editingRelation, setEditingRelation] = useState<{
      id: string;
      dirty: boolean;
    }>();
  const [renameRequest, setRenameRequest] = useState({ id: "", count: 0 });
  const graph = useMemo(
      () => categoryProjection(presentation, equation),
      [presentation, equation],
    ),
    layout = useMemo(() => categoryLayout(graph), [graph]);
  const [nodes, setNodes, onNodesChange] = useNodesState<CategoryFlowNode>([]),
    flow = useReactFlow<CategoryFlowNode>(),
    initialized = useNodesInitialized(),
    fit = useRef(true),
    placed = useRef(""),
    canvas = useRef<HTMLDivElement>(null);
  const relationPanel = useRef<HTMLDivElement>(null);
  const [relationPosition, setRelationPosition] = useState<{ left: number; top: number }>();
  const placeRelationPanel = () => {
    const panel = relationPanel.current, container = canvas.current;
    if (!panel || !container) return;
    const bounds = container.getBoundingClientRect(), current = panel.getBoundingClientRect();
    const obstacles = [
      ...container.querySelectorAll<HTMLElement>(".react-flow__node, .category-edge-label, .category-equations"),
      ...document.querySelectorAll<HTMLElement>(".tutorial-popover, .floating-add-trigger"),
    ].filter(element => element.checkVisibility({checkVisibilityCSS:true,checkOpacity:true}))
      .map(element => element.getBoundingClientRect())
      .filter(box => box.width > 0 && box.height > 0)
      .map(box => ({left:box.left-bounds.left,top:box.top-bounds.top,width:box.width,height:box.height}));
    const position = placePopover(
      // Keep a clear position stable as selection chips appear or the canvas moves.
      {left:current.left-bounds.left,top:current.top-bounds.top,width:0,height:0},
      {width:current.width,height:current.height}, bounds, obstacles, false,
    );
    setRelationPosition(old => old?.left === position.left && old.top === position.top
      ? old : {left:position.left,top:position.top});
  };
  useEffect(() => {
    if (mode !== "relation" || !relationPanel.current || !canvas.current) return;
    let frame = requestAnimationFrame(placeRelationPanel);
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame); frame = requestAnimationFrame(placeRelationPanel);
    });
    observer.observe(relationPanel.current); observer.observe(canvas.current);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [mode, nodes, picked, candidates]);
  const routing = useMemo(
    () =>
      routeCategoryReferences(
        graph,
        Object.fromEntries(nodes.map((n) => [n.id, n.position])),
        Object.fromEntries(
          graph.objects.map((o) => {
            const n = nodes.find((n) => n.id === o.id);
            return [
              o.id,
              {
                width: n?.measured?.width ?? layout.sizes[o.id].width,
                height: n?.measured?.height ?? layout.sizes[o.id].height,
              },
            ];
          }),
        ),
      ),
    [graph, nodes, layout],
  );
  const signature = JSON.stringify([
    graph.objects.map((o) => [o.id, o.kind]),
    displayed.tables.map((t) => [
      t.id,
      (t.primaryKey ?? []).map(
        (id) => t.columns.find((c) => c.id === id)?.name,
      ),
    ]),
    graph.arrows.map((a) => [a.id, a.source, a.target, a.label]),
  ]);
  const marks =
      comparison && comparisonMode === "changes"
        ? comparison.changes
        : undefined,
    locked = disabled || !!busy;
  const editing = mode !== "inspect" || !!pending;
  const reset = () => {
    setMode("inspect");
    setSource(undefined);
    setPending(undefined);
    setPicked([]);
    setCandidates([]);
    setSelection(undefined);
    setObject(undefined);
    setEquation(undefined);
    setError("");
    setEditingArrow(undefined);
    setEditingRelation(undefined);
  };
  useEffect(() => {
    props.onCanvasEditing(editing);
    return () => props.onCanvasEditing(false);
  }, [editing]);
  useEffect(() => {
    if (props.canvasAction) {
      reset();
      if (props.canvasAction.kind !== "object")
        setMode(props.canvasAction.kind);
      props.onCanvasActionConsumed?.();
    }
  }, [props.canvasAction?.id]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") reset();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const run = async (ops: Operation[], label?: string) => {
    setError("");
    try {
      await props.onOperations(ops, label);
      reset();
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  };
  const perform = (ops: Operation[]) => {
    void run(ops).catch(() => {});
  };
  const createArrow = async (name: string) => {
    if (!source || !pending?.target)
      throw new Error("Choose source and target first.");
    const schema = schemaSpec(tables, useCase.relationships, useCase.equations);
    const ops = humanCommandOperations(
      schema,
      editingArrow
        ? {
            kind: "edit_arrow",
            arrowId: editingArrow,
            sourceId: source,
            targetId: pending.target,
            name,
          }
        : {
            kind: "create_arrow",
            sourceId: source,
            targetId: pending.target,
            name,
          },
    );
    if (ops.length)
      await props.onOperations(
        ops,
        editingArrow ? `Edit arrow ${editedArrow?.label ?? name}` : undefined,
      );
    reset();
  };
  const chooseArrow = (id: string) => {
    if (locked || pending || mode === "arrow") return;
    setObject(undefined);
    setEquation(undefined);
    setError("");
    if (mode === "relation") {
      setPicked((old) =>
        old.includes(id) ? old.filter((value) => value !== id) : [...old, id],
      );
      setCandidates([]);
      setEditingRelation((old) => (old ? { ...old, dirty: true } : old));
    } else setSelection(id);
  };
  useEffect(() => {
    const arrange = placed.current !== signature;
    placed.current = signature;
    if (arrange) fit.current = true;
    setNodes((current) =>
      graph.objects.map((item) => ({
        ...current.find((n) => n.id === item.id),
        id: item.id,
        type: "object",
        position: arrange
          ? layout.positions[item.id]
          : (current.find((n) => n.id === item.id)?.position ??
            layout.positions[item.id]),
        selected: item.id === object || item.id === source,
        draggable: !locked && mode === "inspect" && !pending,
        data: {
          layoutSignature: signature,
          label: item.label,
          primaryKey: (
            displayed.tables.find((t) => t.id === item.id)?.primaryKey ?? []
          ).map((id) => {
            const column = displayed.tables
              .find((t) => t.id === item.id)!
              .columns.find((c) => c.id === id)!;
            return {
              id,
              name: column.name,
              onRename:
                !editing && !(comparison && comparisonMode === "before")
                  ? (name: string) =>
                      run(renamePrimaryKeyOperations(item.id, id, name))
                  : undefined,
            };
          }),
          width: layout.sizes[item.id].width,
          height: layout.sizes[item.id].height,
          ports: graph.arrows
            .filter(
              (a) =>
                layout.attributePorts[a.id] &&
                (a.source === item.id || a.target === item.id),
            )
            .map((a) => {
              const port = layout.attributePorts[a.id];
              return {
                id: port.handle,
                type:
                  a.source === item.id
                    ? ("source" as const)
                    : ("target" as const),
                side: a.source === item.id ? port.sourceSide : port.targetSide,
                offset:
                  a.source === item.id
                    ? layout.sizes[item.id].height / 2
                    : port.offset,
              };
            }),
          kind: item.kind,
          change: marks?.tables[item.id]?.kind,
          readOnly:
            locked || editing || marks?.tables[item.id]?.kind === "removed",
          canConnect: false,
          faded: false,
          connectionMode: mode === "arrow",
          connectionTarget: mode === "arrow" && !!source,
          onSelect: () => {
            if (locked || marks?.tables[item.id]?.kind === "removed") return;
            if (mode === "arrow") {
              if (source) setPending({ source, target: item.id });
              else if (item.kind === "entity") {
                setSource(item.id);
                setError("");
              } else setError("Start an arrow at an entity.");
            } else if (mode === "inspect") {
              setObject(item.id);
              setSelection(undefined);
              setEquation(undefined);
              setError("");
            }
          },
          onRename:
            item.kind === "entity" && !editing
              ? (name: string) => run(renameObjectOperations(item.id, name))
              : undefined,
          onDelete:
            item.kind === "entity"
              ? () => perform(deleteObjectOperations(item.id))
              : undefined,
        },
      })),
    );
  }, [
    graph,
    layout,
    signature,
    locked,
    marks,
    object,
    source,
    mode,
    pending,
    editing,
    selection,
    picked,
    candidates,
    candidate,
    editingArrow,
    setNodes,
  ]);
  useEffect(() => {
    if (
      !initialized ||
      !fit.current ||
      nodes.length !== graph.objects.length ||
      !nodes.every((n) => n.data.layoutSignature === signature)
    )
      return;
    const frame = requestAnimationFrame(() => {
      fit.current = false;
      if (!canvas.current || !nodes.length) return;
      const x = Math.min(...nodes.map((n) => n.position.x)),
        y = Math.min(...nodes.map((n) => n.position.y));
      const right = Math.max(
          ...nodes.map((n) => n.position.x + layout.sizes[n.id].width),
        ),
        bottom = Math.max(
          ...nodes.map((n) => n.position.y + layout.sizes[n.id].height),
        );
      const viewport = getViewportForBounds(
        { x, y, width: right - x, height: bottom - y },
        canvas.current.clientWidth,
        canvas.current.clientHeight,
        0.2,
        1.25,
        0.08,
      );
      void flow.setViewport(viewport, { duration: 140 });
    });
    return () => cancelAnimationFrame(frame);
  }, [initialized, nodes, signature, flow, graph.objects.length]);
  const focused = candidates[candidate],
    left = new Set(focused?.left.arrows ?? graph.left),
    right = new Set(focused?.right.arrows ?? graph.right);
  const allEdges: Edge[] = graph.arrows.map((arrow) => {
    const reference = displayed.relationships.find(
        (r) => referenceId(r.id) === arrow.id,
      ),
      field = displayed.tables
        .flatMap((t) => t.columns)
        .find((c) => attributeId(c.id) === arrow.id);
    const change =
      presentation.arrowChanges[arrow.id] ??
      (reference
        ? marks?.relationships[reference.id]
        : field
          ? marks?.columns[field.id]
          : undefined);
    const count = picked.filter((id) => id === arrow.id).length,
      isSelected =
        selection === arrow.id || editingArrow === arrow.id || count > 0,
      isLeft = left.has(arrow.id),
      isRight = right.has(arrow.id);
    const color =
      isLeft && isRight
        ? "#8568a5"
        : isLeft
          ? "#507eaf"
          : isRight
            ? "#4d9470"
            : isSelected
              ? "#377cca"
              : change?.kind === "removed"
                ? "#bd8580"
                : change?.kind === "added"
                  ? "#569475"
                  : "#8799aa";
    const removed = change?.kind === "removed",
      readOnly =
        locked || removed || editing || field?.generated === "identity",
      reverse =
        (nodes.find((n) => n.id === arrow.target)?.position.x ?? 0) <
        (nodes.find((n) => n.id === arrow.source)?.position.x ?? 0);
    return {
      id: arrow.id,
      source: arrow.source,
      target: arrow.target,
      sourceHandle:
        layout.attributePorts[arrow.id]?.handle ??
        routing[arrow.id]?.sourceSide ??
        (reverse ? "left" : "right"),
      targetHandle:
        layout.attributePorts[arrow.id]?.handle ??
        routing[arrow.id]?.targetSide ??
        (arrow.source === arrow.target ? "right" : reverse ? "right" : "left"),
      type: "arrow",
      label: arrow.label,
      selected: isSelected,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
      ariaLabel: `Arrow ${presentation.objects.find((o) => o.id === arrow.source)?.label}.${arrow.label} to ${presentation.objects.find((o) => o.id === arrow.target)?.label}`,
      style: {
        stroke: color,
        strokeWidth: isSelected || isLeft || isRight ? 2.5 : 1.5,
        strokeDasharray: removed ? "5 4" : undefined,
      },
      data: {
        route: routing[arrow.id]?.points,
        attribute: !reference,
        parallelAttribute: !!layout.attributePorts[arrow.id],
        accessibleName: `${presentation.objects.find((o) => o.id === arrow.source)?.label}.${arrow.label}`,
        readOnly,
        removed,
        occurrences: count,
        editRequest: renameRequest.id === arrow.id ? renameRequest.count : 0,
        onSelect: () => {
          if (!removed) chooseArrow(arrow.id);
        },
        onRename: !readOnly
          ? (name: string) => run(renameArrowOperations(bound, arrow.id, name))
          : undefined,
        onDelete: () => perform(deleteArrowOperations(bound, arrow.id)),
      },
    };
  });
  const edges = [...allEdges];
  if (pending && graph.objects.some((o) => o.id === pending.target))
    edges.push({
      id: "pending-reference",
      source: pending.source,
      target: pending.target,
      sourceHandle: "right",
      targetHandle: "left",
      type: "arrow",
      label: "New arrow",
      style: { stroke: "#b58a43", strokeDasharray: "5 4", strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: "#b58a43" },
      data: { readOnly: true, onSelect: () => {} },
    });
  const describe = (path: Path) =>
    path.arrows.length
      ? pathLabel(presentation, path)
      : `id(${presentation.objects.find((o) => o.id === path.source)?.label})`;
  const confirmRelation = () => {
    setError("");
    if (editingRelation && !editingRelation.dirty) {
      reset();
      return;
    }
    try {
      const choices = candidates.length
        ? candidates
        : relationCandidates(presentation, [...new Set(picked)]);
      if (choices.length > 1 && !candidates.length) {
        setCandidates(choices);
        setCandidate(0);
        return;
      }
      const chosen = choices[candidates.length ? candidate : 0];
      const original = displayed.equations?.find(
        (e) => e.id === editingRelation?.id,
      );
      perform(
        equationOperations(bound, chosen.left, chosen.right, original?.id),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const beginArrowEdit = (id: string) => {
    const arrow = presentation.arrows.find((a) => a.id === id);
    if (!arrow || locked) return;
    reset();
    setEditingArrow(id);
    setSource(arrow.source);
    setPending({ source: arrow.source, target: arrow.target });
    setMode("arrow");
  };
  const beginRelationEdit = (value: Equation) => {
    if (locked) return;
    reset();
    setEditingRelation({ id: value.id, dirty: false });
    setPicked([...new Set([...value.left.arrows, ...value.right.arrows])]);
    setCandidates([{ left: value.left, right: value.right }]);
    setCandidate(0);
    setMode("relation");
  };
  const editedArrow = presentation.arrows.find((a) => a.id === editingArrow),
    editedRef = displayed.relationships.find(
      (r) => referenceId(r.id) === editingArrow,
    );
  const editedSource = displayed.tables.find(
    (t) => t.id === editedArrow?.source,
  );
  const editedName =
    editedRef &&
    (editedRef.source_columns ?? [editedRef.source_columns[0]]).length === 1
      ? editedSource?.columns.find((c) => c.id === editedRef.source_columns[0])
          ?.name
      : editedArrow?.label;
  const selectedArrow = presentation.arrows.find((a) => a.id === selection),
    ref = displayed.relationships.find((r) => referenceId(r.id) === selection);
  const binding = ref
    ? (
        [
          [ref.source_table, ref.source_columns],
          [ref.target_table, ref.target_columns],
        ] as const
      )
        .map(([tableId, columns]) => {
          const t = displayed.tables.find((t) => t.id === tableId);
          return `${t?.name}.${columns.map((id) => t?.columns.find((c) => c.id === id)?.name).join(", ")}`;
        })
        .join(" → ")
    : selectedArrow
      ? `${presentation.objects.find((o) => o.id === selectedArrow.source)?.label}.${selectedArrow.label} → ${presentation.objects.find((o) => o.id === selectedArrow.target)?.label}`
      : undefined;
  const storagePathLabel = (path: Path) =>
    pathLabel(storagePresentation(bound), path);
  const implicit = ref
    ? bindingEquations(bound).filter((e) =>
        e.id.startsWith(`binding:${ref.id}:`),
      )
    : [];
  return (
    <section className="diagram-editor category-diagram">
      <DiagramToolbar
        mode={props.mode}
        onMode={props.onMode}
        busy={!!busy || editing}
      >
        {props.toolbar}
      </DiagramToolbar>
      <main className="diagram-workspace">
        <div className="canvas-container" ref={canvas}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={{ zIndex: 1 }}
            elevateNodesOnSelect={false}
            onNodesChange={onNodesChange}
            onMoveEnd={placeRelationPanel}
            nodesConnectable={false}
            nodesDraggable={!locked && !editing}
            deleteKeyCode={null}
            minZoom={0.2}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
            onPaneClick={() => {
              if (mode === "inspect" && !pending) {
                setSelection(undefined);
                setObject(undefined);
                setEquation(undefined);
                setError("");
              }
            }}
            onEdgeClick={(_event, edge) => {
              if (!edge.data?.removed && edge.id !== "pending-reference")
                chooseArrow(edge.id);
            }}
            onEdgeDoubleClick={(_event, edge) => {
              if (!edge.data?.readOnly)
                setRenameRequest((old) => ({
                  id: edge.id,
                  count: old.count + 1,
                }));
            }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1}
              color="#e0e4e8"
            />
          </ReactFlow>
          {!graph.objects.length && (
            <div className="canvas-empty-hint">Use + to add an entity</div>
          )}
          {error && (
            <div className="canvas-message" role="alert">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                ×
              </button>
            </div>
          )}
          {mode === "arrow" && (
            <ArrowCreator
              key={editingArrow ?? "new"}
              editing={!!editingArrow}
              initialName={editedName}
              tables={tables}
              sourceId={source}
              targetId={pending?.target}
              onSource={(id) => {
                setSource(id || undefined);
                setPending((current) =>
                  current && id
                    ? { source: id, target: current.target }
                    : undefined,
                );
              }}
              onTarget={(id) =>
                setPending(source && id ? { source, target: id } : undefined)
              }
              onCreate={createArrow}
              onCancel={reset}
            />
          )}
          {mode === "relation" && !disabled && (
            <div
              ref={relationPanel}
              className="relation-composer"
              style={relationPosition ? {...relationPosition,bottom:"auto",transform:"none"} : undefined}
              role="region"
              aria-label="Select relation arrows"
            >
              <div className="dialog-heading">
                <strong>
                  {editingRelation ? "Edit relation" : "Relation"}
                </strong>
                <button aria-label="Cancel relation" onClick={reset}>
                  ×
                </button>
              </div>
              <p>
                Select arrows forming two paths with the same start and end.
                Click a selected arrow to deselect it.
              </p>
              {editingRelation && (
                <div className="relation-current">
                  Current:{" "}
                  {(() => {
                    const e = presentation.equations.find(
                      (e) => e.id === editingRelation.id,
                    );
                    return e
                      ? `${describe(e.left)} = ${describe(e.right)}`
                      : "";
                  })()}
                </div>
              )}
              <div className="relation-occurrences">
                {picked.map((id, i) => (
                  <button
                    key={i}
                    title="Deselect arrow"
                    onClick={() => {
                      setPicked((old) => old.filter((_, j) => i !== j));
                      setCandidates([]);
                      setEditingRelation((old) =>
                        old ? { ...old, dirty: true } : old,
                      );
                      setError("");
                    }}
                  >
                    {qualifiedArrowLabel(presentation, id)} <span>×</span>
                  </button>
                ))}
              </div>
              {candidates.length > 1 && (
                <div className="relation-choices">
                  <p>
                    This loop has more than one meaning. Choose the equation:
                  </p>
                  {candidates.map((c, i) => (
                    <label key={i}>
                      <input
                        type="radio"
                        name="relation-choice"
                        value={i}
                        checked={candidate === i}
                        onChange={() => setCandidate(i)}
                      />
                      {describe(c.left)} = {describe(c.right)}
                    </label>
                  ))}
                </div>
              )}
              <div className="dialog-actions">
                <button
                  className="button"
                  disabled={locked || !picked.length}
                  onClick={() => {
                    setPicked([]);
                    setCandidates([]);
                    setEditingRelation((old) =>
                      old ? { ...old, dirty: true } : old,
                    );
                    setError("");
                  }}
                >
                  Clear
                </button>
                <button
                  className="button primary"
                  disabled={locked || !picked.length}
                  onClick={confirmRelation}
                >
                  Confirm
                </button>
              </div>
            </div>
          )}
          {selection && binding && mode === "inspect" && !pending && (
            <div
              className="canvas-relation-bar binding-inspector"
              role="region"
              aria-label="Arrow binding"
            >
              <div>
                <strong>
                  {selectedArrow
                    ? qualifiedArrowLabel(presentation, selectedArrow.id)
                    : "Arrow"}
                </strong>
                <div className="arrow-binding-summary">{binding}</div>
                {implicit.map((e) => (
                  <div className="binding-equation" key={e.id}>
                    {storagePathLabel(e.left)} = {storagePathLabel(e.right)}{" "}
                    <small title="Storage correspondence generated from the reference key. Change it in Edit arrow.">
                      storage
                    </small>
                  </div>
                ))}
                {selectedArrow?.target.startsWith("type:") && (
                  <small>
                    Scalar domain includes NULL; required fields enforce NOT
                    NULL.
                  </small>
                )}
              </div>
              {!locked && (
                <button
                  className="button"
                  onClick={() => selection && beginArrowEdit(selection)}
                >
                  Edit arrow
                </button>
              )}
              <button
                aria-label="Close arrow binding"
                onClick={() => setSelection(undefined)}
              >
                ×
              </button>
            </div>
          )}
          {!!presentation.equations.filter((e) => e.origin !== "binding")
            .length &&
            mode === "inspect" &&
            !pending && (
              <div
                className={`category-equations ${selection ? "with-selection" : ""}`}
                role="group"
                aria-label="Path equations"
              >
                {presentation.equations
                  .filter((e) => e.origin !== "binding")
                  .map((e) => (
                    <div
                      key={e.id}
                      className={`category-equation ${marks?.equations?.[e.id]?.kind ?? ""}`}
                    >
                      <button
                        aria-label={`Highlight equation ${pathLabel(presentation, e.left)} = ${pathLabel(presentation, e.right)}`}
                        aria-pressed={equation === e.id}
                        onClick={() => {
                          setSelection(undefined);
                          setObject(undefined);
                          setEquation(equation === e.id ? undefined : e.id);
                        }}
                      >
                        <span className="equation-left">
                          {pathLabel(presentation, e.left)}
                        </span>
                        <span>=</span>
                        <span className="equation-right">
                          {pathLabel(presentation, e.right)}
                        </span>
                      </button>
                      {!locked &&
                        marks?.equations?.[e.id]?.kind !== "removed" && (
                          <button
                            className="equation-edit"
                            aria-label={`Edit relation ${pathLabel(presentation, e.left)} = ${pathLabel(presentation, e.right)}`}
                            title="Edit paths"
                            onClick={() => beginRelationEdit(e)}
                          >
                            <Icon name="edit" size={12} />
                          </button>
                        )}
                      {!locked &&
                        marks?.equations?.[e.id]?.kind !== "removed" && (
                          <button
                            className="equation-remove"
                            aria-label={`Delete equation ${pathLabel(presentation, e.left)} = ${pathLabel(presentation, e.right)}`}
                            onClick={() =>
                              perform(dropEquationOperations(bound, e.id))
                            }
                          >
                            ×
                          </button>
                        )}
                    </div>
                  ))}
              </div>
            )}
          {busy && (
            <div className="import-progress" role="status">
              <span className="spinner" />
              {busy}
            </div>
          )}
        </div>
        {props.footer}
      </main>
    </section>
  );
}
