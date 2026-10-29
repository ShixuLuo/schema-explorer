import type { ReactNode } from "react";
import type {
  ComparisonMode,
  ModelComparison,
  ViewTable,
} from "../model/comparison.ts";
import type { Operation } from "../model/operations.ts";
import type { UseCase } from "../model/workspace.ts";
export type DiagramMode = "category" | "tables";
export type DiagramProps = {
  useCase: UseCase;
  tables: ViewTable[];
  comparison?: ModelComparison | null;
  comparisonMode?: ComparisonMode;
  busy: string;
  disabled: boolean;
  fitNewData: boolean;
  focusArrowId?: string;
  focusObjectId?: string;
  focusEquationId?: string;
  canvasAction?: { kind: "object" | "arrow" | "relation"; id: number };
  onCanvasEditing: (value: boolean) => void;
  onCanvasActionConsumed?: () => void;
  toolbar: ReactNode;
  footer: ReactNode;
  mode: DiagramMode;
  onMode: (mode: DiagramMode) => void;
  onLayout: (
    patch: Pick<Partial<UseCase>, "positions" | "viewport">,
  ) => Promise<void>;
  onOperations: (operations: Operation[], label?: string) => Promise<void>;
  onPreview: (id: string) => void;
  onCreateTable: () => void;
};
