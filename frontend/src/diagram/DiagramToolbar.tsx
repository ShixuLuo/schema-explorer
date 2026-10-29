import type { ReactNode } from "react";
import type { DiagramMode } from "./view-types.ts";
export default function DiagramToolbar({
  children,
  mode,
  onMode,
  busy,
}: {
  children: ReactNode;
  mode: DiagramMode;
  onMode: (mode: DiagramMode) => void;
  busy: boolean;
}) {
  return (
    <header className="diagram-toolbar">
      {children}
      <div className="view-switch" role="group" aria-label="Diagram view">
        <button
          aria-pressed={mode === "category"}
          disabled={busy}
          onClick={() => onMode("category")}
        >
          Category
        </button>
        <button
          aria-pressed={mode === "tables"}
          disabled={busy}
          onClick={() => onMode("tables")}
        >
          Tables
        </button>
      </div>
    </header>
  );
}
