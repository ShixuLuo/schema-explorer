import { useEffect, useRef, useState, type MouseEvent } from "react";
export default function InlineLabel({
  label,
  name,
  disabled,
  onSelect,
  onRename,
  editRequest = 0,
}: {
  label: string;
  name: string;
  disabled?: boolean;
  onSelect: (event: MouseEvent<HTMLButtonElement>) => void;
  onRename?: (label: string) => Promise<void>;
  editRequest?: number;
}) {
  const [editing, setEditing] = useState(false),
    [value, setValue] = useState(label),
    [error, setError] = useState("");
  const submitting = useRef(false),
    input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  useEffect(() => {
    if (editRequest && !disabled && onRename) {
      setValue(label);
      setError("");
      setEditing(true);
    }
  }, [editRequest]);
  const commit = async () => {
    if (submitting.current || !editing) return;
    const next = value.trim();
    if (!next) {
      setError("Enter a name.");
      return;
    }
    if (next === label) {
      setEditing(false);
      return;
    }
    submitting.current = true;
    try {
      await onRename?.(next);
      setEditing(false);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submitting.current = false;
    }
  };
  return editing ? (
    <span className="inline-name-editor nodrag nopan">
      <input
        ref={input}
        aria-label={`Rename ${name}`}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          }
          if (e.key === "Escape") {
            setEditing(false);
            setError("");
          }
        }}
      />
      {error && (
        <span className="graph-inline-error" role="alert">
          {error}
        </span>
      )}
    </span>
  ) : (
    <button
      className="graph-label nodrag nopan"
      aria-label={`Select ${name}`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(event);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!disabled && onRename) {
          setValue(label);
          setError("");
          setEditing(true);
        }
      }}
      title={onRename ? "Double-click to rename" : undefined}
    >
      {label}
    </button>
  );
}
