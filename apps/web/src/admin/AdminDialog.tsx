import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useAdminDialog } from "./useAdminDialog";

const FooterContext = createContext<HTMLElement | null>(null);
export const AdminDialogFooterProvider = FooterContext.Provider;

/** Sub2API modal proportions, with the application's shared focus and draft guard. */
export function AdminDialog({ open, title, description, onClose, busy = false, wide = false, children, notice, trackChanges = false, closeLabel = "关闭弹窗", cancelLabel = "取消" }: {
  open: boolean; title: string; description?: ReactNode; onClose: () => void; busy?: boolean;
  wide?: boolean; children: ReactNode; notice?: ReactNode; closeLabel?: string; cancelLabel?: string; trackChanges?: boolean;
}) {
  const { dialogRef, titleId, requestClose } = useAdminDialog(open, onClose, busy);
  const descriptionId = useId();
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  if (!open) return null;
  return <div className="admin-modal-backdrop" role="presentation">
    <section ref={dialogRef} tabIndex={-1} className={`admin-modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} aria-busy={busy}>
      <header className="admin-modal-head">
        <div><h2 id={titleId}>{title}</h2>{description ? <p id={descriptionId}>{description}</p> : null}</div>
        <button className="admin-icon-btn" type="button" disabled={busy} onClick={requestClose} aria-label={closeLabel}><X size={20} /></button>
      </header>
      <FooterContext.Provider value={footer}>
        <div className="admin-modal-body" onChangeCapture={event => { if (trackChanges && (event.target as HTMLElement).matches("input,select,textarea")) event.currentTarget.dataset.adminDirty = "true"; }}>{notice}{children}</div>
      </FooterContext.Provider>
      <footer className="admin-modal-footer"><button className="admin-secondary-btn" type="button" disabled={busy} onClick={requestClose}>{cancelLabel}</button><div ref={setFooter} /></footer>
    </section>
  </div>;
}

/** React portals keep handlers/context while the form attribute preserves native validation. */
export function AdminDialogActions({ children }: { children: ReactNode }) {
  const footer = useContext(FooterContext);
  return footer ? createPortal(children, footer) : null;
}
