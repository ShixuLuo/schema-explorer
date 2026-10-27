import { useEffect, useState } from "react";
import type { SqlBundle } from "../model/operations.ts";
import Icon from "../shared/Icon";

export default function MigrationDialog({
  caseId,
  loadSql,
  onClose,
}: {
  caseId: string;
  loadSql: (caseId: string) => Promise<SqlBundle>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"changes" | "current" | "baseline">(
    "changes",
  );
  const [sql, setSql] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void loadSql(caseId)
      .then((sql) => {
        if (active) setSql(sql);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [caseId, loadSql]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  const download = () => {
    if (!sql) return;
    const url = URL.createObjectURL(
      new Blob([sql[mode]], { type: "application/sql;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `schema-${mode}.sql`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div
      className="modal-backdrop"
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
          <h2>Export SQL</h2>
          <span className="sql-dialect">PostgreSQL</span>
          <button
            className="icon-button"
            aria-label="Close SQL export"
            onClick={onClose}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <select
          aria-label="SQL output"
          value={mode}
          onChange={(e) => setMode(e.target.value as typeof mode)}
        >
          <option value="changes">Changes</option>
          <option value="current">Current schema</option>
          <option value="baseline">Baseline schema</option>
        </select>
        <p className="sql-note">
          {mode === "changes" ? "Run against the baseline schema. " : ""}CSV
          records are not included.
        </p>
        {error ? (
          <p className="edit-error" role="alert">
            {error}
          </p>
        ) : (
          <pre tabIndex={0} aria-label="Generated SQL">
            {sql?.[mode] ?? "Generating SQL…"}
          </pre>
        )}
        <div className="dialog-actions">
          <button className="button" onClick={onClose}>
            Close
          </button>
          <button className="button primary" disabled={!sql} onClick={download}>
            Download SQL
          </button>
        </div>
      </section>
    </div>
  );
}
