export type FailureKind =
  | "incomplete"
  | "mapping"
  | "unsupported"
  | "typeside"
  | "binding"
  | "compiler-limit"
  | "preview-limit"
  | "data";
export type FailureInfo = {
  kind?: FailureKind;
  message: string;
  hint?: string;
  details?: string;
  precheckFailed?: boolean;
};
export class ReadableFailure extends Error {
  kind?: FailureKind;
  hint?: string;
  details?: string;
  precheckFailed?: boolean;
  constructor(info: FailureInfo) {
    super(info.message);
    this.kind = info.kind;
    this.name = "ReadableFailure";
    this.hint = info.hint;
    this.details = info.details;
    this.precheckFailed = info.precheckFailed;
  }
}
export function failureInfo(value: unknown): FailureInfo {
  const item =
    typeof value === "object" && value !== null
      ? (value as Partial<FailureInfo>)
      : undefined;
  const original =
    typeof item?.message === "string"
      ? item.message
      : typeof value === "string"
        ? value
        : "Could not complete this change.";
  const message = original.replace(/^Step \d+:\s*/, "");
  return {
    message,
    ...(item?.kind ? { kind: item.kind } : {}),
    ...(item?.precheckFailed === true ? { precheckFailed: true } : {}),
    ...(typeof item?.hint === "string" ? { hint: item.hint } : {}),
    ...(typeof item?.details === "string"
      ? { details: item.details }
      : message !== original
        ? { details: original }
        : {}),
  };
}
