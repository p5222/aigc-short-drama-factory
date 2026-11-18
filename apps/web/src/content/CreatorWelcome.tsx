import { useEffect, useState } from "react";
import { ArrowRight, BookOpen, Clapperboard, Lightbulb, X } from "lucide-react";
import { creatorApi } from "../lib/creatorApi";
import "./short-creator.css";

export type ShortEntry = "idea" | "story" | "sample";
export function CreatorWelcome({ onStart }: { onStart: (entry: ShortEntry) => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void creatorApi.preference().then(value => {
      if (!active) return;
      const show = !value.hasProjects && ["new", "shown"].includes(value.guideState);
      setOpen(show);
      if (show && value.guideState === "new") void creatorApi.guide("shown").catch(() => undefined);
    }).catch(() => { if (active) setError("首作引导状态暂未读取成功。你仍可主动开始。"); });
    return () => { active = false; };
  }, []);
  async function skip() {
    try { await creatorApi.guide("skipped"); setOpen(false); setError(""); }
    catch { setError("暂未保存跳过状态，请稍后再试。"); }
  }
  function start(entry: ShortEntry) {
    void creatorApi.guide("started").catch(() => undefined);
    onStart(entry);
  }
  return <section className={`creator-welcome${open ? " is-open" : ""}`} aria-label="首作引导">
    {open ? <>
      <div className="creator-welcome-heading"><h2>新建短片</h2><button type="button" className="ghost-button" onClick={() => void skip()} aria-label="暂时跳过首作引导"><X size={16} />稍后再看</button></div>
      <div className="creator-entry-options">
        <button type="button" onClick={() => start("idea")}><Lightbulb size={22} /><strong>写下灵感</strong><ArrowRight size={17} /></button>
        <button type="button" onClick={() => start("story")}><BookOpen size={22} /><strong>导入故事或剧本</strong><ArrowRight size={17} /></button>
        <button type="button" onClick={() => start("sample")}><Clapperboard size={22} /><strong>使用示例</strong><ArrowRight size={17} /></button>
      </div>
    </> : <button type="button" className="ghost-button" onClick={() => setOpen(true)} aria-label="打开首作引导">新建短片<ArrowRight size={16} /></button>}
    {error ? <p role="status" className="creator-caption">{error}</p> : null}
  </section>;
}
