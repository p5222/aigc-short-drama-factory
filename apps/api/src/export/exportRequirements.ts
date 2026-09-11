import type { ProjectWorkflow } from "@aifilm/shared";

export function assertVideoExportReady(workflow: ProjectWorkflow) {
  if (!workflow.storyboards.length) throw new Error("请先完成分镜和镜头视频，再导出 MP4");
  const assets = new Map(workflow.assets.map(asset => [asset.id, asset]));
  const missing = workflow.storyboards.filter(shot => {
    const video = assets.get(`video_${shot.id}`);
    return video?.status !== "succeeded" || !video.referenceUrl
      || !/^(https?:\/\/|\/storage\/|data:video\/)/i.test(video.referenceUrl)
      || /\.(json|html|txt)(?:[?#]|$)/i.test(video.referenceUrl);
  });
  if (missing.length) throw new Error(`还有 ${missing.length} 个镜头没有可用视频，请在分镜阶段完成后再导出 MP4`);
}

export function assertRealNarration(provider: string, hasSpeech: boolean) {
  if (hasSpeech && ["scratch-local-wav", "silence", "mock", "manifest-only"].includes(provider)) {
    throw new Error("配音未生成真实语音，请配置可用配音服务后重试；未使用占位音轨代替对白");
  }
}
