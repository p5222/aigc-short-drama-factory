import { AlertCircle, CheckCircle2, Inbox, Info, LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { dialogStackForDocument } from "./dialogStack";

export function PageHeader({ eyebrow, title, description, actions, children }: { eyebrow?: string; title: string; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return <header className="ui-page-heading"><div className="ui-page-heading-copy">{eyebrow ? <span className="ui-eyebrow">{eyebrow}</span> : null}<h1>{title}</h1>{description ? <p>{description}</p> : null}{children}</div>{actions ? <div className="ui-page-heading-actions">{actions}</div> : null}</header>;
}

export function StatePanel({ kind = "empty", title, description, action, compact = false }: { kind?: "empty" | "loading" | "error" | "success"; title: string; description?: ReactNode; action?: ReactNode; compact?: boolean }) {
  const Icon = kind === "loading" ? LoaderCircle : kind === "error" ? AlertCircle : kind === "success" ? CheckCircle2 : Inbox;
  return <div className={`ui-state ui-state--${kind}${compact ? " ui-state--compact" : ""}`} role={kind === "error" ? "alert" : kind === "loading" || kind === "success" ? "status" : undefined} aria-busy={kind === "loading" || undefined}><span className="ui-state-icon"><Icon size={24} className={kind === "loading" ? "ui-spin" : undefined} aria-hidden="true" /></span><div><strong>{title}</strong>{description ? <p>{description}</p> : null}</div>{action ? <div className="ui-state-actions">{action}</div> : null}</div>;
}

export function InlineNotice({ tone = "info", children, onDismiss }: { tone?: "info" | "success" | "warning" | "error"; children: ReactNode; onDismiss?: () => void }) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "error" || tone === "warning" ? AlertCircle : Info;
  return <div className={`ui-notice ui-notice--${tone}`} role={tone === "error" ? "alert" : "status"}><Icon size={18} aria-hidden="true" /><div>{children}</div>{onDismiss ? <button type="button" className="ui-icon-button" aria-label="关闭提示" onClick={onDismiss}><X size={16} /></button> : null}</div>;
}

/** Shared modal behavior: labeled, keyboard contained, background inert, focus restored. */
export function Dialog({ open, title, description, onClose, busy = false, children, footer, className = "" }: { open: boolean; title: string; description?: ReactNode; onClose: () => void; busy?: boolean; children: ReactNode; footer?: ReactNode; className?: string }) {
  const titleId = useId(), descriptionId = useId();
  const layer = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null);
  const latest = useRef({ onClose, busy }); latest.current = { onClose, busy };
  useEffect(() => {
    if (!open || !layer.current) return;
    const controls = () => [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') ?? [])].filter(element => !element.hidden && !element.closest("[inert]") && element.getClientRects().length > 0);
    const registration = dialogStackForDocument(document).register({
      element: layer.current,
      focusInitial: () => (panel.current?.querySelector<HTMLElement>("[data-autofocus]") ?? controls()[0] ?? panel.current)?.focus({ preventScroll: true }),
      onEscape: () => { if (!latest.current.busy) latest.current.onClose(); }
    });
    const keydown = (event: KeyboardEvent) => {
      if (!registration.isTop()) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); registration.escape(); return; }
      if (event.key !== "Tab") return;
      const focusable = controls(), first = focusable[0], last = focusable.at(-1);
      if (!first) { event.preventDefault(); panel.current?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement) || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown, true);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      registration.release();
    };
  }, [open]);
  if (!open) return null;
  return createPortal(<div ref={layer} data-ui-dialog="true" className="ui-modal-layer" onClick={event => { if (event.target === event.currentTarget && !latest.current.busy) latest.current.onClose(); }}><div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} aria-busy={busy || undefined} tabIndex={-1} className={`ui-dialog ${className}`}><header className="ui-dialog-header"><div><h2 id={titleId}>{title}</h2>{description ? <p id={descriptionId}>{description}</p> : null}</div><button type="button" className="ui-icon-button" aria-label="关闭对话框" disabled={busy} onClick={onClose}><X size={20} /></button></header><div className="ui-dialog-body">{children}</div>{footer ? <footer className="ui-dialog-footer">{footer}</footer> : null}</div></div>, document.body);
}

export function ConfirmDialog({ open, title, description, confirmLabel = "确认", danger = false, pending = false, onConfirm, onCancel }: { open: boolean; title: string; description: ReactNode; confirmLabel?: string; danger?: boolean; pending?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return <Dialog open={open} title={title} onClose={onCancel} busy={pending} footer={<><button type="button" className="ghost-button" disabled={pending} onClick={onCancel}>取消</button><button type="button" className={`primary-button${danger ? " ui-button-danger" : ""}`} disabled={pending} onClick={onConfirm}>{pending ? <LoaderCircle size={16} className="ui-spin" /> : null}{pending ? "正在处理…" : confirmLabel}</button></>}><p className="ui-confirm-description">{description}</p></Dialog>;
}
