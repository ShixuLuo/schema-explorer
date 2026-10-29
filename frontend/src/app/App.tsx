import Tutorial from "./Tutorial.tsx";
import { createTutorialSample } from "./runtime.ts";
import "./tutorial.css";
import {
  pendingPreviewPlan,
  type PendingPlan,
  type PreviewFocus,
} from "../ai/ai-default-preview.ts";
import { humanCommandGroupLabel } from "../application/human-commands.ts";
import { AiPendingPreview } from "../ai/ai-pending-preview.ts";
import AiSuggestions from "../ai/AiSuggestions.tsx";
import {
  addActionRound,
  acceptancePlan,
  acceptPlanned,
  rejectAction,
  type ActionReview,
} from "../ai/ai-action-review.ts";
import {
  humanActionOperations,
  validateAiActionGroups,
  validateAiAction,
} from "../ai/ai-capabilities.ts";
import { prepareAiContext } from "../ai/ai-context.ts";
import { fingerprint } from "../ai/ai-proposal.ts";
import { schemaSpec } from "../model/wire.ts";
import { translateCommand } from "../model/database-commands.ts";
import CqlExperiment from "./CqlExperiment.tsx";
import { readCsvHeaders } from "./runtime.ts";
import type { CsvInput } from "../application/ports.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EditSession } from "../application/editor.ts";
import { historyInfo, type SavedComparison } from "../application/history.ts";
import { validateFiles } from "../application/import.ts";
import type { CaseInfoPatch } from "../application/ports.ts";
import type { EditSummary } from "../application/preview.ts";
import Diagram from "../diagram/DiagramEditor";
import FloatingAddMenu, {
  type CanvasAction,
} from "../diagram/FloatingAddMenu.tsx";
import type { DiagramMode } from "../diagram/view-types.ts";
import type { ComparisonMode, ViewTable } from "../model/comparison.ts";
import { failureInfo } from "../model/failure.ts";
import type { MigrationMethod } from "../model/migration-options.ts";
import type {
  MigrationParameters as AttributeParameters,
  Operation,
} from "../model/operations.ts";
import type { Table } from "../model/schema.ts";
import type { CaseInfo, CheckpointRange, UseCase } from "../model/workspace.ts";
import { caseInfo } from "../model/workspace.ts";
import DataPreview from "../schema/DataPreview.tsx";
import GraphPreviewControls from "../schema/GraphPreviewControls.tsx";
import HistoryDialog, {
  HistoryComparisonBar,
} from "../schema/HistoryDialog.tsx";
import MigrationDialog from "../schema/MigrationDialog";
import MigrationPlan from "../schema/MigrationPlan.tsx";
import ObjectCreator from "../schema/ObjectCreator.tsx";
import PrecheckDialog, {
  type PrecheckPrompt,
} from "../schema/PrecheckDialog.tsx";
import Icon from "../shared/Icon";
import {
  aiExperiment,
  createEditorSession,
  history,
  loadSql,
  workspace,
} from "./runtime.ts";
import { runDataTask } from "./worker-client.ts";
export default function App() {
  const [tutorial, setTutorial] = useState<{
    caseId: string;
    returnId?: string;
    key: number;
  } | null>(null);
  const [cqlOpen, setCqlOpen] = useState(false);
  const [cases, setCases] = useState<CaseInfo[]>([]);
  const [useCase, setCase] = useState<UseCase | null>(null);
  const [tables, setTables] = useState<Table[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [modal, setModal] = useState<"open" | "rename" | null>(null);
  const [name, setName] = useState("");
  const [showAllCases, setShowAllCases] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [showSql, setShowSql] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const [diagramMode, setDiagramMode] = useState<DiagramMode>("category");
  const [sqlRange, setSqlRange] = useState<CheckpointRange | undefined>();
  const [showHistory, setShowHistory] = useState(false);
  const [savedComparison, setSavedComparison] =
    useState<SavedComparison | null>(null);
  const [draft, setDraft] = useState<EditSummary | null>(null);
  const [draftError, setDraftError] = useState("");
  const acceptedDraftRef = useRef<EditSummary | null>(null);
  acceptedDraftRef.current = draft;
  const [showAi, setShowAi] = useState(false),
    [aiReview, setAiReview] = useState<ActionReview | null>(null),
    [aiSelected, setAiSelected] = useState<string | null>(null),
    [aiFocus, setAiFocus] = useState<PreviewFocus>({}),
    [aiWorking, setAiWorking] = useState(false),
    [aiError, setAiError] = useState(""),
    [aiLive, setAiLive] = useState(false);
  const aiCase = useRef<string | null>(null);
  const aiDemo =
    import.meta.env.DEV && new URLSearchParams(location.search).has("aiDemo");
  const pendingAi = useRef(new AiPendingPreview());
  const [aiPending, setAiPending] = useState<EditSummary | null>(null);
  const [aiPreviewWorking, setAiPreviewWorking] = useState(false);
  const aiPreviewPlan = useRef<PendingPlan | null>(null),
    aiSelectedRef = useRef<string | null>(null),
    aiPreviewEpoch = useRef(0);
  useEffect(() => () => pendingAi.current.clear(), []);
  const aiSchemaRef = useRef<import("../model/operations.ts").SchemaSpec>({
    tables: [],
    foreign_keys: [],
  });
  useEffect(() => {
    if (aiCase.current !== useCase?.id) {
      setAiReview(null);
      setAiSelected(null);
      setAiFocus({});
      setAiError("");
      pendingAi.current.clear();
      setAiPending(null);
      aiPreviewPlan.current = null;
      aiSelectedRef.current = null;
      if (!useCase) setShowAi(false);
      aiCase.current = useCase?.id ?? null;
    }
  }, [useCase?.id]);
  useEffect(() => {
    if (!showAi) return;
    if (aiDemo) {
      setAiLive(false);
      return;
    }
    void fetch("/api/ai/health")
      .then((r) => (r.ok ? r.json() : null))
      .then((h) => {
        const ready = h?.ready === true && h?.protocol === "schema-actions/v1";
        setAiLive(ready);
        if (!ready) setAiError("AI is unavailable. Try again.");
        else
          setAiError((e) => (e === "AI is unavailable. Try again." ? "" : e));
      })
      .catch(() => {
        setAiLive(false);
        setAiError("AI is unavailable. Try again.");
      });
  }, [showAi]);
  const session = useRef<EditSession | null>(null);
  const displayDraft = aiPending ?? draft;
  const comparison =
    displayDraft?.comparison ?? savedComparison?.comparison ?? null;
  const [comparisonMode, setComparisonMode] =
    useState<ComparisonMode>("changes");
  const [edit, setEdit] = useState<{
    kind: "create_table";
    files?: File[];
    tableId: string;
  } | null>(null);
  const [view, setView] = useState<{
    revision: number;
    fit: boolean;
    canvasAction?: { kind: CanvasAction; id: number };
    canvasEditing?: boolean;
    precheck?: PrecheckPrompt;
  }>({ revision: 0, fit: false });
  const task = useRef<AbortController | null>(null);
  const currentCase = useRef(useCase);
  currentCase.current = useCase;
  const refreshCases = useCallback(async () => {
    const values = await workspace.list();
    setCases(values);
    return values;
  }, []);
  const load = useCallback(
    async (id: string, fitNewData = false, keepHistory = false) => {
      const { useCase: next, tables: loaded } = await workspace.open(id);
      const values = await workspace.list();
      session.current?.dispose();
      session.current = null;
      pendingAi.current.clear();
      setAiPending(null);
      aiPreviewPlan.current = null;
      acceptedDraftRef.current = null;
      setDraft(null);
      setDraftError("");
      setShowPlan(false);
      setShowHistory(keepHistory);
      setSavedComparison(null);
      setView((v) => ({ revision: v.revision + 1, fit: fitNewData }));
      setPreviewId(null);
      setCase(next);
      setTables(loaded);
      setCases(values);
      setModal(null);
    },
    [],
  );
  useEffect(() => {
    let active = true;
    void workspace
      .list()
      .then((values) => {
        if (active) setCases(values);
      })
      .catch((err) => {
        if (active) setError(String(err));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(
    () => () => {
      task.current?.abort();
      session.current?.dispose();
    },
    [],
  );
  useEffect(() => {
    if (!draft) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setModal(null);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [edit]);
  const save = useCallback(async (patch: CaseInfoPatch) => {
    const active = currentCase.current;
    if (!active) return;
    try {
      const next = await workspace.patch(active.id, patch);
      if (currentCase.current?.id === active.id)
        setCase((current) =>
          current?.id === active.id
            ? { ...current, ...patch, updatedAt: next.updatedAt }
            : current,
        );
      setCases((values) =>
        values.map((c) => (c.id === active.id ? caseInfo(next) : c)),
      );
    } catch (err) {
      setError(String(err));
    }
  }, []);
  const home = () => {
    if (busy || draft || savedComparison || showHistory) return;
    session.current?.dispose();
    session.current = null;
    pendingAi.current.clear();
    setAiPending(null);
    aiPreviewPlan.current = null;
    setAiReview(null);
    setShowAi(false);
    setCqlOpen(false);
    setCase(null);
    setTables([]);
    setPreviewId(null);
    setError("");
    void refreshCases();
  };
  const importFiles = async (inputs: CsvInput[]) => {
    if (busy) return;
    if (
      (edit && edit.kind !== "create_table") ||
      draft ||
      savedComparison ||
      showHistory
    ) {
      setError(
        draft
          ? "Commit or roll back draft changes before importing files."
          : "Close the current view before importing files.",
      );
      return;
    }
    try {
      validateFiles(inputs.map((input) => input.file));
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
    setError("");
    setModal(null);
    setBusy("Reading CSV files…");
    let caseId = useCase?.id;
    const isNew = !caseId;
    try {
      if (!caseId) caseId = (await workspace.create()).id;
      const controller = new AbortController();
      task.current = controller;
      await runDataTask(
        { kind: "import", files: inputs, caseId },
        setBusy,
        controller.signal,
      );
      await load(caseId, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (isNew && caseId) await workspace.deleteEmpty(caseId);
      await refreshCases();
      throw err;
    } finally {
      task.current = null;
      setBusy("");
    }
  };
  const activeTables = displayDraft?.comparison.after.tables ?? tables;
  const activeCase =
    useCase && displayDraft
      ? {
          ...useCase,
          relationships: displayDraft.comparison.after.relationships,
          equations: displayDraft.comparison.after.equations,
        }
      : useCase;
  const preview = activeTables.find((t) => t.id === previewId);
  const readRows = useCallback(
    (table: ViewTable, offset: number, limit?: number) => {
      if (aiPending) return pendingAi.current.readRows(table.id, offset, limit);
      if (draft && session.current)
        return session.current.readRows(table.id, offset, limit);
      const stored = tables.find((t) => t.id === table.id);
      if (!stored)
        return Promise.reject(new Error("This table is no longer available."));
      return workspace.readRows(stored, offset, limit);
    },
    [draft, aiPending, tables],
  );
  const updateDraft = async (
    change: (editor: EditSession, force: boolean) => Promise<EditSummary>,
  ) => {
    if (!useCase || busy || view.precheck)
      throw new Error("Wait for the current change to finish.");
    session.current = createEditorSession(useCase.id, setBusy, session.current);
    const accept = (summary: EditSummary) => {
      acceptedDraftRef.current = summary;
      setDraft(summary);
      setComparisonMode("changes");
      setPreviewId(null);
      if (summary.pendingParameters?.length) setShowPlan(true);
    };
    setDraftError("");
    setBusy("Preparing preview…");
    try {
      accept(await change(session.current, false));
    } catch (error) {
      const info = failureInfo(error);
      if (!info.precheckFailed) throw error;
      setBusy("");
      await new Promise<void>((resolve, reject) => {
        const close = () => setView((v) => ({ ...v, precheck: undefined }));
        setView((v) => ({
          ...v,
          precheck: {
            errors: [info],
            cancel: () => {
              close();
              reject(error);
            },
            force: async () => {
              setBusy("Preparing schema change…");
              try {
                session.current = createEditorSession(
                  useCase.id,
                  setBusy,
                  session.current,
                );
                accept(await change(session.current, true));
                close();
                resolve();
              } catch (failure) {
                close();
                reject(failure);
              } finally {
                setBusy("");
              }
            },
          },
        }));
      });
    } finally {
      setBusy("");
    }
  };
  const append = (operations: Operation[], label?: string) =>
    updateDraft((editor, force) => editor.append(operations, force, label));
  const chooseMethod = async (index: number, method: MigrationMethod) => {
    try {
      await updateDraft((editor, force) =>
        editor.chooseMethod(index, method, force),
      );
    } catch (error) {
      setDraftError(failureInfo(error).message);
    }
  };
  const configureParameters = (
    index: number,
    parameters: AttributeParameters,
  ) =>
    updateDraft((editor, force) =>
      editor.configureAttribute(index, parameters, force),
    );
  const readPlanRows = useCallback(
    (tableId: string, offset: number, side: "before" | "after") =>
      session.current?.readRows(tableId, offset, 5, side) ??
      Promise.resolve([]),
    [],
  );
  const commit = async () => {
    if (
      aiReview?.suggestions.some(
        (s) => s.status === "pending" || s.status === "stale",
      ) ||
      !session.current ||
      !draft ||
      busy ||
      !useCase ||
      draft.pendingParameters?.length
    )
      return;
    setBusy("Committing changes…");
    setDraftError("");
    try {
      await session.current.commit();
      setAiReview((r) =>
        r
          ? {
              ...r,
              suggestions: r.suggestions.map((s) =>
                s.status === "accepted" ? { ...s, status: "committed" } : s,
              ),
            }
          : null,
      );
      session.current = null;
      try {
        await load(useCase.id, draft.createdTables.length > 0);
      } catch (error) {
        setError(
          `Changes committed, but the view could not reload: ${String(error)}`,
        );
      }
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  };
  const rollback = async () => {
    pendingAi.current.clear();
    setAiPending(null);
    setAiReview(null);
    setAiSelected(null);
    aiSelectedRef.current = null;
    aiPreviewPlan.current = null;
    setAiFocus({});
    if (!session.current || busy) return;
    setBusy("Rolling back changes…");
    try {
      await session.current.rollback();
      setAiReview((r) =>
        r
          ? {
              ...r,
              suggestions: r.suggestions.map((s) =>
                s.status === "accepted" || s.status === "stale"
                  ? { ...s, status: "pending" }
                  : s,
              ),
            }
          : null,
      );
      session.current = null;
      acceptedDraftRef.current = null;
      setDraft(null);
      setDraftError("");
      setPreviewId(null);
      if (useCase) {
        try {
          await load(useCase.id);
        } catch (error) {
          setError(
            `Draft discarded, but the workspace could not reload: ${String(error)}`,
          );
        }
      }
    } finally {
      setBusy("");
    }
  };
  const readOnly =
    !!aiPending ||
    !!savedComparison ||
    (!!draft && comparisonMode === "before");
  const workspaceLocked = !!(
    edit ||
    draft ||
    savedComparison ||
    showHistory ||
    view.canvasEditing ||
    view.precheck
  );
  const runHistory = async (action: () => Promise<unknown>) => {
    if (!useCase || draft || busy)
      throw new Error("Finish the current draft first.");
    await action();
    await load(useCase.id, false, true);
  };
  const compareHistory = async (checkpointId: string) => {
    if (!useCase || draft || busy) return;
    const value = await history.compare(useCase.id, checkpointId);
    setSavedComparison(value);
    setComparisonMode("changes");
    setShowHistory(false);
    setPreviewId(null);
  };
  const newCase = async () => {
    if (busy || edit || draft) return;
    try {
      const c = await workspace.create();
      setDiagramMode("category");
      await load(c.id);
    } catch (e) {
      setError(String(e));
    }
  };
  const createTable = () =>
    setEdit({ kind: "create_table", tableId: crypto.randomUUID() });
  const openCases = () => {
    setShowAllCases(false);
    void refreshCases();
    setModal("open");
  };
  const drop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (!files.length || busy || draft || savedComparison || showHistory)
      return;
    void (async () => {
      try {
        validateFiles(files);
        if (!useCase) {
          const c = await workspace.create();
          await load(c.id);
        }
        setEdit({ kind: "create_table", tableId: crypto.randomUUID(), files });
      } catch (error) {
        setError((error as Error).message);
      }
    })();
  };
  const submitName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      await save({ name: name.trim() });
      setModal(null);
    }
  };

  const startTutorial = async (restart = false) => {
    if (busy || aiWorking) return;
    setCqlOpen(false);
    clearPendingAi();
    setAiReview(null);
    setShowAi(false);
    const returnId = restart ? tutorial?.returnId : useCase?.id;
    setBusy("Opening tutorial…");
    try {
      await session.current?.rollback();
      session.current = null;
      setEdit(null);
      setShowSql(false);
      setShowHistory(false);
      setPreviewId(null);
      const id = await createTutorialSample();
      await load(id, true);
      setDiagramMode("category");
      setTutorial({ caseId: id, returnId, key: Date.now() });
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy("");
    }
  };
  const exitTutorial = async () => {
    if (busy) return;
    try {
      await session.current?.rollback();
      session.current = null;
      setEdit(null);
      setShowSql(false);
      setShowHistory(false);
      setPreviewId(null);
      const returnId = tutorial?.returnId;
      setTutorial(null);
      if (returnId) await load(returnId, true);
      else {
        setCase(null);
        setTables([]);
        setDraft(null);
        await refreshCases();
      }
    } catch (error) {
      setError(String(error));
    }
  };

  const finishTutorial = async (home: boolean) => {
    if (busy) return;
    setTutorial(null);
    setEdit(null);
    setShowSql(false);
    setShowHistory(false);
    setPreviewId(null);
    setSavedComparison(null);
    if (home) {
      setCase(null);
      setTables([]);
      setDraft(null);
      await refreshCases();
    }
  };

  const currentAiSchema = () => {
    const accepted = acceptedDraftRef.current;
    return accepted
      ? schemaSpec(
          accepted.comparison.after.tables,
          accepted.comparison.after.relationships,
          accepted.comparison.after.equations,
        )
      : schemaSpec(
          tables,
          useCase?.relationships ?? [],
          useCase?.equations ?? [],
        );
  };
  aiSchemaRef.current = currentAiSchema();
  const openAiExample = async () => {
    if (busy || draft) return;
    setAiWorking(true);
    try {
      const id = await aiExperiment.createSample();
      await load(id, true);
      setShowAi(true);
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setAiWorking(false);
    }
  };
  const clearPendingAi = () => {
    pendingAi.current.clear();
    setAiPending(null);
    setAiSelected(null);
    aiSelectedRef.current = null;
    aiPreviewPlan.current = null;
    setAiFocus({});
  };
  const generateAi = async (guidance: string) => {
    if (!useCase || busy || aiPreviewWorking) return;
    if (!aiDemo && !aiLive) {
      setAiError("AI is unavailable. Try again.");
      void fetch("/api/ai/health")
        .then((r) => r.json())
        .then((h) =>
          setAiLive(h?.ready === true && h?.protocol === "schema-actions/v1"),
        )
        .catch(() => {});
      return;
    }
    if (draft?.pendingParameters?.length) {
      setAiError("Finish the action details first.");
      return;
    }
    setAiWorking(true);
    setAiError("");
    try {
      const schema = currentAiSchema();
      if (aiDemo) {
        const { demoSuggestions } =
          await import("../dev-fixtures/ai-demo-provider.ts");
        const groups = demoSuggestions({
          schema,
          iteration: (aiReview?.round ?? 0) + 1,
          hasPriorSuggestions: !!aiReview,
        });
        setAiReview(addActionRound(aiReview, groups));
        setAiSelected(null);
        return;
      }

      const before = await aiExperiment.snapshot(useCase.id);
      let snapshot = before;
      let provider: Pick<
        import("../application/ports.ts").WorkspaceStore,
        "rows"
      > = workspace;
      if (draft && session.current) {
        const editor = session.current;
        snapshot = {
          useCase: {
            ...before.useCase,
            relationships: draft.comparison.after.relationships,
            equations: draft.comparison.after.equations,
          },
          tables: draft.comparison.after.tables.map((t) => ({
            ...before.tables.find((o) => o.id === t.id),
            ...t,
            caseId: useCase.id,
            fileName: "",
            bytes: 0,
          })),
        };
        provider = {
          async *rows(t) {
            let offset = 0;
            while (true) {
              const rows = await editor.readRows(t.id, offset, 500);
              if (!rows.length) break;
              yield { offset, rows };
              offset += rows.length;
              if (rows.length < 500) break;
            }
          },
        };
      }
      const context = await prepareAiContext(snapshot, provider, { schema });
      const requestId = crypto.randomUUID(),
        baseFingerprint = await fingerprint(schema);
      const response = await fetch("/api/ai/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          caseId: useCase.id,
          base: {
            revision: before.useCase.revision ?? 0,
            fingerprint: baseFingerprint,
            schema,
          },
          context,
          guidance,
          feedback: {
            acceptedIds:
              aiReview?.suggestions
                .filter(
                  (s) => s.status === "accepted" || s.status === "committed",
                )
                .map((s) => s.id) ?? [],
            rejectedIds:
              aiReview?.suggestions
                .filter((s) => s.status === "rejected")
                .map((s) => s.id) ?? [],
          },
          pending:
            aiReview?.suggestions
              .filter((s) => s.status === "pending")
              .map(({ status: _status, ...s }) => s) ?? [],
        }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? "Please try again.");
      if (
        currentCase.current?.id !== before.useCase.id ||
        result.protocol !== "schema-actions/v1" ||
        result.requestId !== requestId ||
        result.base?.fingerprint !== baseFingerprint ||
        result.base?.revision !== (before.useCase.revision ?? 0) ||
        result.dataFingerprint !== context.dataFingerprint ||
        (await fingerprint(aiSchemaRef.current)) !== baseFingerprint
      )
        throw Error("The model changed. Generate again.");
      validateAiActionGroups(result.suggestions, schema);
      setAiReview(addActionRound(aiReview, result.suggestions));
      setAiSelected(null);
    } catch (e) {
      console.error("AI suggestion generation", e);
      setAiError((e as Error).message);
    } finally {
      setAiWorking(false);
    }
  };
  const compileAi = (id: string) => {
    if (!aiReview) throw Error("Try generating again.");
    const groups = acceptancePlan(aiReview, id);
    let schema = currentAiSchema();
    const operations: Operation[] = [];
    for (const group of groups)
      for (const action of group.actions) {
        const next = humanActionOperations(action, schema);
        for (const op of next) {
          schema = translateCommand(schema, op).after;
          operations.push(op);
        }
      }
    return { groups, schema, operations };
  };
  const rebuildAiPreview = async (
    review: ActionReview | null,
    accepted: EditSummary | null,
  ) => {
    const epoch = ++aiPreviewEpoch.current;
    if (!useCase || !review) {
      pendingAi.current.clear();
      setAiPending(null);
      aiPreviewPlan.current = null;
      setAiPreviewWorking(false);
      return;
    }
    const schema = accepted
      ? schemaSpec(
          accepted.comparison.after.tables,
          accepted.comparison.after.relationships,
          accepted.comparison.after.equations,
        )
      : schemaSpec(tables, useCase.relationships, useCase.equations);
    const plan = pendingPreviewPlan(review, schema);
    aiPreviewPlan.current = plan;
    if (plan.skippedIds.length)
      setAiReview((r) =>
        r
          ? {
              ...r,
              suggestions: r.suggestions.map((g) =>
                plan.skippedIds.includes(g.id) && g.status === "pending"
                  ? { ...g, status: "stale" }
                  : g,
              ),
            }
          : r,
      );
    if (!plan.operations.length) {
      pendingAi.current.clear();
      setAiPending(null);
      setAiPreviewWorking(false);
      if (!plan.focus[aiSelectedRef.current ?? ""]) setAiFocus({});
      return;
    }
    setAiPreviewWorking(true);
    try {
      const hash = await fingerprint(schema);
      if (epoch !== aiPreviewEpoch.current) return;
      const summary = await pendingAi.current.show(
        "__all_pending__",
        hash,
        accepted,
        plan.operations,
        () => createEditorSession(useCase.id, () => {}),
        "Suggested changes",
        plan.groupOperations,
      );
      if (epoch === aiPreviewEpoch.current && summary) {
        setAiPending(summary);
        setComparisonMode("changes");
        setPreviewId(null);
        setAiFocus(plan.focus[aiSelectedRef.current ?? ""] ?? {});
      }
    } catch (error) {
      if (epoch === aiPreviewEpoch.current) {
        console.error("AI pending preview", error);
        setAiPending(null);
        setAiError("Some suggestions need another look.");
      }
    } finally {
      if (epoch === aiPreviewEpoch.current) setAiPreviewWorking(false);
    }
  };
  const acceptAi = async (id: string) => {
    if (!aiReview || busy || aiPreviewWorking || !useCase) return;
    setAiWorking(true);
    setAiError("");
    try {
      const planned = compileAi(id),
        base = currentAiSchema(),
        hash = await fingerprint(base);
      const pieces = planned.groups.map((g) =>
        pendingAi.current.pendingOperations(g.id, hash),
      );
      const operations = pieces.every((p) => p !== null)
        ? pieces.flatMap((p) => p!)
        : planned.operations;
      const actualSchema = operations.reduce(
        (schema, operation) => translateCommand(schema, operation).after,
        base,
      );
      clearPendingAi();
      if (operations.length)
        await append(
          operations,
          planned.groups
            .map((g) => humanCommandGroupLabel(base, g.actions))
            .join(" + "),
        );
      setAiReview((r) => {
        if (!r) return r;
        const accepted = acceptPlanned(
          r,
          planned.groups.map((g) => g.id),
        );
        return {
          ...accepted,
          suggestions: accepted.suggestions.map((g) => {
            if (g.status !== "pending") return g;
            try {
              for (const action of g.actions)
                validateAiAction(action, actualSchema);
              return g;
            } catch {
              return { ...g, status: "stale" as const };
            }
          }),
        };
      });
    } catch (error) {
      console.error("AI action", error);
      setAiError((error as Error).message);
      setAiReview((r) => (r ? { ...r } : r));
    } finally {
      setAiWorking(false);
    }
  };
  const selectAi = (id: string) => {
    setAiSelected(id);
    aiSelectedRef.current = id;
    const focus = aiPreviewPlan.current?.focus[id];
    if (focus) setAiFocus(focus);
    else {
      const action = aiReview?.suggestions.find((g) => g.id === id)?.actions[0];
      setAiFocus(action?.arrowId ? { arrowId: action.arrowId } : {});
    }
  };
  useEffect(() => {
    void rebuildAiPreview(aiReview, draft);
    return () => {
      aiPreviewEpoch.current++;
      pendingAi.current.clear();
    };
  }, [aiReview, draft, useCase?.id, useCase?.revision]);
  return (
    <div
      className="app-shell"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDragOver(false);
      }}
      onDrop={drop}
    >
      {
        <AiSuggestions
          key={useCase?.id ?? "home"}
          hidden={!showAi}
          working={aiWorking || aiPreviewWorking || !!busy}
          error={aiError}
          review={aiReview}
          schema={currentAiSchema()}
          demo={aiDemo}
          showExample={
            import.meta.env.DEV &&
            new URLSearchParams(location.search).has("aiExample")
          }
          selected={aiSelected}
          onGenerate={(g) => void generateAi(g)}
          onSample={() => void openAiExample()}
          onClose={() => setShowAi(false)}
          onSelect={selectAi}
          onAccept={(id) => void acceptAi(id)}
          onReject={(id) => {
            setAiReview((r) => (r ? rejectAction(r, id) : r));
            setAiSelected(null);
            aiSelectedRef.current = null;
            setAiFocus({});
          }}
          hasCase={!!useCase}
        />
      }
      <CqlExperiment
        hidden={!cqlOpen}
        onClose={() => setCqlOpen(false)}
        activeCaseId={useCase?.id ?? null}
        load={load}
        disabled={
          !!busy || !!draft || !!edit || !!aiPending || aiWorking || !!tutorial
        }
      />
      {!useCase ? (
        <main className="landing">
          <div className="landing-content">
            <h1>Schema Explorer</h1>
            {import.meta.env.DEV &&
              new URLSearchParams(location.search).has("aiExample") && (
                <button className="button" onClick={() => void openAiExample()}>
                  Open example
                </button>
              )}
            <button
              className="upload-area"
              disabled={!!busy}
              onClick={() => void newCase()}
            >
              <Icon name="plus" size={25} />
              <span>New model</span>
            </button>
            <button
              className="open-use-case"
              disabled={!cases.length || !!busy}
              onClick={openCases}
            >
              <Icon name="folder" size={16} />
              Open model
            </button>
            <button
              className="open-use-case"
              disabled={!!busy}
              onClick={() => void startTutorial()}
            >
              <Icon name="book" size={16} />
              Tutorial
            </button>
            {busy && (
              <div className="reading-status" role="status">
                <span className="spinner" />
                {busy}
              </div>
            )}
          </div>
        </main>
      ) : (
        <Diagram
          key={`${useCase.id}:${view.revision}`}
          mode={diagramMode}
          onMode={(mode) => {
            setDiagramMode(mode);
            setView((v) => ({ ...v, canvasAction: undefined }));
          }}
          useCase={activeCase!}
          tables={activeTables}
          focusArrowId={aiFocus.arrowId}
          focusObjectId={aiFocus.objectId}
          focusEquationId={aiFocus.equationId}
          comparison={comparison}
          comparisonMode={comparisonMode}
          busy={busy}
          disabled={!!edit || readOnly || showHistory || !!view.precheck}
          fitNewData={view.fit}
          canvasAction={view.canvasAction}
          onCanvasActionConsumed={() =>
            setView((v) =>
              v.canvasAction ? { ...v, canvasAction: undefined } : v,
            )
          }
          onCanvasEditing={(value) =>
            setView((v) =>
              v.canvasEditing === value ? v : { ...v, canvasEditing: value },
            )
          }
          onLayout={(patch) =>
            aiPending
              ? Promise.resolve()
              : save({
                  ...patch,
                  ...(patch.positions
                    ? {
                        positions: {
                          ...Object.fromEntries(
                            Object.entries(
                              currentCase.current?.positions ?? {},
                            ).filter(([id]) => id.startsWith("type:")),
                          ),
                          ...patch.positions,
                        },
                      }
                    : {}),
                })
          }
          onOperations={append}
          onPreview={setPreviewId}
          onCreateTable={createTable}
          toolbar={
            <>
              <button
                className="home-button"
                disabled={!!busy || workspaceLocked}
                onClick={home}
                title="Home"
              >
                Schema Explorer
              </button>
              <span className="breadcrumb-slash">/</span>
              <button
                className="case-name"
                disabled={!!busy || workspaceLocked}
                onClick={() => {
                  setName(useCase.name);
                  setModal("rename");
                }}
                title="Rename use case"
              >
                {useCase.name}
              </button>
              <div className="toolbar-spacer" />
              {!tutorial && (
                <button
                  className="toolbar-button"
                  disabled={!!busy || workspaceLocked}
                  onClick={() => void startTutorial()}
                >
                  <Icon name="book" size={14} />
                  Tutorial
                </button>
              )}
              <button
                className="toolbar-button ai-launch"
                aria-label={showAi ? "Hide suggestions" : "Show suggestions"}
                title={showAi ? "Hide suggestions" : "Show suggestions"}
                disabled={!!busy || !!edit}
                onClick={() => {
                  setCqlOpen(false);
                  setShowAi((v) => !v);
                }}
              >
                ✧
              </button>
              <button
                className="toolbar-button"
                disabled={!!busy || workspaceLocked || aiWorking || !!tutorial}
                onClick={() => {
                  setShowAi(false);
                  setCqlOpen((value) => !value);
                }}
              >
                CQL
              </button>
              <button
                className="toolbar-button history-control"
                aria-label="Open history"
                title={
                  draft
                    ? "Commit or roll back draft changes first"
                    : "Branches and checkpoints"
                }
                disabled={!!busy || workspaceLocked}
                onClick={() => setShowHistory(true)}
              >
                <Icon name="history" size={14} />
                <span>History</span>
                <Icon name="down" size={12} />
              </button>
              <button
                data-tutorial="export-sql"
                className="toolbar-button"
                onClick={() => {
                  setSqlRange(undefined);
                  setShowSql(true);
                }}
                disabled={!!busy || workspaceLocked || !useCase.history.editing}
              >
                <Icon name="file" size={14} />
                Export SQL
              </button>
            </>
          }
          footer={
            <>
              {displayDraft && (
                <GraphPreviewControls
                  summary={displayDraft}
                  hidePlan={!!aiPending}
                  commitDisabledReason={
                    aiReview?.suggestions.some(
                      (g) => g.status === "pending" || g.status === "stale",
                    )
                      ? "Review the remaining suggestions first."
                      : undefined
                  }
                  mode={comparisonMode}
                  details={
                    !aiPending &&
                    draft &&
                    showPlan && (
                      <MigrationPlan
                        summary={draft}
                        disabled={
                          !!busy ||
                          !!edit ||
                          !!view.canvasEditing ||
                          !!view.precheck
                        }
                        onMethod={(index, method) =>
                          void chooseMethod(index, method)
                        }
                        onParameters={configureParameters}
                        readRows={readPlanRows}
                      />
                    )
                  }
                  planVisible={!aiPending && showPlan}
                  working={busy}
                  disabled={!!edit || !!view.canvasEditing || !!view.precheck}
                  error={draftError}
                  onMode={(mode) => {
                    setComparisonMode(mode);
                    setPreviewId(null);
                  }}
                  onCommit={() => void commit()}
                  onRollback={() => void rollback()}
                  onPlan={() => {
                    setPreviewId(null);
                    setShowPlan((value) => !value);
                  }}
                />
              )}
              {savedComparison && (
                <HistoryComparisonBar
                  value={savedComparison}
                  mode={comparisonMode}
                  onMode={setComparisonMode}
                  onClose={() => setSavedComparison(null)}
                  onExport={() => {
                    setSqlRange(savedComparison.range);
                    setShowSql(true);
                  }}
                />
              )}
              {preview && !showPlan && (
                <DataPreview
                  readRows={readRows}
                  table={preview}
                  onClose={() => setPreviewId(null)}
                />
              )}
            </>
          }
        />
      )}
      {tutorial && useCase?.id === tutorial.caseId && (
        <Tutorial
          key={tutorial.key}
          draft={!!draft}
          configured={!!draft && !draft.pendingParameters?.length}
          editing={!!edit}
          busy={!!busy}
          showHistory={showHistory}
          showSql={showSql}
          committed={
            tables.some((table) => table.name === "Shipment") && !draft
          }
          onExit={() => void exitTutorial()}
          onRestart={() => void startTutorial(true)}
          onExplore={() => void finishTutorial(false)}
          onHome={() => void finishTutorial(true)}
        />
      )}
      {dragOver && (
        <div className="drop-overlay">
          <Icon name="upload" size={26} />
          <span>Drop CSV files</span>
        </div>
      )}
      {error && (
        <div className="toast error" role="alert">
          <span>{error}</span>
          <button
            className="icon-button"
            onClick={() => setError("")}
            aria-label="Dismiss error"
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      )}
      {showHistory && useCase && (
        <HistoryDialog
          value={historyInfo(useCase)}
          obscured={showSql}
          onClose={() => setShowHistory(false)}
          onRestore={(checkpointId) =>
            runHistory(() => history.restore(useCase.id, checkpointId))
          }
          onCompare={compareHistory}
          onAddTag={(checkpointId, tag) =>
            runHistory(() => history.addTag(useCase.id, checkpointId, tag))
          }
          onRemoveTag={(checkpointId, tag) =>
            runHistory(() => history.removeTag(useCase.id, checkpointId, tag))
          }
          onExport={(from) => {
            const to = useCase.history.editing ?? from;
            if (to) {
              setSqlRange({ from, to });
              setShowSql(true);
            }
          }}
        />
      )}
      {showSql && useCase && (
        <MigrationDialog
          caseId={useCase.id}
          checkpoints={historyInfo(useCase).checkpoints}
          editingId={useCase.history.editing}
          initialRange={sqlRange}
          loadSql={loadSql}
          onClose={() => setShowSql(false)}
        />
      )}
      {edit && activeCase && (
        <ObjectCreator
          onClose={() => setEdit(null)}
          onSubmit={append}
          onImport={importFiles}
          inspectCsv={readCsvHeaders}
          initialFiles={edit.files}
          canImport={!draft}
        />
      )}
      {useCase && !showHistory && (
        <FloatingAddMenu
          disabled={!!busy || !!edit || readOnly || !!view.precheck}
          raised={!!draft}
          onAction={(kind) => {
            setDiagramMode("category");
            setView((v) => ({
              ...v,
              canvasAction: { kind, id: (v.canvasAction?.id ?? 0) + 1 },
            }));
            if (kind === "object") createTable();
          }}
        />
      )}
      {view.precheck && <PrecheckDialog prompt={view.precheck} busy={!!busy} />}
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          {modal === "open" ? (
            <section
              className="file-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="Open model"
            >
              <div className="dialog-heading">
                <h2>Open model</h2>
                <button
                  className="icon-button"
                  onClick={() => setModal(null)}
                  aria-label="Close dialog"
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
              <div className="saved-list">
                {(showAllCases ? cases : cases.slice(0, 5)).map((c) => (
                  <button
                    key={c.id}
                    onClick={() =>
                      void load(c.id).catch((err) => setError(String(err)))
                    }
                  >
                    <Icon name="folder" size={17} />
                    <span>{c.name}</span>
                    <small>
                      {c.tableIds.length}{" "}
                      {c.tableIds.length === 1 ? "table" : "tables"}
                    </small>
                  </button>
                ))}
              </div>
              {cases.length > 5 && (
                <button
                  className="plain-button all-cases"
                  onClick={() => setShowAllCases((v) => !v)}
                >
                  {showAllCases ? "Show recent" : "Show all"}
                </button>
              )}
            </section>
          ) : (
            <form
              className="rename-dialog"
              onSubmit={(e) => void submitName(e)}
              role="dialog"
              aria-modal="true"
              aria-label="Rename use case"
            >
              <div className="dialog-heading">
                <h2>Rename use case</h2>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setModal(null)}
                  aria-label="Close dialog"
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
              <label htmlFor="case-name">Name</label>
              <input
                id="case-name"
                autoFocus
                maxLength={80}
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
              />
              <div className="dialog-actions">
                <button
                  type="button"
                  className="button"
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button className="button primary" disabled={!name.trim()}>
                  Save
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
