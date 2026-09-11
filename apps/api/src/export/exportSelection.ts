import type { ProjectWorkflow } from "@aifilm/shared";

/** IDs are an explicit edit decision: preserve order and reject stale/foreign shots. */
export function selectExportWorkflow(workflow: ProjectWorkflow, storyboardIds?: string[]): ProjectWorkflow {
  if (storyboardIds === undefined) return workflow;
  if (!storyboardIds.length) throw new Error("请先选择需要导出的镜头");
  if (new Set(storyboardIds).size !== storyboardIds.length) throw new Error("导出镜头不能重复");
  const byId = new Map(workflow.storyboards.map(shot => [shot.id, shot]));
  const storyboards = storyboardIds.map(id => {
    const shot = byId.get(id);
    if (!shot) throw new Error("导出镜头已变化或不属于当前项目，请刷新后重试");
    return shot;
  });
  return { ...workflow, storyboards };
}
