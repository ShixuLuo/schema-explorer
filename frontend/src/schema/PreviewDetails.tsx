import type { CellValue } from "../model/schema.ts";
import type { EditSummary } from "../application/preview.ts";
const cell = (value: CellValue | undefined) =>
  value === undefined
    ? "—"
    : value === null
      ? "NULL"
      : value === ""
        ? '""'
        : value;

export default function PreviewDetails({ preview }: { preview: EditSummary }) {
  const removed = preview.reports.reduce((n, r) => n + r.cells_removed, 0);
  return (
    <div className="edit-preview">
      {preview.reports.map((report) => (
        <div key={report.step_index} className="edit-change">
          <strong>{report.description}</strong>
          {report.cells_added > 0 && (
            <span>{report.cells_added.toLocaleString()} cells added</span>
          )}
          {report.op === "drop_table" && (
            <span className="edit-warning">
              {report.rows_removed.toLocaleString()} rows removed
            </span>
          )}
          {report.cells_removed > 0 && report.op !== "drop_table" && (
            <span className="edit-warning">
              {report.cells_removed.toLocaleString()} cells removed
            </span>
          )}
          {!report.cells_added &&
            !report.cells_removed &&
            report.op !== "drop_table" && (
              <span>
                {report.rows_checked
                  ? `${report.rows_checked.toLocaleString()} rows checked`
                  : "Data values unchanged"}
              </span>
            )}
        </div>
      ))}
      {preview.removedRelationships.length > 0 && (
        <p className="edit-warning">
          {preview.removedRelationships.length} connected{" "}
          {preview.removedRelationships.length === 1
            ? "relationship removed"
            : "relationships removed"}
        </p>
      )}
      {preview.createdTables.map((table) => (
        <div className="edit-sample" key={table.id}>
          <table>
            <thead>
              <tr>
                <th>Field</th>
                <th>Type</th>
                <th>Nullable</th>
              </tr>
            </thead>
            <tbody>
              {table.columns.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.data_type}</td>
                  <td>{c.nullable ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {preview.samples
        .filter((sample) => sample.rows.length)
        .map((sample) => (
          <div className="edit-sample" key={sample.columnId}>
            <div>{sample.beforeName ?? sample.afterName}</div>
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Before</th>
                  <th>After</th>
                </tr>
              </thead>
              <tbody>
                {sample.rows.map((row) => (
                  <tr key={row.number}>
                    <td>{row.number}</td>
                    <td>{cell(row.before)}</td>
                    <td>{cell(row.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      {removed > 0 && (
        <p className="edit-warning">
          The previous values remain available for Undo.
        </p>
      )}
    </div>
  );
}
