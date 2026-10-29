import { suggestionDirections } from "./ai-directions.ts";
import { humanCommandGroupLabel } from "../application/human-commands.ts";
import type { SchemaSpec } from "../model/operations.ts";
import { useState } from "react";
import type { ActionReview } from "./ai-action-review.ts";
import "./ai.css";
export default function AiSuggestions({
  hidden,
  working,
  error,
  review,
  demo,
  showExample,
  schema,
  selected,
  onGenerate,
  onSample,
  onClose,
  onSelect,
  onAccept,
  onReject,
  hasCase,
}: {
  hidden: boolean;
  working: boolean;
  error: string;
  review: ActionReview | null;
  demo: boolean;
  showExample: boolean;
  schema: SchemaSpec;
  selected: string | null;
  onGenerate: (guidance: string) => void;
  onSample: () => void;
  onClose: () => void;
  onSelect: (id: string) => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  hasCase: boolean;
}) {
  const [guidance, setGuidance] = useState("");
  const pending =
    review?.suggestions.filter(
      (s) => s.status === "pending" || s.status === "stale",
    ) ?? [];
  return (
    <aside
      hidden={hidden}
      className="ai-experiment-panel"
      aria-label="AI suggestions"
    >
      <header>
        <h2>Suggestions {demo && <small>Demo</small>}</h2>
        <button
          className="ai-hide"
          aria-label="Hide suggestions"
          onClick={onClose}
        >
          Hide <span aria-hidden="true">›</span>
        </button>
      </header>
      <div className="ai-panel-content">
        <label className="ai-guidance-label">
          Guidance <span>Optional</span>
        </label>
        <textarea
          aria-label="Guidance (optional)"
          rows={2}
          maxLength={240}
          placeholder="Leave blank for suggestions"
          value={guidance}
          onChange={(e) => setGuidance(e.target.value)}
        />
        <div className="ai-directions">
          {suggestionDirections(schema).map((d) => (
            <button key={d.label} onClick={() => setGuidance(d.guidance)}>
              {d.label}
            </button>
          ))}
        </div>
        <button
          className="button primary ai-generate"
          disabled={working || !hasCase}
          onClick={() => onGenerate(guidance)}
        >
          {working
            ? "Thinking…"
            : review
              ? "Suggest again"
              : "Generate suggestions"}
        </button>
        {!hasCase && showExample && (
          <button className="button" onClick={onSample}>
            Try an example
          </button>
        )}
        {error && (
          <p className="ai-error" role="alert">
            {error}
          </p>
        )}
        <div className="ai-suggestion-list">
          {pending.map((s) => {
            const title = humanCommandGroupLabel(schema, s.actions);
            return (
              <div
                key={s.id}
                className={`ai-suggestion-row ${selected === s.id ? "selected" : ""}`}
              >
                <button
                  className="ai-suggestion-title"
                  title={title}
                  onClick={() => onSelect(s.id)}
                >
                  {title}
                </button>
                <div className="ai-row-actions">
                  <button
                    aria-label={"Accept " + title}
                    title="Accept"
                    disabled={working || s.status === "stale"}
                    onClick={() => onAccept(s.id)}
                  >
                    ✓
                  </button>
                  <button
                    aria-label={"Reject " + title}
                    title="Reject"
                    disabled={working}
                    onClick={() => onReject(s.id)}
                  >
                    ×
                  </button>
                </div>
                {s.status === "stale" && (
                  <span className="ai-stale">Needs another look</span>
                )}
              </div>
            );
          })}
        </div>
        {review && !pending.length && <p className="ai-empty">All reviewed.</p>}
        {review && review.suggestions.some((s) => s.status === "accepted") && (
          <p className="ai-accepted">
            {review.suggestions.filter((s) => s.status === "accepted").length}{" "}
            accepted · Commit when ready
          </p>
        )}
        {showExample && (
          <button
            className="ai-example-link"
            disabled={working}
            onClick={onSample}
          >
            Open example
          </button>
        )}
      </div>
    </aside>
  );
}
