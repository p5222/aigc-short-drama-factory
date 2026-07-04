import {
  Bell,
  BookOpen,
  CircleHelp,
  ClipboardList,
  Coins,
  CreditCard,
  Film,
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
import type { ReactNode } from "react";

export type PageKey =
  | "workbench"
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

export function Shell({ active, onNavigate, children, credits = 0, theme, onToggleTheme, onStartGuide, userName, onLogout }: ShellProps) {
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
            <label className="search-box">
              <Search size={19} />
              <input placeholder="搜索作品 / 角色 / 分镜 / 任务" />
            </label>
            <button className="guide-button" onClick={onStartGuide}>
              <Sparkles size={18} />
              新手引导
            </button>
            <button className="icon-button" onClick={onToggleTheme} aria-label="切换主题">
              {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <button className="icon-button" aria-label="通知">
              <Bell size={19} />
            </button>
            <div className="user-pill">
              <Coins size={17} />
              {userName}
            </div>
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
