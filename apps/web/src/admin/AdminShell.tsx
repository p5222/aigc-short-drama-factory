import type { ReactNode } from "react";
import { Menu, SunMoon, X } from "lucide-react";

export interface AdminNavItem { id: string; label: string; icon?: ReactNode; badge?: string | number; }
export function AdminShell({ title, description, items, activeId, onNavigate, onThemeToggle, mobileOpen, onMobileOpenChange, children, actions }: { title: string; description?: string; items: AdminNavItem[]; activeId: string; onNavigate: (id: string) => void; onThemeToggle?: () => void; mobileOpen?: boolean; onMobileOpenChange?: (open: boolean) => void; children: ReactNode; actions?: ReactNode; }) {
  return <div className="adm-shell">
    <aside className={`adm-sidebar${mobileOpen ? " is-open" : ""}`}><div className="adm-brand"><span>漫角</span><small>运营控制台</small><button type="button" aria-label="关闭导航" onClick={() => onMobileOpenChange?.(false)}><X /></button></div><nav aria-label="后台模块">{items.map((item) => <button type="button" key={item.id} className={item.id === activeId ? "is-active" : ""} aria-current={item.id === activeId ? "page" : undefined} onClick={() => { onNavigate(item.id); onMobileOpenChange?.(false); }}>{item.icon}<span>{item.label}</span>{item.badge != null ? <em>{item.badge}</em> : null}</button>)}</nav></aside>
    {mobileOpen ? <button className="adm-scrim" aria-label="关闭导航" onClick={() => onMobileOpenChange?.(false)} /> : null}
    <section className="adm-main"><header className="adm-topbar"><button className="adm-icon-btn adm-menu-trigger" type="button" aria-label="打开导航" onClick={() => onMobileOpenChange?.(true)}><Menu /></button><div><h1>{title}</h1>{description ? <p>{description}</p> : null}</div><div className="adm-topbar-actions">{actions}{onThemeToggle ? <button className="adm-icon-btn" type="button" aria-label="切换主题" onClick={onThemeToggle}><SunMoon /></button> : null}</div></header><main className="adm-content">{children}</main></section>
  </div>;
}
