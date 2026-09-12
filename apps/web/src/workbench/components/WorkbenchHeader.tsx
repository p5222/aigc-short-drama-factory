import {
  ArrowLeft,
  Ellipsis,
  ListTree,
  Moon,
  PanelRight,
  RefreshCw,
  Sun
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { WorkbenchSaveState } from "../WorkbenchContext";
import { nextWorkbenchTheme, type WorkbenchStage, type WorkbenchTheme } from "../model";

export interface WorkbenchHeaderStage {
  id: WorkbenchStage;
  label: string;
  done?: boolean;
}

interface WorkbenchHeaderProps {
  projectName: string;
  projectMeta?: string;
  stages: readonly WorkbenchHeaderStage[];
  activeStage: WorkbenchStage;
  saveState: WorkbenchSaveState;
  theme: WorkbenchTheme;
  onBack: () => void;
  onStageChange: (stage: WorkbenchStage) => void;
  onThemeChange: (theme: WorkbenchTheme) => void;
  onRefresh?: () => void;
  onOpenRail?: () => void;
  onOpenInspector?: () => void;
  onOpenTasks?: () => void;
  onOpenEvaluation?: () => void;
}

const saveStateLabels: Record<WorkbenchSaveState, string> = {
  unchanged: "未修改",
  dirty: "有未保存修改",
  saving: "保存中",
  error: "保存失败",
  saved: "已保存",
  "sync-required": "已保存 · 待刷新"
};

export function WorkbenchHeader({
  projectName,
  projectMeta,
  stages,
  activeStage,
  saveState,
  theme,
  onBack,
  onStageChange,
  onThemeChange,
  onRefresh,
  onOpenRail,
  onOpenInspector, onOpenTasks, onOpenEvaluation
}: WorkbenchHeaderProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreMenuId = useId();
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !moreMenuRef.current?.contains(event.target)) {
        setMoreOpen(false);
        moreTriggerRef.current?.focus();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMoreOpen(false);
      moreTriggerRef.current?.focus();
    };
    const media = window.matchMedia("(max-width: 1439px)");
    const handleMediaChange = (event: MediaQueryListEvent) => {
      if (!event.matches) setMoreOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    media.addEventListener("change", handleMediaChange);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      media.removeEventListener("change", handleMediaChange);
    };
  }, [moreOpen]);

  function closeMoreAndRestoreFocus() {
    setMoreOpen(false);
    moreTriggerRef.current?.focus();
  }

  return (
    <header className="wb-header" data-layout="project-production">
      <div className="wb-header__project">
        <button className="wb-icon-button" type="button" aria-label="返回作品列表" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
        </button>
        <div className="wb-header__project-copy">
          <strong title={projectName}>{projectName}</strong>
          {projectMeta ? <span>{projectMeta}</span> : null}
        </div>
      </div>

      <nav className="wb-stage-nav" aria-label="项目生产阶段">
        {stages.map((stage) => (
          <button
            className={stage.id === activeStage ? "is-active" : undefined}
            type="button"
            key={stage.id}
            aria-current={stage.id === activeStage ? "step" : undefined}
            onClick={() => onStageChange(stage.id)}
          >
            <span>{stage.label}</span>
            {stage.done ? (
              <span className="wb-stage-complete">
                <i aria-hidden="true" />
                <span className="wb-sr-only">已完成</span>
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="wb-header__actions">
        <span className={`wb-save-state wb-save-state--${saveState}`} role="status" aria-live="polite">
          {saveStateLabels[saveState]}
        </span>
        {onOpenRail ? (
          <button className="wb-icon-button wb-header__drawer-trigger wb-header__rail-trigger" type="button" aria-label="打开对象列表" onClick={onOpenRail}>
            <ListTree aria-hidden="true" />
          </button>
        ) : null}
        {onOpenInspector ? (
          <button className="wb-icon-button wb-header__drawer-trigger" type="button" aria-label="打开检查器" onClick={onOpenInspector}>
            <PanelRight aria-hidden="true" />
          </button>
        ) : null}
        {onOpenTasks ? <button className="wb-icon-button wb-header__overflow-action" type="button" aria-label="打开生成任务" title="生成任务" onClick={onOpenTasks}><ListTree aria-hidden="true" /></button> : null}
        {onOpenEvaluation ? <button className="wb-icon-button wb-header__overflow-action" type="button" aria-label="打开评测反馈" title="评测反馈" onClick={onOpenEvaluation}><PanelRight aria-hidden="true" /></button> : null}
        {onRefresh ? (
          <button className="wb-icon-button wb-header__secondary-action" type="button" aria-label="刷新项目数据" onClick={onRefresh}>
            <RefreshCw aria-hidden="true" />
          </button>
        ) : null}
        <button
          className="wb-icon-button wb-header__secondary-action"
          type="button"
          aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
          onClick={() => onThemeChange(nextWorkbenchTheme(theme))}
        >
          {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
        </button>
        <div ref={moreMenuRef} className="wb-more-menu">
          <button
            ref={moreTriggerRef}
            className="wb-icon-button"
            type="button"
            aria-expanded={moreOpen}
            aria-controls={moreMenuId}
            onClick={() => setMoreOpen((current) => !current)}
          >
            <Ellipsis aria-hidden="true" />
            <span className="wb-sr-only">更多操作</span>
          </button>
          {moreOpen ? <div id={moreMenuId} className="wb-more-popover">
            <span className={`wb-more-save-state wb-save-state--${saveState}`} role="status" aria-live="polite">
              <span>保存状态</span>
              <strong>{saveStateLabels[saveState]}</strong>
            </span>
            {onOpenTasks ? <button className="wb-more-mobile-action" type="button" onClick={() => { onOpenTasks(); closeMoreAndRestoreFocus(); }}><ListTree aria-hidden="true" /><span>打开生成任务</span></button> : null}
            {onOpenEvaluation ? <button className="wb-more-mobile-action" type="button" onClick={() => { onOpenEvaluation(); closeMoreAndRestoreFocus(); }}><PanelRight aria-hidden="true" /><span>打开评测反馈</span></button> : null}
            {onRefresh ? (
              <button type="button" onClick={() => {
                onRefresh();
                closeMoreAndRestoreFocus();
              }}>
                <RefreshCw aria-hidden="true" />
                <span>刷新项目数据</span>
              </button>
            ) : null}
            <button type="button" onClick={() => {
              onThemeChange(nextWorkbenchTheme(theme));
              closeMoreAndRestoreFocus();
            }}>
              {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
              <span>{theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}</span>
            </button>
          </div> : null}
        </div>
      </div>
    </header>
  );
}
