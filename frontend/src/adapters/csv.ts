import Papa from "papaparse";
import type { Column, Table } from "../model/schema.ts";
import type { CsvReader, RowWriter } from "../application/ports.ts";
import { ColumnProfiler } from "../model/profile.ts";
import { LIMITS } from "../application/limits.ts";
const encoder = new TextEncoder();

async function validateUtf8(file: File) {
  const decoder = new TextDecoder("utf-8", { fatal: true }),
    reader = file.stream().getReader();
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      decoder.decode(item.value, { stream: true });
    }
    decoder.decode();
  } catch {
    throw new Error(`${file.name} must use UTF-8 encoding.`);
  } finally {
    reader.releaseLock();
  }
}

export const readCsv: CsvReader = async (file, caseId, id, store, progress) => {
  await validateUtf8(file);
  return new Promise<Table>((resolve, reject) => {
    let columns: Column[] = [],
      writer: RowWriter | undefined,
      profiler: ColumnProfiler | undefined;
    let rowCount = 0,
      buffer: string[][] = [],
      bufferBytes = 0,
      failed = false;
    const metadata = (): Table => ({
      id,
      caseId,
      name: file.name.replace(/\.csv$/i, ""),
      fileName: file.name,
      bytes: file.size,
      rowCount,
      columns,
    });
    const fail = (error: unknown, parser?: Papa.Parser) => {
      if (failed) return;
      failed = true;
      parser?.abort();
      const reason = error instanceof Error ? error : new Error(String(error));
      if (writer)
        void writer
          .abort()
          .catch(() => {})
          .finally(() => reject(reason));
      else reject(reason);
    };
    const flush = async () => {
      if (buffer.length) {
        await writer!.append(buffer);
        buffer = [];
        bufferBytes = 0;
      }
    };
    Papa.parse<string[]>(file, {
      header: false,
      delimiter: ",",
      skipEmptyLines: true,
      chunkSize: 128 * 1024,
      chunk: (result, parser) => {
        parser.pause();
        void (async () => {
          if (result.errors.length)
            throw new Error(`${file.name}: ${result.errors[0].message}`);
          for (const row of result.data) {
            if (!columns.length) {
              const headers = row.map((v, i) =>
                i ? v : v.replace(/^\uFEFF/, ""),
              );
              if (!headers.length || headers.length > LIMITS.columns)
                throw new Error(
                  `${file.name} must have between 1 and 100 columns.`,
                );
              if (
                headers.some((h) => !h.trim()) ||
                new Set(headers).size !== headers.length
              )
                throw new Error(
                  `${file.name} needs nonempty, unique column headers.`,
                );
              if (headers.some((h) => encoder.encode(h).length > 256))
                throw new Error(
                  `${file.name} has a column header longer than 256 bytes.`,
                );
              columns = headers.map((name, index) => ({
                id: `${id}:${index}`,
                name,
                index,
                emptyCount: 0,
                distinctCount: 0,
                integerFailures: 0,
                formatChanges: 0,
                nullCount: 0,
                dataType: "text",
                nullable: false,
              }));
              profiler = new ColumnProfiler(columns);
              writer = store.stage(metadata());
              continue;
            }
            if (row.length !== columns.length)
              throw new Error(
                `${file.name}, row ${rowCount + 2}: expected ${columns.length} fields, found ${row.length}.`,
              );
            if (
              rowCount >= LIMITS.rows ||
              (rowCount + 1) * columns.length > LIMITS.cells
            )
              throw new Error(
                `${file.name} exceeds 50,000 rows or 200,000 cells.`,
              );
            let bytes = 0;
            for (const value of row) {
              const size = encoder.encode(value).length;
              if (size > LIMITS.cellBytes)
                throw new Error(
                  `${file.name}, row ${rowCount + 2}: a cell exceeds 8 KiB.`,
                );
              bytes += size;
            }
            if (bytes > LIMITS.recordBytes)
              throw new Error(
                `${file.name}, row ${rowCount + 2}: a record exceeds 256 KiB.`,
              );
            if (buffer.length && bufferBytes + bytes > 256 * 1024)
              await flush();
            profiler!.add(row);
            buffer.push(row);
            bufferBytes += bytes;
            rowCount++;
            if (buffer.length >= 200) await flush();
          }
          progress(`Reading ${file.name} · ${rowCount.toLocaleString()} rows`);
          parser.resume();
        })().catch((error) => fail(error, parser));
      },
      complete: () => {
        if (failed) return;
        void (async () => {
          if (!columns.length)
            throw new Error(`${file.name} has no header row.`);
          await flush();
          profiler!.finish();
          resolve(await writer!.finish(metadata()));
        })().catch((error) => fail(error));
      },
      error: (error) => fail(error),
    });
  });
};
