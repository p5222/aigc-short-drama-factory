import { CREATOR_GUIDE_VERSION, type CreatorAgentState, type CreatorBrief, type CreatorQuote, type CreatorScriptDetails, type StoryFact } from "@aifilm/shared";
import { requestJson } from "./httpClient";

export type CreatorPreference = { guideVersion: number; guideState: "new" | "shown" | "skipped" | "started" | "completed"; hasProjects: boolean };
const root = "/content/creator";
const project = (id: string) => `${root}/projects/${encodeURIComponent(id)}`;
const send = <T>(url: string, body?: unknown, method = "POST") => requestJson<T>(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
export const creatorApi = {
  preference: () => requestJson<CreatorPreference>(`${root}/preference`),
  guide: (guideState: Exclude<CreatorPreference["guideState"], "new">) => send<CreatorPreference>(`${root}/preference`, { guideVersion: CREATOR_GUIDE_VERSION, guideState }, "PATCH"),
  create: (input: { requestId: string; title: string; brief: CreatorBrief; source: string; textProvider: string; textModel: string; styleProfile: Record<string, unknown> }) => send<{ id: string }>(`${root}/projects`, input),
  state: (id: string) => requestJson<CreatorAgentState>(project(id)),
  brief: (id: string, brief: CreatorBrief, expectedRevision: number) => send<CreatorAgentState>(`${project(id)}/brief`, { brief, expectedRevision }, "PATCH"),
  quote: (id: string, input: { maxCalls: number; feedback: string; baseScriptId?: string }) => send<CreatorQuote>(`${project(id)}/quote`, input),
  plan: (id: string, input: { requestId: string; expectedRevision: number; maximumCredits: number; maxCalls: number; feedback: string; baseScriptId?: string }) => send<{ id: string }>(`${project(id)}/runs`, input),
  execute: (id: string, runId: string) => send<CreatorAgentState>(`${project(id)}/runs/${encodeURIComponent(runId)}/execute`),
  cancel: (id: string, runId: string) => send<CreatorAgentState>(`${project(id)}/runs/${encodeURIComponent(runId)}/cancel`),
  acknowledge: (id: string, runId: string) => send<CreatorAgentState>(`${project(id)}/runs/${encodeURIComponent(runId)}/acknowledge`, { supplierChecked: true }),
  review: (id: string, input: { expectedScriptId: string; expectedRevision: number; content: string; approve: boolean; note: string; details?: CreatorScriptDetails }) => send<CreatorAgentState>(`${project(id)}/review`, input),
  fact: (id: string, input: Pick<StoryFact, "subject" | "predicate" | "value" | "status" | "validFrom" | "validTo" | "knownBy"> & { expectedRevision?: number }, factId?: string) => send<StoryFact>(`${project(id)}/facts${factId ? `/${encodeURIComponent(factId)}` : ""}`, input, factId ? "PATCH" : "POST"),
  continue: (id: string, input: { requestId: string; title: string; intent: string }) => send<{ id: string }>(`${project(id)}/continue`, input),
  event: (id: string, event: "creator_script_viewed" | "creator_preview_viewed" | "creator_export_viewed") => send<{ ok: true }>(`${project(id)}/events`, { event })
};
