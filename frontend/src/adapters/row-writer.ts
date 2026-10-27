import type { CellValue, Table } from "../model/schema.ts";
import type { RowWriter } from "../application/ports.ts";
import { LIMITS } from "../application/limits.ts";

type Sink = {
  put(reference: string, offset: number, rows: CellValue[][]): Promise<void>;
  discard(reference: string): Promise<void>;
};
// Physical buffering and data references belong to the adapter, never the edit
// workflow. Finished data is immutable; abort cannot remove published records.
export function rowWriter(table: Table, sink: Sink): RowWriter {
  const reference = crypto.randomUUID();
  const width = table.columns.length,
    columns = table.columns.map((c) => c.id);
  const encoder = new TextEncoder();
  let buffer: CellValue[][] = [],
    bufferBytes = 0,
    count = 0,
    stored = 0,
    totalBytes = 0;
  let state: "open" | "finished" | "aborted" = "open";
  const flush = async () => {
    if (!buffer.length) return;
    await sink.put(reference, stored, buffer);
    stored += buffer.length;
    buffer = [];
    bufferBytes = 0;
  };
  const abort = async () => {
    state = "aborted";
    buffer = [];
    bufferBytes = 0;
    await sink.discard(reference);
  };
  return {
    async append(rows) {
      if (state !== "open") throw new Error("This data writer is closed.");
      try {
        for (const row of rows) {
          if (row.length !== width)
            throw new Error("A record does not match its table schema.");
          if (count >= LIMITS.rows || (count + 1) * width > LIMITS.cells)
            throw new Error(
              "A table supports at most 50,000 rows and 200,000 cells.",
            );
          const bytes = row.reduce((n, value) => {
            const size = value === null ? 0 : encoder.encode(value).length;
            if (size > LIMITS.cellBytes)
              throw new Error("A cell exceeds 8 KiB.");
            return n + size;
          }, 0);
          if (bytes > LIMITS.recordBytes)
            throw new Error("A record exceeds 256 KiB.");
          if (totalBytes + bytes > LIMITS.caseBytes)
            throw new Error("Table data exceeds 40 MiB.");
          if (buffer.length && bufferBytes + bytes > 256 * 1024) await flush();
          buffer.push([...row]);
          bufferBytes += bytes;
          totalBytes += bytes;
          count++;
          if (buffer.length >= 200) await flush();
        }
      } catch (error) {
        await abort().catch(() => {});
        throw error;
      }
    },
    async finish(metadata) {
      if (state !== "open") throw new Error("This data writer is closed.");
      if (metadata.id !== table.id || metadata.caseId !== table.caseId)
        throw new Error("Data metadata belongs to another table.");
      if (
        metadata.columns.length !== width ||
        metadata.columns.some((c, i) => c.id !== columns[i])
      )
        throw new Error("Data metadata does not match its fields.");
      await flush();
      state = "finished";
      return {
        ...metadata,
        rowCount: count,
        dataBytes: totalBytes,
        dataId: reference,
      };
    },
    abort,
  };
}
