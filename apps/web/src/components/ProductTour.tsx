import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties } from "react";
import { useRef } from "react";
import type { PageKey } from "./Shell";

export interface ProductTourStep {
  id: string;
  page: PageKey;
  targetId: string;
  title: string;
  body: string;
  placement?: "left" | "right" | "bottom" | "top";
}

interface ProductTourProps {
  activePage: PageKey;
  currentIndex: number;
  steps: ProductTourStep[];
  onNavigate: (page: PageKey) => void;
  onStepChange: (index: number) => void;
  onClose: () => void;
}

export function ProductTour({ activePage, currentIndex, steps, onNavigate, onStepChange, onClose }: ProductTourProps) {
  const step = steps[currentIndex];
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); }
      if (event.key !== "Tab") return;
      const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);

  useEffect(() => {
    if (!step) return;
    if (activePage !== step.page) onNavigate(step.page);
  }, [activePage, onNavigate, step]);

  useEffect(() => {
    if (!step) return;

    function update() {
      const target = document.querySelector(`[data-tour-id="${step.targetId}"]`);
      setTargetRect(target ? target.getBoundingClientRect() : null);
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    }

    const frame = window.requestAnimationFrame(() => {
      document.querySelector(`[data-tour-id="${step.targetId}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      update();
    });
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [activePage, step]);

  const cardStyle = useMemo<CSSProperties>(() => {
    const width = Math.min(430, Math.max(240, viewport.width - 32));
    if (!targetRect || viewport.width < 600) return { left: "50%", top: "50%", transform: "translate(-50%, -50%)", width, maxHeight: "calc(100dvh - 32px)", overflowY: "auto" };
    const gap = 22;
    const placement = step?.placement ?? "right";
    const leftByPlacement = {
      right: targetRect.right + gap,
      left: targetRect.left - width - gap,
      bottom: targetRect.left,
      top: targetRect.left
    }[placement];
    const topByPlacement = {
      right: targetRect.top,
      left: targetRect.top,
      bottom: targetRect.bottom + gap,
      top: targetRect.top - 230 - gap
    }[placement];
    const left = Math.min(Math.max(24, leftByPlacement), viewport.width - width - 24);
    const top = Math.min(Math.max(24, topByPlacement), viewport.height - 250);
    return { left, top, width, maxHeight: "calc(100dvh - 48px)", overflowY: "auto" };
  }, [step?.placement, targetRect, viewport.height, viewport.width]);

  if (!step) return null;

  const content = (
    <div className="product-tour-layer" ref={dialogRef} role="dialog" aria-modal="true" aria-label="新手引导">
      {targetRect ? (
        <div
          className="product-tour-target"
          style={{
            left: targetRect.left - 8,
            top: targetRect.top - 8,
            width: targetRect.width + 16,
            height: targetRect.height + 16
          }}
        />
      ) : <div className="product-tour-dim" />}
      <article className="product-tour-card" style={cardStyle}>
        <strong>{step.title}</strong>
        <p>{step.body}</p>
        <span aria-live="polite">第 {currentIndex + 1} / {steps.length} 步</span>
        <div className="product-tour-actions">
          <button className="ghost-button" onClick={onClose} type="button">稍后再看</button>
          <div>
            <button className="ghost-button" onClick={() => onStepChange(Math.max(0, currentIndex - 1))} disabled={currentIndex === 0} type="button">上一步</button>
            <button className="primary-button" onClick={() => currentIndex + 1 >= steps.length ? onClose() : onStepChange(currentIndex + 1)} type="button">
              {currentIndex + 1 >= steps.length ? "完成" : "下一步"}
            </button>
          </div>
        </div>
      </article>
    </div>
  );

  return createPortal(content, document.body);
}
