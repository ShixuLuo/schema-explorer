import { useEffect, useState } from "react";
import type { EditSummary } from "../application/preview.ts";
import type { ViewTable } from "../model/comparison.ts";
import type { CellValue } from "../model/schema.ts";
const cell = (value: CellValue | undefined) =>
  value === null
    ? "NULL"
    : value === undefined
      ? "—"
      : value === ""
        ? '""'
        : value;
export function changedPreviewTables(summary: EditSummary) {
  const ids = new Set(summary.changedData);
  Object.keys(summary.comparison.changes.tables).forEach((id) => ids.add(id));
  const all = [
    ...summary.comparison.after.tables,
    ...summary.comparison.before.tables,
  ];
  return [...ids].flatMap((id) => {
    const table = all.find((t) => t.id === id);
    return table
      ? [
          {
            id,
            name: table.name,
            before: summary.comparison.before.tables.find((t) => t.id === id),
            after: summary.comparison.after.tables.find((t) => t.id === id),
          },
        ]
      : [];
  });
}
type Snapshot = { before: CellValue[][]; after: CellValue[][]; error?: string };
export default function ChangedDataPreview({
  summary,
  readRows,
}: {
  summary: EditSummary;
  readRows: (
    id: string,
    offset: number,
    side: "before" | "after",
  ) => Promise<CellValue[][]>;
}) {
  const tables = changedPreviewTables(summary);
  const [data, setData] = useState<{
    summary: EditSummary | null;
    tables: Record<string, Snapshot>;
  }>({ summary: null, tables: {} });
  useEffect(() => {
    let active = true;
    if (
      summary.dataValidation === "unverified" ||
      summary.pendingParameters?.length
    ) {
      setData({ summary, tables: {} });
      return;
    }
    setData({ summary: null, tables: {} });
    Promise.all(
      tables.map(async (table) => {
        try {
          const [before, after] = await Promise.all([
            table.before ? readRows(table.id, 0, "before") : [],
            table.after ? readRows(table.id, 0, "after") : [],
          ]);
          return [
            table.id,
            { before: before.slice(0, 5), after: after.slice(0, 5) },
          ] as const;
        } catch (error) {
          return [
            table.id,
            {
              before: [],
              after: [],
              error: error instanceof Error ? error.message : String(error),
            },
          ] as const;
        }
      }),
    ).then((values) => {
      if (active) setData({ summary, tables: Object.fromEntries(values) });
    });
    return () => {
      active = false;
    };
  }, [summary, readRows]);
  if (summary.pendingParameters?.length)
    return (
      <section
        className="changed-preview no-data-preview"
        aria-label="Changed data preview"
      >
        <strong>No data preview</strong>
        <p>
          Configure the actions with a supported migration and its required
          parameters.
        </p>
      </section>
    );
  if (summary.dataValidation === "unverified")
    return (
      <section
        className="changed-preview no-data-preview"
        aria-label="Changed data preview"
      >
        <strong>No preview</strong>
        <p>
          Force schema change skipped data migration. Before / After data is
          unavailable for this draft.
        </p>
      </section>
    );
  return (
    <section className="changed-preview" aria-label="Changed data preview">
      <header>
        <strong>Before / After</strong>
        <span>
          All actions · {tables.length} affected{" "}
          {tables.length === 1 ? "table" : "tables"}
        </span>
      </header>
      {!tables.length && (
        <p className="plan-empty">No table data is affected by this plan.</p>
      )}
      <div className="changed-tables">
        {tables.map((table) => {
          const { before, after } = table,
            rows = data.summary === summary ? data.tables[table.id] : undefined;
          const allColumns = [
            ...(after?.columns ?? []),
            ...(before?.columns.filter(
              (c) => !after?.columns.some((n) => n.id === c.id),
            ) ?? []),
          ];
          const written = new Set(
            summary.operations.flatMap((op) =>
              op.op === "populate_reference" && op.table_id === table.id
                ? op.source_columns
                : [],
            ),
          );
          const focused = allColumns.filter((c) => {
            const a = before?.columns.find((n) => n.id === c.id),
              b = after?.columns.find((n) => n.id === c.id);
            return (
              !a ||
              !b ||
              a.name !== b.name ||
              a.dataType !== b.dataType ||
              written.has(c.id)
            );
          });
          const context = allColumns
            .filter((c) => !focused.some((f) => f.id === c.id))
            .slice(0, 2);
          const columns = focused.length
            ? [...context, ...focused]
            : allColumns.slice(0, 8);
          const renderSide = (
            side: "before" | "after",
            model: ViewTable | undefined,
          ) => (
            <section
              className={`preview-state ${side}`}
              aria-label={`${table.name} ${side === "before" ? "Before" : "After"}`}
            >
              <header>
                <strong>{side === "before" ? "Before" : "After"}</strong>
                <span>
                  {model
                    ? `${model.rowCount} ${model.rowCount === 1 ? "row" : "rows"}`
                    : "Not present"}
                </span>
              </header>
              {!model ? (
                <p className="plan-empty">
                  {side === "before"
                    ? "Object did not exist."
                    : "Object removed."}
                </p>
              ) : !model.rowCount ? (
                <p className="plan-empty">No records.</p>
              ) : !model.columns.length ? (
                <div className="empty-tuple-preview">
                  <span>
                    {model.rowCount}{" "}
                    {model.rowCount === 1 ? "record" : "records"} with no
                    attributes
                  </span>
                  <ol>
                    {(rows?.[side] ?? []).map((_, i) => (
                      <li key={i}>
                        <span>{i + 1}</span>
                        <span className="empty-row-label">
                          No attributes yet
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : (
                <div className="plan-data-scroll">
                  <table>
                    <thead>
                      <tr>
                        {columns.map((c) => {
                          const field = model.columns.find(
                            (n) => n.id === c.id,
                          );
                          return (
                            <th
                              key={c.id}
                              className={!field ? "preview-absent" : ""}
                            >
                              {field?.name ?? c.name}
                              {!field && (
                                <span className="missing-field"> · absent</span>
                              )}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {rows?.[side].map((row, index) => (
                        <tr key={index}>
                          {columns.map((c) => {
                            const field = model.columns.find(
                              (n) => n.id === c.id,
                            );
                            return (
                              <td
                                key={c.id}
                                className={
                                  !field
                                    ? "preview-absent"
                                    : focused.some((f) => f.id === c.id)
                                      ? side === "before"
                                        ? "preview-old-column"
                                        : "preview-new-column"
                                      : ""
                                }
                              >
                                {field ? cell(row[field.index]) : "—"}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
          return (
            <details className="changed-table" key={table.id} open>
              <summary>
                <strong>
                  {before?.name && before.name !== after?.name && after
                    ? `${before.name} → ${after.name}`
                    : table.name}
                </strong>
                <span>
                  {before?.rowCount ?? 0} → {after?.rowCount ?? 0} records
                </span>
                <span className="table-disclosure" aria-hidden="true">
                  ⌃
                </span>
              </summary>
              {rows?.error ? (
                <p className="edit-error" role="alert">
                  {rows.error}
                </p>
              ) : !rows ? (
                <p className="plan-empty" role="status">
                  Loading preview…
                </p>
              ) : (
                <div className="before-after-grid">
                  {renderSide("before", before)}
                  {renderSide("after", after)}
                </div>
              )}
              {rows && !rows.error && (
                <p className="preview-caption">
                  Up to 5 sample records per state
                  {columns.length < allColumns.length
                    ? ` · ${columns.length} of ${allColumns.length} fields`
                    : ""}
                </p>
              )}
            </details>
          );
        })}
      </div>
    </section>
  );
}
