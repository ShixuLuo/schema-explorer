import { createObjectOperations, BUSINESS_KEY_TYPES, type NewObjectKey } from "../application/human-commands.ts";
import { useEffect, useState } from "react";
import { validateFiles } from "../application/import.ts";
import type { CsvInput } from "../application/ports.ts";
import type { Operation } from "../model/operations.ts";
import Icon from "../shared/Icon";
export default function ObjectCreator({
  onClose,
  onSubmit,
  onImport,
  inspectCsv,
  canImport,
  initialFiles = [],
}: {
  onClose: () => void;
  onSubmit: (ops: Operation[]) => Promise<void>;
  onImport: (files: CsvInput[]) => Promise<void>;
  inspectCsv: (file: File) => Promise<string[]>;
  canImport: boolean;
  initialFiles?: File[];
}) {
  const [source, setSource] = useState<"empty" | "csv">(
      initialFiles.length ? "csv" : "empty",
    ),
    [name, setName] = useState(""),
    [keyName, setKeyName] = useState(""),
    [keyMode, setKeyMode] = useState<NewObjectKey["mode"]>("generated"),
    [keyType, setKeyType] = useState<(typeof BUSINESS_KEY_TYPES)[number]>("text"),
    [files, setFiles] = useState(initialFiles),
    [headers, setHeaders] = useState<string[][]>([]),
    [keys, setKeys] = useState<string[]>([]),
    [reading, setReading] = useState(false),
    [working, setWorking] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !working) onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [working, onClose]);
  useEffect(() => {
    let active = true;
    setHeaders([]);
    setKeys([]);
    setError("");
    if (!files.length) {
      setReading(false);
      return;
    }
    setReading(true);
    void (async () => {
      validateFiles(files);
      return Promise.all(files.map(inspectCsv));
    })()
      .then((values) => {
        if (active) setHeaders(values);
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      })
      .finally(() => {
        if (active) setReading(false);
      });
    return () => {
      active = false;
    };
  }, [files, inspectCsv]);
  return (
    <form
      className="operation-editor object-creator"
      role="region"
      aria-label="Add object"
      onSubmit={async (e) => {
        e.preventDefault();
        setWorking(true);
        setError("");
        try {
          if (source === "csv")
            await onImport(
              files.map((file, i) => ({
                file,
                ...(keys[i] ? { primaryKey: keys[i] } : {}),
              })),
            );
          else {
            await onSubmit(createObjectOperations(name, keyName,
              keyMode === "generated" ? { mode: "generated" } : { mode: "business", dataType: keyType }));
          }
          onClose();
        } catch (error) {
          setError((error as Error).message);
        } finally {
          setWorking(false);
        }
      }}
    >
      <div className="dialog-heading">
        <h2>Add object</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close edit"
          disabled={working}
          onClick={onClose}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      <div
        className="creation-source"
        role="group"
        aria-label="Creation source"
      >
        <button
          type="button"
          aria-pressed={source === "empty"}
          disabled={working}
          onClick={() => setSource("empty")}
        >
          Empty
        </button>
        <button
          type="button"
          aria-pressed={source === "csv"}
          disabled={working || !canImport}
          onClick={() => setSource("csv")}
        >
          From CSV
        </button>
      </div>
      {source === "empty" ? (
        <>
          <label className="edit-label">
            Name
            <input
              autoFocus
              aria-label="Entity name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={working}
              required
            />
          </label>
          <label className="edit-label">
            Key values
            <select aria-label="Key values" value={keyMode} disabled={working}
              onChange={(e) => setKeyMode(e.target.value as NewObjectKey["mode"])}>
              <option value="generated">Generate automatically</option>
              <option value="business">Use business values</option>
            </select>
          </label>
          <label className="edit-label">
            Primary key name
            <input
              aria-label="Primary key name"
              placeholder={keyMode === "generated" ? "_id" : "e.g. code"}
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              disabled={working}
              required={keyMode === "business"}
            />
          </label>
          {keyMode === "business" && <label className="edit-label">
            Key type
            <select aria-label="Key type" value={keyType} disabled={working}
              onChange={(e) => setKeyType(e.target.value as (typeof BUSINESS_KEY_TYPES)[number])}>
              {BUSINESS_KEY_TYPES.map(type => <option value={type} key={type}>{type[0].toUpperCase() + type.slice(1)}</option>)}
            </select>
          </label>}
        </>
      ) : (
        <>
          <label className="csv-source">
            CSV files
            <input
              key="csv-files"
              type="file"
              accept=".csv,text/csv"
              multiple
              aria-label="CSV files"
              disabled={working}
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
          </label>
          {reading && <p role="status">Reading column names…</p>}
          {headers.map((columns, i) => (
            <label className="edit-label" key={i}>
              <span>{files[i].name} · Primary key</span>
              <select
                aria-label={`Primary key for ${files[i].name}`}
                value={keys[i] ?? ""}
                disabled={working}
                onChange={(e) =>
                  setKeys((old) => {
                    const next = [...old];
                    next[i] = e.target.value;
                    return next;
                  })
                }
              >
                <option value="">Row number → _id</option>
                {columns.map((column) => (
                  <option key={column} value={column}>
                    {column}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </>
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
          disabled={
            working ||
            reading ||
            (source === "empty"
              ? !name.trim() || (keyMode === "business" && !keyName.trim())
              : !files.length || headers.length !== files.length)
          }
        >
          {working ? "Creating…" : "Create"}
        </button>
      </div>
    </form>
  );
}
