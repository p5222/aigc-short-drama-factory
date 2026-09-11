import { Check, ChevronLeft, ChevronRight, Clock3, Copy, Play, Search, Sparkles, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ShowcaseWork } from "@aifilm/shared";
import { api } from "../lib/api";
import "./PublicShowcase.css";

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
  const cn = locale === "cn";

  useEffect(() => {
    if (!preview) return;
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
  }, [category, keyword, page]);

  return (
    <section className="public-studio-page">
      <div className="public-studio-banner" style={{ backgroundImage: `url(${works[0]?.coverUrl || scenes[2]?.posterUrl || scenes[0]?.posterUrl})` }}>
        <div>
          <span><Sparkles size={15} />{cn ? "创作现场" : "CREATOR STUDIO"}</span>
          <h1>{cn ? "让真实作品被看见" : "Real work, ready to be seen."}</h1>
          <p>{cn ? "创作者提交项目成片，审核通过后在这里公开展示。" : "Creators submit finished project videos. Approved work is published here."}</p>
          <div className="public-studio-banner-meta">
            <strong>{total}</strong><small>{cn ? "已发布作品" : "published works"}</small>
            <strong>{works.filter((item) => item.featured).length}</strong><small>{cn ? "本页精选" : "featured here"}</small>
          </div>
          <button type="button" onClick={onStart}>{cn ? "发布我的作品" : "Publish my work"}<ChevronRight size={18} /></button>
        </div>
      </div>

      <div className="public-studio-toolbar">
        <div>
          <h2>{cn ? "创作者作品" : "Creator showcase"}</h2>
          <p>{cn ? "全部内容来自已审核的真实发布记录。" : "Every item is an approved, persisted submission."}</p>
        </div>
        <label><Search size={18} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={cn ? "搜索作品、作者..." : "Search works or creators..."} /></label>
      </div>

      <div className="public-studio-filters">
        {categories.map((item) => <button className={category === item ? "active" : ""} key={item} type="button" onClick={() => setCategory(item)}>{item}</button>)}
      </div>

      {loading ? <div className="public-studio-empty">正在读取已发布作品...</div> : null}
      {!loading && error ? <div className="public-studio-empty error">{error}</div> : null}
      {!loading && !error ? (
        <div className="public-studio-grid">
          {works.map((work) => (
            <article key={work.id}>
              <button className="public-work-cover" type="button" onClick={() => setPreview(work)}>
                <img src={work.coverUrl} alt={work.title} loading="lazy" decoding="async" />
                {work.featured ? <span className="public-work-badge"><Check size={12} />官方精选</span> : null}
                <span className="public-work-duration">{work.durationLabel}</span>
                <i><Play size={22} fill="currentColor" /></i>
              </button>
              <div className="public-work-copy">
                <strong>{work.title}</strong>
                <span>{work.creatorName}</span>
                <p>{work.description || "创作者公开作品"}</p>
                <div><small>{work.category}</small><span><Clock3 size={13} />{work.durationLabel}</span></div>
                <button type="button" onClick={onStart}><Copy size={14} />开始同款创作</button>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {!loading && !error && !works.length ? <div className="public-studio-empty">没有匹配的已发布作品。</div> : null}

      {totalPages > 1 ? (
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
            <video src={preview.videoUrl} poster={preview.coverUrl} controls autoPlay playsInline preload="metadata" aria-label={preview.title} tabIndex={0} />
            <div className="public-preview-information"><div className="public-preview-copy"><span>{preview.category}</span><h3 id={previewTitleId}>{preview.title}</h3><p>{preview.creatorName} · {preview.durationLabel}</p></div><button type="button" onClick={onStart}><Copy size={16} />开始同款创作</button></div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

export function PublicShowcase({ locale, scenes, onStart }: PublicShowcaseProps) {
  return <StudioPage locale={locale} scenes={scenes} onStart={onStart} />;
}
