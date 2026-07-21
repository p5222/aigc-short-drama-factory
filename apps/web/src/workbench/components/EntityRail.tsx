import { X } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { useResponsiveDrawer } from "./useResponsiveDrawer";

interface EntityRailProps {
  children: ReactNode;
  open?: boolean;
  onClose?: () => void;
  title?: string;
}

export function EntityRail({ children, open = false, onClose, title = "对象列表" }: EntityRailProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const drawerActive = useResponsiveDrawer({
    open,
    maxWidth: 979,
    onClose,
    panelRef,
    initialFocusRef: closeButtonRef
  });

  return (
    <aside
      className={`wb-entity-rail${drawerActive ? " is-open" : ""}`}
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
