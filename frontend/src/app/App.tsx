import { useCallback, useEffect, useRef, useState } from "react";
import { workspace, createEditorSession, loadSql } from "./runtime.ts";
import { validateFiles } from "../application/import.ts";
import type { Relation, Table } from "../model/schema.ts";
import type { UseCase } from "../model/workspace.ts";
import Icon from "../shared/Icon";
import DataPreview from "../schema/DataPreview.tsx";
import OperationDialog from "../schema/OperationDialog";
import MigrationDialog from "../schema/MigrationDialog";
import { runDataTask } from "./worker-client.ts";
import type { EditTarget } from "../application/intents.ts";
import Diagram from "../diagram/DiagramEditor";
export default function App() {
  const [cases, setCases] = useState<UseCase[]>([]);
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
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [view, setView] = useState({ revision: 0, fit: false });
  const upload = useRef<HTMLInputElement>(null);
  const task = useRef<AbortController | null>(null);
  const currentCase = useRef(useCase);
  currentCase.current = useCase;
  const refreshCases = useCallback(async () => {
    const values = await workspace.list();
    setCases(values);
    return values;
  }, []);
  const load = useCallback(async (id: string, fitNewData = false) => {
    const { useCase: next, tables: loaded } = await workspace.open(id);
    const values = await workspace.list();
    setView((v) => ({ revision: v.revision + 1, fit: fitNewData }));
    setPreviewId(null);
    setCase(next);
    setTables(loaded);
    setCases(values);
    setModal(null);
  }, []);
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
  useEffect(() => () => task.current?.abort(), []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setModal(null);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const save = useCallback(async (patch: Partial<UseCase>) => {
    const active = currentCase.current;
    if (!active) return;
    try {
      const next = await workspace.patch(active.id, patch);
      if (currentCase.current?.id === active.id) setCase(next);
      setCases((values) => values.map((c) => (c.id === active.id ? next : c)));
    } catch (err) {
      setError(String(err));
    }
  }, []);
  const home = () => {
    if (busy) return;
    setCase(null);
    setTables([]);
    setPreviewId(null);
    setError("");
    void refreshCases();
  };
  const importFiles = async (files: File[]) => {
    if (busy) return;
    if (edit) {
      setError("Finish or cancel the current edit before importing files.");
      return;
    }
    try {
      validateFiles(files);
    } catch (err) {
      setError((err as Error).message);
      return;
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
        { kind: "import", files, caseId },
        setBusy,
        controller.signal,
      );
      await load(caseId, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (isNew && caseId) await workspace.deleteEmpty(caseId);
      await refreshCases();
    } finally {
      task.current = null;
      setBusy("");
    }
  };
  const confirmRelation = (relation: Relation) => {
    if (busy || edit) return;
    setEdit({
      kind: "add_foreign_key",
      tableId: relation.source.tableId,
      relation,
    });
  };
  const undo = async () => {
    if (!useCase || busy || edit) return;
    setBusy("Restoring previous state…");
    setError("");
    try {
      await workspace.undo(useCase.id);
      await load(useCase.id);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  };
  const dismiss = (id: string) => {
    if (useCase) void save({ dismissed: [...useCase.dismissed, id] });
  };
  const preview = tables.find((t) => t.id === previewId);
  const openPicker = () => upload.current?.click();
  const newCase = async () => {
    if (busy || edit) return;
    try {
      const c = await workspace.create();
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
    if (e.dataTransfer.files.length)
      void importFiles(Array.from(e.dataTransfer.files));
  };
  const submitName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      await save({ name: name.trim() });
      setModal(null);
    }
  };

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
      <input
        className="hidden-input"
        ref={upload}
        type="file"
        accept=".csv,text/csv"
        multiple
        aria-label="Import CSV files"
        onChange={(e) => {
          if (e.target.files?.length)
            void importFiles(Array.from(e.target.files));
          e.target.value = "";
        }}
      />
      {!useCase ? (
        <main className="landing">
          <div className="landing-content">
            <h1>Schema Explorer</h1>
            <button
              className={`upload-area ${dragOver ? "dragging" : ""}`}
              onClick={openPicker}
              disabled={!!busy || !!edit}
            >
              <Icon name="upload" size={25} />
              <span>Drop CSV files</span>
              <span className="choose-files">Choose files</span>
            </button>
            <button
              className="open-use-case"
              disabled={!!busy}
              onClick={() => void newCase()}
            >
              <Icon name="plus" size={16} />
              New use case
            </button>
            <button
              className="open-use-case"
              disabled={!cases.length || !!busy}
              onClick={openCases}
            >
              <Icon name="folder" size={16} />
              Open use case
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
          useCase={useCase}
          tables={tables}
          busy={busy}
          disabled={!!edit}
          fitNewData={view.fit}
          onLayout={save}
          onEdit={setEdit}
          onPreview={setPreviewId}
          onAcceptRelation={confirmRelation}
          onDismiss={dismiss}
          onCreateTable={createTable}
          toolbar={
            <>
              <button
                className="home-button"
                disabled={!!busy || !!edit}
                onClick={home}
                title="Home"
              >
                Schema Explorer
              </button>
              <span className="breadcrumb-slash">/</span>
              <button
                className="case-name"
                disabled={!!busy || !!edit}
                onClick={() => {
                  setName(useCase.name);
                  setModal("rename");
                }}
                title="Rename use case"
              >
                {useCase.name}
              </button>
              <div className="toolbar-spacer" />
              <button
                className="toolbar-button"
                onClick={createTable}
                disabled={!!busy || !!edit}
              >
                <Icon name="plus" size={14} />
                Create table
              </button>
              <button
                className="toolbar-button"
                onClick={() => setShowSql(true)}
                disabled={!!busy || !!edit}
              >
                <Icon name="file" size={14} />
                Export SQL
              </button>
              <button
                className="toolbar-button"
                onClick={openPicker}
                disabled={!!busy || !!edit}
              >
                <Icon name="plus" size={14} />
                Import CSV
              </button>
              <button
                className="toolbar-button"
                disabled={!!busy || !!edit}
                onClick={openCases}
              >
                <Icon name="folder" size={14} />
                Open
              </button>
              <span className="toolbar-divider" />
              <button
                className="icon-button"
                disabled={!useCase.undo || !!busy || !!edit}
                onClick={() => void undo()}
                aria-label="Undo last edit"
                title={
                  useCase.undo
                    ? `Undo: ${useCase.undo.description}`
                    : "Undo last edit"
                }
              >
                <Icon name="undo" size={17} />
              </button>
            </>
          }
          footer={
            preview ? (
              <DataPreview
                readRows={workspace.readRows}
                table={preview}
                onClose={() => setPreviewId(null)}
              />
            ) : null
          }
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
      {showSql && useCase && (
        <MigrationDialog
          caseId={useCase.id}
          loadSql={loadSql}
          onClose={() => setShowSql(false)}
        />
      )}
      {edit && useCase && (
        <OperationDialog
          key={`${edit.kind}:${edit.tableId}:${edit.columnId ?? ""}`}
          target={edit}
          createSession={createEditorSession}
          useCase={useCase}
          tables={tables}
          onClose={() => setEdit(null)}
          onApplied={() => {
            const id = useCase.id;
            setEdit(null);
            void load(id, edit.kind === "create_table").catch((error) =>
              setError(
                `Edit saved, but the view could not reload: ${String(error)}`,
              ),
            );
          }}
        />
      )}
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
              aria-label="Open use case"
            >
              <div className="dialog-heading">
                <h2>Open use case</h2>
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
