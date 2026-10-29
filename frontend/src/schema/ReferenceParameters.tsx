import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Operation, SchemaSpec } from "../model/operations.ts";
import { databasePresentation } from "../model/database-presentation.ts";
import { endpoint, pathLabel, type Path } from "../model/presentation.ts";
import PathPicker from "./PathPicker.tsx";
export default function ReferenceParameters({
  operation,
  schema,
  disabled,
  onApply,
  onClose,
}: {
  operation: Extract<Operation, { op: "add_reference" }>;
  schema: SchemaSpec;
  disabled: boolean;
  onApply: (path: Path) => Promise<void>;
  onClose: () => void;
}) {
  const p = databasePresentation(schema),
    [path, setPath] = useState<Path>(
      operation.image ?? { source: operation.table_id, arrows: [] },
    ),
    [working, setWorking] = useState(false),
    [error, setError] = useState(""),
    form = useRef<HTMLFormElement>(null);
  let ready = false;
  try {
    ready = endpoint(p, path) === operation.foreign_key.target_table;
  } catch {}
  useEffect(() => {
    form.current?.querySelector<HTMLElement>("select,button")?.focus();
  }, []);
  return createPortal(
    <div
      className="modal-backdrop parameter-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !working) onClose();
      }}
    >
      <form
        ref={form}
        className="parameter-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Configure migration"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ready) return;
          setWorking(true);
          setError("");
          try {
            await onApply(path);
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setWorking(false);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !working) {
            e.preventDefault();
            onClose();
          }
          if (e.key === "Tab") {
            const items = [
                ...e.currentTarget.querySelectorAll<HTMLElement>(
                  "select:not(:disabled),button:not(:disabled)",
                ),
              ],
              first = items[0],
              last = items.at(-1);
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="dialog-heading">
          <h2>Configure Δ</h2>
        </div>
        <p>
          {schema.tables.find((t) => t.id === operation.table_id)?.name}.
          {operation.foreign_key.name} →{" "}
          {
            schema.tables.find(
              (t) => t.id === operation.foreign_key.target_table,
            )?.name
          }
        </p>
        <fieldset disabled={disabled || working}>
          <PathPicker
            label="Arrow image"
            presentation={p}
            value={path}
            onChange={setPath}
          />
        </fieldset>
        <p>{pathLabel(p, path)}</p>
        {!ready && (
          <p>
            Choose a path ending at{" "}
            {
              schema.tables.find(
                (t) => t.id === operation.foreign_key.target_table,
              )?.name
            }
            .
          </p>
        )}
        {error && (
          <p role="alert" className="edit-error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="button"
            disabled={working}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={disabled || working || !ready}
          >
            {working ? "Applying…" : "Apply"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
