import { BookOpenCheck, Clock3, MapPin, Pencil, RefreshCw, Save, X } from "lucide-react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ProjectWorkflow, StoryboardShot } from "@aifilm/shared";
import type { ContentSceneRow } from "../model";
import {
  buildContentSceneRows,
  buildStoryboardGenerationPayload,
  collectContentEpisodeNumbers,
  reconcileContentSelection,
  createShotDraftState,
  reduceShotDraftState
} from "../model";
import { useWorkbench, type WorkbenchSaveState } from "../WorkbenchContext";
import { ProductionWorkspace } from "../components/ProductionWorkspace";
import { api } from "../../lib/api";
import { canDiscardContentDraft, contentShotDraft } from "./contentDraftModel";

interface ContentStageProps {
  railOpen: boolean;
  inspectorOpen: boolean;
  onCloseRail: () => void;
  onCloseInspector: () => void;
  onRefresh: (projectId: string) => Promise<ProjectWorkflow>;
  onSaveStateChange: (state: WorkbenchSaveState) => void;
}

type ContentActionPhase = "idle" | "generating" | "syncing" | "refresh-required";

export function ContentStage({
  railOpen,
  inspectorOpen,
  onCloseRail,
  onCloseInspector,
  onRefresh,
  onSaveStateChange
}: ContentStageProps) {
  const { workflow } = useWorkbench();
  if (!workflow) return null;
  return <LoadedContentStage workflow={workflow} railOpen={railOpen} inspectorOpen={inspectorOpen} onCloseRail={onCloseRail} onCloseInspector={onCloseInspector} onRefresh={onRefresh} onSaveStateChange={onSaveStateChange} />;
}

