import type { CheckpointInfo, CheckpointRange } from "./workspace.ts";

export const PRESET_TAGS = ["Live", "Review", "Milestone"] as const;
export function liveCheckpointId(
  checkpoints: CheckpointInfo[],
): string | undefined {
  return checkpoints.find((c) =>
    c.tags?.some((tag) => tag.toLowerCase() === "live"),
  )?.id;
}

// Both the graph and SQL export use recorded parents. Timestamps are labels,
// not evidence of ancestry. A missing parent must never invent a migration.
export function checkpointPath<T extends CheckpointInfo>(
  checkpoints: T[],
  range: CheckpointRange,
): T[] | null {
  const byId = new Map(checkpoints.map((c) => [c.id, c]));
  if (range.from !== null && !byId.has(range.from)) return null;
  const path: T[] = [],
    seen = new Set<string>();
  let id: string | null | undefined = range.to;
  while (id !== range.from) {
    if (id === null || id === undefined || seen.has(id)) return null;
    const checkpoint = byId.get(id);
    if (!checkpoint) return null;
    seen.add(id);
    path.unshift(checkpoint);
    id = checkpoint.parentId;
  }
  return path;
}
export function defaultCheckpointRange(
  checkpoints: CheckpointInfo[],
  editingId?: string | null,
): CheckpointRange | null {
  if (!editingId) return null;
  const byId = new Map(checkpoints.map((c) => [c.id, c]));
  const target = byId.get(editingId);
  if (!target) return null;
  const liveId = liveCheckpointId(checkpoints);
  if (liveId) return { from: liveId, to: editingId };
  let first = target;
  const seen = new Set([first.id]);
  while (first.parentId && !seen.has(first.parentId)) {
    const parent = byId.get(first.parentId);
    if (!parent) break;
    first = parent;
    seen.add(first.id);
  }
  return {
    from: first.id === editingId && first.parentId === null ? null : first.id,
    to: editingId,
  };
}
export function checkpointLabel(
  checkpoints: CheckpointInfo[],
  id: string | null,
  status?: { editingId?: string | null },
): string {
  if (id === null) return "Start · empty schema";
  const checkpoint = checkpoints.find((c) => c.id === id);
  if (!checkpoint) return "Missing checkpoint";
  const position = id === status?.editingId ? " [Editing]" : "";
  const time = new Date(checkpoint.createdAt).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return `${checkpoint.name}${position} · ${checkpoint.tags?.length ? `${checkpoint.tags.join(" / ")} · ` : ""}${time}`;
}
