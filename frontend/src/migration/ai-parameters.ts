import type { SchemaSpec } from "../model/operations.ts";
import type { AiContext } from "../ai/ai-context.ts";
import { fingerprint } from "../ai/ai-proposal.ts";
import type { Assignment, Hole, Plan } from "./migration-client.ts";
export type MigrationAiBase = { sourceHash: string; targetHash: string; assignmentsHash: string };
export type MigrationAiRequest = {
  protocol: "migration-parameters/v1"; requestId: string;
  source: SchemaSpec; target: SchemaSpec; holes: Hole[];
  assignments: Assignment[]; guidance: string; base: MigrationAiBase;
  context?: AiContext;
  intents?: unknown[];
};
export type MigrationAiProposal = {
  protocol: "migration-parameters/v1"; requestId: string; base: MigrationAiBase;
  status: "valid" | "needs-input"; questions: string[]; attempts: number;
  title: string; assignments: Assignment[]; changes: Assignment[];
  replacedHoleIds: string[]; missing: Hole[]; validation: Plan;
  origin: { kind: "live"; label: string };
};
export async function migrationAiBase(source: SchemaSpec, target: SchemaSpec, assignments: Assignment[]): Promise<MigrationAiBase> {
  return { sourceHash: await fingerprint(source), targetHash: await fingerprint(target), assignmentsHash: await fingerprint(assignments) };
}
export async function requestMigrationParameters(request: MigrationAiRequest, signal?: AbortSignal): Promise<MigrationAiProposal> {
  const response = await fetch("/api/ai/migration-parameters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal });
  const result = await response.json();
  if (!response.ok) throw Error(result.error ?? "Migration AI request failed.");
  if (result.protocol !== request.protocol || result.requestId !== request.requestId || result.base?.sourceHash !== request.base.sourceHash || result.base?.targetHash !== request.base.targetHash || result.base?.assignmentsHash !== request.base.assignmentsHash) throw Error("Stale migration AI response.");
  return result;
}
export async function migrationProposalIsCurrent(proposal: MigrationAiProposal, source: SchemaSpec, target: SchemaSpec, assignments: Assignment[]) {
  const base = await migrationAiBase(source, target, assignments);
  return base.sourceHash === proposal.base.sourceHash && base.targetHash === proposal.base.targetHash && base.assignmentsHash === proposal.base.assignmentsHash;
}
