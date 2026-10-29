import type { EditSession } from "../application/editor.ts";
import type { EditSummary } from "../application/preview.ts";
import type { Operation } from "../model/operations.ts";
// A temporary native editor owns its own staged results. It can never publish.
export class AiPendingPreview {
  private editor: EditSession | null = null;
  private epoch = 0;
  private request: {
    id: string;
    fingerprint: string;
    operations: Operation[];
    groups?: Record<string, Operation[]>;
  } | null = null;
  async show(
    id: string,
    fingerprint: string,
    accepted: EditSummary | null,
    operations: Operation[],
    create: () => EditSession,
    label: string,
    groups?: Record<string, Operation[]>,
  ) {
    this.clear();
    const epoch = this.epoch,
      editor = create();
    this.editor = editor;
    this.request = {
      id,
      fingerprint,
      operations: structuredClone(operations),
      groups: structuredClone(groups),
    };
    try {
      const summary = await editor.append(
        [...(accepted?.operations ?? []), ...operations],
        accepted?.dataValidation === "unverified",
        label,
      );
      if (epoch !== this.epoch) return null;
      return summary;
    } catch (error) {
      if (epoch !== this.epoch) return null;
      this.clear();
      throw error;
    }
  }
  pendingOperations(id: string, fingerprint: string) {
    if (this.request?.fingerprint !== fingerprint) return null;
    if (this.request.id === id) return structuredClone(this.request.operations);
    return this.request.groups?.[id]
      ? structuredClone(this.request.groups[id])
      : null;
  }
  readRows(tableId: string, offset: number, limit?: number) {
    return this.editor?.readRows(tableId, offset, limit) ?? Promise.resolve([]);
  }
  clear() {
    this.epoch++;
    this.editor?.dispose();
    this.editor = null;
    this.request = null;
  }
}
