import { failureInfo } from "../model/failure.ts";
export default function FailureNotice({ error }: { error: unknown }) {
  const info = failureInfo(error);
  return (
    <div className="failure-notice" role="alert">
      <p className="failure-message">{info.message}</p>
      {info.hint && <p className="failure-hint">{info.hint}</p>}
      {info.details && (
        <details>
          <summary>Technical details</summary>
          <pre>{info.details}</pre>
        </details>
      )}
    </div>
  );
}
