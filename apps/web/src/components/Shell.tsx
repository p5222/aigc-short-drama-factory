import {
  Bell,
  CircleHelp,
  ClipboardList,
  CreditCard,
  ListVideo,
  Grid2X2,
  LogOut,
  Menu,
  Moon,
  Search,
  Sparkles,
  Sun,
  UserRound,
  WandSparkles,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ContentProjectSummary, GenerationTask, Project } from "@aifilm/shared";
import { searchCreatorItems, type CreatorSearchItem } from "./creatorSearchModel";
import { dialogStackForDocument } from "../design-system/dialogStack";
import { StudioIcon, StudioMark } from "../design-system/StudioIcon";

export type PageKey =
  | "workbench"
  | "content"
  | "wizard"
  | "scripts"
  | "studio"
  | "tasks"
  | "profile"
  | "recharge"
  | "ledger"
  | "settings"
  | "help"
  | "admin"
  | "project";

interface ShellProps {
  active: PageKey;
  onNavigate: (page: PageKey) => void;
  children: ReactNode;
  credits?: number;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onStartGuide: () => void;
  userName: string;
  onLogout: () => void;
  projects: Project[];
  contentProjects: ContentProjectSummary[];
  tasks: GenerationTask[];
  onOpenProject: (id: string) => void;
  onOpenContent: (id: string) => void;
}

const sections: Array<{ label: string; items: Array<{ key: PageKey; label: string; icon: ReactNode }> }> = [
  {
    label: "创作",
    items: [
      { key: "workbench", label: "工作台", icon: <Grid2X2 size={20} /> },
      { key: "wizard", label: "新建漫剧", icon: <WandSparkles size={20} /> },
      { key: "scripts", label: "我的作品", icon: <StudioIcon stage="content" /> }
    ]
  },
  {
    label: "生产",
    items: [
      { key: "studio", label: "剪辑中心", icon: <StudioIcon stage="delivery" /> },
      { key: "tasks", label: "生成队列", icon: <ListVideo size={20} /> }
    ]
  },
  {
    label: "账户",
    items: [
      { key: "profile", label: "我的", icon: <UserRound size={19} /> },
      { key: "recharge", label: "积分充值", icon: <CreditCard size={19} /> },
      { key: "ledger", label: "积分明细", icon: <ClipboardList size={19} /> },
      { key: "help", label: "帮助中心", icon: <CircleHelp size={19} /> }
    ]
  }
];

