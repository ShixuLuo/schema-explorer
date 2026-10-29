import { PRESET_TAGS } from "./history.ts";
import type { Operation } from "./operations.ts";
import type { UseCase, SavedWorkspace, EditingUndo } from "./workspace.ts";
export type ModelContent = Pick<
  SavedWorkspace,
  "tables" | "relationships" | "equations"
>;
export type ModelPublication =
  | {
      kind: "checkpoint";
      state: ModelContent;
      operations?: Operation[];
      provenance?: import("./workspace.ts").CqlProvenance;
      description: string;
      undoable?: boolean;
    }
  | { kind: "restore"; checkpointId: string }
  | { kind: "undo" };
export type TagChange = {
  kind: "add" | "remove";
  checkpointId: string;
  tag: string;
};

// Called within the storage transaction against its latest record. A prepared
// edit supplies model content and operations, never a replacement History.
export function publishModel(
  current: UseCase,
  expectedRevision: number,
  publication: ModelPublication,
): { useCase: UseCase; tables: SavedWorkspace["tables"] } {
  if ((current.revision ?? 0) !== expectedRevision)
    throw new Error(
      "The model changed in another session. Roll back this draft and start again.",
    );
  let state: ModelContent,
    view: Pick<UseCase, "positions" | "viewport"> = current,
    undo: EditingUndo | undefined;
  let checkpoints = current.history.checkpoints,
    editing = current.history.editing;
  if (publication.kind === "checkpoint") {
    if (!publication.operations && !publication.provenance)
      throw new Error("Checkpoint needs operations or provenance.");
    state = structuredClone(publication.state);
    const checkpoint = {
      id: crypto.randomUUID(),
      name:
        publication.description.length > 80
          ? publication.description.slice(0, 77) + "…"
          : publication.description,
      createdAt: Date.now(),
      parentId: editing,
      ...(publication.operations
        ? {
            operations: structuredClone(publication.operations),
            operationCount: publication.operations.length,
          }
        : {}),
      ...(publication.provenance
        ? { provenance: structuredClone(publication.provenance) }
        : {}),
      state: structuredClone({
        ...state,
        positions: current.positions,
        viewport: current.viewport,
      }),
    };
    checkpoints = [...checkpoints, checkpoint];
    if (publication.undoable !== false)
      undo = { checkpointId: editing, description: publication.description };
    editing = checkpoint.id;
  } else {
    const previous = publication.kind === "undo" ? current.undo : undefined;
    if (publication.kind === "undo" && !previous)
      throw new Error("There is no edit to undo.");
    const target =
      publication.kind === "restore"
        ? publication.checkpointId
        : previous!.checkpointId;
    const checkpoint = target
      ? checkpoints.find((c) => c.id === target)
      : undefined;
    if (target !== null && !checkpoint)
      throw new Error("This checkpoint no longer exists.");
    state = checkpoint?.state ?? {
      tables: [],
      relationships: [],
    };
    if (publication.kind === "restore") {
      view = checkpoint!.state;
      undo = {
        checkpointId: editing,
        description: `Restore ${checkpoint!.name}`,
        positions: current.positions,
        viewport: current.viewport,
      };
    } else if (previous!.positions)
      view = {
        positions: previous!.positions,
        viewport: previous!.viewport,
      };
    editing = target;
  }
  const { tables, ...model } = state;
  return {
    tables,
    useCase: {
      ...current,
      relationships: model.relationships,
      equations: model.equations ?? [],
      positions: view.positions,
      viewport: view.viewport,
      tableIds: tables.map((t) => t.id),
      history: { checkpoints, editing },
      undo,
      revision: (current.revision ?? 0) + 1,
      updatedAt: Date.now(),
    },
  };
}

// Metadata commands can only edit tags on the latest immutable checkpoints.
// They do not advance the model revision, replace History or disturb drafts.
export function publishTags(current: UseCase, change: TagChange): UseCase {
  const trimmed = change.tag.trim();
  const tag =
    PRESET_TAGS.find((p) => p.toLowerCase() === trimmed.toLowerCase()) ??
    trimmed;
  if (!tag || tag.length > 40 || /[\r\n]/.test(tag))
    throw new Error("Use a tag between 1 and 40 characters on one line.");
  if (tag.toLowerCase() === "editing")
    throw new Error("Editing shows your current position. Choose another tag.");
  const checkpoint = current.history.checkpoints.find(
    (c) => c.id === change.checkpointId,
  );
  if (!checkpoint) throw new Error("This checkpoint no longer exists.");
  if (
    change.kind === "add" &&
    checkpoint.tags?.some((t) => t.toLowerCase() === tag.toLowerCase())
  )
    throw new Error("This checkpoint already has this tag.");
  const checkpoints = current.history.checkpoints.map((c) => {
    let tags = c.tags ?? [];
    if (c.id === change.checkpointId)
      tags =
        change.kind === "add"
          ? [...tags, tag]
          : tags.filter((t) => t.toLowerCase() !== tag.toLowerCase());
    else if (change.kind === "add" && tag === "Live")
      tags = tags.filter((t) => t.toLowerCase() !== "live");
    return { ...c, tags: [...tags] };
  });
  return {
    ...current,
    history: { ...current.history, checkpoints },
    updatedAt: Date.now(),
  };
}
