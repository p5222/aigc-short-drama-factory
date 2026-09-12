import { type ReactNode } from "react";
import { X } from "lucide-react";
import { useAdminDialog } from "./useAdminDialog";

export function AdminMasterDetail({ title, meta, open, onClose, children, footer, busy = false }: { title: string; meta?: ReactNode; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode; busy?: boolean; }) {
  const { dialogRef, titleId, requestClose } = useAdminDialog(open, onClose, busy);

  if (!open) return null;
  return (
    <div className="adm-detail-layer" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) requestClose(); }}>
      <aside ref={dialogRef} tabIndex={-1} className="adm-detail" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy}>
        <header><div><h2 id={titleId}>{title}</h2>{meta}</div><button className="adm-icon-btn" type="button" aria-label="关闭详情" disabled={busy} onClick={requestClose}><X /></button></header>
        <div className="adm-detail-body">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </aside>
    </div>
  );
}
