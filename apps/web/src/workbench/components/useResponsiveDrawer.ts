import { useEffect, useRef, useState, type RefObject } from "react";
import { dialogStackForDocument } from "../../design-system/dialogStack";

interface ResponsiveDrawerOptions {
  open: boolean;
  maxWidth: number;
  onClose?: () => void;
  panelRef: RefObject<HTMLElement | null>;
  initialFocusRef: RefObject<HTMLElement | null>;
}

const focusableSelector = [
  "button:not([disabled])",
  "summary",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(", ");

function isActuallyFocusable(element: HTMLElement) {
  if (element.matches(":disabled") || element.tabIndex < 0) return false;
  if (element.closest("[hidden], [inert], [aria-hidden='true']")) return false;
  const collapsedDetails = element.closest("details:not([open])");
  if (collapsedDetails) {
    const summary = Array.from(collapsedDetails.children).find((child) => child.tagName === "SUMMARY");
    if (!summary?.contains(element)) return false;
  }
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
}

function getFocusableElements(panel: HTMLElement | null) {
  if (!panel) return [];
  return Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector)).filter(isActuallyFocusable);
}

export function useResponsiveDrawer({
  open,
  maxWidth,
  onClose,
  panelRef,
  initialFocusRef
}: ResponsiveDrawerOptions) {
  const query = `(max-width: ${maxWidth}px)`;
  const [drawerMode, setDrawerMode] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const media = window.matchMedia(query);
    setDrawerMode(media.matches);
    const handleChange = (event: MediaQueryListEvent) => {
      setDrawerMode(event.matches);
      if (!event.matches && open) onCloseRef.current?.();
    };
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [open, query]);

  const drawerActive = open && drawerMode;

  useEffect(() => {
    if (!drawerActive || !panelRef.current) return;
    const lock = dialogStackForDocument(document).register({
      element: panelRef.current,
      focusInitial: () => (initialFocusRef.current ?? getFocusableElements(panelRef.current)[0] ?? panelRef.current)?.focus({ preventScroll: true }),
      onEscape: () => onCloseRef.current?.()
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!lock.isTop()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        lock.escape();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusableElements(panelRef.current);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === first || !panelRef.current?.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !panelRef.current?.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      lock.release();
    };
  }, [drawerActive, initialFocusRef, panelRef]);

  return drawerActive;
}
