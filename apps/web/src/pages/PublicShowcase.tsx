import { Check, ChevronLeft, ChevronRight, Clock3, Copy, Play, Search, Sparkles, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ShowcaseWork } from "@aifilm/shared";
import { api } from "../lib/api";
import "./PublicShowcase.css";
import { InlineNotice, PageHeader, StatePanel } from "../design-system/ui";

export type PublicView = "home" | "studio";
export type PublicLocale = "cn" | "en";

export interface PublicScene {
  id: string;
  videoUrl: string;
  posterUrl: string;
  eyebrow: string;
  meta: string;
  title: Record<PublicLocale, string>;
  scanLabel: Record<PublicLocale, string>;
  activeLabel?: string;
}

interface PublicShowcaseProps {
  locale: PublicLocale;
  scenes: PublicScene[];
  view: "studio";
  onStart: () => void;
}

const categories = ["全部", "官方精选", "AI短剧", "动画短片", "电商广告", "品牌广告", "概念片", "电影感", "科幻风"];

function StudioPage({ locale, scenes, onStart }: Omit<PublicShowcaseProps, "view">) {
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState("全部");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [works, setWorks] = useState<ShowcaseWork[]>([]);
  const [preview, setPreview] = useState<ShowcaseWork | null>(null);
  const previewDialog = useRef<HTMLElement>(null);
  const previewTitleId = useId();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [mediaState, setMediaState] = useState<"loading" | "ready" | "error">("loading");
  const [mediaAttempt, setMediaAttempt] = useState(0);
  const cn = locale === "cn";

  useEffect(() => {
    if (!preview) return;
    setMediaState("loading"); setMediaAttempt(0);
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = previewDialog.current;
    dialog?.querySelector<HTMLButtonElement>(".public-preview-close")?.focus({ preventScroll: true });
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.fullscreenElement) {
        event.preventDefault();
        setPreview(null);
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), video[controls], [tabindex="0"]') ?? []).filter(item => item.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first || !last) { event.preventDefault(); dialog?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [preview?.id]);

  useEffect(() => {
    setPage(1);
  }, [category, keyword]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      void api.publicShowcaseWorks(page, 20, category, keyword)
        .then((result) => {
          if (!active) return;
          setWorks(result.items);
          setTotal(result.total);
          setTotalPages(result.totalPages);
        })
        .catch((reason) => {
          if (!active) return;
          setWorks([]);
          setError(reason instanceof Error ? reason.message : "作品加载失败");
        })
        .finally(() => active && setLoading(false));
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [category, keyword, page, reload]);

  return (
    <section className="public-studio-page">
      <PageHeader title={cn ? "创作现场" : "Creator showcase"} description={cn ? "探索创作者制作的短片。这里展示的作品均已通过审核。" : "Explore films created with Manjiao. Every published work is reviewed."} actions={<button className="primary-button" type="button" onClick={onStart}>{cn ? "开始创作" : "Start creating"}<ChevronRight size={18} /></button>} />

      <div className="public-studio-toolbar">
        <div>
          <h2>{cn ? "已发布作品" : "Published work"}</h2>
          <p>{loading ? (cn ? "正在更新…" : "Updating…") : error ? (cn ? "暂未取得最新列表" : "List unavailable") : cn ? `当前条件下共 ${total} 部作品` : `${total} matching works`}</p>
        </div>
        <label><Search size={18} /><input type="search" aria-label={cn ? "搜索作品或作者" : "Search work or creator"} value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={cn ? "搜索作品或作者" : "Search works or creators"} /></label>
      </div>

      <div className="public-studio-filters">
        {categories.map((item) => <button className={category === item ? "active" : ""} aria-pressed={category === item} key={item} type="button" onClick={() => setCategory(item)}>{item}</button>)}
      </div>

      {loading ? <StatePanel kind="loading" title={cn ? "正在读取作品" : "Loading work"} description={cn ? "请稍候，作品列表即将就绪。" : "The showcase will be ready shortly."} /> : null}
      {!loading && error ? <StatePanel kind="error" title={cn ? "作品列表暂时无法加载" : "Unable to load work"} description={error} action={<button className="ghost-button" type="button" onClick={() => setReload(value => value + 1)}>{cn ? "重新加载" : "Try again"}</button>} /> : null}
      {!loading && !error ? (
        <div className="public-studio-grid">
          {works.map((work) => (
            <article key={work.id}>
              <button className="public-work-cover" type="button" aria-label={`${cn ? "播放" : "Play"} ${work.title}`} onClick={() => setPreview(work)}>
                <ShowcaseCover url={work.coverUrl} title={work.title} />
                {work.featured ? <span className="public-work-badge"><Check size={12} />官方精选</span> : null}
                <span className="public-work-duration">{work.durationLabel}</span>
                <i><Play size={22} fill="currentColor" /></i>
              </button>
              <div className="public-work-copy">
                <strong>{work.title}</strong>
                <span>{work.creatorName}</span>
                <p>{work.description || "创作者公开作品"}</p>
                <div><small>{work.category}</small><span><Clock3 size={13} />{work.durationLabel}</span></div>
                <button type="button" onClick={() => setPreview(work)}><Play size={14} />{cn ? "观看作品" : "Watch film"}</button>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {!loading && !error && !works.length ? <StatePanel title={cn ? "没有匹配的作品" : "No matching work"} description={cn ? "尝试其他关键词，或查看全部分类。" : "Try another search or browse all categories."} action={<button className="ghost-button" type="button" onClick={() => { setKeyword(""); setCategory("全部"); }}>{cn ? "查看全部" : "View all"}</button>} /> : null}

      {!loading && !error && totalPages > 1 ? (
        <div className="public-studio-pagination">
          <button type="button" aria-label="上一页" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft size={18} /></button>
          <span>{page} / {totalPages}</span>
          <button type="button" aria-label="下一页" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}><ChevronRight size={18} /></button>
        </div>
      ) : null}

      {preview ? (
        <div className="public-preview-modal" data-appearance="dark" role="dialog" aria-modal="true" aria-labelledby={previewTitleId}>
          <button className="public-preview-backdrop" type="button" tabIndex={-1} onClick={() => setPreview(null)} aria-label="关闭预览" />
          <section ref={previewDialog} tabIndex={-1}>
            <button className="public-preview-close" type="button" onClick={() => setPreview(null)} aria-label="关闭"><X size={19} /></button>
            <video key={`${preview.id}:${mediaAttempt}`} src={preview.videoUrl} poster={preview.coverUrl} controls autoPlay playsInline preload="metadata" aria-label={preview.title} tabIndex={0} onCanPlay={() => setMediaState("ready")} onError={() => setMediaState("error")} />
            {mediaState === "loading" ? <p className="public-media-status" role="status">{cn ? "正在加载视频…" : "Loading video…"}</p> : null}
            {mediaState === "error" ? <div className="public-media-error"><InlineNotice tone="error">{cn ? "视频暂时无法播放，请重新加载。" : "The video could not be played. Please try again."}<button type="button" onClick={() => { setMediaState("loading"); setMediaAttempt(value => value + 1); }}>{cn ? "重新加载视频" : "Reload video"}</button></InlineNotice></div> : null}
            <div className="public-preview-information"><div className="public-preview-copy"><span>{preview.category}</span><h3 id={previewTitleId}>{preview.title}</h3><p>{preview.creatorName} · {preview.durationLabel}</p></div><button type="button" onClick={() => { setPreview(null); onStart(); }}><Copy size={16} />{cn ? "开始创作" : "Start creating"}</button></div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

export function PublicShowcase({ locale, scenes, onStart }: PublicShowcaseProps) {
  return <StudioPage locale={locale} scenes={scenes} onStart={onStart} />;
}

function ShowcaseCover({ url, title }: { url: string; title: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return failed || !url ? <span className="public-cover-unavailable"><Play size={25} /><span>点击播放作品</span></span> : <img src={url} alt={title} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}
