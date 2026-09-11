import { useEffect, useRef } from "react";
import { Loader2, X } from "lucide-react";
import type { DeliveryExportQuote, DeliveryExportType } from "./deliveryQuoteModel";
import "./deliveryExportQuote.css";

export function DeliveryExportQuoteDialog({ type, episode, shotCount, quote, loading, submitting, error, maxCredits, onRetry, onSubmit, onClose }: {
  type: DeliveryExportType;
  episode: number | "all";
  shotCount: number;
  quote: DeliveryExportQuote | null;
  loading: boolean;
  submitting: boolean;
  error: string;
  maxCredits: number | null;
  onRetry: () => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const label = type === "video_export" ? "合成 MP4" : type === "tts" ? "生成配音" : "生成字幕";
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className="dlv2-quote-dialog" aria-labelledby="delivery-quote-title" aria-busy={loading || submitting} onCancel={(event) => { event.preventDefault(); if (!submitting) onClose(); }}>
    <header><div><h2 id="delivery-quote-title">确认{label}</h2><p>{episode === "all" ? "本项目全部剧集" : `第 ${episode} 集`} · {shotCount} 个镜头 · {episode === "all" ? "按项目镜头顺序" : "按当前时间线顺序"}</p></div><button type="button" className="dlv2-icon-btn" aria-label="关闭导出确认" disabled={submitting} onClick={onClose}><X size={18} /></button></header>
    {loading ? <p role="status"><Loader2 size={17} className="dlv2-spin" /> 正在计算费用…</p> : null}
    {error ? <p className="dlv2-warn" role="alert">{error}</p> : null}
    {quote && !loading ? <>
      <div className="dlv2-quote-price"><strong>{quote.estimatedCredits.toLocaleString()}</strong><span>积分</span></div>
      <p>{type === "subtitle" ? "字幕生成不扣积分。" : quote.cached ? "将复用已有配音，本次不重复扣费。" : quote.characters > 0 ? `${quote.providerName} · ${quote.model}，共 ${quote.characters} 字、${quote.cueCount} 段配音。` : "本次无需生成配音，不扣积分。"}</p>
      {type === "video_export" ? <p>费用用于当前导出范围的配音；将结合已有镜头视频合成 MP4。</p> : null}
      <p className="dlv2-job-line">提交时重新校验费用；若价格超过本次确认上限，将停止操作并要求重新报价。</p>
    </> : null}
    <footer><button className="dlv2-btn" disabled={submitting} onClick={onClose}>取消</button><button className="dlv2-btn" disabled={loading || submitting} onClick={onRetry}>刷新报价</button><button className="dlv2-btn dlv2-btn-primary" disabled={loading || submitting || maxCredits === null} onClick={onSubmit}>{submitting ? <><Loader2 size={15} className="dlv2-spin" />正在提交…</> : `确认${label}${maxCredits === null ? "" : ` · ${maxCredits} 积分`}`}</button></footer>
  </dialog>;
}
