import { useEffect, useId, useRef } from "react";
import { lockAdminDocumentScroll } from "./adminDialogScroll";

export function useAdminDialog(open: boolean, onClose: () => void, busy = false) {
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const options = useRef({ onClose, busy });
  options.current = { onClose, busy };
  useEffect(() => {
    if (!open) return;
    const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const releaseScroll = lockAdminDocumentScroll(document);
    const dialog = dialogRef.current;
    const controls = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])') ?? [])
      .filter((item) => !item.matches(":disabled") && item.getClientRects().length > 0);
    (controls()[0] ?? dialog)?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!options.current.busy) options.current.onClose();
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
      releaseScroll();
      if (priorFocus?.isConnected) priorFocus.focus({ preventScroll: true });
    };
  }, [open]);
  return { dialogRef, titleId };
}
