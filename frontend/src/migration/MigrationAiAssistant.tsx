import { useEffect, useRef, useState } from "react";
import type { SchemaSpec } from "../model/operations.ts";
import type { AiContext } from "../ai/ai-context.ts";
import { canonical, fingerprint } from "../ai/ai-proposal.ts";
import { migrationAiBase, migrationProposalIsCurrent, requestMigrationParameters, type MigrationAiProposal } from "./ai-parameters.ts";
import type { Assignment, Plan } from "./migration-client.ts";
import "./migration-ai.css";

export type MigrationAiAssistantProps = {
  source: SchemaSpec;
  target: SchemaSpec;
  plan: Plan;
  assignments: Assignment[];
  intents?: unknown[];
  disabled?: boolean;
  loadContext?: () => Promise<AiContext>;
  /** Replace all displayed assignments atomically; do not execute a migration. */
  onPreview: (proposal: MigrationAiProposal) => void | Promise<void>;
  onAccept: () => void | Promise<void>;
  /** Called only while the displayed values still exactly match our preview. */
  onReject: (baseline: Assignment[]) => void | Promise<void>;
  onPendingChange?: (pending: boolean) => void;
};
type Pending = { proposal: MigrationAiProposal; baseline: Assignment[]; sourceKey: string; targetKey: string; baselineKey: string; candidateKey: string; candidateHash: string; applied: boolean };
function checkCandidate(proposal: MigrationAiProposal, baseline: Assignment[], plan: Plan, target: SchemaSpec) {
  if (!Array.isArray(proposal.assignments) || !Array.isArray(proposal.changes) || !Array.isArray(proposal.replacedHoleIds) || !Array.isArray(proposal.missing) || proposal.status !== "valid" || proposal.validation?.status !== "valid" || proposal.missing.length > 0 || proposal.validation.holes?.some(h => !h.filled) || !Array.isArray(proposal.validation.holes)) throw Error("Invalid parameter proposal.");
  const allowed = new Set([...(plan.holes ?? []).map(h => h.holeId), ...target.tables.map(t => `${t.id}.where`)]);
  const changed = new Set<string>();
  for (const assignment of proposal.changes) {
    if (!assignment || typeof assignment.holeId !== "string" || !allowed.has(assignment.holeId) || changed.has(assignment.holeId) || !assignment.value || typeof assignment.value !== "object") throw Error("Invalid parameter proposal.");
    changed.add(assignment.holeId);
    if (baseline.some(a => a.holeId === assignment.holeId) && !proposal.replacedHoleIds.includes(assignment.holeId)) throw Error("Unconfirmed parameter replacement.");
  }
  const merged = [...baseline.filter(a => !changed.has(a.holeId)), ...proposal.changes];
  if (new Set(proposal.assignments.map(a => a.holeId)).size !== proposal.assignments.length || canonical(merged) !== canonical(proposal.assignments)) throw Error("Incomplete parameter proposal.");
}

