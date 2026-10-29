import { useEffect, useState } from "react";
import type { Operation, SchemaSpec } from "../model/operations.ts";
import { migrationRequest, stableDefaults, type Assignment, type Plan } from "./migration-client.ts";
import { MigrationReview } from "./MigrationReview.tsx";
import { MigrationConfigure } from "./MigrationConfigure.tsx";
import MigrationAiAssistant from "./MigrationAiAssistant.tsx";
import type { AiContext } from "../ai/ai-context.ts";
import "./wizard.css";

type Props = {
  source: SchemaSpec;
  target: SchemaSpec;
  sourceRevision?: number;
  operations?: Operation[];
  onClose: () => void;
  onStageChange?: (stage: "review" | "configure") => void;
  onMigrate?: (assignments: Assignment[]) => Promise<void>;
  loadAiContext?: () => Promise<AiContext>;
};
function missingLabel(id: string, target: SchemaSpec) {
  for (const table of target.tables) {
    if (id === `${table.id}.from`) return `${table.name}: source records`;
    const column = table.columns.find(c => id === `${table.id}.attribute.${c.id}`);
    if (column) return `${table.name}.${column.name}`;
    const fk = target.foreign_keys.find(f => id === `${table.id}.foreignKey.${f.id}`);
    if (fk) return `${table.name}.${fk.name ?? "reference"}`;
  }
  return "the remaining mapping";
}
export function MigrationWizard({ source, target, sourceRevision, operations, onClose, onStageChange, onMigrate, loadAiContext }: Props) {
  const [plan, setPlan] = useState<Plan>();
  const stage = plan ? "configure" : "review";
  useEffect(() => { onStageChange?.(stage); }, [stage, onStageChange]);
  const [assignments, setAssignments] = useState<Assignment[]>(() => stableDefaults(source, target));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [validated, setValidated] = useState(false);
  const notify = (message: string) => {
    setError(message);
    window.setTimeout(() => setError(current => current === message ? "" : current), 6500);
  };
  async function generate() {
    setBusy(true); setError("");
    try {
      const next = await migrationRequest("draft", source, target, assignments);
      if (!next.holes) throw Error(next.diagnostics?.[0]?.message ?? "Could not prepare the migration.");
      setPlan(next); setAssignments(next.assignments ?? assignments); setValidated(false);
    } catch (e) { notify(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function migrate() {
    if (!onMigrate || plan?.aiPending) return;
    setBusy(true); setError("");
    try {
      const next = await migrationRequest("validate", source, target, assignments);
      setPlan(next); setAssignments(next.assignments ?? assignments); setValidated(true);
      if (next.status !== "valid") {
        const missing = next.holes?.filter(h => !h.filled) ?? [];
        notify(missing.length ? `Complete ${missing.slice(0, 3).map(h => missingLabel(h.holeId, target)).join(", ")}.` : next.diagnostics?.[0]?.message ?? "Check the highlighted mappings.");
        if (missing[0]) document.querySelector<HTMLElement>(`[data-hole-id="${CSS.escape(missing[0].holeId)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      await onMigrate(next.assignments ?? assignments);
    } catch (e) { notify(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <div className="migration-overlay"><section className="migration-wizard" role="dialog" aria-modal="true" aria-labelledby="migration-title" aria-busy={busy} data-source-revision={sourceRevision} data-validated={validated}>
    <header className="migration-header"><div className="migration-heading"><h2 id="migration-title">Migration</h2><span>{plan ? "Map data" : "Review changes"}</span></div><div className="migration-header-actions">{plan && <MigrationAiAssistant source={source} target={target} plan={plan} assignments={assignments} intents={JSON.parse(JSON.stringify(operations ?? [], (key, value) => ["parameters", "value", "rows", "data", "sql", "method"].includes(key) ? undefined : value))} disabled={busy} loadContext={loadAiContext}
      onPreview={proposal => { setAssignments(proposal.assignments); setPlan({...proposal.validation, aiPending: true}); setValidated(proposal.validation.status === "valid"); setError(""); }}
      onAccept={() => setPlan(p => p ? {...p, aiPending: false} : p)}
      onReject={baseline => { setAssignments(baseline); setPlan(p => p ? {...p, aiPending: false, program: undefined} : p); setValidated(false); }}
      onPendingChange={pending => setPlan(p => p ? {...p, aiPending: pending} : p)} />}
      <a href="https://categoricaldata.net/help/Query.html" target="_blank" rel="noreferrer">Query guide ↗</a><button className="icon-button" disabled={busy} onClick={onClose} aria-label="Close migration">×</button></div></header>
    <div className="migration-content">
      {!plan ? <MigrationReview source={source} target={target} operations={operations}/> : <fieldset className="migration-form" disabled={busy}><MigrationConfigure source={source} target={target} plan={plan} assignments={assignments} onChange={next => { setAssignments(next); setPlan(p => p ? {...p, aiPending: false, program: undefined} : p); setValidated(false); setError(""); }}/></fieldset>}
    </div>
    <footer>{plan && <button className="plain-button" disabled={busy} onClick={() => { setPlan(undefined); setValidated(false); }}>Back</button>}<span className="migration-footer-spacer"/><button className="button" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy || !!plan?.aiPending || (Boolean(plan) && !onMigrate)} onClick={() => void (plan ? migrate() : generate())}>{busy ? (plan ? "Migrating…" : "Preparing…") : plan ? "Migrate" : "Continue"}</button></footer>
    {error && <div role="alert" className="migration-toast">{error}<button aria-label="Dismiss message" onClick={() => setError("")}>×</button></div>}
  </section></div>;
}
export default MigrationWizard;
