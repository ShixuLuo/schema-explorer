import { useMemo, useRef, useState } from "react";
import type { EditSummary } from "../application/preview.ts";
import type {
  MigrationMethod,
  MigrationOption,
} from "../model/migration-options.ts";
import type { MigrationParameters as Parameters } from "../model/operations.ts";
import type { CellValue } from "../model/schema.ts";
import Icon from "../shared/Icon.tsx";
import AttributeParameters from "./AttributeParameters.tsx";
import ChangedDataPreview from "./ChangedDataPreview.tsx";
import { planSteps } from "./migration-plan.ts";
import MigrationSelector from "./MigrationSelector.tsx";
import ReferenceParameters from "./ReferenceParameters.tsx";
export default function MigrationPlan({
  summary,
  disabled,
  onMethod,
  onParameters,
  readRows,
}: {
  summary: EditSummary;
  disabled: boolean;
  onMethod: (index: number, method: MigrationMethod) => void;
  onParameters: (index: number, parameters: Parameters) => Promise<void>;
  readRows: (
    id: string,
    offset: number,
    side: "before" | "after",
  ) => Promise<CellValue[][]>;
}) {
  const [activeTab, setActiveTab] = useState<"actions" | "preview">("actions");
  const steps = useMemo(() => planSteps(summary), [summary]);
  const [configuring, setConfiguring] = useState<{
    index: number;
    option: MigrationOption;
  } | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const selectMigration = (
    step: (typeof steps)[number],
    method: MigrationMethod,
  ) => {
    const option = step.options.find((option) => option.method === method);
    if (disabled || !option?.enabled) return;
    if (option.configuration) {
      opener.current = document.activeElement as HTMLElement;
      setConfiguring({ index: step.operationIndex, option });
    } else if (method !== step.selected) onMethod(step.operationIndex, method);
  };
  const close = () => {
    setConfiguring(null);
    opener.current?.focus();
  };
  const configured = steps.find(
    (step) => step.operationIndex === configuring?.index,
  );
  return (
    <section
      className="migration-plan"
      id="migration-plan"
      aria-label="Migration plan"
    >
      <div className="details-tabs" role="tablist" aria-label="Change details">
        {(["actions", "preview"] as const).map((tab) => (
          <button
            key={tab}
            id={`details-tab-${tab}`}
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`details-panel-${tab}`}
            tabIndex={activeTab === tab ? 0 : -1}
            onClick={() => setActiveTab(tab)}
            onKeyDown={(event) => {
              if (
                ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              ) {
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? "actions"
                    : event.key === "End"
                      ? "preview"
                      : activeTab === "actions"
                        ? "preview"
                        : "actions";
                setActiveTab(next);
                document.getElementById(`details-tab-${next}`)?.focus();
              }
            }}
          >
            {tab === "actions" ? "Actions" : "Preview"}
          </button>
        ))}
      </div>
      <>
        <div
          hidden={activeTab !== "actions"}
          className="plan-actions-panel"
          id="details-panel-actions"
          role="tabpanel"
          aria-labelledby="details-tab-actions"
        >
          <table className="plan-actions-table">
            <colgroup>
              <col className="plan-action-col" />
              <col className="plan-migration-col" />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Action</th>
                <th scope="col">Migration</th>
                <th scope="col">Explain</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((step) => (
                <tr key={step.start}>
                  <td>
                    <span className="action-order">{step.index + 1}.</span>
                    <span>{step.title}</span>
                  </td>
                  <td>
                    <div className="action-migration">
                      <MigrationSelector
                        label={`Migration for action ${step.index + 1}`}
                        options={step.options}
                        selected={step.selected}
                        disabled={disabled}
                        onChange={(method) => selectMigration(step, method)}
                      />
                      {step.options.some(
                        (option) =>
                          option.enabled &&
                          option.configuration &&
                          (!step.selected || option.method === step.selected),
                      ) && (
                        <button
                          type="button"
                          className="icon-button configure-action"
                          title="Configure"
                          aria-label={`Configure action ${step.index + 1}`}
                          disabled={disabled}
                          onClick={() =>
                            selectMigration(
                              step,
                              step.options.find(
                                (option) =>
                                  option.enabled &&
                                  option.configuration &&
                                  (option.method === step.selected ||
                                    !step.selected),
                              )!.method,
                            )
                          }
                        >
                          <Icon name="edit" size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="plan-explanation">{step.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div
          hidden={activeTab !== "preview"}
          id="details-panel-preview"
          role="tabpanel"
          aria-labelledby="details-tab-preview"
        >
          {activeTab === "preview" && (
            <ChangedDataPreview summary={summary} readRows={readRows} />
          )}
        </div>
      </>
      {configured &&
        configuring?.option.configuration === "reference-path" &&
        configured.operation.op === "add_reference" && (
          <ReferenceParameters
            operation={configured.operation}
            schema={configured.schema}
            disabled={disabled}
            onApply={(path) =>
              onParameters(configured.operationIndex, {
                template: "path",
                path,
              })
            }
            onClose={close}
          />
        )}
      {configured &&
        configuring?.option.configuration === "attribute-value" &&
        (configured.operation.op === "add_attribute" ||
          configured.operation.op === "add_column") && (
          <AttributeParameters
            method={configuring.option.method}
            operation={configured.operation}
            schema={configured.schema}
            disabled={disabled}
            onApply={(parameters) =>
              onParameters(configured.operationIndex, parameters)
            }
            onClose={close}
          />
        )}
    </section>
  );
}
