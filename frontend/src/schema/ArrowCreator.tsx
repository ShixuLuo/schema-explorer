import FailureNotice from "../shared/FailureNotice.tsx";
import { failureInfo, type FailureInfo } from "../model/failure.ts";
import { useState } from "react";
import type { ViewTable } from "../model/comparison.ts";
export default function ArrowCreator({
  tables,
  sourceId,
  targetId,
  onSource,
  onTarget,
  onCreate,
  onCancel,
  initialName = "",
  editing = false,
}: {
  tables: ViewTable[];
  sourceId?: string;
  targetId?: string;
  onSource: (id: string) => void;
  onTarget: (id: string) => void;
  onCreate: (name: string) => Promise<void>;
  onCancel: () => void;
  initialName?: string;
  editing?: boolean;
}) {
  const [name, setName] = useState(initialName),
    [working, setWorking] = useState(false),
    [error, setError] = useState<FailureInfo | null>(null);
  const ready = !!sourceId && !!targetId && !!name.trim();
  return (
    <form
      className="operation-editor arrow-creator"
      role="region"
      aria-label={editing ? "Edit arrow" : "Add arrow"}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        setWorking(true);
        setError(null);
        try {
          await onCreate(name.trim());
        } catch (e) {
          setError(failureInfo(e));
        } finally {
          setWorking(false);
        }
      }}
    >
      <div className="dialog-heading">
        <h2>{editing ? "Edit arrow" : "Add arrow"}</h2>
        <button
          type="button"
          aria-label="Cancel arrow"
          disabled={working}
          onClick={onCancel}
        >
          ×
        </button>
      </div>
      <label className="edit-label">
        Source
        <select
          aria-label="Arrow source"
          value={sourceId ?? ""}
          disabled={working}
          onChange={(e) => onSource(e.target.value)}
        >
          <option value="" disabled hidden>
            Choose entity
          </option>
          {tables.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label className="edit-label">
        Arrow name
        <input
          aria-label="Arrow name"
          value={name}
          disabled={working}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </label>
      <label className="edit-label">
        Target
        <select
          aria-label="Arrow target"
          value={targetId ?? ""}
          disabled={working || !sourceId}
          onChange={(e) => onTarget(e.target.value)}
        >
          <option value="" disabled hidden>
            Choose entity or type
          </option>
          <optgroup label="Entities">
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Types">
            <option value="type:text">Text</option>
            <option value="type:integer">Integer</option>
            <option value="type:real">Real</option>
            <option value="type:boolean">Boolean</option>
          </optgroup>
        </select>
      </label>
      {error && <FailureNotice error={error} />}
      <div className="dialog-actions">
        <button
          type="button"
          className="button"
          disabled={working}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button className="button primary" disabled={working || !ready}>
          {working ? "Checking…" : "Confirm"}
        </button>
      </div>
    </form>
  );
}
