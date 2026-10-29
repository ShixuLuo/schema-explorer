import {
  MIGRATION_SYMBOLS,
  type MigrationMethod,
  type MigrationOption,
} from "../model/migration-options.ts";
export default function MigrationSelector({
  label,
  options,
  selected,
  disabled,
  onChange,
}: {
  label: string;
  options: MigrationOption[];
  selected?: MigrationMethod;
  disabled: boolean;
  onChange: (method: MigrationMethod) => void;
}) {
  const enabled = options.filter((option) => option.enabled),
    tabStop = selected ?? enabled[0]?.method;
  return (
    <div className="migration-segments" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={option.method}
          data-method={option.method}
          role="radio"
          aria-label={MIGRATION_SYMBOLS[option.method]}
          aria-checked={selected === option.method}
          tabIndex={option.method === tabStop ? 0 : -1}
          disabled={disabled || !option.enabled}
          title={option.reason}
          onClick={() => {
            onChange(option.method);
          }}
          onKeyDown={(event) => {
            if (
              ![
                "ArrowLeft",
                "ArrowRight",
                "ArrowUp",
                "ArrowDown",
                "Home",
                "End",
              ].includes(event.key)
            )
              return;
            event.preventDefault();
            const at = enabled.findIndex((o) => o.method === option.method),
              direction =
                event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
            const next =
              enabled[
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? enabled.length - 1
                    : (at + direction + enabled.length) % enabled.length
              ];
            if (next) {
              event.currentTarget.parentElement
                ?.querySelector<HTMLButtonElement>(
                  `[data-method="${next.method}"]`,
                )
                ?.focus();
              if (next.method !== selected) onChange(next.method);
            }
          }}
        >
          {MIGRATION_SYMBOLS[option.method]}
        </button>
      ))}
    </div>
  );
}
