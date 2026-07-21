import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

interface InspectorProps {
  children: ReactNode;
  open?: boolean;
  onClose?: () => void;
  title?: string;
}

export function Inspector({ children, open = false, onClose, title = "检查器" }: InspectorProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus();
    };
  }, [open]);

  return (
    <aside className={`wb-inspector${open ? " is-open" : ""}`} aria-label={title}>
      {onClose ? <button className="wb-drawer-scrim" type="button" aria-label={`关闭${title}`} onClick={onClose} /> : null}
      <div ref={panelRef} className="wb-drawer-panel">
        {onClose ? (
          <div className="wb-drawer-heading">
            <strong>{title}</strong>
            <button ref={closeButtonRef} className="wb-icon-button" type="button" aria-label={`关闭${title}`} onClick={onClose}>
              <X aria-hidden="true" />
            </button>
          </div>
        ) : null}
        <div className="wb-region-scroll">{children}</div>
      </div>
    </aside>
  );
}
