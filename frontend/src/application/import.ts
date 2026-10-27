import type { WorkspaceStore, CsvReader, Progress } from "./ports.ts";
import type { Table } from "../model/schema.ts";
import { LIMITS } from "./limits.ts";
import { findRelations } from "./analysis.ts";
import { publishImport } from "./workspaces.ts";

export function validateFiles(files: File[]) {
  if (!files.length) throw new Error("Choose at least one CSV file.");
  if (files.length > LIMITS.files)
    throw new Error("Import up to 10 CSV files at a time.");
  if (files.some((f) => !/\.csv$/i.test(f.name)))
    throw new Error("Please choose CSV files.");
  const large = files.find((f) => f.size > LIMITS.fileBytes);
  if (large) throw new Error(`${large.name} exceeds the 5 MiB file limit.`);
  if (files.reduce((n, f) => n + f.size, 0) > LIMITS.batchBytes)
    throw new Error("This import exceeds the 20 MiB batch limit.");
}
export async function importFiles(
  store: WorkspaceStore,
  reader: CsvReader,
  caseId: string,
  files: File[],
  progress: Progress,
) {
  const added: Table[] = [];
  try {
    validateFiles(files);
    const before = await store.snapshot(caseId),
      old = before.tables;
    if (old.length + files.length > 24)
      throw new Error("A use case supports up to 24 tables.");
    if (
      old.reduce((n, t) => n + (t.dataBytes ?? t.bytes), 0) +
        files.reduce((n, f) => n + f.size, 0) >
      LIMITS.caseBytes
    )
      throw new Error(
        "This import would exceed the 40 MiB use-case data limit.",
      );
    for (const file of files)
      added.push(
        await reader(file, caseId, crypto.randomUUID(), store, progress),
      );
    const tables = [...old, ...added];
    if (new Set(tables.map((t) => t.name)).size !== tables.length)
      throw new Error(
        "Table names must be unique. Rename an existing table before importing a file with the same name.",
      );
    if (tables.reduce((n, t) => n + t.columns.length, 0) > 400)
      throw new Error("A use case supports up to 400 fields.");
    const { candidates, analysis } = await findRelations(
      store,
      tables,
      before.useCase.relationships,
      progress,
    );
    await publishImport(store, before, added, candidates, analysis);
  } catch (error) {
    await store.discard(added).catch(() => {});
    throw error;
  }
}
