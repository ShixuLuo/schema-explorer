import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { tutorialChapters, type TutorialContext as Context } from "../tutorial/lessons.ts";
import { placePopover, type Box } from "../shared/floating-placement.ts";

type Rect = Box & { fallback?: boolean; popoverLeft?: number; popoverTop?: number };
export default function Tutorial(
  props: Context & {
    onExit: () => void;
    onRestart: () => void;
    onExplore: () => void;
    onHome: () => void;
  },
) {
  const [chapter, setChapter] = useState(0);
  const [position, setPosition] = useState<number | string>(0);
  const steps = tutorialChapters[chapter].steps;
  // Numeric state from an already-open guide survives this upgrade; future moves use stable IDs.
  const index = typeof position === "number" ? Math.min(position, steps.length - 1) : Math.max(0, steps.findIndex(item => item.id === position));
  const advance = () => {
    if (index < steps.length - 1) setPosition(steps[index + 1].id);
    else if (chapter < tutorialChapters.length - 1) { setChapter(chapter + 1); setPosition(tutorialChapters[chapter + 1].steps[0].id); }
  };
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
      {
        const height = element.getBoundingClientRect().height;
        setPopoverHeight(height);
      },
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
    if (step.ready?.(props)) advance();
  }, [
    step,
    props.draft,
    props.editing,
    props.busy,
    props.migrationOpen,
    props.migrationStage,
  ]);
  useEffect(() => {
    let sawRequiredElement = false;
    const targets = () => [...document.querySelectorAll<HTMLElement>(step.target)].filter(element =>
      element.getBoundingClientRect().width > 0 && (!step.targetText || element.textContent?.trim() === step.targetText));
    const measure = () => {
      if (step.complete?.every(rule => {
        const elements = document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(rule.selector);
        if (rule.minCount !== undefined && elements.length < rule.minCount) return false;
        const element = rule.textIncludes === undefined ? elements[0] : [...elements].find(item => item.textContent?.includes(rule.textIncludes!));
        if (rule.absent) return !element;
        if (!element) return false;
        if (rule.value !== undefined && element.value !== rule.value) return false;
        if (rule.selectedText !== undefined && (!(element instanceof HTMLSelectElement) || element.selectedOptions[0]?.textContent?.trim() !== rule.selectedText)) return false;
        return true;
      })) { advance(); return; }
      if (step.disappeared) {
        const present = !!document.querySelector(step.disappeared);
        if (present) sawRequiredElement = true;
        else if (sawRequiredElement) { advance(); return; }
      }
      if (step.appeared && document.querySelector(step.appeared)) { advance(); return; }
      const matches = targets();
      const target = matches[0];
      if (!target) {
        setRect(undefined);
        return;
      }
      const fallback = !!step.fallback && !!document.querySelector(step.fallback.selector);
      const bounds = matches.map((element) => element.getBoundingClientRect());
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
      const targetRect = {left:Math.max(0,r.left-5),top:Math.max(0,r.top-5),width:r.width+10,height:r.height+10};
      const dialog = target.closest<HTMLElement>('[role="dialog"][aria-modal="true"]');
      const scope = dialog ?? document;
      // Closed details can retain nonzero layout boxes without rendering their contents.
      const obstacles = [...scope.querySelectorAll<HTMLElement>("button, a, input, select, textarea, label, summary, h2, h3, h4, .migration-heading, .configure-match-row, .react-flow__node, .category-edge-label, .data-panel, .history-node-menu, .relation-composer, .arrow-creator, .object-creator, .migration-ai-panel, .ai-experiment-panel")]
        .filter(element=>!element.closest(".tutorial-layer") && element.checkVisibility({checkVisibilityCSS:true,checkOpacity:true}))
        .map(element=>{
          if(element.matches("h2, h3, h4")) {
            const text=document.createRange();text.selectNodeContents(element);
            return text.getBoundingClientRect();
          }
          return element.getBoundingClientRect();
        }).filter(item=>item.width>0&&item.height>0&&item.bottom>0&&item.top<window.innerHeight);
      const placement = placePopover(targetRect,
        { width: Math.min(300,window.innerWidth-24), height: popover.current?.getBoundingClientRect().height || 240 },
        { width: window.innerWidth, height: window.innerHeight }, obstacles,
        !dialog && targetRect.width * targetRect.height < window.innerWidth * window.innerHeight * 0.55);
      const next = {...targetRect,fallback,popoverLeft:placement.left,popoverTop:placement.top};
      setRect(old=>JSON.stringify(old)===JSON.stringify(next)?old:next);
    };
    measure();
    const timer = window.setInterval(measure, 100);
    const click = (event: MouseEvent) => {
      if (!step.click) return;
      if (targets().some(target => target.contains(event.target as Node)))
        window.setTimeout(
          () => advance(),
          0,
        );
    };
    document.addEventListener("click", click, true);
    return () => {
      clearInterval(timer);
      document.removeEventListener("click", click, true);
    };
  }, [step]);
  const body = step.fallback && rect?.fallback ? step.fallback.body : step.body;
  return createPortal(
    <div className="tutorial-layer" aria-label="Tutorial guide">
      {step.presentation === "workspace" ? (
        <div className="tutorial-shade" style={{ inset: 0, background: "rgba(16, 21, 27, 0.08)", pointerEvents: "none" }} />
      ) : rect ? (
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
          <div className="tutorial-spotlight" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />
        </>
      ) : (
        <div className="tutorial-shade" style={{ inset: 0 }} />
      )}
      <section
        ref={popover}
        className="tutorial-popover"
        style={{ left: rect?.popoverLeft ?? 16, top: rect?.popoverTop ?? Math.max(12, (viewport.height - popoverHeight) / 2), width: Math.min(300,viewport.width-24) }}
        aria-live="polite"
      >
        <div className="tutorial-caption">
          {tutorialChapters[chapter].title} · {index + 1} / {steps.length}
        </div>
        <nav className="tutorial-chapters" aria-label="Tutorial chapters">
          {tutorialChapters.map((item, position) => <button key={item.id} aria-current={position === chapter ? "step" : undefined} disabled={props.busy} onClick={() => { setChapter(position); setPosition(tutorialChapters[position].steps[0].id); }}>{position + 1}. {item.title}</button>)}
        </nav>
        <h2>{step.title}</h2>
        <p>
          {rect
            ? body
                .split(/(\*\*.*?\*\*)/g)
                .map((part, index) =>
                  part.startsWith("**") ? (
                    <strong key={index}>{part.slice(2, -2)}</strong>
                  ) : (
                    part
                  ),
                )
            : props.busy
              ? "Preparing…"
              : body}
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
              {(step.next || (!rect && !step.complete)) && (
                <button
                  className="button primary"
                  onClick={advance}
                >
                  {step.next || "Continue"}
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
    </div>,
    document.body,
  );
}
