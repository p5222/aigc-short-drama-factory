import { BookOpenCheck, Clock3, MapPin } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ProjectWorkflow } from "@aifilm/shared";
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
  onRefresh: (projectId: string) => void | Promise<void>;
}

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
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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
  const episodeScenes = scenes.filter((scene) => scene.episodeNo === selection.activeEpisodeNo);

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

  async function generateStoryboardStructure() {
    if (!script || isGenerating) return;
    if (storyboards.length && !window.confirm("重建镜头结构会覆盖现有镜头、分镜图和视频草稿，确认继续？")) return;

    setIsGenerating(true);
    setMessage("");
    setError("");
    try {
      await api.generateStoryboards(project.id, buildStoryboardGenerationPayload(project));
      const refreshedWorkflow = await api.workflow(project.id);
      dispatch({ type: "reconcile-workflow", storyboards: refreshedWorkflow.storyboards });
      dispatch({ type: "set-stage", stage: "assets" });
      setMessage("镜头结构已生成，正在进入资产阶段。");
      await onRefresh(project.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "镜头结构生成失败");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <ProductionWorkspace
      railOpen={railOpen}
      inspectorOpen={inspectorOpen}
      onCloseRail={onCloseRail}
      onCloseInspector={onCloseInspector}
      rail={(
        <div className="wb-content-rail">
          <div className="wb-region-section">
            <h2 className="wb-region-heading">剧集与场次</h2>
            <p className="wb-region-copy">选择一集，再查看该集识别出的场次。</p>
          </div>
          <div className="wb-episode-tabs" role="tablist" aria-label="剧集">
            {episodeNumbers.map((episodeNo) => {
              const count = scenes.filter((scene) => scene.episodeNo === episodeNo).length;
              return (
                <button
                  key={episodeNo}
                  type="button"
                  role="tab"
                  aria-selected={selection.activeEpisodeNo === episodeNo}
                  className={selection.activeEpisodeNo === episodeNo ? "is-active" : undefined}
                  onClick={() => selectEpisode(episodeNo)}
                >
                  <span>第 {episodeNo} 集</span>
                  <small>{count} 场</small>
                </button>
              );
            })}
          </div>
          <div className="wb-scene-list" aria-label={`第 ${selection.activeEpisodeNo ?? "-"} 集场次`}>
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
            {!episodeScenes.length ? <p className="wb-empty-state">本集尚未识别到真实场次。</p> : null}
          </div>
        </div>
      )}
      canvas={(
        <div className="wb-content-canvas">
          <header className="wb-content-canvas__heading">
            <div>
              <span>第 {selection.activeEpisodeNo ?? "-"} 集</span>
              <h1>{selectedScene?.title || "暂无场次"}</h1>
            </div>
            {selectedScene ? <small>{selectedScene.sourceLabel}</small> : null}
          </header>
          <section className="wb-content-synopsis" aria-labelledby="content-synopsis-heading">
            <h2 id="content-synopsis-heading">剧情梗概</h2>
            <p>{script?.synopsis || "当前剧本没有提供梗概。"}</p>
          </section>
          {selectedScene ? (
            <div className="wb-content-fields">
              <ContentField label="场景描述" value={selectedScene.lines.join("\n") || "当前场次没有场景描述。"} wide />
              <ContentField label="人物出场" value={selectedScene.characters.join(" / ") || "当前数据未提供出场角色。"} />
              <ContentField label="动作与调度" value={selectedScene.action || "当前数据未提供动作与调度。"} />
              <ContentField label="台词与旁白" value={selectedScene.dialogue.join("\n") || "当前场次没有明确台词或旁白。"} wide />
            </div>
          ) : (
            <div className="wb-empty-state wb-empty-state--canvas">选择有真实内容的剧集后查看场次。</div>
          )}
        </div>
      )}
      inspector={(
        <div className="wb-content-inspector">
          <div className="wb-region-section">
            <h2 className="wb-region-heading">场次信息</h2>
            <p className="wb-region-copy">仅展示当前剧本或镜头结构中已有的信息。</p>
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
            <button type="button" onClick={() => void generateStoryboardStructure()} disabled={!script || isGenerating}>
              <BookOpenCheck aria-hidden="true" />
              {isGenerating ? "正在生成镜头结构" : "确认内容并生成镜头结构"}
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
