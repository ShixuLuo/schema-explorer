import { useRef, useState } from "react";
import { cqlExperiment, cqlLive } from "./runtime.ts";
import type { Contract, FrozenBinding } from "../application/cql-subset.ts";
import type {
  RecipeBindings,
  LiveResult,
  SourceFixture,
} from "../application/cql-live.ts";
import "./cql-panel.css";

export type CqlPanelProps = {
  hidden: boolean;
  onClose: () => void;
  activeCaseId: string | null;
  load: (id: string, fit?: boolean) => Promise<void>;
  disabled: boolean;
};

export default function CqlExperiment({
  hidden,
  onClose,
  activeCaseId,
  load,
  disabled,
}: CqlPanelProps) {
  const [data, setData] = useState<{
    contract: Contract;
    caseId: string;
    binding: FrozenBinding;
  } | null>(null);
  const [source, setSource] = useState<{
    caseId: string;
    bindings: RecipeBindings;
  } | null>(null);
  const [live, setLive] = useState<LiveResult | null>(null);
  const [counts, setCounts] = useState("");
  const [message, setMessage] = useState(
    "Prepare the configured example target to begin.",
  );
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const locked = disabled || busy;
  const targetIsOpen = !!data && activeCaseId === data.caseId;

  async function prepare() {
    setBusy(true);
    try {
      const response = await fetch("/cql-experiment/target.json");
      if (!response.ok) throw Error("Example target unavailable.");
      const contract: Contract = await response.json();
      const start = await cqlExperiment.start(contract);
      setData({ contract, ...start });
      setCounts("");
      setLive(null);
      await load(start.caseId, true);
      setMessage(
        `${start.binding.tables.length} target tables prepared. Load the example source, then run CQL.`,
      );
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function prepareInput() {
    setBusy(true);
    try {
      const response = await fetch("/cql-experiment/source.json");
      if (!response.ok) throw Error("Example source unavailable.");
      const fixture: SourceFixture = await response.json();
      setSource(await cqlLive.prepareSource(fixture));
      setMessage("Example source snapshot loaded.");
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!data || !source) return;
    setBusy(true);
    setLive(null);
    setCounts("");
    const controller = new AbortController();
    abort.current = controller;
    try {
      const result = await cqlLive.run(
        data.caseId,
        source.caseId,
        source.bindings,
        data.binding,
        setMessage,
        controller.signal,
        data.contract.metadata?.recipeId ?? "",
      );
      setLive(result);
      setCounts(
        data.binding.tables
          .map((table) => `${table.name}: ${result.rows[table.id].length}`)
          .join(" · "),
      );
      setMessage("CQL result ready. Open the prepared target to apply it.");
    } catch (error) {
      setMessage(
        controller.signal.aborted
          ? "Stopped waiting. Target data is unchanged."
          : String(error),
      );
    } finally {
      abort.current = null;
      setBusy(false);
    }
  }

  async function apply() {
    if (!data || !live || activeCaseId !== data.caseId) return;
    setBusy(true);
    try {
      await cqlLive.apply(data.caseId, live, data.contract);
      setLive(null);
      await load(data.caseId, true);
      setMessage("CQL result applied to the prepared target.");
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function openTarget() {
    if (!data) return;
    setBusy(true);
    try {
      await load(data.caseId, true);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="cql-panel"
      hidden={hidden}
      aria-label="CQL configured example"
    >
      <div className="cql-panel-heading">
        <div>
          <strong>{data?.contract.metadata?.title ?? "CQL"}</strong>
          <span className="cql-panel-label">Configured example</span>
        </div>
        <button className="plain-button" onClick={onClose}>
          Hide
        </button>
      </div>
      <p>
        {data?.contract.metadata?.description ??
          "Prepare an example target, load its source snapshot, then run CQL and apply the returned rows."}
      </p>
      <div className="cql-panel-actions">
        <button
          className="button"
          disabled={locked}
          onClick={() => void prepare()}
        >
          Prepare target
        </button>
        <button
          className="button"
          disabled={locked || !!source}
          onClick={() => void prepareInput()}
        >
          Load source
        </button>
        <button
          className="button"
          disabled={
            locked || !data || !source || !data.contract.metadata?.recipeId
          }
          onClick={() => void run()}
        >
          Run CQL
        </button>
        {data && !targetIsOpen && (
          <button
            className="button"
            disabled={locked}
            onClick={() => void openTarget()}
          >
            Open target
          </button>
        )}
        <button
          className="button primary"
          disabled={locked || !live || !targetIsOpen}
          onClick={() => void apply()}
        >
          Apply result
        </button>
        {busy && abort.current && (
          <button
            className="plain-button"
            onClick={() => abort.current?.abort()}
          >
            Stop waiting
          </button>
        )}
      </div>
      {counts && <p className="cql-panel-counts">{counts}</p>}
      <p role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
