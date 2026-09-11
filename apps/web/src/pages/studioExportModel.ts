import type { ExportJob, ProjectWorkflow } from "@aifilm/shared";
import { getDeliveryExportState } from "../workbench/stages/deliveryModel.ts";
import { confirmedDeliveryCredits, deliveryQuoteScopeKey, type DeliveryExportQuote, type DeliveryExportType } from "../workbench/stages/deliveryQuoteModel.ts";

export interface StudioExportIntent {
  projectId: string;
  type: DeliveryExportType;
  storyboardIds: string[];
  scopeKey: string;
}

/** A late read cannot replace a newer project or quote, including A → B → A. */
export function createScopedRequestGate() {
  let version = 0;
  return {
    begin(scope: string) { return { scope, version: ++version }; },
    isCurrent(ticket: { scope: string; version: number }, currentScope: string) { return ticket.version === version && ticket.scope === currentScope; },
    invalidate() { version += 1; }
  };
}

export function buildStudioExportIntent(workflow: ProjectWorkflow, type: DeliveryExportType): StudioExportIntent {
  const state = getDeliveryExportState(workflow.storyboards, workflow.assets);
  if (!state.storyboardIds.length) throw new Error("当前作品没有可导出的镜头。");
  if (type === "video_export" && !state.canExportVideo) throw new Error(`还有 ${state.missingVideoCount} 个镜头视频未完成，请先到生产台补齐。`);
  return { projectId: workflow.project.id, type, storyboardIds: [...state.storyboardIds], scopeKey: deliveryQuoteScopeKey(workflow.project.id, "all", workflow.storyboards) };
}

export async function submitStudioExport(
  intent: StudioExportIntent,
  quote: DeliveryExportQuote | null,
  currentScope: string,
  dependencies: {
    submit: (projectId: string, input: { type: DeliveryExportType; storyboardIds: string[]; maxCredits: number }) => Promise<ExportJob>;
    sync: (projectId: string) => Promise<unknown>;
  }
): Promise<{ status: "accepted" | "sync-required" | "failed"; job: ExportJob }> {
  const maxCredits = confirmedDeliveryCredits(quote, intent.type, intent.scopeKey, currentScope);
  if (maxCredits === null) throw new Error("作品内容或导出范围已变化，请重新获取报价并确认。");
  const job = await dependencies.submit(intent.projectId, { type: intent.type, storyboardIds: [...intent.storyboardIds], maxCredits });
  if (job.status === "failed") return { status: "failed", job };
  try {
    await dependencies.sync(intent.projectId);
    return { status: "accepted", job };
  } catch {
    // The write is already accepted. Refreshing must never resubmit the billable action.
    return { status: "sync-required", job };
  }
}
