import { storageColumn } from "../model/database-presentation.ts";
import {
  MIGRATION_SYMBOLS,
  type MigrationMethod,
} from "../model/migration-options.ts";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  Operation,
  SchemaSpec,
  AttributeParameters as Parameters,
} from "../model/operations.ts";
import { attributeParameters } from "../model/attribute-template.ts";
import Icon from "../shared/Icon.tsx";
export default function AttributeParameters({
  operation,
  method,
  schema,
  disabled,
  onApply,
  onClose,
}: {
  operation: Extract<Operation, { op: "add_attribute" | "add_column" }>;
  method: MigrationMethod;
  schema: SchemaSpec;
  disabled: boolean;
  onApply: (parameters: Parameters) => Promise<void>;
  onClose: () => void;
}) {
  const initial = attributeParameters(operation)!;
  const source = schema.tables.find((t) => t.id === operation.table_id)!,
    column = operation.column;
  const sources = source.columns.filter(
    (c) => !storageColumn(c) && c.dataType === column.dataType,
  );
  const [mode, setMode] = useState<"constant" | "copy">(
    initial.template === "copy" ? "copy" : "constant",
  );
  const [value, setValue] = useState(
    initial.template === "constant" && initial.value?.type !== "null"
      ? (initial.value?.value ?? "")
      : "",
  );
  const [useNull, setUseNull] = useState(
    initial.template === "constant" && initial.value?.type === "null",
  );
  const [sourceId, setSourceId] = useState(
    initial.template === "copy"
      ? (initial.source_column ?? sources[0]?.id ?? "")
      : sources.length === 1
        ? sources[0].id
        : "",
  );
  const [working, setWorking] = useState(false),
    [error, setError] = useState("");
  const form = useRef<HTMLFormElement>(null),
    locked = disabled || working;
  useEffect(() => {
    form.current
      ?.querySelector<HTMLElement>("input:not([type=radio]),select,button")
      ?.focus();
  }, []);
  const ready =
    mode === "copy"
      ? !!sourceId
      : useNull || column.dataType === "text" || /^-?\d+$/.test(value);
  const save = async () => {
    setWorking(true);
    setError("");
    try {
      await onApply(
        mode === "copy"
          ? { template: "copy", source_column: sourceId }
          : {
              template: "constant",
              value: useNull
                ? { type: "null" }
                : { type: column.dataType, value },
            },
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  };
  return createPortal(
    <div
      className="modal-backdrop parameter-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !locked) onClose();
      }}
    >
      <form
        ref={form}
        className="parameter-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Configure migration"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !locked) void save();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !locked) {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
          if (e.key === "Tab" && !disabled) {
            const items = [
              ...e.currentTarget.querySelectorAll<HTMLElement>(
                "button:not(:disabled),input:not(:disabled),select:not(:disabled)",
              ),
            ];
            const first = items[0],
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
          <h2>Configure {MIGRATION_SYMBOLS[method]}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close configuration"
            disabled={locked}
            onClick={onClose}
          >
            <Icon name="close" size={15} />
          </button>
        </div>
        <p className="parameter-target">
          {source.name}.{column.name}
        </p>
        {!!sources.length && (
          <fieldset className="value-source">
            <legend>Value source</legend>
            <label>
              <input
                type="radio"
                name="value-source"
                checked={mode === "constant"}
                disabled={locked}
                onChange={() => setMode("constant")}
              />
              Fixed value
            </label>
            <label>
              <input
                type="radio"
                name="value-source"
                checked={mode === "copy"}
                disabled={locked}
                onChange={() => {
                  setMode("copy");
                  if (sources.length === 1) setSourceId(sources[0].id);
                }}
              />
              Existing attribute
            </label>
          </fieldset>
        )}
        {mode === "constant" ? (
          <div className="value-configuration">
            {!useNull && (
              <label className="edit-label">
                {column.dataType === "integer" ? "Integer value" : "Text value"}
                <input
                  aria-label="Attribute value"
                  value={value}
                  disabled={locked}
                  inputMode={column.dataType === "integer" ? "numeric" : "text"}
                  placeholder={
                    column.dataType === "integer"
                      ? "Enter an integer"
                      : "Leave blank for empty text"
                  }
                  onChange={(e) => {
                    setValue(e.target.value);
                    setError("");
                  }}
                />
              </label>
            )}
            <label className="null-choice">
              <input
                type="checkbox"
                checked={useNull}
                disabled={locked}
                onChange={(e) => {
                  setUseNull(e.target.checked);
                  setError("");
                }}
              />
              Use NULL
            </label>
          </div>
        ) : sources.length > 1 ? (
          <label className="edit-label">
            Source attribute
            <select
              aria-label="Source attribute"
              value={sourceId}
              disabled={locked}
              onChange={(e) => {
                setSourceId(e.target.value);
                setError("");
              }}
            >
              <option value="" disabled>
                Choose attribute
              </option>
              {sources.map((c) => (
                <option key={c.id} value={c.id}>
                  {source.name}.{c.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {error && (
          <p className="edit-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="button"
            disabled={locked}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button primary" disabled={locked || !ready}>
            {working ? "Applying…" : "Apply"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
