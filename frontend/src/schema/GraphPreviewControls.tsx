import { useId, type ReactNode } from "react";
import type { EditSummary } from "../application/preview.ts";
import { inferPlanGroups } from "../application/preview.ts";
import type { ComparisonMode } from "../model/comparison.ts";
export default function GraphPreviewControls({
  summary,
  mode,
  planVisible,
  working,
  disabled = false,
  error,
  onMode,
  onCommit,
  onRollback,
  onPlan,
  details,
}: {
  summary: EditSummary;
  mode: ComparisonMode;
  planVisible: boolean;
  working: string;
  disabled?: boolean;
  error: string;
  onMode: (mode: ComparisonMode) => void;
  onCommit: () => void;
  onRollback: () => void;
  onPlan: () => void;
  details?: ReactNode;
}) {
  const tooltipId = useId();
  const groups = summary.plan ?? inferPlanGroups(summary.operations);
  const pending = (summary.pendingParameters ?? []).map(
    ({ index, message }) => {
      const group = groups.findIndex(
        (group) => index >= group.start && index < group.start + group.count,
      );
      const op = summary.operations[index];
      const table =
        "table_id" in op
          ? summary.comparison.after.tables.find((t) => t.id === op.table_id)
          : undefined;
      const label =
        op.op === "add_attribute"
          ? `${table?.name ?? op.table_id}.${op.column.name}`
          : undefined;
      return `Action ${group < 0 ? index + 1 : group + 1}${label ? ` · ${label}` : ""}: ${message}`;
    },
  );
  const commitReason = working
    ? "Wait for the current operation to finish."
    : disabled
      ? "Finish the open editor or precheck dialog first."
      : pending.length
        ? pending.join("\n") +
          "\nOpen Details → Actions to configure these steps."
        : undefined;
  return (
    <div className="draft-controls-shell">
      <details className="draft-details-drawer" open={planVisible}>
        <summary
          aria-controls="migration-plan"
          onClick={(event) => {
            event.preventDefault();
            onPlan();
          }}
        >
          <span>Details</span>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d={planVisible ? "M3 4.5 6 7.5 9 4.5" : "M3 7.5 6 4.5 9 7.5"}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </summary>
        {details}
      </details>
      <section
        className="graph-preview-controls compact-preview"
        role="region"
        aria-label="Draft changes"
      >
        <strong>
          {summary.operations.length}{" "}
          {summary.operations.length === 1 ? "change" : "changes"}
        </strong>
        {!!summary.pendingParameters?.length && (
          <span className="schema-only-badge">Configure actions</span>
        )}
        {summary.dataValidation === "unverified" && (
          <span className="schema-only-badge">Data not validated</span>
        )}
        <select
          aria-label="Preview view"
          value={mode}
          disabled={disabled || !!working}
          onChange={(e) => onMode(e.target.value as ComparisonMode)}
        >
          <option value="changes">Schema diff</option>
          <option value="before">Before</option>
          <option value="after">After</option>
        </select>
        <span className="toolbar-spacer" />
        <button
          className="button"
          disabled={disabled || !!working}
          onClick={onRollback}
        >
          Rollback
        </button>
        <span
          className="commit-control"
          data-disabled={!!commitReason}
          tabIndex={commitReason ? 0 : undefined}
          aria-label={commitReason ? "Commit unavailable" : undefined}
          aria-describedby={commitReason ? tooltipId : undefined}
        >
          <button
            className="button primary"
            disabled={!!commitReason}
            aria-describedby={commitReason ? tooltipId : undefined}
            onClick={onCommit}
          >
            Commit
          </button>
          {commitReason && (
            <span
              id={tooltipId}
              className="commit-disabled-tooltip"
              role="tooltip"
            >
              <strong>Cannot commit yet</strong>
              <span>{commitReason}</span>
            </span>
          )}
        </span>
        {error && (
          <p className="edit-error" role="alert">
            {error}
          </p>
        )}
        {working && (
          <div className="edit-progress" role="status">
            <span className="spinner" />
            {working}
          </div>
        )}
      </section>
    </div>
  );
}
