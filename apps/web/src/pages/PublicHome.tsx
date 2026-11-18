import { ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { StudioWordmark } from "../design-system/StudioIcon";
import { PublicShowcase, type PublicLocale, type PublicView } from "./PublicShowcase";
import { cineScenes } from "./cineScenes";

const icp = import.meta.env.VITE_ICP_NUMBER?.trim() || "粤ICP备2026098451号";
const company = import.meta.env.VITE_ICP_COMPANY?.trim();
const region = import.meta.env.VITE_ICP_REGION?.trim();

export function PublicHome({ locale, onLocaleChange, onLogin, authOpen }: {
  locale: PublicLocale;
  onLocaleChange: (locale: PublicLocale) => void;
  onLogin: () => void;
  authOpen: boolean;
}) {
  const [view, setView] = useState<PublicView>("home");
  const [sceneIndex, setSceneIndex] = useState(0);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const scene = cineScenes[sceneIndex];
  const cn = locale === "cn";

  useEffect(() => { if (authOpen) video.current?.pause(); }, [authOpen]);
  useEffect(() => {
    const pause = () => { if (document.hidden) video.current?.pause(); };
    document.addEventListener("visibilitychange", pause);
    return () => document.removeEventListener("visibilitychange", pause);
  }, []);

  return <main className="public-home" data-public-view={view}>
    <nav className="public-home-nav" aria-label={cn ? "首页导航" : "Main navigation"}>
      <button className="public-home-logo" type="button" aria-label={cn ? "漫角首页" : "Manjiao home"} onClick={() => setView("home")}><StudioWordmark height={32} /></button>
      <div className="public-home-links">
        <button type="button" aria-current={view === "home" ? "page" : undefined} onClick={() => setView("home")}>{cn ? "首页" : "Home"}</button>
        <button type="button" aria-current={view === "studio" ? "page" : undefined} onClick={() => setView("studio")}>{cn ? "创作现场" : "Showcase"}</button>
      </div>
      <div className="public-home-actions">
        <select aria-label={cn ? "选择语言" : "Select language"} value={locale} onChange={event => onLocaleChange(event.target.value as PublicLocale)}>
          <option value="cn">中文</option><option value="en">English</option>
        </select>
        <button type="button" className="ghost-button" onClick={onLogin}>{cn ? "登录" : "Log in"}</button>
      </div>
    </nav>
    {view === "home" ? <section className="public-home-content" aria-labelledby="public-home-title">
      <header className="public-home-heading">
        <h1 id="public-home-title">{cn ? "漫剧创作" : "Create your film"}</h1>
        <button type="button" className="primary-button" onClick={onLogin}>{cn ? "开始创作" : "Start creating"}<ArrowRight size={17} /></button>
      </header>
      <figure className="public-home-example">
        <video key={`${scene.id}-${sourceIndex}`} ref={video} src={scene.videoCandidates[sourceIndex]} poster={scene.posterUrl}
          controls playsInline preload="none" aria-label={`${cn ? "视觉示例" : "Visual example"} · ${scene.title[locale]}`}
          onError={() => {
            if (sourceIndex < scene.videoCandidates.length - 1) setSourceIndex(sourceIndex + 1);
            else setFailed(true);
          }} />
        {failed ? <div className="public-home-media-error" role="status">
          <span>{cn ? "示例暂时无法播放" : "This example is unavailable"}</span>
          <button type="button" className="ghost-button" onClick={() => { setFailed(false); setSourceIndex(0); video.current?.load(); }}>{cn ? "重试" : "Retry"}</button>
        </div> : null}
        <figcaption>
          <span>{cn ? "视觉示例" : "Visual examples"}</span>
          <div role="group" aria-label={cn ? "浏览创作示例" : "Choose an example"}>
            {cineScenes.map((item, index) => <button key={item.id} type="button" aria-pressed={index === sceneIndex}
              onClick={() => { setSceneIndex(index); setSourceIndex(0); setFailed(false); }}>{item.title[locale]}</button>)}
          </div>
        </figcaption>
      </figure>
    </section> : <PublicShowcase locale={locale} scenes={cineScenes} view="studio" onStart={onLogin} />}
    <footer className="public-home-footer">© {new Date().getFullYear()} 漫角 · <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">{icp}</a>{company ? ` · ${company}` : ""}{region ? ` · ${region}` : ""}</footer>
  </main>;
}