export default function MigrationAiAssistant(props: MigrationAiAssistantProps) {
  const [open, setOpen] = useState(false), [guidance, setGuidance] = useState("");
  const [busy, setBusy] = useState(false), [suggested, setSuggested] = useState(false), [notice, setNotice] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const latest = useRef(props); latest.current = props;
  const pendingRef = useRef<Pending | null>(null), epoch = useRef(0), notified = useRef(false);
  const request = useRef<{ controller: AbortController; key: string } | null>(null);
  const stateKey = canonical({ source: props.source, target: props.target, assignments: props.assignments });
  const requestKey = canonical({ state: stateKey, holes: props.plan.holes ?? [], intents: props.intents ?? [] });
  function notifyPending(value: boolean) { if (notified.current !== value) { notified.current = value; latest.current.onPendingChange?.(value); } }
  function clearProposal(message = "") { pendingRef.current = null; setPending(null); notifyPending(false); setNotice(message); }
  function valuesMatch(candidate: Pending) {
    const value = latest.current;
    return canonical(value.source) === candidate.sourceKey && canonical(value.target) === candidate.targetKey && canonical(value.assignments) === candidate.candidateKey;
  }
  useEffect(() => {
    if (request.current && request.current.key !== requestKey) {
      request.current.controller.abort(); request.current = null; epoch.current++; setBusy(false); notifyPending(false); setNotice("Values changed. Suggest again.");
    }
    const candidate = pendingRef.current;
    if (!candidate) return;
    const schemasMatch = canonical(props.source) === candidate.sourceKey && canonical(props.target) === candidate.targetKey;
    const assignmentsKey = canonical(props.assignments);
    if (schemasMatch && assignmentsKey === candidate.candidateKey) { candidate.applied = true; return; }
    if (schemasMatch && !candidate.applied && assignmentsKey === candidate.baselineKey) return;
    // Manual edits win: never restore a baseline over newly edited values.
    clearProposal("Kept your edits.");
  }, [stateKey, requestKey]);
  useEffect(() => { if (props.disabled && request.current) { request.current.controller.abort(); request.current = null; epoch.current++; setBusy(false); notifyPending(false); } }, [props.disabled]);
  useEffect(() => () => {
    request.current?.controller.abort(); epoch.current++;
    const candidate = pendingRef.current;
    if (candidate && valuesMatch(candidate)) {
      try { void Promise.resolve(latest.current.onReject(structuredClone(candidate.baseline))).catch(error => console.error("Migration AI unmount restore", error)); }
      catch (error) { console.error("Migration AI unmount restore", error); }
    }
    pendingRef.current = null; notifyPending(false);
  }, []);

  async function generate() {
    if (latest.current.disabled || busy || pendingRef.current) return;
    const captured = structuredClone({ source: latest.current.source, target: latest.current.target, assignments: latest.current.assignments, plan: latest.current.plan, intents: latest.current.intents });
    const key = canonical({ state: canonical({ source: captured.source, target: captured.target, assignments: captured.assignments }), holes: captured.plan.holes ?? [], intents: captured.intents ?? [] });
    const controller = new AbortController(), token = ++epoch.current;
    request.current = { controller, key }; setBusy(true); setNotice(""); setSuggested(true); notifyPending(true);
    try {
      const base = await migrationAiBase(captured.source, captured.target, captured.assignments);
      const context = await latest.current.loadContext?.();
      if (token !== epoch.current || controller.signal.aborted || latest.current.disabled) return;
      const proposal = await requestMigrationParameters({ protocol: "migration-parameters/v1", requestId: crypto.randomUUID(), source: captured.source, target: captured.target, holes: captured.plan.holes ?? [], assignments: captured.assignments, guidance, base, ...(captured.intents ? { intents: captured.intents } : {}), ...(context ? { context } : {}) }, controller.signal);
      const current = latest.current;
      if (token !== epoch.current || controller.signal.aborted || !(await migrationProposalIsCurrent(proposal, current.source, current.target, current.assignments))) return;
      if (token !== epoch.current || request.current?.key !== key || latest.current.disabled) return;
      if (proposal.status === "needs-input") {
        if (canonical(proposal.assignments) !== canonical(captured.assignments) || proposal.changes.length) throw Error("Unexpected incomplete proposal.");
        setNotice(proposal.questions.find(question => typeof question === "string" && question.trim()) ?? "Add guidance and try again."); return;
      }
      checkCandidate(proposal, captured.assignments, captured.plan, captured.target);
      const candidateHash = await fingerprint(proposal.assignments);
      if (token !== epoch.current || controller.signal.aborted || latest.current.disabled) return;
      request.current = null;
      if (!proposal.changes.length) { setNotice("No changes suggested."); return; }
      const candidate: Pending = { proposal: structuredClone(proposal), baseline: captured.assignments, sourceKey: canonical(captured.source), targetKey: canonical(captured.target), baselineKey: canonical(captured.assignments), candidateKey: canonical(proposal.assignments), candidateHash, applied: false };
      pendingRef.current = candidate; setPending(candidate); notifyPending(true);
      await latest.current.onPreview(structuredClone(proposal));
    } catch (error) {
      if (token !== epoch.current || controller.signal.aborted || latest.current.disabled) return;
      console.error("Migration AI parameters", error);
      const candidate = pendingRef.current;
      if (candidate && valuesMatch(candidate)) { try { await latest.current.onReject(structuredClone(candidate.baseline)); } catch (rollbackError) { console.error("Migration AI preview restore", rollbackError); } }
      clearProposal("Could not fill parameters. Try again.");
    } finally { if (token === epoch.current) { request.current = null; setBusy(false); if (!pendingRef.current) notifyPending(false); } }
  }
  async function accept() {
    const candidate = pendingRef.current;
    if (!candidate || busy || latest.current.disabled) return;
    setBusy(true); setNotice("");
    try {
      const snapshot = structuredClone({ source: latest.current.source, target: latest.current.target, assignments: latest.current.assignments });
      const base = await migrationAiBase(snapshot.source, snapshot.target, snapshot.assignments);
      if (pendingRef.current !== candidate || !valuesMatch(candidate) || base.sourceHash !== candidate.proposal.base.sourceHash || base.targetHash !== candidate.proposal.base.targetHash || base.assignmentsHash !== candidate.candidateHash) { clearProposal("Values changed. Suggest again."); return; }
      await latest.current.onAccept(); clearProposal();
    } catch (error) { console.error("Migration AI accept", error); setNotice("Could not accept. Try again."); }
    finally { setBusy(false); }
  }
  async function reject() {
    const candidate = pendingRef.current;
    if (!candidate || busy || latest.current.disabled) return;
    setBusy(true);
    try {
      if (valuesMatch(candidate)) { await latest.current.onReject(structuredClone(candidate.baseline)); clearProposal(); }
      else clearProposal("Kept your edits.");
    } catch (error) { console.error("Migration AI reject", error); setNotice("Could not restore. Try again."); }
    finally { setBusy(false); }
  }
  return <>
    <button type="button" className="icon-button migration-ai-launch" aria-label={open ? "Hide parameter suggestions" : "Show parameter suggestions"} title={open ? "Hide parameter suggestions" : "AI parameters"} disabled={props.disabled} onClick={() => setOpen(value => !value)}>✧</button>
    <aside hidden={!open} className="migration-ai-panel" aria-label="Parameter suggestions" aria-busy={busy}>
      <header><h3>Parameters</h3><button type="button" onClick={() => setOpen(false)} aria-label="Hide parameter suggestions">Hide <span aria-hidden="true">›</span></button></header>
      <div className="migration-ai-body">
        <label htmlFor="migration-ai-guidance">Guidance <span>Optional</span></label>
        <textarea id="migration-ai-guidance" rows={2} maxLength={1000} placeholder="Leave blank for suggestions" value={guidance} onChange={event => setGuidance(event.target.value)} disabled={busy || props.disabled}/>
        <button type="button" className="button primary migration-ai-fill" disabled={busy || props.disabled || !!pending} onClick={() => void generate()}>{busy ? "Filling…" : suggested ? "Suggest again" : "Fill parameters"}</button>
        {pending && <section className="migration-ai-proposal"><strong>Fill {pending.proposal.changes.length} {pending.proposal.changes.length === 1 ? "parameter" : "parameters"}</strong><div className="migration-ai-decisions"><button type="button" className="button primary" onClick={() => void accept()} disabled={busy || props.disabled}>Accept</button><button type="button" className="button" onClick={() => void reject()} disabled={busy || props.disabled}>Reject</button></div>{pending.proposal.missing.length > 0 && <p>{pending.proposal.missing.length} still need your input.</p>}</section>}
        {notice && <p role="status" className="migration-ai-notice">{notice}</p>}
      </div>
    </aside>
  </>;
}
