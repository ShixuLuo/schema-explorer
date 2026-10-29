import { failureInfo } from "../model/failure.ts";
import { importFiles } from "../application/import.ts";
import { createIndexedDbStore } from "../adapters/indexeddb-store.ts";
import { createPostgresEngine } from "../adapters/postgres-engine.ts";
import { readCsv } from "../adapters/csv.ts";
import { prepareEdit } from "../application/edit.ts";
import type { DataTask } from "./tasks.ts";

const store = createIndexedDbStore(),
  engine = createPostgresEngine();
const progress = (message: string) =>
  self.postMessage({ kind: "progress", message });
async function run(data: DataTask) {
  try {
    if (data.kind === "import") {
      await importFiles(store, readCsv, data.caseId, data.files, progress);
      self.postMessage({ kind: "complete" });
    } else if (data.kind === "prepare_edit")
      self.postMessage({
        kind: "edit_preview",
        preview: await prepareEdit(
          store,
          engine,
          data.caseId,
          data.operations,
          progress,
          data.base,
          data.schemaOnly,
        ),
      });
  } catch (error) {
    self.postMessage({
      kind: "error",
      ...failureInfo(
        error instanceof DOMException && error.name === "QuotaExceededError"
          ? new Error("Browser storage is full. Free some space and try again.")
          : error,
      ),
    });
  }
}
self.onmessage = (event) => {
  if (navigator.locks)
    void navigator.locks.request(
      "schema-explorer-import",
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          self.postMessage({
            kind: "error",
            message:
              "Another data task is running. Please wait for it to finish.",
          });
          return;
        }
        await run(event.data);
      },
    );
  else void run(event.data);
};