function LoadedContentStage({
  workflow,
  railOpen,
  inspectorOpen,
  onCloseRail,
  onCloseInspector,
  onRefresh,
  onSaveStateChange
}: ContentStageProps & { workflow: ProjectWorkflow }) {
  const { state, dispatch } = useWorkbench();
  const [actionPhase, setActionPhase] = useState<ContentActionPhase>("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [draftState, updateDraft] = useReducer(reduceShotDraftState, createShotDraftState("", {}));
  const operationRef = useRef<{ token: string; shotId: string } | null>(null);
  const sequence = useRef(0);
  const structurePending = useRef(false);
  const shotDraft = draftState.draft;

  const { project, script, storyboards } = workflow;
  const scenes = useMemo(() => buildContentSceneRows(script, storyboards), [script, storyboards]);
  const episodeNumbers = useMemo(
    () => collectContentEpisodeNumbers(scenes, project.episodes),
    [project.episodes, scenes]
  );
  const selection = reconcileContentSelection(
    state.activeEpisodeNo,
    state.activeSceneKey,
    episodeNumbers,
    scenes
  );
  const selectedScene = scenes.find((scene) => sceneKeyEquals(scene, selection.activeSceneKey));
  const selectedShot = selectedScene?.shotId ? storyboards.find((shot) => shot.id === selectedScene.shotId) : undefined;
  const episodeScenes = scenes.filter((scene) => scene.episodeNo === selection.activeEpisodeNo);

  useEffect(() => {
    setEditing(false);
    operationRef.current = null;
    updateDraft({ type: "rebuild", shotId: selectedShot?.id ?? "", draft: contentShotDraft(selectedShot) });
  }, [selectedShot?.id]);

  useEffect(() => {
    if (selectedShot) updateDraft({ type: "reconcile-canonical", shotId: selectedShot.id, draft: contentShotDraft(selectedShot) });
  }, [selectedShot]);

  const actionPending = actionPhase === "generating" || actionPhase === "syncing" || Boolean(draftState.activeOperation);
  useEffect(() => { onSaveStateChange(actionPending ? "saving" : draftState.status); }, [actionPending, draftState.status, onSaveStateChange]);
  useEffect(() => () => { operationRef.current = null; onSaveStateChange("unchanged"); }, [onSaveStateChange]);

  function canLeaveDraft() {
    if (structurePending.current || operationRef.current) return false;
    return canDiscardContentDraft(draftState, () => window.confirm("当前镜头有未保存修改。确认放弃这些修改并继续？"));
  }

  function toggleEditing() {
    if (actionPending) return;
    if (editing) {
      if (!canLeaveDraft()) return;
      updateDraft({ type: "rebuild", shotId: selectedShot?.id ?? "", draft: contentShotDraft(selectedShot) });
    }
    setEditing(value => !value);
    setError(""); setMessage("");
  }

  function edit(patch: Partial<StoryboardShot>) {
    if (actionPending || operationRef.current) return;
    updateDraft({ type: "edit", patch });
  }

  useEffect(() => {
    if (
      state.activeEpisodeNo === selection.activeEpisodeNo
      && sceneKeyEqualsValue(state.activeSceneKey, selection.activeSceneKey)
    ) return;
    dispatch({
      type: "set-content-selection",
      episodeNo: selection.activeEpisodeNo,
      sceneKey: selection.activeSceneKey,
      storyboards
    });
  }, [dispatch, selection.activeEpisodeNo, selection.activeSceneKey, state.activeEpisodeNo, state.activeSceneKey, storyboards]);

  function selectEpisode(episodeNo: number) {
    if (episodeNo === selection.activeEpisodeNo || !canLeaveDraft()) return;
    const next = reconcileContentSelection(episodeNo, null, episodeNumbers, scenes);
    dispatch({
      type: "set-content-selection",
      episodeNo: next.activeEpisodeNo,
      sceneKey: next.activeSceneKey,
      storyboards
    });
  }

  function selectScene(scene: ContentSceneRow) {
    if (sceneKeyEquals(scene, selection.activeSceneKey) || !canLeaveDraft()) return;
    dispatch({
      type: "set-content-selection",
      episodeNo: scene.episodeNo,
      sceneKey: scene.key,
      storyboards
    });
  }

  async function syncGeneratedWorkflow() {
    if (structurePending.current) return;
    structurePending.current = true;
    setActionPhase("syncing");
    setMessage("镜头结构已生成，正在刷新项目数据。");
    setError("");
    try {
      const refreshedWorkflow = await onRefresh(project.id);
      dispatch({ type: "reconcile-workflow", storyboards: refreshedWorkflow.storyboards });
      dispatch({ type: "set-stage", stage: "assets" });
    } catch {
      setActionPhase("refresh-required");
      setMessage("");
      setError("镜头结构已生成，但刷新失败");
    } finally {
      structurePending.current = false;
    }
  }

  async function generateStoryboardStructure() {
    if (!script || actionPhase !== "idle" || !canLeaveDraft()) return;
    if (storyboards.length && !window.confirm("重建镜头结构会覆盖现有镜头、分镜图和视频草稿，确认继续？")) return;

    setActionPhase("generating");
    structurePending.current = true;
    setMessage("");
    setError("");
    try {
      await api.generateStoryboards(project.id, buildStoryboardGenerationPayload(project));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "镜头结构生成失败");
      setActionPhase("idle");
      structurePending.current = false;
      return;
    }
    structurePending.current = false;
    await syncGeneratedWorkflow();
  }

  async function saveShotChanges() {
    if (!selectedShot || operationRef.current || structurePending.current || (draftState.status !== "dirty" && draftState.status !== "error")) return;
    const shotId = selectedShot.id;
    const token = `content-save:${++sequence.current}:${shotId}`;
    operationRef.current = { token, shotId };
    const isCurrent = () => operationRef.current?.token === token && operationRef.current.shotId === shotId;
    updateDraft({ type: "save-start", token }); setError(""); setMessage("");
    let updated: StoryboardShot;
    try {
      updated = await api.updateStoryboardShot(project.id, shotId, { ...shotDraft });
      if (!isCurrent()) return;
      updateDraft({ type: "save-committed", token, draft: contentShotDraft(updated) });
    } catch (cause) {
      if (!isCurrent()) return;
      const detail = cause instanceof Error ? cause.message : "镜头保存失败";
      updateDraft({ type: "save-failed", token, error: detail });
      operationRef.current = null;
      setError(detail);
      return;
    }
    try {
      const refreshedWorkflow = await onRefresh(project.id);
      if (!isCurrent()) return;
      updateDraft({ type: "sync-succeeded", token, draft: contentShotDraft(refreshedWorkflow.storyboards.find(shot => shot.id === shotId) ?? updated) });
      dispatch({ type: "reconcile-workflow", storyboards: refreshedWorkflow.storyboards });
      setEditing(false);
      setMessage("镜头内容已保存。后续生成将使用修改后的内容。");
    } catch (cause) {
      if (!isCurrent()) return;
      const detail = "镜头已保存，但项目刷新失败。请仅重试刷新，无需再次保存。";
      updateDraft({ type: "save-committed", token, draft: contentShotDraft(updated), refreshError: detail });
      setError(detail);
    } finally {
      if (isCurrent()) operationRef.current = null;
    }
  }

  async function retrySavedShotRefresh() {
    if (operationRef.current || draftState.status !== "sync-required") return;
    const shotId = draftState.shotId;
    const token = `content-refresh:${++sequence.current}:${shotId}`;
    operationRef.current = { token, shotId };
    updateDraft({ type: "sync-start", token }); setError("");
    try {
      const refreshed = await onRefresh(project.id);
      if (operationRef.current?.token !== token) return;
      updateDraft({ type: "sync-succeeded", token, draft: contentShotDraft(refreshed.storyboards.find(shot => shot.id === shotId) ?? selectedShot) });
      setEditing(false); setMessage("镜头已保存，项目数据已刷新。");
    } catch (cause) {
      if (operationRef.current?.token !== token) return;
      const detail = cause instanceof Error ? cause.message : "刷新失败，请稍后再试。";
      updateDraft({ type: "sync-failed", token, error: detail }); setError(detail);
    } finally { if (operationRef.current?.token === token) operationRef.current = null; }
  }

  const refreshOnly = actionPhase === "refresh-required";

  return (
    <ProductionWorkspace
      railOpen={railOpen}
      inspectorOpen={inspectorOpen}
      onCloseRail={onCloseRail}
      onCloseInspector={onCloseInspector}
      rail={(
        <div className="wb-content-rail">
          <div className="wb-region-section">
            <h2 className="wb-region-heading">剧集与镜头</h2>
            <p className="wb-region-copy">选择一集，再查看该集的镜头列表。</p>
          </div>
          <div className="wb-episode-tabs" role="group" aria-label="剧集">
            {episodeNumbers.map((episodeNo) => {
              const count = scenes.filter((scene) => scene.episodeNo === episodeNo).length;
              return (
                <button
                  key={episodeNo}
                  type="button"
                  aria-pressed={selection.activeEpisodeNo === episodeNo}
                  disabled={actionPending}
                  className={selection.activeEpisodeNo === episodeNo ? "is-active" : undefined}
                  onClick={() => selectEpisode(episodeNo)}
                >
                  <span>第 {episodeNo} 集</span>
                  <small>{count} 镜头</small>
                </button>
              );
            })}
          </div>
          <div className="wb-scene-list" aria-label={`第 ${selection.activeEpisodeNo ?? "-"} 集镜头`}>
            {episodeScenes.map((scene) => (
              <button
                key={scene.id}
                type="button"
                className={sceneKeyEquals(scene, selection.activeSceneKey) ? "is-selected" : undefined}
                aria-pressed={sceneKeyEquals(scene, selection.activeSceneKey)}
                disabled={actionPending}
                onClick={() => selectScene(scene)}
              >
                <span className="wb-scene-list__index">{String(scene.sceneNo).padStart(2, "0")}</span>
                <span className="wb-scene-list__copy">
                  <strong>{scene.title}</strong>
                  <small>{scene.sourceLabel} · {scene.duration || "-"} 秒</small>
                </span>
              </button>
            ))}
            {!episodeScenes.length ? <p className="wb-empty-state">本集尚未生成镜头。</p> : null}
          </div>
        </div>
      )}
      canvas={(
        <div className="wb-content-canvas">
          <header className="wb-content-canvas__heading">
            <div>
              <span>第 {selection.activeEpisodeNo ?? "-"} 集</span>
              <h1>{selectedScene?.title || "暂无镜头"}</h1>
            </div>
            {selectedShot ? <button type="button" className="wb-content-edit-button" disabled={actionPending || actionPhase === "refresh-required" || draftState.status === "sync-required"} onClick={toggleEditing}>{editing ? <X size={15} /> : <Pencil size={15} />}{editing ? "取消编辑" : "编辑镜头"}</button> : selectedScene ? <small>{selectedScene.sourceLabel}</small> : null}
          </header>
          <section className="wb-content-synopsis" aria-labelledby="content-synopsis-heading">
            <h2 id="content-synopsis-heading">剧情梗概</h2>
            <p>{script?.synopsis || "当前剧本没有提供梗概。"}</p>
          </section>
          {selectedScene && editing && selectedShot ? (
            <div className="wb-content-shot-editor">
          <p className="wb-content-edit-warning">保存后，本镜头及实际承接它的镜头需要重新生成画面和视频。旧素材与导出文件保留为历史版本，已发布作品保持原视频。</p>
              <EditField label="画面描述" value={String(shotDraft.pictureDesc ?? "")} disabled={actionPending || draftState.status === "sync-required"} onChange={(value) => edit({ pictureDesc: value })} />
              <EditField label="动作与调度" value={String(shotDraft.action ?? "")} disabled={actionPending || draftState.status === "sync-required"} onChange={(value) => edit({ action: value })} />
              <EditField label="台词" value={String(shotDraft.dialogue ?? "")} disabled={actionPending || draftState.status === "sync-required"} onChange={(value) => edit({ dialogue: value })} />
              <EditField label="旁白" value={String(shotDraft.voiceOver ?? "")} disabled={actionPending || draftState.status === "sync-required"} onChange={(value) => edit({ voiceOver: value })} />
              <EditField label="情绪" value={String(shotDraft.emotion ?? "")} disabled={actionPending || draftState.status === "sync-required"} onChange={(value) => edit({ emotion: value })} />
              {draftState.status === "sync-required" ? <button type="button" className="wb-content-save-button" disabled={actionPending} onClick={() => void retrySavedShotRefresh()}><RefreshCw size={16} />已保存，仅重试刷新</button> : <button type="button" className="wb-content-save-button" disabled={actionPending || (draftState.status !== "dirty" && draftState.status !== "error")} onClick={() => void saveShotChanges()}><Save size={16} />{actionPending ? "保存中…" : draftState.status === "error" ? "重试保存" : "保存镜头修改"}</button>}
              {error ? <p className="wb-action-feedback--error" role="alert">{error}</p> : null}
            </div>
          ) : selectedScene ? (
            <div className="wb-content-fields">
              <ContentField label="场景描述" value={selectedScene.lines.join("\n") || "当前场次没有场景描述。"} wide />
              <ContentField label="人物出场" value={selectedScene.characters.join(" / ") || "当前数据未提供出场角色。"} />
              <ContentField label="动作与调度" value={selectedScene.action || "当前数据未提供动作与调度。"} />
              <ContentField label="台词与旁白" value={selectedScene.dialogue.join("\n") || "当前场次没有明确台词或旁白。"} wide />
            </div>
          ) : (
            <div className="wb-empty-state wb-empty-state--canvas">选择有真实内容的剧集后查看镜头。</div>
          )}
        </div>
      )}
      inspector={(
        <div className="wb-content-inspector">
          <div className="wb-region-section">
            <h2 className="wb-region-heading">镜头信息</h2>
            <p className="wb-region-copy">台词、动作和情绪均属于当前镜头。</p>
          </div>
          <dl className="wb-content-metadata">
            <div><dt><Clock3 aria-hidden="true" />时间</dt><dd>{selectedScene?.timeOfDay || "未提供"}</dd></div>
            <div><dt><MapPin aria-hidden="true" />地点</dt><dd>{selectedScene?.location || "未提供"}</dd></div>
            <div><dt>天气</dt><dd>{selectedScene?.weather || "未提供"}</dd></div>
            <div><dt>情绪</dt><dd>{selectedScene?.emotion || "未提供"}</dd></div>
            <div><dt>出场角色</dt><dd>{selectedScene?.characters.join("、") || "未提供"}</dd></div>
            <div><dt>内容状态</dt><dd>{selectedScene ? contentStatusLabel(selectedScene) : "无场次"}</dd></div>
          </dl>
          <div className="wb-content-primary-action">
            <button
              type="button"
              onClick={() => void (refreshOnly ? syncGeneratedWorkflow() : generateStoryboardStructure())}
              disabled={(!script && !refreshOnly) || actionPending || draftState.status === "sync-required"}
            >
              {refreshOnly || actionPhase === "syncing" ? <RefreshCw aria-hidden="true" /> : <BookOpenCheck aria-hidden="true" />}
              {actionPhase === "generating"
                ? "正在生成镜头结构"
                : actionPhase === "syncing"
                  ? "正在刷新项目"
                  : refreshOnly
                    ? "重试刷新"
                    : "确认内容并生成镜头结构"}
            </button>
            <div className="wb-action-feedback" aria-live="polite">
              {message ? <p className="wb-action-feedback--success">{message}</p> : null}
              {error ? <p className="wb-action-feedback--error">{error}</p> : null}
            </div>
          </div>
        </div>
      )}
    />
  );
}

function ContentField({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <section className={wide ? "wb-content-field wb-content-field--wide" : "wb-content-field"}>
      <h2>{label}</h2>
      {value.split("\n").map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}
    </section>
  );
}

function EditField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return <label className="wb-content-edit-field"><span>{label}</span><textarea value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} /></label>;
}

function sceneKeyEquals(scene: ContentSceneRow, key: typeof scene.key | null): boolean {
  return sceneKeyEqualsValue(scene.key, key);
}

function sceneKeyEqualsValue(left: ContentSceneRow["key"] | null, right: ContentSceneRow["key"] | null): boolean {
  return left?.source === right?.source && left?.value === right?.value;
}

function contentStatusLabel(scene: ContentSceneRow): string {
  if (scene.status === "risk") return "需要复核";
  if (scene.status === "ready") return "镜头结构已生成";
  return "从剧本识别";
}
