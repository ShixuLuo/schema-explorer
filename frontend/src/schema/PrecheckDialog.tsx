import type { FailureInfo } from "../model/failure.ts";
import FailureNotice from "../shared/FailureNotice.tsx";
export type PrecheckPrompt = {
  errors: FailureInfo[];
  force: () => Promise<void>;
  cancel: () => void;
};
export default function PrecheckDialog({
  prompt,
  busy,
}: {
  prompt: PrecheckPrompt;
  busy: boolean;
}) {
  return (
    <div className="modal-backdrop precheck-backdrop">
      <section
        className="precheck-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="precheck-title"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) {
            e.stopPropagation();
            prompt.cancel();
          }
        }}
      >
        <h2 id="precheck-title">Precheck failed</h2>
        {prompt.errors.map((error, i) => (
          <FailureNotice key={i} error={error} />
        ))}
        <p className="precheck-explanation">
          You can keep the schema change without migrating the sample data. The
          original samples stay in the previous checkpoint. Migration SQL will
          still check the real data and roll back if a constraint fails.
        </p>
        <div className="dialog-actions">
          <button
            autoFocus
            className="button"
            disabled={busy}
            onClick={prompt.cancel}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void prompt.force()}
          >
            {busy ? "Preparing…" : "Force schema change"}
          </button>
        </div>
      </section>
    </div>
  );
}
