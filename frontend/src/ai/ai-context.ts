import { validScalar } from "../model/scalar.ts";
import type {
  WorkspaceSnapshot,
  WorkspaceStore,
} from "../application/ports.ts";
import type { SchemaSpec } from "../model/operations.ts";
import type { CellValue } from "../model/schema.ts";
import { fingerprint, snapshotSchema } from "./ai-proposal.ts";
export type AiContext = {
  protocol: "schema-context/v1";
  schemaFingerprint: string;
  dataFingerprint: string;
  profiles: {
    tableId: string;
    scannedRows: number;
    totalRows: number;
    precision: "exact" | "estimate";
    columns: {
      columnId: string;
      nullCount: number;
      distinctCount: number;
      duplicateCount: number;
      typeFailures: number;
    }[];
    keys: { columnIds: string[]; nullRows: number; duplicateRows: number }[];
  }[];
  relationships: {
    id: string;
    scannedRows: number;
    nonNullRows: number;
    matchedRows: number;
    unmatchedRows: number;
    precision: "exact" | "estimate";
  }[];
  samples: {
    tableId: string;
    rowToken: string;
    stratum: string;
    values: Record<string, CellValue>;
    parentRowTokens: string[];
    orphanReferenceIds: string[];
  }[];
  excludedColumnIds: string[];
  scanLimit: number;
  sampleLimit: number;
  warnings: string[];
};
const sensitive = (name: string) =>
  /email|phone|address|password|secret|token|ssn|social.?security|birth|credit|salary|passport|name|contact/i.test(
    name,
  );
const key = (row: CellValue[], indices: number[]) =>
  JSON.stringify(indices.map((i) => row[i] ?? null));
