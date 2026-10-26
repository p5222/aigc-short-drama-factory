import { useEffect, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useAdminDialog } from "./useAdminDialog";

const CONFIRM_EVENT = "manjiao:admin-confirm";
type Confirmation = { message: string; title: string; confirmLabel: string; danger: boolean; resolve: (value: boolean) => void };
type Options = Partial<Pick<Confirmation, "title" | "confirmLabel" | "danger">>;
let mounted = false;

export function confirmAdminAction(message: string, options: Options = {}): Promise<boolean> {
  if (!mounted) return Promise.resolve(false);
  return new Promise(resolve => {
    window.dispatchEvent(new CustomEvent<Confirmation>(CONFIRM_EVENT, { detail: {
      message, title: options.title ?? "确认操作", confirmLabel: options.confirmLabel ?? "确认",
      danger: options.danger ?? /删除|停用|清理|放弃|回收站/.test(message), resolve
    } }));
  });
}

export function AdminConfirmHost() {
  const [request, setRequest] = useState<Confirmation | null>(null);
  const active = useRef<Confirmation | null>(null);
  const finish = (value: boolean) => {
    const current = active.current;
    active.current = null;
    setRequest(null);
    // Let the dialog release inert/focus before the caller navigates or opens another.
    window.setTimeout(() => current?.resolve(value), 0);
  };
  const { dialogRef, titleId, requestClose } = useAdminDialog(Boolean(request), () => finish(false));
  useEffect(() => {
    mounted = true;
    const listener = (event: Event) => {
      const next = (event as CustomEvent<Confirmation>).detail;
      if (active.current) { next.resolve(false); return; }
      active.current = next;
      setRequest(next);
    };
    window.addEventListener(CONFIRM_EVENT, listener);
    return () => { mounted = false; window.removeEventListener(CONFIRM_EVENT, listener); active.current?.resolve(false); active.current = null; };
  }, []);
  if (!request) return null;
  return <div className="admin-confirm-backdrop">
    <section ref={dialogRef} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={`${titleId}-message`} className="admin-confirm">
      <header><span className={`admin-confirm-icon${request.danger ? " danger" : ""}`}><AlertTriangle size={24} /></span><button type="button" className="admin-icon-btn" aria-label="关闭确认" onClick={requestClose}><X size={20} /></button></header>
      <h2 id={titleId}>{request.title}</h2><p id={`${titleId}-message`}>{request.message}</p>
      <footer><button type="button" className="admin-secondary-btn" onClick={() => finish(false)}>取消</button><button type="button" className={request.danger ? "admin-danger-btn" : "admin-primary-btn"} onClick={() => finish(true)}>{request.confirmLabel}</button></footer>
    </section>
  </div>;
}
