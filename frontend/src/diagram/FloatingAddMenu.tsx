import { useEffect, useRef, useState } from "react";
import Icon from "../shared/Icon";
export type CanvasAction = "object" | "arrow" | "relation";
export default function FloatingAddMenu({
  disabled,
  raised,
  onAction,
}: {
  disabled: boolean;
  raised: boolean;
  onAction: (action: CanvasAction) => void;
}) {
  const [open, setOpen] = useState(false),
    root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return (
    <div ref={root} className={`floating-add ${raised ? "raised" : ""}`}>
      {open && !disabled && (
        <div
          className="floating-add-menu"
          role="menu"
          aria-label="Add to canvas"
        >
          {[
            ["object", "Object"],
            ["arrow", "Arrow"],
            ["relation", "Relation"],
          ].map(([action, label]) => (
            <button
              role="menuitem"
              key={action}
              onClick={() => {
                setOpen(false);
                onAction(action as CanvasAction);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <button
        className="floating-add-trigger"
        aria-label="Add to canvas"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <Icon name={open ? "close" : "plus"} size={22} />
      </button>
    </div>
  );
}
