import type { AiEditorAction } from "./ai-capabilities.ts";
export type ActionSuggestion = {
  id: string;
  title: string;
  dependsOn: string[];
  actions: AiEditorAction[];
  status: "pending" | "accepted" | "committed" | "rejected" | "stale";
};
export type ActionReview = { suggestions: ActionSuggestion[]; round: number };
const signature = (s: ActionSuggestion) => JSON.stringify(s.actions);
export function addActionRound(
  review: ActionReview | null,
  groups: Omit<ActionSuggestion, "status">[],
): ActionReview {
  const current = review ?? { suggestions: [], round: 0 },
    ids = new Set(current.suggestions.map((s) => s.id)),
    known = new Set(
      current.suggestions.filter((s) => s.status !== "rejected").map(signature),
    );
  if (groups.some((g) => ids.has(g.id))) throw Error("Please try again.");
  return {
    round: current.round + 1,
    suggestions: [
      ...current.suggestions,
      ...groups
        .filter((g) => !known.has(signature({ ...g, status: "pending" })))
        .map((g) => ({ ...g, status: "pending" as const })),
    ],
  };
}
export function acceptancePlan(
  review: ActionReview,
  id: string,
): ActionSuggestion[] {
  const visited = new Set<string>(),
    stack = new Set<string>();
  const visit = (id: string): ActionSuggestion[] => {
    if (stack.has(id)) throw Error("These suggestions need another look.");
    if (visited.has(id)) return [];
    const s = review.suggestions.find((s) => s.id === id);
    if (!s || s.status === "stale" || s.status === "rejected")
      throw Error("A required suggestion is unavailable.");
    if (s.status === "accepted" || s.status === "committed") return [];
    stack.add(id);
    const deps = s.dependsOn.flatMap(visit);
    stack.delete(id);
    visited.add(id);
    return [...deps, s];
  };
  return visit(id);
}
export function acceptPlanned(
  review: ActionReview,
  ids: string[],
): ActionReview {
  return {
    ...review,
    suggestions: review.suggestions.map((s) =>
      ids.includes(s.id) ? { ...s, status: "accepted" } : s,
    ),
  };
}
export function rejectAction(review: ActionReview, id: string): ActionReview {
  const rejected = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of review.suggestions)
      if (
        (s.status === "pending" || s.status === "stale") &&
        s.dependsOn.some((id) => rejected.has(id)) &&
        !rejected.has(s.id)
      ) {
        rejected.add(s.id);
        changed = true;
      }
  }
  return {
    ...review,
    suggestions: review.suggestions.map((s) =>
      rejected.has(s.id) && s.status !== "accepted" && s.status !== "committed"
        ? { ...s, status: "rejected" }
        : s,
    ),
  };
}
