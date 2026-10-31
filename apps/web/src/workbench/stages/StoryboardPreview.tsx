import { useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";
import type { AssetItem, StoryboardShot } from "@aifilm/shared";
import { requestJson } from "../../lib/httpClient";
import "./creator-outcome.css";

export function StoryboardPreview({ projectId, shots, imageMap }: { projectId: string; shots: StoryboardShot[]; imageMap: Map<string, AssetItem> }) {
  const [open, setOpen] = useState(false), [playing, setPlaying] = useState(false), [time, setTime] = useState(0);
  const signature = shots.map(shot => `${shot.id}:${shot.duration}:${imageMap.get(shot.id)?.referenceUrl}`).join("|");
  const durations = shots.map(shot => Number.isFinite(shot.duration) && shot.duration > 0 ? shot.duration : 1);
  const total = durations.reduce((sum, seconds) => sum + seconds, 0);
  let elapsed = 0;
  const index = Math.max(0, durations.findIndex((duration, i) => { elapsed += duration; return time < elapsed || i === shots.length - 1; }));
  const shot = shots[index], image = shot ? imageMap.get(shot.id) : undefined;
  const ready = shots.filter(shot => imageMap.get(shot.id)?.status === "succeeded" && imageMap.get(shot.id)?.referenceUrl).length;
  const [failedUrl, setFailedUrl] = useState("");
  useEffect(() => { setTime(0); setPlaying(false); }, [signature]);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => { if (!document.hidden) setTime(value => Math.min(total, value + .25)); }, 250);
    return () => window.clearInterval(timer);
  }, [playing, total]);
  useEffect(() => { if (time >= total) setPlaying(false); }, [time, total]);
  return <section className="story-preview" aria-label="动态分镜预览">
    <button type="button" className="wb-secondary-button" aria-expanded={open} onClick={() => {
      setOpen(value => !value); setPlaying(false);
      if (!open) void requestJson(`/projects/${encodeURIComponent(projectId)}/creator-events`, { method: "POST", body: JSON.stringify({ event: "creator_preview_viewed" }) }).catch(() => undefined);
    }}><Play size={16} />{open ? "收起动态分镜" : "预览故事节奏"}<small>{ready}/{shots.length} 张首帧</small></button>
    {open ? <div className="story-preview-body">
      <div className="story-preview-stage">
        {image?.status === "succeeded" && image.referenceUrl && failedUrl !== image.referenceUrl ? <img key={shot.id} src={image.referenceUrl} alt={shot.pictureDesc || `镜头 ${shot.shotNo}`} onError={() => { setFailedUrl(image.referenceUrl!); setPlaying(false); }} /> : <div className="story-preview-missing"><strong>{image?.referenceUrl === failedUrl ? "首帧暂时无法显示" : "本镜头首帧尚未就绪"}</strong><p>{shot?.pictureDesc || "先创建分镜，再查看故事节奏。"}</p></div>}
        <span className="story-preview-label">分镜预览 · 静帧按时长播放</span>
        {shot?.dialogue || shot?.voiceOver ? <p className="story-preview-subtitle">{shot.dialogue || shot.voiceOver}</p> : null}
      </div>
      <div className="story-preview-controls"><button className="wb-secondary-button" type="button" disabled={!shots.length} aria-label={playing ? "暂停分镜预览" : "播放分镜预览"} onClick={() => { if (time >= total) setTime(0); setPlaying(value => !value); }}>{playing ? <Pause size={16} /> : <Play size={16} />}</button><label><span className="sr-only">分镜预览进度</span><input aria-label="分镜预览进度" type="range" min={0} max={total || 1} step={.1} value={time} onChange={event => { setPlaying(false); setTime(Number(event.target.value)); }} /></label><span>{time.toFixed(1)} / {total.toFixed(1)}s</span></div>
      <p>镜头 {shot?.shotNo ?? "—"} · {shot?.cameraMovement || "未指定运镜"}。此预览不含真实运动与配音，不产生视频生成费用。</p>
      <p>看好节奏后，勾选需要制作的镜头，再切换到“视频”查看该批次费用。</p>
    </div> : null}
  </section>;
}
