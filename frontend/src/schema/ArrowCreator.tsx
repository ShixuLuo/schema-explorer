import {
  humanSourceChoices,
  humanTargetKeyChoices,
} from "../application/human-commands.ts";
import FailureNotice from "../shared/FailureNotice.tsx";
import { failureInfo, type FailureInfo } from "../model/failure.ts";
import { useEffect, useState } from "react";
import type { ViewTable } from "../model/comparison.ts";
import type { ReferenceKeyChoice } from "../application/foreign-key-plan.ts";
export default function ArrowCreator({
  tables,
  sourceId,
  targetId,
  onSource,
  onTarget,
  onCreate,
  onCancel,
  initialName = "",
  initialChoice,
  editing = false,
}: {
  tables: ViewTable[];
  sourceId?: string;
  targetId?: string;
  onSource: (id: string) => void;
  onTarget: (id: string) => void;
  onCreate: (name: string, choice?: ReferenceKeyChoice) => Promise<void>;
  onCancel: () => void;
  initialName?: string;
  initialChoice?: ReferenceKeyChoice;
  editing?: boolean;
}) {
  const [name, setName] = useState(initialName),
    [keyChoice, setKeyChoice] = useState(""),
    [components, setComponents] = useState<string[]>([]),
    [unique, setUnique] = useState(false),
    [working, setWorking] = useState(false),
    [error, setError] = useState<FailureInfo | null>(null);
  const source = tables.find((t) => t.id === sourceId),
    target = tables.find((t) => t.id === targetId);
  useEffect(() => {
    setKeyChoice(
      initialChoice?.targetColumns?.length
        ? JSON.stringify(initialChoice.targetColumns)
        : target?.primaryKey?.length
          ? JSON.stringify(target.primaryKey)
          : target?.columns.length
            ? ""
            : "internal",
    );
    setComponents(initialChoice?.sourceColumns ?? []);
    setUnique(false);
    setError(null);
  }, [sourceId, targetId]);
  const keys =
    keyChoice && keyChoice !== "internal"
      ? (JSON.parse(keyChoice) as string[])
      : [];
  const declared = target
    ? [
        ...(target.primaryKey?.length ? [target.primaryKey] : []),
        ...(target.uniqueKeys ?? []),
      ]
    : [];
  const needsUnique =
    keys.length > 0 &&
    !declared.some((k) => JSON.stringify(k) === JSON.stringify(keys));
  const fields = target
    ? keys.length
      ? keys.map((id) => target.columns.find((c) => c.id === id)!)
      : [{ id: "internal", name: "internal identity", dataType: "integer" }]
    : [];
  const compatible = (type: string) => humanSourceChoices(source, type);
  const chosen = fields.map(
    (f, i) =>
      components[i] ||
      (compatible(f.dataType ?? "text").length ? "" : "__new__"),
  );
  const ready =
    !!sourceId &&
    !!targetId &&
    !!name.trim() &&
    (!target ||
      (!!keyChoice && chosen.every(Boolean) && (!needsUnique || unique)));
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
          await onCreate(
            name.trim(),
            target
              ? {
                  targetColumns: keys,
                  sourceColumns: chosen,
                  declareUnique: needsUnique && unique,
                }
              : undefined,
          );
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
          </optgroup>
        </select>
      </label>
      {target && (
        <>
          {!target.primaryKey?.length && !!target.columns.length && (
            <label className="edit-label">
              Target key
              <select
                aria-label="Referenced target field"
                value={keyChoice}
                disabled={working}
                onChange={(e) => {
                  setKeyChoice(e.target.value);
                  setComponents([]);
                  setUnique(false);
                }}
              >
                <option value="" disabled hidden>
                  Choose target key
                </option>
                {!target.primaryKey?.length && (
                  <option value="internal">
                    {target.name} · new internal identity
                  </option>
                )}
                {humanTargetKeyChoices(target)
                  .filter((k) => k.length === 1)
                  .map((k) => target.columns.find((c) => c.id === k[0])!)
                  .map((c) => (
                    <option key={c.id} value={JSON.stringify([c.id])}>
                      {target.name}.{c.name}
                      {declared.some((k) => k.length === 1 && k[0] === c.id)
                        ? " · key"
                        : ""}
                    </option>
                  ))}
                {declared
                  .filter((k) => k.length > 1)
                  .map((k) => (
                    <option key={JSON.stringify(k)} value={JSON.stringify(k)}>
                      {k
                        .map(
                          (id) =>
                            `${target.name}.${target.columns.find((c) => c.id === id)?.name}`,
                        )
                        .join(" + ")}{" "}
                      · composite key
                    </option>
                  ))}
              </select>
            </label>
          )}
          {needsUnique && (
            <label className="null-choice">
              <input
                type="checkbox"
                checked={unique}
                disabled={working}
                onChange={(e) => setUnique(e.target.checked)}
              />
              Require a unique, non-empty target key
            </label>
          )}
          {!!keyChoice &&
            fields.map((f, i) => {
              const options = compatible(f.dataType ?? "text"),
                fieldName = fields.length > 1 ? `${name}_${f.name}` : name;
              return options.length ? (
                <label className="edit-label" key={f.id}>
                  Source for {target.name}.{f.name}
                  <select
                    aria-label={`Source key component ${i + 1}`}
                    value={chosen[i]}
                    disabled={working}
                    onChange={(e) =>
                      setComponents((old) => {
                        const next = [...old];
                        next[i] = e.target.value;
                        return next;
                      })
                    }
                  >
                    <option value="" disabled hidden>
                      Choose source field
                    </option>
                    <option value="__new__">
                      New field: {source?.name}.{fieldName || "…"}
                    </option>
                    {options.map((c) => (
                      <option key={c.id} value={c.id}>
                        {source?.name}.{c.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null;
            })}
        </>
      )}
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
