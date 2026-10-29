import {
  qualifiedArrowLabel,
  type Presentation,
  type Path,
} from "../model/presentation.ts";
export default function PathPicker({
  label,
  presentation,
  value,
  onChange,
}: {
  label: string;
  presentation: Presentation;
  value: Path;
  onChange: (path: Path) => void;
}) {
  let current = value.source;
  const selectors = value.arrows.map((id, index) => {
    const from = current,
      arrow = presentation.arrows.find((a) => a.id === id);
    if (arrow) current = arrow.target;
    return (
      <select
        aria-label={`${label} arrow ${index + 1}`}
        key={index}
        value={id}
        onChange={(e) =>
          onChange({
            source: value.source,
            arrows: [
              ...value.arrows.slice(0, index),
              ...(e.target.value ? [e.target.value] : []),
            ],
          })
        }
      >
        <option value="">End path</option>
        {presentation.arrows
          .filter((a) => a.source === from)
          .map((a) => (
            <option key={a.id} value={a.id}>
              {qualifiedArrowLabel(presentation, a.id)} →{" "}
              {presentation.objects.find((o) => o.id === a.target)?.label}
            </option>
          ))}
      </select>
    );
  });
  const next = presentation.arrows
    .filter((a) => a.source === current)
    .sort(
      (a, b) =>
        Number(
          presentation.objects.find((o) => o.id === a.target)?.kind === "type",
        ) -
        Number(
          presentation.objects.find((o) => o.id === b.target)?.kind === "type",
        ),
    );
  return (
    <div className="path-picker">
      <span>{label}</span>
      <div>
        <code>
          {presentation.objects.find((o) => o.id === value.source)?.label}
        </code>
        {selectors}
        {!!next.length && (
          <select
            aria-label={`${label} next arrow`}
            value=""
            onChange={(e) => {
              if (e.target.value)
                onChange({
                  source: value.source,
                  arrows: [...value.arrows, e.target.value],
                });
            }}
          >
            <option value="">Extend path…</option>
            {next.map((a) => (
              <option key={a.id} value={a.id}>
                {qualifiedArrowLabel(presentation, a.id)} →{" "}
                {presentation.objects.find((o) => o.id === a.target)?.label}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