export function Shell({ active, onNavigate, children, credits, theme, onToggleTheme, onStartGuide, userName, onLogout, projects, contentProjects, tasks, onOpenProject, onOpenContent }: ShellProps) {
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLFormElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 900px)").matches);
  const [mobileOpen, setMobileOpen] = useState(false);
  const go = (page: PageKey) => { onNavigate(page); setMobileOpen(false); };
  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const update = () => { setCompact(media.matches); if (!media.matches) setMobileOpen(false); };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => { setMobileOpen(false); }, [active]);
  useEffect(() => {
    if (!compact || !mobileOpen || !sidebarRef.current) return;
    const controls = () => [...(sidebarRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])].filter(button => button.getClientRects().length > 0);
    const lock = dialogStackForDocument(document).register({ element: sidebarRef.current, focusInitial: () => controls()[0]?.focus(), onEscape: () => setMobileOpen(false) });
    const keydown = (event: KeyboardEvent) => {
      if (!lock.isTop()) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); lock.escape(); return; }
      if (event.key !== "Tab") return;
      const items = controls(), first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); lock.release(); };
  }, [compact, mobileOpen]);
  const searchItems = useMemo<CreatorSearchItem[]>(() => [
    ...projects.map((item) => ({ id: item.id, label: item.name, detail: "漫剧作品", kind: "project" as const })),
    ...contentProjects.map((item) => ({ id: item.id, label: item.title, detail: "内容创作", kind: "content" as const })),
    ...tasks.map((item) => ({ id: item.id, label: item.title, detail: "生成任务", kind: "task" as const, projectId: item.projectId }))
  ], [projects, contentProjects, tasks]);
  const results = useMemo(() => searchCreatorItems(searchItems, query), [searchItems, query]);
  const failedCount = tasks.filter((task) => task.status === "failed").length;
  useEffect(() => { setSearchOpen(false); }, [active]);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!searchRef.current?.contains(event.target as Node)) setSearchOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const openResult = (item: CreatorSearchItem) => {
    setSearchOpen(false);
    if (item.kind === "project") onOpenProject(item.id);
    else if (item.kind === "content") onOpenContent(item.id);
    else onNavigate("tasks");
  };
  return (
    <div className="app-shell product-shell">
      <a href="#creator-main-content" className="ui-skip-link" onClick={event => { event.preventDefault(); document.getElementById("creator-main-content")?.focus(); }}>跳到主要内容</a>
      <aside ref={sidebarRef} id="creator-sidebar" className={`sidebar${mobileOpen ? " is-open" : ""}`} inert={compact && !mobileOpen} aria-hidden={compact && !mobileOpen || undefined} role={compact ? "dialog" : undefined} aria-modal={compact && mobileOpen || undefined} aria-label={compact ? "创作导航" : undefined}>
        <div className="brand">
          <div className="brand-mark"><StudioMark /></div>
          <div>
            <strong>漫角 Studio</strong>
            <span>创作工作空间</span>
          </div>
          <button type="button" className="ui-icon-button creator-menu-close" aria-label="关闭导航" onClick={() => setMobileOpen(false)}><X size={20} /></button>
        </div>

        <button type="button" className="primary-button side-create" onClick={() => go("wizard")} data-tour-id="create-project">
          <Sparkles size={18} />
          新建漫剧
        </button>

        <nav className="nav" aria-label="创作与账户">
          {sections.map((section, index) => (
            <div key={section.label} className="nav-section">
              <p><span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>{section.label}</p>
              {section.items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={item.key === active ? "nav-item active" : "nav-item"}
                  onClick={() => go(item.key)}
                  data-tour-id={`nav-${item.key}`}
                  aria-current={item.key === active ? "page" : undefined}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="credit-card">
          <span>可用积分</span>
          <strong>{credits == null ? "—" : credits.toLocaleString()}<small> 积分</small></strong>
          <button type="button" onClick={() => go("recharge")}>充值积分<CreditCard size={15} /></button>
        </div>
      </aside>
      {compact && mobileOpen ? <button className="creator-nav-scrim" type="button" tabIndex={-1} aria-label="收起导航" onClick={() => setMobileOpen(false)} /> : null}
      <main className="main" id="creator-main-content" tabIndex={-1} inert={compact && mobileOpen}>
        <header className="topbar">
          <button ref={menuTrigger} type="button" className="ui-icon-button creator-menu-trigger" aria-label="打开导航" aria-controls="creator-sidebar" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Menu size={21} /></button>
          <div className="creator-location">
            <div className="crumb"><span>工作空间</span><i aria-hidden="true">/</i><strong>{pageTitle(active)}</strong></div>
          </div>
          <div className="top-actions">
            <form className="creator-search" role="search" ref={searchRef} onSubmit={(event) => { event.preventDefault(); if (results[0]) openResult(results[0]); }} onKeyDown={(event) => { if (event.key === "Escape") { setSearchOpen(false); searchRef.current?.querySelector("input")?.focus(); } }}>
              <label className="search-box">
                <Search size={19} aria-hidden="true" />
                <input aria-label="搜索我的作品和任务" placeholder="搜索作品或任务" value={query} onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); }} onFocus={() => setSearchOpen(true)} aria-controls="creator-search-results" aria-expanded={searchOpen && Boolean(query.trim())} />
              </label>
              {searchOpen && query.trim() ? <div className="creator-search-results" id="creator-search-results">
                <p role="status">{results.length ? `${results.length} 条匹配结果` : "没有找到匹配的作品或任务"}</p>
                {results.map((item) => <button key={`${item.kind}:${item.id}`} type="button" onClick={() => openResult(item)}><strong>{item.label}</strong><span>{item.detail}</span></button>)}
              </div> : null}
            </form>
            <button type="button" className="guide-button" onClick={onStartGuide} title="查看新手引导">
              <Sparkles size={18} />
              新手引导
            </button>
            <button type="button" className="icon-button" onClick={onToggleTheme} aria-label="切换主题" title={theme === "dark" ? "切换浅色主题" : "切换深色主题"}>
              {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <button type="button" className="icon-button creator-task-notice" onClick={() => go("tasks")} aria-label={failedCount ? `查看生成队列，${failedCount} 个任务失败` : "查看生成队列"} title={failedCount ? `${failedCount} 个任务失败，点击查看` : "查看生成队列"}>
              <Bell size={19} />{failedCount ? <span className="creator-notice-dot" /> : null}
            </button>
            <button className="user-pill" type="button" onClick={() => onNavigate("profile")} aria-label={`打开个人账户：${userName}`}>
              <span className="creator-avatar" aria-hidden="true">{userName.slice(0, 1)}</span><span>{userName}</span>
            </button>
            <button type="button" className="icon-button creator-logout" onClick={onLogout} aria-label="退出登录" title="退出登录">
              <LogOut size={19} />
            </button>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

function pageTitle(page: PageKey) {
  const map: Record<PageKey, string> = {
    workbench: "工作台",
    content: "内容创作",
    wizard: "新建漫剧",
    scripts: "我的作品",
    studio: "剪辑中心",
    tasks: "生成队列",
    profile: "我的",
    recharge: "积分充值",
    ledger: "积分明细",
    settings: "设置",
    help: "帮助中心",
    admin: "后台管理",
    project: "项目生产台"
  };
  return map[page];
}
