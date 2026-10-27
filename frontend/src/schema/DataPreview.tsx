import { useEffect, useState } from "react";
import type { CellValue, Table } from "../model/schema.ts";
import Icon from "../shared/Icon";
export default function DataPreview({
  table,
  readRows,
  columnId,
  onClose,
}: {
  table: Table;
  readRows: (
    table: Table,
    offset: number,
    limit?: number,
  ) => Promise<CellValue[][]>;
  columnId?: string;
  onClose: () => void;
}) {
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<CellValue[][]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setPage(0);
  }, [table.id]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void readRows(table, page * 50, 50)
      .then((value) => {
        if (active) setRows(value);
      })
      .catch((err) => {
        if (active) setError(String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [table.id, table.dataId, page]);
  return (
    <section className="data-panel" aria-label="Data preview">
      <div className="data-panel-header">
        <div>
          <Icon name="table" size={16} />
          <strong>{table.name}</strong>
        </div>
        <div className="pagination">
          <span>
            {table.rowCount ? page * 50 + 1 : 0}–
            {Math.min((page + 1) * 50, table.rowCount)} of{" "}
            {table.rowCount.toLocaleString()}
          </span>
          <button
            className="icon-button"
            disabled={!page || loading}
            onClick={() => setPage((p) => p - 1)}
            aria-label="Previous page"
          >
            <Icon name="left" size={16} />
          </button>
          <button
            className="icon-button"
            disabled={(page + 1) * 50 >= table.rowCount || loading}
            onClick={() => setPage((p) => p + 1)}
            aria-label="Next page"
          >
            <Icon name="right" size={16} />
          </button>
          <span className="divider" />
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close data preview"
          >
            <Icon name="close" size={17} />
          </button>
        </div>
      </div>
      <div className={`data-scroll ${loading ? "is-loading" : ""}`}>
        {error ? (
          <div className="inline-error">{error}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th className="row-number">#</th>
                {table.columns.map((c) => (
                  <th
                    className={c.id === columnId ? "highlight-cell" : ""}
                    key={c.id}
                  >
                    {c.name}
                    <small>{c.dataType ?? "text"}</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={page * 50 + i}>
                  <td className="row-number">{page * 50 + i + 1}</td>
                  {row.map((value, j) => (
                    <td
                      className={
                        table.columns[j]?.id === columnId
                          ? "highlight-cell"
                          : ""
                      }
                      key={j}
                      title={value ?? "NULL"}
                    >
                      {value === null ? (
                        <span className="null-value">NULL</span>
                      ) : value === "" ? (
                        <span className="empty-value">empty</span>
                      ) : (
                        value
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && !rows.length && !error && (
          <div className="data-empty">
            This CSV contains headers and no data rows.
          </div>
        )}
      </div>
    </section>
  );
}
