import {
  Bell,
  BookOpen,
  CircleHelp,
  ClipboardList,
  Coins,
  CreditCard,
  Film,
  FileText,
  Gauge,
  Grid2X2,
  LogOut,
  Moon,
  Search,
  Sparkles,
  Sun,
  UserRound,
  WandSparkles
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ContentProjectSummary, GenerationTask, Project } from "@aifilm/shared";
import { searchCreatorItems, type CreatorSearchItem } from "./creatorSearchModel";

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
      { key: "workbench", label: "工作台", icon: <Grid2X2 size={19} /> },
      { key: "wizard", label: "新建漫剧", icon: <WandSparkles size={19} /> },
      { key: "scripts", label: "我的作品", icon: <BookOpen size={19} /> }
    ]
  },
  {
    label: "生产",
    items: [
      { key: "studio", label: "剪辑中心", icon: <Film size={19} /> },
      { key: "tasks", label: "生成队列", icon: <Gauge size={19} /> }
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

export function Shell({ active, onNavigate, children, credits = 0, theme, onToggleTheme, onStartGuide, userName, onLogout, projects, contentProjects, tasks, onOpenProject, onOpenContent }: ShellProps) {
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLFormElement>(null);
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
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">AI</div>
          <div>
            <strong>漫角 Studio</strong>
            <span>AI 漫剧生产台</span>
          </div>
        </div>

        <button className="primary-button side-create" onClick={() => onNavigate("wizard")} data-tour-id="create-project"> 
          <Sparkles size={18} />
          新建漫剧
        </button>

        <nav className="nav">
          {sections.map((section) => (
            <div key={section.label} className="nav-section">
              <p>{section.label}</p>
              {section.items.map((item) => (
                <button
                  key={item.key}
                  className={item.key === active ? "nav-item active" : "nav-item"}
                  onClick={() => onNavigate(item.key)}
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
          <strong>{credits.toLocaleString()}</strong>
          <button onClick={() => onNavigate("recharge")}>充值积分</button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <div className="crumb">AI 漫剧 / {pageTitle(active)}</div>
            <small>内容、分镜、图片、视频任务统一管理</small>
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
            <button className="guide-button" onClick={onStartGuide}>
              <Sparkles size={18} />
              新手引导
            </button>
            <button className="icon-button" onClick={onToggleTheme} aria-label="切换主题">
              {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <button className="icon-button creator-task-notice" onClick={() => onNavigate("tasks")} aria-label={failedCount ? `查看生成队列，${failedCount} 个任务失败` : "查看生成队列"} title={failedCount ? `${failedCount} 个任务失败，点击查看` : "查看生成队列"}>
              <Bell size={19} />{failedCount ? <span className="creator-notice-dot" /> : null}
            </button>
            <button className="user-pill" type="button" onClick={() => onNavigate("profile")} aria-label={`打开个人账户：${userName}`}>
              <Coins size={17} />
              {userName}
            </button>
            <button className="icon-button" onClick={onLogout} aria-label="退出登录">
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
