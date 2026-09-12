import { useEffect, useId, useRef } from "react";
import { canLeaveAdminEditor } from "./adminDirtyState";
import { dialogStackForDocument } from "../design-system/dialogStack";

export function useAdminDialog(open: boolean, onClose: () => void, busy = false) {
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const options = useRef({ onClose, busy });
  options.current = { onClose, busy };
  const requestClose = () => {
    if (!options.current.busy && (!dialogRef.current || canLeaveAdminEditor(dialogRef.current))) options.current.onClose();
  };
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const controls = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])') ?? [])
      .filter((item) => !item.matches(":disabled") && !item.closest("[inert]") && item.getClientRects().length > 0);
    // Admin surfaces are nested inside the app root; the stack preserves that ancestor
    // and the React-owned inert state, while sharing scroll/focus ownership with portals.
    const lock = dialogStackForDocument(document).register({
      element: dialog,
      focusInitial: () => (controls()[0] ?? dialog).focus({ preventScroll: true }),
      onEscape: requestClose
    });
    function handleKey(event: KeyboardEvent) {
      if (!lock.isTop()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        lock.escape();
        return;
      }
      if (event.key !== "Tab") return;
      const available = controls();
      if (!available.length) { event.preventDefault(); dialog?.focus(); return; }
      const first = available[0];
      const last = available[available.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    }
    document.addEventListener("keydown", handleKey, true);
    return () => {
      document.removeEventListener("keydown", handleKey, true);
      lock.release();
    };
  }, [open]);
  return { dialogRef, titleId, requestClose };
}
