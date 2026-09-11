import { useEffect, useRef, useState, type ReactNode } from "react";
import { Menu, SunMoon, X } from "lucide-react";

export interface AdminNavItem { id: string; label: string; icon?: ReactNode; badge?: string | number; }
export function AdminShell({ title, description, items, activeId, onNavigate, onThemeToggle, mobileOpen, onMobileOpenChange, children, actions }: { title: string; description?: string; items: AdminNavItem[]; activeId: string; onNavigate: (id: string) => void; onThemeToggle?: () => void; mobileOpen?: boolean; onMobileOpenChange?: (open: boolean) => void; children: ReactNode; actions?: ReactNode; }) {
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 820px)").matches);
  const sidebar = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeMenu = useRef(onMobileOpenChange);
  closeMenu.current = onMobileOpenChange;
  useEffect(() => {
    const media = window.matchMedia("(max-width: 820px)");
    const update = () => setCompact(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!compact || !mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sidebar.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeMenu.current?.(false); }
      if (event.key !== "Tab") return;
      const buttons = [...(sidebar.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", trapFocus);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", trapFocus); trigger.current?.focus(); };
  }, [compact, mobileOpen]);
  return <div className="adm-shell">
    <aside ref={sidebar} className={`adm-sidebar${mobileOpen ? " is-open" : ""}`} inert={compact && !mobileOpen} aria-hidden={compact && !mobileOpen ? true : undefined} role={compact && mobileOpen ? "dialog" : undefined} aria-modal={compact && mobileOpen ? true : undefined} aria-label={compact ? "后台导航" : undefined}><div className="adm-brand"><span>漫角</span><small>运营控制台</small><button type="button" aria-label="关闭导航" onClick={() => onMobileOpenChange?.(false)}><X /></button></div><nav aria-label="后台模块">{items.map((item) => <button type="button" key={item.id} className={item.id === activeId ? "is-active" : ""} aria-current={item.id === activeId ? "page" : undefined} onClick={() => { onNavigate(item.id); onMobileOpenChange?.(false); }}>{item.icon}<span>{item.label}</span>{item.badge != null ? <em>{item.badge}</em> : null}</button>)}</nav></aside>
    {mobileOpen ? <button className="adm-scrim" aria-label="关闭导航" onClick={() => onMobileOpenChange?.(false)} /> : null}
    <section className="adm-main" inert={compact && Boolean(mobileOpen)}><header className="adm-topbar"><button ref={trigger} className="adm-icon-btn adm-menu-trigger" type="button" aria-label="打开导航" aria-expanded={Boolean(mobileOpen)} onClick={() => onMobileOpenChange?.(true)}><Menu /></button><div><h1>{title}</h1>{description ? <p>{description}</p> : null}</div><div className="adm-topbar-actions">{actions}{onThemeToggle ? <button className="adm-icon-btn" type="button" aria-label="切换主题" onClick={onThemeToggle}><SunMoon /></button> : null}</div></header><main className="adm-content">{children}</main></section>
  </div>;
}
