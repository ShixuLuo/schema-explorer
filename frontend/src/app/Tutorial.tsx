import { useEffect, useRef, useState } from "react";

type Context = {
  draft: boolean;
  configured: boolean;
  editing: boolean;
  busy: boolean;
  committed: boolean;
  showHistory: boolean;
  showSql: boolean;
};
type Step = {
  id: string;
  title: string;
  body: string;
  target: string;
  click?: boolean;
  next?: boolean;
  ready?: (context: Context) => boolean;
};
// Targets refer to the existing editor controls. No tutorial action mutates the model.
const steps: Step[] = [
  {
    id: "object",
    title: "Objects",
    body: "An object represents a table. Click Customer to continue.",
    target: '[aria-label="Select entity Customer"]',
    click: true,
  },
  {
    id: "attribute",
    title: "Attributes",
    body: "The name arrow assigns a Text value to each Customer. Click name to continue.",
    target: '[aria-label="Select arrow Customer.name"]',
    click: true,
  },
  {
    id: "foreign-key",
    title: "Foreign keys",
    body: "Each Order points to a Customer. Click the customer arrow to continue.",
    target: '[aria-label="Select arrow Order.customer"]',
    click: true,
  },
  {
    id: "add",
    title: "Create an object",
    body: "Click + to open the canvas menu.",
    target: ".floating-add-trigger",
    click: true,
  },
  {
    id: "object-menu",
    title: "Choose Object",
    body: "Click Object to open the creation form.",
    target: '.floating-add-menu [role="menuitem"]',
    click: true,
  },
  {
    id: "create",
    title: "Create Shipment",
    body: "Enter Shipment as the name, then click Create. Keep the default Integer primary key.",
    target: ".object-creator",
    ready: (c) => c.draft && !c.editing && !c.busy,
  },
  {
    id: "migration",
    title: "Choose a migration",
    body: "Choose Σ to create an empty Shipment object. This resolves the existing draft action before Commit.",
    target: '[data-method="sigma"]',
    ready: (c) => c.configured && !c.busy,
  },
  {
    id: "commit",
    title: "Commit",
    body: "Review the draft, then Commit to save a checkpoint.",
    target: ".commit-control .button.primary",
    ready: (c) => c.committed && !c.busy,
  },
  {
    id: "history",
    title: "History",
    body: "Open History to see the sample and your new checkpoint.",
    target: '[aria-label="Open history"]',
    ready: (c) => c.showHistory,
  },
  {
    id: "history-graph",
    title: "A new checkpoint",
    body: "The sample is the parent of Add object Shipment. Follow their connecting line, then click Next. Both checkpoints are retained.",
    target: ".history-event",
    next: true,
  },
  {
    id: "history-current",
    title: "Editing is your position",
    body: "Editing marks the checkpoint shown in the editor. Click this checkpoint to inspect its details.",
    target: '[data-tutorial="editing-checkpoint"]',
    click: true,
  },
  {
    id: "history-details",
    title: "Checkpoint details",
    body: "This checkpoint records your create operation and its parent. Review these details, then click Next. Continue from here would restore it; leave that unchanged.",
    target: '[data-tutorial="checkpoint-details"]',
    next: true,
  },
  {
    id: "history-close",
    title: "Checkpoints",
    body: "Editing marks the current checkpoint. Close History to continue.",
    target: '[aria-label="Close history"]',
    ready: (c) => !c.showHistory,
  },
  {
    id: "sql",
    title: "Migrate / Export SQL",
    body: "Open Export SQL to review the recorded migration.",
    target: '[data-tutorial="export-sql"]',
    ready: (c) => c.showSql,
  },
  {
    id: "done",
    title: "Ready to explore",
    body: "You have created and committed a model, inspected its history, and generated SQL. Keep exploring this sample or return home.",
    target: ".migration-dialog",
  },
];
type Rect = { left: number; top: number; width: number; height: number };
export default function Tutorial(
  props: Context & {
    onExit: () => void;
    onRestart: () => void;
    onExplore: () => void;
    onHome: () => void;
  },
) {
  const [index, setIndex] = useState(0);
  const popover = useRef<HTMLElement>(null);
  const [popoverHeight, setPopoverHeight] = useState(0);
  const [viewport, setViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  useEffect(() => {
    const element = popover.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setPopoverHeight(element.getBoundingClientRect().height),
    );
    observer.observe(element);
    const resize = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);
  const [rect, setRect] = useState<Rect>();
  const step = steps[index];
  useEffect(() => {
    if (step.ready?.(props)) setIndex((i) => Math.min(i + 1, steps.length - 1));
  }, [
    step,
    props.draft,
    props.configured,
    props.editing,
    props.busy,
    props.committed,
    props.showHistory,
    props.showSql,
  ]);
  useEffect(() => {
    const measure = () => {
      const target = document.querySelector<HTMLElement>(step.target);
      if (!target) {
        setRect(undefined);
        return;
      }
      const bounds = [
        ...document.querySelectorAll<HTMLElement>(step.target),
      ].map((element) => element.getBoundingClientRect());
      const r = {
        left: Math.min(...bounds.map((item) => item.left)),
        top: Math.min(...bounds.map((item) => item.top)),
        right: Math.max(...bounds.map((item) => item.right)),
        bottom: Math.max(...bounds.map((item) => item.bottom)),
        width: 0,
        height: 0,
      };
      r.width = r.right - r.left;
      r.height = r.bottom - r.top;
      setRect((old) =>
        old &&
        Math.abs(old.left - r.left + 5) < 1 &&
        Math.abs(old.top - r.top + 5) < 1 &&
        old.width === r.width + 10 &&
        old.height === r.height + 10
          ? old
          : {
              left: Math.max(0, r.left - 5),
              top: Math.max(0, r.top - 5),
              width: r.width + 10,
              height: r.height + 10,
            },
      );
    };
    measure();
    const timer = window.setInterval(measure, 100);
    const click = (event: MouseEvent) => {
      if (!step.click) return;
      const target = document.querySelector(step.target);
      if (target?.contains(event.target as Node))
        window.setTimeout(
          () => setIndex((i) => Math.min(i + 1, steps.length - 1)),
          0,
        );
    };
    document.addEventListener("click", click, true);
    return () => {
      clearInterval(timer);
      document.removeEventListener("click", click, true);
    };
  }, [step]);
  const width = Math.min(280, viewport.width - 24),
    height = popoverHeight,
    gap = 18;
  let left = 20,
    top = 85;
  if (rect) {
    if (rect.left + rect.width + gap + width < viewport.width) {
      left = rect.left + rect.width + gap;
      top = rect.top;
    } else if (rect.left > width + gap) {
      left = rect.left - width - gap;
      top = rect.top;
    } else {
      left = Math.max(12, rect.left);
      top = rect.top + rect.height + gap;
    }
    top = Math.max(12, Math.min(top, viewport.height - height - 12));
    left = Math.min(left, viewport.width - width - 12);
  }
  return (
    <div className="tutorial-layer" aria-label="Tutorial guide">
      {rect ? (
        <>
          <div
            className="tutorial-shade"
            style={{ inset: "0 0 auto 0", height: rect.top }}
          />
          <div
            className="tutorial-shade"
            style={{
              left: 0,
              top: rect.top,
              width: rect.left,
              height: rect.height,
            }}
          />
          <div
            className="tutorial-shade"
            style={{
              left: rect.left + rect.width,
              right: 0,
              top: rect.top,
              height: rect.height,
            }}
          />
          <div
            className="tutorial-shade"
            style={{ inset: `${rect.top + rect.height}px 0 0 0` }}
          />
          <div className="tutorial-spotlight" style={rect} />
        </>
      ) : (
        <div className="tutorial-shade" style={{ inset: 0 }} />
      )}
      <section
        ref={popover}
        className="tutorial-popover"
        style={{ left, top, width }}
        aria-live="polite"
      >
        <div className="tutorial-caption">
          Tutorial · {index + 1} / {steps.length}
        </div>
        <h2>{step.title}</h2>
        <p>
          {rect
            ? step.body
                .split(/\b(click)\b/gi)
                .map((part, index) =>
                  part.toLowerCase() === "click" ? (
                    <strong key={index}>{part}</strong>
                  ) : (
                    part
                  ),
                )
            : props.busy
              ? "Preparing…"
              : "Waiting for the editor…"}
        </p>
        <div className="tutorial-actions">
          {step.id === "done" ? (
            <>
              <button className="button primary" onClick={props.onExplore}>
                Keep exploring
              </button>
              <button className="button" onClick={props.onHome}>
                Back to home
              </button>
            </>
          ) : (
            <>
              {step.next && (
                <button
                  className="button primary"
                  onClick={() => setIndex((i) => i + 1)}
                >
                  Next
                </button>
              )}
              <button
                className="button tutorial-secondary"
                onClick={props.onExit}
                disabled={props.busy}
              >
                Exit
              </button>
              <button
                className="button tutorial-secondary"
                onClick={props.onRestart}
                disabled={props.busy}
              >
                Restart
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
