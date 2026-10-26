import { useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { useAdminDialog } from "./useAdminDialog";
import { AdminDialogFooterProvider } from "./AdminDialog";

export function AdminMasterDetail({ title, meta, open, onClose, children, footer, busy = false }: { title: string; meta?: ReactNode; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode; busy?: boolean; }) {
  const { dialogRef, titleId, requestClose } = useAdminDialog(open, onClose, busy);
  const [actions, setActions] = useState<HTMLDivElement | null>(null);

  if (!open) return null;
  return (
    <div className="adm-detail-layer">
      <aside ref={dialogRef} tabIndex={-1} className="adm-detail" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy}>
        <header><div><h2 id={titleId}>{title}</h2>{meta}</div><button className="adm-icon-btn" type="button" aria-label="关闭详情" disabled={busy} onClick={requestClose}><X /></button></header>
        <AdminDialogFooterProvider value={actions}><div className="adm-detail-body">{children}</div></AdminDialogFooterProvider>
        <footer>{footer ?? <button type="button" className="admin-secondary-btn" disabled={busy} onClick={requestClose}>关闭详情</button>}<div className="admin-detail-actions" ref={setActions} /></footer>
      </aside>
    </div>
  );
}
