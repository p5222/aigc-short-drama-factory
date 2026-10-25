import { X } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { useResponsiveDrawer } from "./useResponsiveDrawer";

interface InspectorProps {
  children: ReactNode;
  open?: boolean;
  onClose?: () => void;
  title?: string;
}

export function Inspector({ children, open = false, onClose, title = "检查器" }: InspectorProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const drawerActive = useResponsiveDrawer({
    open,
    maxWidth: 1399,
    onClose,
    panelRef,
    initialFocusRef: closeButtonRef
  });

  return (
    <aside
      className={`wb-inspector${drawerActive ? " is-open" : ""}`}
      role={drawerActive ? "dialog" : undefined}
      aria-modal={drawerActive ? true : undefined}
      aria-label={title}
    >
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
