import { useEffect, useRef, useState, type ReactNode } from "react";
import { Menu, Search, SunMoon, X } from "lucide-react";
import { dialogStackForDocument } from "../design-system/dialogStack";
import "./admin-navigation.css";

export interface AdminNavItem { id: string; label: string; group?: string; icon?: ReactNode; badge?: string | number; }
export function AdminShell({ title, description, items, activeId, onNavigate, onThemeToggle, mobileOpen, onMobileOpenChange, children, actions }: { title: string; description?: string; items: AdminNavItem[]; activeId: string; onNavigate: (id: string) => boolean | void; onThemeToggle?: () => void; mobileOpen?: boolean; onMobileOpenChange?: (open: boolean) => void; children: ReactNode; actions?: ReactNode; }) {
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 820px)").matches);
  const sidebar = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const visibleItems = items.filter(item => `${item.label} ${item.group ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const activeItem = items.find(item => item.id === activeId);
  const closeMenu = useRef(onMobileOpenChange);
  closeMenu.current = onMobileOpenChange;
  useEffect(() => {
    const media = window.matchMedia("(max-width: 820px)");
    const update = () => { setCompact(media.matches); if (!media.matches) closeMenu.current?.(false); };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!compact || !mobileOpen || !sidebar.current) return;
    const controls = () => [...(sidebar.current?.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled)") ?? [])].filter(button => button.getClientRects().length > 0);
    const lock = dialogStackForDocument(document).register({ element: sidebar.current, focusInitial: () => controls()[0]?.focus(), onEscape: () => closeMenu.current?.(false) });
    const trapFocus = (event: KeyboardEvent) => {
      if (!lock.isTop()) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); lock.escape(); return; }
      if (event.key !== "Tab") return;
      const buttons = controls();
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && (document.activeElement === first || !sidebar.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !sidebar.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", trapFocus);
    return () => { document.removeEventListener("keydown", trapFocus); lock.release(); };
  }, [compact, mobileOpen]);
  const groups = [...new Set(visibleItems.map(item => item.group || "工作区"))];
  return <div className="adm-shell admin-product">
    <a href="#admin-main-content" className="ui-skip-link" onClick={event => { event.preventDefault(); document.getElementById("admin-main-content")?.focus(); }}>跳到主要内容</a>
    <aside ref={sidebar} className={`adm-sidebar${mobileOpen ? " is-open" : ""}`} inert={compact && !mobileOpen} aria-hidden={compact && !mobileOpen ? true : undefined} role={compact && mobileOpen ? "dialog" : undefined} aria-modal={compact && mobileOpen ? true : undefined} aria-label={compact ? "后台导航" : undefined}>
      <div className="adm-brand"><span className="adm-brand-mark">漫</span><div><strong>漫角</strong><small>运营控制台</small></div><button type="button" aria-label="关闭导航" onClick={() => onMobileOpenChange?.(false)}><X /></button></div>
      <label className="adm-nav-search"><Search size={16} aria-hidden="true" /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="查找管理模块" aria-label="查找管理模块" /></label>
      <nav aria-label="后台模块">{groups.map(group => <section className="adm-nav-group" key={group}><h2>{group}</h2>{visibleItems.filter(item => (item.group || "工作区") === group).map(item => <button type="button" key={item.id} className={item.id === activeId ? "is-active" : ""} aria-current={item.id === activeId ? "page" : undefined} onClick={() => { if (onNavigate(item.id) !== false) { onMobileOpenChange?.(false); setQuery(""); } }}>{item.icon}<span>{item.id === "套餐会员" ? "充值套餐" : item.id === "订阅会员" ? "订阅方案 · 未开放" : item.label}</span>{item.badge != null ? <em>{item.badge}</em> : null}</button>)}</section>)}{!visibleItems.length ? <div className="adm-nav-empty" role="status"><p>没有匹配的模块</p><button type="button" onClick={() => setQuery("")}>清空搜索</button></div> : null}</nav>
      <div className="adm-sidebar-foot"><span className="adm-online-dot" />管理工作区</div>
    </aside>
    {compact && mobileOpen ? <button className="adm-scrim" tabIndex={-1} aria-label="关闭导航" onClick={() => onMobileOpenChange?.(false)} /> : null}
    <section className="adm-main" inert={compact && Boolean(mobileOpen)}><header className="adm-topbar"><button ref={trigger} className="adm-icon-btn adm-menu-trigger" type="button" aria-label="打开导航" aria-expanded={Boolean(mobileOpen)} onClick={() => onMobileOpenChange?.(true)}><Menu /></button><div className="adm-location" aria-label={description || title}><span>{activeItem?.group || "工作空间"}</span><span aria-hidden="true">/</span><strong>{activeItem?.label || title}</strong></div><div className="adm-topbar-actions">{actions}{onThemeToggle ? <button className="adm-icon-btn" type="button" aria-label="切换主题" onClick={onThemeToggle}><SunMoon /></button> : null}</div></header><main className="adm-content" id="admin-main-content" tabIndex={-1}>{children}</main></section>
  </div>;
}
