import { useEffect, useState } from "react";
import { ArrowRight, BookOpen, Clapperboard, Lightbulb, X } from "lucide-react";
import { creatorApi, type CreatorPreference } from "../lib/creatorApi";
import "./short-creator.css";

export type ShortEntry = "idea" | "story" | "sample";
export function CreatorWelcome({ onStart }: { onStart: (entry: ShortEntry) => void }) {
  const [preference, setPreference] = useState<CreatorPreference | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void creatorApi.preference().then(value => {
      if (!active) return;
      setPreference(value);
      const show = !value.hasProjects && ["new", "shown"].includes(value.guideState);
      setOpen(show);
      if (show && value.guideState === "new") void creatorApi.guide("shown").catch(() => undefined);
    }).catch(() => { if (active) setError("首作引导状态暂未读取成功。你仍可主动开始。"); });
    return () => { active = false; };
  }, []);
  async function skip() {
    try { setPreference(await creatorApi.guide("skipped")); setOpen(false); setError(""); }
    catch { setError("暂未保存跳过状态，请稍后再试。"); }
  }
  function start(entry: ShortEntry) {
    void creatorApi.guide("started").catch(() => undefined);
    onStart(entry);
  }
  return <section className={`creator-welcome${open ? " is-open" : ""}`} aria-label="首作引导">
    {open ? <>
      <div className="creator-welcome-heading"><span className="section-kicker">你的第一条短片</span><button type="button" className="ghost-button" onClick={() => void skip()} aria-label="暂时跳过首作引导"><X size={16} />稍后再看</button></div>
      <h2>先讲一个小故事。</h2>
      <p>选一个主角、一个冲突，用 30 秒开始。先确认剧本，再看分镜和决定哪些镜头需要视频。</p>
      <div className="creator-entry-options">
        <button type="button" onClick={() => start("idea")}><Lightbulb size={22} /><strong>我有一个灵感</strong><span>一句话也可以开始</span><ArrowRight size={17} /></button>
        <button type="button" onClick={() => start("story")}><BookOpen size={22} /><strong>我有故事或剧本</strong><span>保留原意，改编成短片</span><ArrowRight size={17} /></button>
        <button type="button" onClick={() => start("sample")}><Clapperboard size={22} /><strong>先试一个示例</strong><span>可改写的示例灵感，生成前报价</span><ArrowRight size={17} /></button>
      </div>
      <p className="creator-caption">写下故事 → 确认剧本 → 预览分镜 → 制作成片。每一步都可以回来修改。</p>
    </> : <div className="creator-welcome-compact"><div><strong>从一条 30 秒短片开始</strong><span>{preference?.guideState === "skipped" ? "随时重新打开首作引导" : "把灵感写成可以制作的短剧本"}</span></div><button type="button" className="ghost-button" onClick={() => setOpen(true)}>打开首作引导<ArrowRight size={16} /></button></div>}
    {error ? <p role="status" className="creator-caption">{error}</p> : null}
  </section>;
}
