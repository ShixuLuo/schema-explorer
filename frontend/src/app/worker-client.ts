import type { DataTask, DataResult } from "./tasks.ts";
export function runDataTask(
  task: DataTask,
  onProgress: (message: string) => void,
  signal: AbortSignal,
): Promise<DataResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./data.worker.ts", import.meta.url), {
      type: "module",
    });
    const cleanup = () => {
      worker.terminate();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Task cancelled.", "AbortError"));
    };
    worker.onmessage = (event) => {
      if (event.data.kind === "progress") {
        onProgress(event.data.message);
        return;
      }
      cleanup();
      if (event.data.kind === "error") reject(new Error(event.data.message));
      else resolve(event.data as DataResult);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      cleanup();
      reject(new Error(event.message || "Could not process this data."));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else worker.postMessage(task);
  });
}
