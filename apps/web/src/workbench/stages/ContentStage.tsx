import { BookOpenCheck, Clock3, MapPin, Pencil, RefreshCw, Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ProjectWorkflow, StoryboardShot } from "@aifilm/shared";
import type { ContentSceneRow } from "../model";
import {
  buildContentSceneRows,
  buildStoryboardGenerationPayload,
  collectContentEpisodeNumbers,
  reconcileContentSelection
} from "../model";
import { useWorkbench } from "../WorkbenchContext";
import { ProductionWorkspace } from "../components/ProductionWorkspace";
import { api } from "../../lib/api";

interface ContentStageProps {
  railOpen: boolean;
  inspectorOpen: boolean;
  onCloseRail: () => void;
  onCloseInspector: () => void;
  onRefresh: (projectId: string) => Promise<ProjectWorkflow>;
}

type ContentActionPhase = "idle" | "generating" | "syncing" | "refresh-required";

export function ContentStage({
  railOpen,
  inspectorOpen,
  onCloseRail,
  onCloseInspector,
  onRefresh
}: ContentStageProps) {
  const { workflow } = useWorkbench();
  if (!workflow) return null;
  return <LoadedContentStage workflow={workflow} railOpen={railOpen} inspectorOpen={inspectorOpen} onCloseRail={onCloseRail} onCloseInspector={onCloseInspector} onRefresh={onRefresh} />;
}

function LoadedContentStage({
  workflow,
  railOpen,
  inspectorOpen,
  onCloseRail,
  onCloseInspector,
  onRefresh
}: ContentStageProps & { workflow: ProjectWorkflow }) {
  const { state, dispatch } = useWorkbench();
  const [actionPhase, setActionPhase] = useState<ContentActionPhase>("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [shotDraft, setShotDraft] = useState<Partial<StoryboardShot>>({});

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
    setShotDraft(selectedShot ? { pictureDesc: selectedShot.pictureDesc, action: selectedShot.action, dialogue: selectedShot.dialogue, voiceOver: selectedShot.voiceOver, emotion: selectedShot.emotion } : {});
  }, [selectedShot?.id]);

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
    const next = reconcileContentSelection(episodeNo, null, episodeNumbers, scenes);
    dispatch({
      type: "set-content-selection",
      episodeNo: next.activeEpisodeNo,
      sceneKey: next.activeSceneKey,
      storyboards
    });
  }

  function selectScene(scene: ContentSceneRow) {
    dispatch({
      type: "set-content-selection",
      episodeNo: scene.episodeNo,
      sceneKey: scene.key,
      storyboards
    });
  }

  async function syncGeneratedWorkflow() {
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
    }
  }

  async function generateStoryboardStructure() {
    if (!script || actionPhase !== "idle") return;
    if (storyboards.length && !window.confirm("重建镜头结构会覆盖现有镜头、分镜图和视频草稿，确认继续？")) return;

    setActionPhase("generating");
    setMessage("");
    setError("");
    try {
      await api.generateStoryboards(project.id, buildStoryboardGenerationPayload(project));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "镜头结构生成失败");
      setActionPhase("idle");
      return;
    }
    await syncGeneratedWorkflow();
  }

  async function saveShotChanges() {
    if (!selectedShot) return;
    setActionPhase("syncing"); setError(""); setMessage("");
    try {
      await api.updateStoryboardShot(project.id, selectedShot.id, shotDraft);
      const refreshedWorkflow = await onRefresh(project.id);
      dispatch({ type: "reconcile-workflow", storyboards: refreshedWorkflow.storyboards });
      setEditing(false);
      setMessage("镜头内容已保存。后续生成将使用修改后的内容。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "镜头保存失败");
    } finally {
      setActionPhase("idle");
    }
  }

  const actionPending = actionPhase === "generating" || actionPhase === "syncing";
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
            {selectedShot ? <button type="button" className="wb-content-edit-button" onClick={() => setEditing((value) => !value)}>{editing ? <X size={15} /> : <Pencil size={15} />}{editing ? "取消编辑" : "编辑镜头"}</button> : selectedScene ? <small>{selectedScene.sourceLabel}</small> : null}
          </header>
          <section className="wb-content-synopsis" aria-labelledby="content-synopsis-heading">
            <h2 id="content-synopsis-heading">剧情梗概</h2>
            <p>{script?.synopsis || "当前剧本没有提供梗概。"}</p>
          </section>
          {selectedScene && editing && selectedShot ? (
            <div className="wb-content-shot-editor">
              <p className="wb-content-edit-warning">人工修改会直接影响后续图片、视频和成片生成。系统无法保证自行调整后的提示、动作或台词仍能获得原有生成效果，请确认后再保存。</p>
              <EditField label="画面描述" value={String(shotDraft.pictureDesc ?? "")} onChange={(value) => setShotDraft((current) => ({ ...current, pictureDesc: value }))} />
              <EditField label="动作与调度" value={String(shotDraft.action ?? "")} onChange={(value) => setShotDraft((current) => ({ ...current, action: value }))} />
              <EditField label="台词" value={String(shotDraft.dialogue ?? "")} onChange={(value) => setShotDraft((current) => ({ ...current, dialogue: value }))} />
              <EditField label="旁白" value={String(shotDraft.voiceOver ?? "")} onChange={(value) => setShotDraft((current) => ({ ...current, voiceOver: value }))} />
              <EditField label="情绪" value={String(shotDraft.emotion ?? "")} onChange={(value) => setShotDraft((current) => ({ ...current, emotion: value }))} />
              <button type="button" className="wb-content-save-button" disabled={actionPending} onClick={() => void saveShotChanges()}><Save size={16} />保存镜头修改</button>
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
              disabled={(!script && !refreshOnly) || actionPending}
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

function EditField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="wb-content-edit-field"><span>{label}</span><textarea value={value} onChange={(event) => onChange(event.target.value)} /></label>;
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
