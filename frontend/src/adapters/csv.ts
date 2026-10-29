import Papa from "papaparse";
import type { Column, Table } from "../model/schema.ts";
import type { CsvReader, RowWriter } from "../application/ports.ts";
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

function headersOf(sourceRow: string[], fileName: string) {
  const raw = sourceRow.map((v, i) => (i ? v : v.replace(/^\uFEFF/, "")));
  const retained = raw.flatMap((h, i) => (h.trim() ? [i] : [])),
    unnamed = raw.flatMap((h, i) => (h.trim() ? [] : [i]));
  const headers = retained.map((i) => raw[i]);
  if (!headers.length || headers.length > LIMITS.columns)
    throw new Error(`${fileName} must have between 1 and 100 columns.`);
  if (new Set(headers).size !== headers.length)
    throw new Error(`${fileName} needs nonempty, unique column headers.`);
  if (headers.some((h) => encoder.encode(h).length > 256))
    throw new Error(`${fileName} has a column header longer than 256 bytes.`);
  return { headers, retained, unnamed, width: raw.length };
}
export function readCsvHeaders(file: File): Promise<string[]> {
  return new Promise((resolve, reject) =>
    Papa.parse<string[]>(file, {
      delimiter: ",",
      header: false,
      skipEmptyLines: true,
      preview: 1,
      complete: (result) => {
        try {
          if (result.errors.length)
            throw new Error(`${file.name}: ${result.errors[0].message}`);
          if (!result.data.length)
            throw new Error(`${file.name} has no header row.`);
          resolve(headersOf(result.data[0], file.name).headers);
        } catch (error) {
          reject(error);
        }
      },
      error: reject,
    }),
  );
}

export const readCsv: CsvReader = async (
  file,
  caseId,
  id,
  store,
  progress,
  primaryKey,
) => {
  await validateUtf8(file);
  return new Promise<Table>((resolve, reject) => {
    let columns: Column[] = [],
      writer: RowWriter | undefined;
    let sourceWidth = 0,
      retained: number[] = [],
      unnamed: number[] = [];
    let keyIndex = -1,
      keyId = "";
    const keys = new Set<string>();
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
      primaryKey: [keyId],
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
          for (const sourceRow of result.data) {
            if (!columns.length) {
              const parsed = headersOf(sourceRow, file.name),
                headers = parsed.headers;
              sourceWidth = parsed.width;
              retained = parsed.retained;
              unnamed = parsed.unnamed;
              if (primaryKey !== undefined) {
                keyIndex = headers.indexOf(primaryKey);
                if (keyIndex < 0)
                  throw new Error(
                    `${file.name}: selected primary key column ${primaryKey} is missing.`,
                  );
              } else if (headers.includes("_id")) {
                throw new Error(
                  `${file.name} already has an _id column. Select it as the primary key, or rename that CSV column before using row numbers.`,
                );
              }
              columns = headers.map((name, index) => ({
                id: `${id}:${index}`,
                name,
                index: index + (keyIndex < 0 ? 1 : 0),
                dataType: "text",
                nullable: false,
                ...(index === keyIndex ? { storage: "identity" as const } : {}),
              }));
              if (keyIndex < 0) {
                keyId = `${id}:identity`;
                columns.unshift({
                  id: keyId,
                  name: "_id",
                  index: 0,
                  dataType: "integer",
                  nullable: false,
                  generated: "identity",
                });
              } else keyId = columns[keyIndex].id;
              writer = store.stage(metadata());
              continue;
            }
            if (sourceRow.length !== sourceWidth)
              throw new Error(
                `${file.name}, row ${rowCount + 2}: expected ${sourceWidth} fields, found ${sourceRow.length}.`,
              );
            // Unnamed CSV fields are ignored only while every value is empty.
            // A later nonempty value aborts the staged import, including prior chunks.
            const unexpected = unnamed.find((i) => sourceRow[i] !== "");
            if (unexpected !== undefined)
              throw new Error(
                `${file.name}, row ${rowCount + 2}: column ${unexpected + 1} has data but no header. Name this column before importing.`,
              );
            const row = retained.map((i) => sourceRow[i]);
            if (keyIndex >= 0) {
              const value = row[keyIndex];
              if (value === "")
                throw new Error(
                  `${file.name}, row ${rowCount + 2}: primary key ${primaryKey} is empty.`,
                );
              if (keys.has(value))
                throw new Error(
                  `${file.name}, row ${rowCount + 2}: primary key ${primaryKey} contains duplicate value ${JSON.stringify(value.slice(0, 80))}.`,
                );
              keys.add(value);
            } else row.unshift(String(rowCount + 1));
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
          resolve(await writer!.finish(metadata()));
        })().catch((error) => fail(error));
      },
      error: (error) => fail(error),
    });
  });
};
