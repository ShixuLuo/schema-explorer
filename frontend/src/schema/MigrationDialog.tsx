import { useEffect, useState } from "react";
import type { CheckpointInfo, CheckpointRange } from "../model/workspace.ts";
import { checkpointLabel, defaultCheckpointRange } from "../model/history.ts";
import type { SelectedSql } from "../application/export.ts";
import Icon from "../shared/Icon";

export default function MigrationDialog({
  caseId,
  checkpoints,
  editingId,
  initialRange,
  loadSql,
  onClose,
}: {
  caseId: string;
  checkpoints: CheckpointInfo[];
  editingId?: string | null;
  initialRange?: CheckpointRange;
  loadSql: (caseId: string, range: CheckpointRange) => Promise<SelectedSql>;
  onClose: () => void;
}) {
  const [from, setFrom] = useState(() =>
    initialRange
      ? initialRange.from
      : (defaultCheckpointRange(checkpoints, editingId)?.from ?? null),
  );
  const [sql, setSql] = useState<SelectedSql | null>(null),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    setSql(null);
    setError("");
    setCopied(false);
    if (!editingId) return;
    loadSql(caseId, { from, to: editingId })
      .then((value) => {
        if (active) setSql(value);
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [caseId, from, editingId, loadSql]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [onClose]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sql?.migration ?? "");
      setCopied(true);
    } catch {
      setError("Select the SQL and copy it with your keyboard.");
    }
  };
  return (
    <div
      className="modal-backdrop sql-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="migration-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Export SQL"
      >
        <div className="dialog-heading">
          <h2>SQL</h2>
          <span className="sql-dialect">PostgreSQL</span>
          <button
            className="icon-button"
            aria-label="Close SQL export"
            onClick={onClose}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="sql-range">
          <label>
            From
            <select
              aria-label="Export from checkpoint"
              value={from ?? ""}
              onChange={(e) => setFrom(e.target.value || null)}
            >
              <option value="">Start · empty schema</option>
              {checkpoints.map((c) => (
                <option key={c.id} value={c.id}>
                  {checkpointLabel(checkpoints, c.id, { editingId })}
                </option>
              ))}
            </select>
          </label>
          <Icon name="arrow" size={16} />
          <span className="sql-editing-target">Editing</span>
        </div>
        {error ? (
          <p role="alert" className="edit-error">
            {error}
          </p>
        ) : sql && !sql.migration ? (
          <p className="sql-unavailable" role="status">
            {sql.reason}
          </p>
        ) : (
          <textarea
            className="sql-output"
            readOnly
            aria-label="Generated SQL"
            value={sql?.migration ?? "Generating SQL…"}
          />
        )}
        <div className="dialog-actions">
          <button className="button" onClick={onClose}>
            Close
          </button>
          <button
            className="button primary"
            disabled={!sql?.migration}
            onClick={() => void copy()}
          >
            {copied ? "Copied" : "Copy SQL"}
          </button>
        </div>
      </section>
    </div>
  );
}
