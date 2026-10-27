import { useEffect, useRef, useState } from "react";
import type { DeliveryEditClip, ProjectWorkflow } from "@aifilm/shared";
import { defaultDeliveryClips } from "@aifilm/shared";
import { api } from "../../lib/api";
import type { WorkbenchSaveState } from "../WorkbenchContext";

interface Draft { clips: DeliveryEditClip[]; revision: number; dirty: boolean; undo: DeliveryEditClip[][]; }

export function useDeliveryEdit(workflow: ProjectWorkflow, episodeNo: number,
  onRefresh: (projectId: string) => Promise<ProjectWorkflow>, onSaveStateChange: (state: WorkbenchSaveState) => void) {
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [saving, setSaving] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const savingRef = useRef(false);
  const saved = workflow.deliveryEdits?.find(edit => edit.episodeNo === episodeNo);
  const initial: Draft = { clips: saved?.clips ?? defaultDeliveryClips(workflow, episodeNo), revision: saved?.revision ?? 0, dirty: false, undo: [] };
  const draft = drafts[episodeNo] ?? initial;
  const dirty = Object.values(drafts).some(item => item.dirty);

  useEffect(() => {
    onSaveStateChange(saving ? "saving" : dirty ? "dirty" : saved ? "saved" : "unchanged");
  }, [dirty, saving, saved?.revision, onSaveStateChange]);
  useEffect(() => () => onSaveStateChange("unchanged"), [onSaveStateChange]);
  useEffect(() => {
    if (!saved) return;
    setDrafts(current => !current[episodeNo]?.dirty && current[episodeNo]?.revision !== saved.revision
      ? { ...current, [episodeNo]: { clips: saved.clips, revision: saved.revision, dirty: false, undo: [] } } : current);
  }, [saved, episodeNo]);

  function edit(clips: DeliveryEditClip[]) {
    if (savingRef.current) return;
    setDrafts(current => ({ ...current, [episodeNo]: { ...draft, clips, dirty: true, undo: [...draft.undo, draft.clips].slice(-30) } }));
    setError(""); setMessage("");
  }
  function undo() {
    const clips = draft.undo.at(-1);
    if (!clips || savingRef.current) return;
    setDrafts(current => ({ ...current, [episodeNo]: { ...draft, clips, dirty: true, undo: draft.undo.slice(0, -1) } }));
  }
  async function save() {
    if (savingRef.current || (!draft.dirty && draft.revision > 0)) return;
    savingRef.current = true; setSaving(true); setError(""); setMessage("");
    const episode = episodeNo;
    try {
      const result = await api.saveDeliveryEdit(workflow.project.id, { episodeNo: episode, expectedRevision: draft.revision, clips: draft.clips });
      setDrafts(current => ({ ...current, [episode]: { clips: result.clips, revision: result.revision, dirty: false, undo: [] } }));
      setMessage(`第 ${episode} 集剪辑 v${result.revision} 已保存`);
      try { await onRefresh(workflow.project.id); }
      catch { setError("剪辑已保存，页面刷新失败。请重新核对数据；无需再次保存。"); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "剪辑保存结果暂无法确认，请保留草稿并刷新核对。"); }
    finally { savingRef.current = false; setSaving(false); }
  }
  async function reloadSaved() {
    if (savingRef.current || (draft.dirty && !window.confirm("载入云端剪辑将放弃本集未保存修改。可先下载剪辑草稿，再继续。"))) return;
    savingRef.current = true; setSaving(true); setError("");
    try {
      const refreshed = await onRefresh(workflow.project.id);
      const edit = refreshed.deliveryEdits?.find(item => item.episodeNo === episodeNo);
      setDrafts(current => ({ ...current, [episodeNo]: { clips: edit?.clips ?? defaultDeliveryClips(refreshed, episodeNo), revision: edit?.revision ?? 0, dirty: false, undo: [] } }));
      setMessage("已载入云端保存的剪辑");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "载入失败，原草稿仍保留。"); }
    finally { savingRef.current = false; setSaving(false); }
  }
  function downloadDraft() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ projectId: workflow.project.id, episodeNo, expectedRevision: draft.revision, clips: draft.clips }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `${workflow.project.name}-第${episodeNo}集-剪辑草稿.json`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  return { draft, edit, undo, save, reloadSaved, saving, error, message, downloadDraft,
    reference: draft.revision > 0 && !draft.dirty ? { episodeNo, revision: draft.revision } : undefined };
}
