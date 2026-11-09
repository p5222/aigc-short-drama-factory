import { useId, useRef, useState } from "react";
import type { UserFeedback } from "@aifilm/shared";
import { InlineNotice } from "../../design-system/ui";
import "./quality-feedback.css";

export type QualityFeedbackInput = Pick<UserFeedback, "rating" | "usability" | "tags" | "content">;

/** The parent keys this form by asset so an opinion never follows a new selection. */
export function QualityFeedbackForm({ stage, recentCount, disabled, onSubmit }: {
  stage: string; recentCount: number; disabled?: boolean; onSubmit: (input: QualityFeedbackInput) => Promise<string>;
}) {
  const id = useId();
  const [rating, setRating] = useState<number>();
  const [usability, setUsability] = useState<UserFeedback["usability"]>();
  const [tags, setTags] = useState<string[]>([]);
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const pending = useRef(false);
  const tagOptions = stage === "character" ? ["角色不像", "脸型漂移", "服装不一致", "参考图不足"] : ["角色不像", "构图问题", "提示词不符", "画面崩坏"];
  async function submit() {
    if (pending.current || disabled || !rating || !usability) return;
    pending.current = true; setSubmitting(true); setError(""); setMessage("");
    try {
      const result = await onSubmit({ rating, usability, tags, content: content.trim() });
      setMessage(result); setContent(""); setTags([]); setRating(undefined); setUsability(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "反馈提交失败，内容已保留。");
    } finally { pending.current = false; setSubmitting(false); }
  }
  const locked = disabled || submitting;
  return <div className="qf-composer">
    <small>{disabled ? "先选择已生成的资产，再提交效果反馈。" : `已保存 ${recentCount} 条反馈 · 仅评价当前选中的结果`}</small>
    <fieldset disabled={locked}><legend>效果评分 <small>必选</small></legend><div className="qf-choice-row">{[1, 2, 3, 4, 5].map(value => <label key={value}><input type="radio" name={`${id}-rating`} aria-label={`${value} 分`} checked={rating === value} onChange={() => setRating(value)} /><span>{value}</span></label>)}</div><div className="qf-rating-scale"><span>不符合预期</span><span>符合预期</span></div></fieldset>
    <fieldset disabled={locked}><legend>能否用于作品 <small>必选</small></legend><div className="qf-choice-row">{([["usable", "可用"], ["barely_usable", "需调整"], ["unusable", "不可用"]] as const).map(([value, label]) => <label key={value}><input type="radio" name={`${id}-usability`} checked={usability === value} onChange={() => setUsability(value)} /><span>{label}</span></label>)}</div></fieldset>
    <fieldset disabled={locked}><legend>具体问题 <small>可多选</small></legend><div className="qf-composer-tags">{tagOptions.map(tag => <button type="button" key={tag} disabled={locked} aria-pressed={tags.includes(tag)} onClick={() => setTags(current => current.includes(tag) ? current.filter(value => value !== tag) : [...current, tag])}>{tag}</button>)}</div></fieldset>
    <label>补充说明<textarea value={content} disabled={locked} maxLength={2000} onChange={event => setContent(event.target.value)} placeholder="例如：人物服装与上一镜不一致，希望保持同一套服装。" /><small>{content.length} / 2000 · 可在「评测与反馈」查看处理进度</small></label>
    <button type="button" className="wb-secondary-button" disabled={locked || !rating || !usability} onClick={() => void submit()}>{submitting ? "提交中…" : "提交反馈"}</button>
    {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}
    {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
  </div>;
}