export async function prepareAiContext(
  snapshot: WorkspaceSnapshot,
  store: Pick<WorkspaceStore, "rows">,
  options: {
    signal?: AbortSignal;
    maxScanRows?: number;
    maxSampleRows?: number;
    schema?: SchemaSpec;
  } = {},
): Promise<AiContext> {
  options.signal?.throwIfAborted();
  const scanLimit = Math.max(1, Math.min(options.maxScanRows ?? 10000, 100000)),
    sampleLimit = Math.max(0, Math.min(options.maxSampleRows ?? 18, 24));
  const schema = options.schema ?? snapshotSchema(snapshot),
    data = new Map<string, CellValue[][]>(),
    complete = new Map<string, boolean>();
  for (const table of snapshot.tables) {
    const rows: CellValue[][] = [];
    let ended = true;
    for await (const batch of store.rows(table)) {
      options.signal?.throwIfAborted();
      if (batch.offset !== rows.length)
        throw Error("Data snapshot changed while profiling.");
      for (const row of batch.rows) {
        if (rows.length === scanLimit) {
          ended = false;
          break;
        }
        rows.push(
          (schema.tables.find((t) => t.id === table.id)?.columns ?? []).map(
            (c) =>
              row[table.columns.findIndex((old) => old.id === c.id)] ?? null,
          ),
        );
      }
      if (!ended) break;
    }
    data.set(table.id, rows);
    complete.set(table.id, ended && rows.length === table.rowCount);
  }
  const excludedColumnIds = [
    ...new Set(
      [...schema.tables, ...snapshot.tables].flatMap((t) =>
        t.columns.filter((c) => sensitive(c.name)).map((c) => c.id),
      ),
    ),
  ];
  const profiles = schema.tables.map((t) => {
    const rows = data.get(t.id) ?? [],
      totalRows = snapshot.tables.find((x) => x.id === t.id)?.rowCount ?? 0;
    return {
      tableId: t.id,
      scannedRows: rows.length,
      totalRows,
      precision: complete.get(t.id)
        ? ("exact" as const)
        : ("estimate" as const),
      columns: t.columns.map((c, i) => {
        const values = rows.map((r) => r[i] ?? null),
          nonNull = values.filter((v) => v !== null),
          distinctCount = new Set(nonNull).size;
        return {
          columnId: c.id,
          nullCount: values.length - nonNull.length,
          distinctCount,
          duplicateCount: nonNull.length - distinctCount,
          typeFailures: nonNull.filter(
            (value) => !validScalar(c.dataType ?? "text", value),
          ).length,
        };
      }),
      keys: [t.primaryKey, ...(t.uniqueKeys ?? [])]
        .filter((k) => k.length)
        .map((ids) => {
          const indices = ids.map((id) =>
              t.columns.findIndex((c) => c.id === id),
            ),
            seen = new Set<string>();
          let nullRows = 0,
            duplicateRows = 0;
          for (const r of rows) {
            if (indices.some((i) => r[i] == null)) {
              nullRows++;
              continue;
            }
            const k = key(r, indices);
            if (seen.has(k)) duplicateRows++;
            seen.add(k);
          }
          return { columnIds: ids, nullRows, duplicateRows };
        }),
    };
  });
  const referenceMaps = schema.foreign_keys.map((f) => {
    const parent = schema.tables.find((t) => t.id === f.target_table)!,
      child = schema.tables.find((t) => t.id === f.source_table)!;
    const parentIndices = f.target_columns.map((id) =>
        parent.columns.findIndex((c) => c.id === id),
      ),
      childIndices = f.source_columns.map((id) =>
        child.columns.findIndex((c) => c.id === id),
      );
    const parents = new Map<string, number>();
    (data.get(parent.id) ?? []).forEach((r, i) => {
      if (!parentIndices.some((j) => r[j] == null))
        parents.set(key(r, parentIndices), i);
    });
    return { f, childIndices, parents };
  });
  const relationships = referenceMaps.map(({ f, childIndices, parents }) => {
    const rows = data.get(f.source_table) ?? [];
    let nonNullRows = 0,
      matchedRows = 0;
    for (const r of rows) {
      if (childIndices.some((i) => r[i] == null)) continue;
      nonNullRows++;
      if (parents.has(key(r, childIndices))) matchedRows++;
    }
    return {
      id: f.id,
      scannedRows: rows.length,
      nonNullRows,
      matchedRows,
      unmatchedRows: nonNullRows - matchedRows,
      precision:
        complete.get(f.source_table) && complete.get(f.target_table)
          ? ("exact" as const)
          : ("estimate" as const),
    };
  });
  // Link carriers receive request-local pseudonyms, shared across related columns.
  const linkIds = new Set(
    schema.foreign_keys.flatMap((f) => [
      ...f.source_columns,
      ...f.target_columns,
    ]),
  );
  const pseudonyms = new Map<string, string>();
  const mask = (v: string) => {
    if (!pseudonyms.has(v)) pseudonyms.set(v, "link-" + (pseudonyms.size + 1));
    return pseudonyms.get(v)!;
  };
  const samples: AiContext["samples"] = [],
    selected = new Set<string>();
  const add = (
    tableId: string,
    index: number,
    stratum: string,
  ): string | undefined => {
    const token = tableId + ":" + index;
    if (selected.has(token)) return token;
    if (samples.length >= sampleLimit) return;
    const table = schema.tables.find((t) => t.id === tableId)!,
      row = data.get(tableId)?.[index];
    if (!row) return;
    selected.add(token);
    const sample: AiContext["samples"][number] = {
      tableId,
      rowToken: token,
      stratum,
      values: {},
      parentRowTokens: [],
      orphanReferenceIds: [],
    };
    samples.push(sample);
    table.columns.forEach((c, i) => {
      if (excludedColumnIds.includes(c.id)) return;
      const value = row[i] ?? null;
      sample.values[c.id] =
        value !== null && linkIds.has(c.id)
          ? mask(value)
          : value === null
            ? null
            : value.slice(0, 160);
    });
    for (const { f, childIndices, parents } of referenceMaps.filter(
      (x) => x.f.source_table === tableId,
    )) {
      if (childIndices.some((i) => row[i] == null)) continue;
      const parentIndex = parents.get(key(row, childIndices));
      if (parentIndex === undefined) {
        sample.orphanReferenceIds.push(f.id);
        continue;
      }
      const parentToken = add(f.target_table, parentIndex, "referenced-parent");
      if (parentToken) sample.parentRowTokens.push(parentToken);
    }
    return token;
  };
  // Reserve each diagnostic child and its parents together; never invent a parent.
  for (const t of schema.tables) {
    const rows = data.get(t.id) ?? [],
      refs = referenceMaps.filter((x) => x.f.source_table === t.id);
    const candidates = [
      0,
      rows.findIndex((r) => r.some((v) => v === null)),
      rows.findIndex((r) =>
        refs.some(
          ({ childIndices, parents }) =>
            !childIndices.some((i) => r[i] == null) &&
            !parents.has(key(r, childIndices)),
        ),
      ),
      rows.length - 1,
    ];
    for (const i of new Set(candidates)) {
      if (i < 0 || !rows[i]) continue;
      const needed =
        1 +
        refs.filter(({ childIndices, parents }) =>
          parents.has(key(rows[i], childIndices)),
        ).length;
      if (samples.length + needed > sampleLimit) continue;
      add(
        t.id,
        i,
        i === 0
          ? "common"
          : rows[i].some((v) => v === null)
            ? "missing"
            : "edge",
      );
    }
  }
  options.signal?.throwIfAborted();
  const dataFingerprint = await fingerprint({
    schema,
    rows: [...data],
    counts: snapshot.tables.map((t) => [t.id, t.rowCount, t.dataId]),
    complete: [...complete],
  });
  return {
    protocol: "schema-context/v1",
    schemaFingerprint: await fingerprint(schema),
    dataFingerprint,
    profiles,
    relationships,
    samples,
    excludedColumnIds,
    scanLimit,
    sampleLimit,
    warnings: [
      "Diagnostic samples are biased; they do not prove constraints or prevalence.",
      "Sensitive columns are excluded; relationship carriers use consistent request-local pseudonyms.",
      ...(profiles.some((p) => p.precision === "estimate")
        ? [
            "Scan limit or snapshot mismatch: all unmatched reference counts may include unscanned parents.",
          ]
        : []),
    ],
  };
}
