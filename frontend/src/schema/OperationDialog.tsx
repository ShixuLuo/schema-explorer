import { useEffect, useRef, useState } from "react";
import type { DataType, Table } from "../model/schema.ts";
import type { UseCase } from "../model/workspace.ts";
import type { Operation, TypedCell } from "../model/operations.ts";
import type { EditTarget } from "../application/intents.ts";
import Icon from "../shared/Icon";
import PreviewDetails from "./PreviewDetails.tsx";
import type { EditSession } from "../application/editor.ts";
import type { EditSummary } from "../application/preview.ts";
import { relationColumns } from "../model/schema.ts";
import type { ColumnSpec } from "../model/operations.ts";

const titles = {
  create_table: "Create table",
  add_primary_key: "Set primary key",
  drop_primary_key: "Remove primary key",
  add_foreign_key: "Add foreign key",
  drop_foreign_key: "Remove foreign key",
  drop_table: "Remove table",
  rename_table: "Rename table",
  rename_column: "Rename field",
  add_column: "Add field",
  drop_column: "Delete field",
};
export default function OperationDialog({
  target,
  createSession,
  useCase,
  tables,
  onClose,
  onApplied,
}: {
  target: EditTarget;
  createSession: (
    caseId: string,
    progress: (message: string) => void,
  ) => EditSession;
  useCase: UseCase;
  tables: Table[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const table =
    tables.find((table) => table.id === target.tableId) ??
    ({
      id: target.tableId,
      caseId: useCase.id,
      fileName: "",
      bytes: 0,
      name: "",
      columns: [],
      rowCount: 0,
      primaryKey: [],
    } as Table);
  const column = table.columns.find((column) => column.id === target.columnId);
  const [name, setName] = useState(
    target.kind === "rename_table"
      ? table.name
      : target.kind === "rename_column"
        ? (column?.name ?? "")
        : "",
  );
  const [dataType, setDataType] = useState<DataType>("text");
  const [value, setValue] = useState("");
  const [useNull, setUseNull] = useState(false);
  const [fields, setFields] = useState<ColumnSpec[]>([]);
  const [keyColumns, setKeyColumns] = useState<string[]>(
    target.columnId ? [target.columnId] : [],
  );
  const [referencedId, setReferencedId] = useState(
    target.relation?.target.tableId ?? "",
  );
  const [sourceColumns, setSourceColumns] = useState<string[]>(
    target.relation ? relationColumns(target.relation, "source") : [],
  );
  const referenced = tables.find((t) => t.id === referencedId);
  const [columnId] = useState(() => crypto.randomUUID());
  const [preview, setPreview] = useState<EditSummary | null>(null);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const session = useRef<EditSession | null>(null);
  session.current ??= createSession(useCase.id, setWorking);
  const discard = () => session.current!.discard();
  const cancel = async () => {
    if (working) return;
    setWorking("Closing…");
    await discard();
    onClose();
  };
  useEffect(() => () => session.current?.dispose(), []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        void cancel();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [working]);

  const operation = (): Operation[] => {
    if (target.kind === "create_table")
      return [
        {
          op: "create_table",
          table: {
            id: target.tableId,
            name: name.trim(),
            columns: fields,
            primary_key: [],
          },
        },
      ];
    if (target.kind === "add_primary_key")
      return [
        { op: "add_primary_key", table_id: table.id, column_ids: keyColumns },
      ];
    if (target.kind === "drop_primary_key")
      return [{ op: "drop_primary_key", table_id: table.id }];
    if (target.kind === "drop_foreign_key")
      return [
        {
          op: "drop_foreign_key",
          table_id: target.relation!.source.tableId,
          foreign_key_id: target.relation!.id,
        },
      ];
    if (target.kind === "add_foreign_key") {
      if (!referenced?.primaryKey?.length)
        throw new Error("Set a primary key on the target table first.");
      if (
        sourceColumns.length !== referenced.primaryKey.length ||
        sourceColumns.some((id) => !id)
      )
        throw new Error("Choose a source field for every target key field.");
      return [
        {
          op: "add_foreign_key",
          table_id: table.id,
          foreign_key: {
            id: target.relation?.id ?? columnId,
            source_table: table.id,
            source_columns: sourceColumns,
            target_table: referenced.id,
            target_columns: referenced.primaryKey,
          },
        },
      ];
    }
    if (target.kind === "drop_table")
      return [
        ...useCase.relationships
          .filter(
            (r) =>
              r.source.tableId === table.id || r.target.tableId === table.id,
          )
          .map((r) => ({
            op: "drop_foreign_key" as const,
            table_id: r.source.tableId,
            foreign_key_id: r.id,
          })),
        { op: "drop_table", table_id: table.id },
      ];
    if (target.kind === "rename_table")
      return [
        { op: "rename_table", table_id: table.id, new_name: name.trim() },
      ];
    if (target.kind === "rename_column")
      return [
        {
          op: "rename_column",
          table_id: table.id,
          column_id: column!.id,
          new_name: name.trim(),
        },
      ];
    if (target.kind === "drop_column")
      return [{ op: "drop_column", table_id: table.id, column_id: column!.id }];
    const constant: TypedCell = useNull
      ? { type: "null" }
      : { type: dataType, value };
    return [
      {
        op: "add_column",
        table_id: table.id,
        column: {
          id: columnId,
          name: name.trim(),
          data_type: dataType,
          nullable: useNull,
        },
        value: constant,
      },
    ];
  };
  const prepare = async () => {
    setError("");
    setWorking("Checking edit…");
    try {
      setPreview(await session.current!.prepare(operation()));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setWorking("");
    }
  };
  const apply = async () => {
    if (!preview) return;
    setWorking("Saving edit…");
    setError("");
    try {
      await session.current!.apply();
      onApplied();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setWorking("");
    }
  };
  const back = async () => {
    setWorking("Discarding preview…");
    await discard();
    setPreview(null);
    setError("");
    setWorking("");
  };
  const unchanged =
    (target.kind === "rename_table" && name.trim() === table.name) ||
    (target.kind === "rename_column" && name.trim() === column?.name);
  const needsName = [
    "create_table",
    "rename_table",
    "rename_column",
    "add_column",
  ].includes(target.kind);
  const destructive =
    target.kind === "drop_column" || target.kind === "drop_table";
  const connected = useCase.relationships.filter(
    (relation) =>
      relation.source.tableId === table.id ||
      relation.target.tableId === table.id,
  ).length;
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) void cancel();
      }}
    >
      <form
        className="operation-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={preview ? "Preview edit" : titles[target.kind]}
        onSubmit={(event) => {
          event.preventDefault();
          if (!working) void (preview ? apply() : prepare());
        }}
      >
        <div className="dialog-heading">
          <h2>{preview ? "Preview edit" : titles[target.kind]}</h2>
          <button
            type="button"
            className="icon-button"
            disabled={!!working}
            onClick={() => void cancel()}
            aria-label="Close edit"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        {!preview ? (
          <>
            {target.kind !== "create_table" && (
              <div className="operation-subject">
                <code>
                  {table.name}
                  {column ? `.${column.name}` : ""}
                </code>
              </div>
            )}
            {needsName && (
              <label className="edit-label">
                Name
                <input
                  autoFocus
                  aria-label={
                    ["rename_table", "create_table"].includes(target.kind)
                      ? "Table name"
                      : "Field name"
                  }
                  value={name}
                  maxLength={256}
                  disabled={!!working}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="off"
                  required
                />
              </label>
            )}
            {target.kind === "create_table" && (
              <div className="create-fields">
                {fields.map((field, i) => (
                  <div className="create-field" key={field.id}>
                    <input
                      aria-label={`Field ${i + 1} name`}
                      placeholder="Field name"
                      value={field.name}
                      onChange={(e) =>
                        setFields((v) =>
                          v.map((c, j) =>
                            j === i ? { ...c, name: e.target.value } : c,
                          ),
                        )
                      }
                    />
                    <select
                      aria-label={`Field ${i + 1} type`}
                      value={field.data_type}
                      onChange={(e) =>
                        setFields((v) =>
                          v.map((c, j) =>
                            j === i
                              ? { ...c, data_type: e.target.value as DataType }
                              : c,
                          ),
                        )
                      }
                    >
                      <option value="text">text</option>
                      <option value="integer">integer</option>
                    </select>
                    <label>
                      <input
                        type="checkbox"
                        checked={field.nullable}
                        onChange={(e) =>
                          setFields((v) =>
                            v.map((c, j) =>
                              j === i
                                ? { ...c, nullable: e.target.checked }
                                : c,
                            ),
                          )
                        }
                      />
                      NULL
                    </label>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove field ${i + 1}`}
                      onClick={() =>
                        setFields((v) => v.filter((_, j) => j !== i))
                      }
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="button"
                  onClick={() =>
                    setFields((v) => [
                      ...v,
                      {
                        id: crypto.randomUUID(),
                        name: "",
                        data_type: "text",
                        nullable: true,
                      },
                    ])
                  }
                >
                  Add field
                </button>
              </div>
            )}
            {target.kind === "add_primary_key" && (
              <div className="key-fields">
                {table.columns.map((c) => (
                  <label key={c.id}>
                    <input
                      type="checkbox"
                      aria-label={c.name}
                      checked={keyColumns.includes(c.id)}
                      onChange={(e) =>
                        setKeyColumns((v) =>
                          e.target.checked
                            ? [...v, c.id]
                            : v.filter((id) => id !== c.id),
                        )
                      }
                    />
                    <code>{c.name}</code>
                    {keyColumns.includes(c.id) && (
                      <span>{keyColumns.indexOf(c.id) + 1}</span>
                    )}
                  </label>
                ))}
              </div>
            )}
            {target.kind === "add_foreign_key" && (
              <div className="foreign-key-fields">
                <label className="form-field">
                  <span>References</span>
                  <select
                    aria-label="Referenced table"
                    value={referencedId}
                    onChange={(e) => {
                      setReferencedId(e.target.value);
                      setSourceColumns([]);
                    }}
                  >
                    <option value="">Choose table</option>
                    {tables.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                {referenced && !referenced.primaryKey?.length && (
                  <p className="edit-warning">
                    Set a primary key on {referenced.name} first.
                  </p>
                )}
                {(referenced?.primaryKey ?? []).map((id, i) => {
                  const key = referenced!.columns.find((c) => c.id === id)!;
                  return (
                    <label className="form-field" key={id}>
                      <span>
                        {referenced!.name}.{key.name}
                      </span>
                      <select
                        aria-label={`Source field for ${key.name}`}
                        value={sourceColumns[i] ?? ""}
                        onChange={(e) =>
                          setSourceColumns((v) => {
                            const n = [...v];
                            n[i] = e.target.value;
                            return n;
                          })
                        }
                      >
                        <option value="">Choose source field</option>
                        {table.columns
                          .filter(
                            (c) =>
                              (c.dataType ?? "text") ===
                              (key.dataType ?? "text"),
                          )
                          .map((c) => (
                            <option value={c.id} key={c.id}>
                              {table.name}.{c.name}
                            </option>
                          ))}
                      </select>
                    </label>
                  );
                })}
              </div>
            )}
            {target.kind === "add_column" && (
              <>
                <label className="edit-label">
                  Type
                  <select
                    aria-label="Field type"
                    value={dataType}
                    disabled={!!working}
                    onChange={(event) =>
                      setDataType(event.target.value as DataType)
                    }
                  >
                    <option value="text">text</option>
                    <option value="integer">integer</option>
                  </select>
                </label>
                <label className="edit-label">
                  Constant value
                  <input
                    aria-label="Constant value"
                    value={value}
                    disabled={!!working || useNull}
                    onChange={(event) => setValue(event.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label className="null-option">
                  <input
                    type="checkbox"
                    checked={useNull}
                    disabled={!!working}
                    onChange={(event) => setUseNull(event.target.checked)}
                  />
                  Use NULL
                </label>
              </>
            )}
            {target.kind === "drop_column" && (
              <p className="edit-warning">
                This removes the field and its {table.rowCount.toLocaleString()}{" "}
                stored cells.
              </p>
            )}
            {target.kind === "drop_table" && (
              <p className="edit-warning">
                This removes the table and its {table.rowCount.toLocaleString()}{" "}
                rows from this use case.
                {connected > 0 &&
                  ` ${connected} connected ${connected === 1 ? "relationship will" : "relationships will"} also be removed.`}
              </p>
            )}
          </>
        ) : (
          <PreviewDetails preview={preview} />
        )}
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
        <div className="dialog-actions">
          {preview && (
            <button
              type="button"
              className="plain-button"
              disabled={!!working}
              onClick={() => void back()}
            >
              Back
            </button>
          )}
          <span className="toolbar-spacer" />
          <button
            type="button"
            className="button"
            disabled={!!working}
            onClick={() => void cancel()}
          >
            Cancel
          </button>
          <button
            className={`button ${destructive && preview ? "danger" : "primary"}`}
            disabled={
              !!working ||
              (!preview && ((needsName && !name.trim()) || unchanged))
            }
          >
            {preview
              ? target.kind === "drop_column"
                ? "Delete field"
                : target.kind === "drop_table"
                  ? "Remove table"
                  : "Apply"
              : "Preview"}
          </button>
        </div>
      </form>
    </div>
  );
}
