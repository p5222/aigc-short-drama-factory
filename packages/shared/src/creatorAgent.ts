export interface CreatorBrief {
  format: "short";
  intent: string;
  material: "idea" | "story" | "script";
  durationSeconds: 30 | 60;
  audience: string;
  emotion: string;
  mustKeep: string;
  fidelity: "faithful" | "inspired";
}
export interface StoryFact {
  id: string;
  subject: string;
  predicate: string;
  value: string;
  status: "candidate" | "confirmed" | "locked" | "stale" | "superseded" | "rejected";
  sourceType: string;
  sourceId: string;
  sourceVersion: number;
  validFrom: number;
  validTo: number | null;
  knownBy: string[];
  revision: number;
}
export interface ContextManifest {
  estimator: "utf8_upper_bound_v1";
  budgetTokens: number;
  estimatedInputTokens: number;
  reservedOutputTokens: number;
  safetyTokens: number;
  sources: Array<{ id: string; label: string; required: boolean; estimatedTokens: number; included: boolean }>;
}
export interface CreatorFinding {
  code: string;
  layer: "structure" | "continuity" | "author";
  severity: "warning" | "blocking";
  message: string;
  evidence?: string;
}
export type CreatorRunStatus = "pending" | "running" | "awaiting_review" | "needs_repair" | "completed" | "failed" | "unknown" | "canceled";
export interface CreatorScriptDetails {
  estimatedSeconds: number;
  characters: Array<{ name: string; identity: string; appearance: string; costume: string; personality: string }>;
  scenes: Array<{ location: string; description: string; characters: string[] }>;
  props: Array<{ name: string; description: string }>;
}
export interface CreatorRun {
  id: string;
  requestId: string;
  inputRevision: number;
  skillVersion: string;
  status: CreatorRunStatus;
  maxCalls: number;
  maximumCredits: number;
  cancelRequested: boolean;
  error: string | null;
  createdAt: string;
  feedback: string;
  baseScriptId?: string;
  steps: Array<{
    id: string; sequence: number; tool: string; status: string; taskId: string | null;
    inputManifest: ContextManifest; findings: CreatorFinding[]; error: string | null;
    scriptId?: string; credits: number | null;
    usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number } | null;
    costMicros: number | null; costStatus: string;
  }>;
}
export interface CreatorAgentState {
  brief: CreatorBrief | null;
  revision: number;
  parentContentId: string | null;
  facts: StoryFact[];
  runs: CreatorRun[];
  scripts: Array<{
    id: string; version: number; status: string; content: string; createdAt: string;
    findings: CreatorFinding[];
    details?: CreatorScriptDetails;
    authorReview?: { approved: boolean; note: string; baseScriptId: string };
  }>;
  nextAction: "brief" | "script" | "review" | "production";
}
export interface CreatorQuote {
  provider: string;
  model: string;
  perCallCredits: number;
  maximumCredits: number;
  maxCalls: number;
  inputRevision: number;
  context: ContextManifest;
}
export const CREATOR_SKILL_VERSION = "short-film/1.0.0";
export const CREATOR_GUIDE_VERSION = 1;

export interface ExportOutcomeReport {
  exportJobId: string;
  reviewRevision: number;
  outputFingerprint: string;
  review: { verdict: "usable" | "needs_changes"; note: string; revision: number; updatedAt: string } | null;
  history: Array<{ verdict: string; note: string; revision: number; reviewedAt: string }>;
  durationSeconds: number | null;
  costs: {
    scope: "cumulative_project_to_export";
    taskCount: number; failedTaskCount: number; unknownCostTasks: number; unsettledTasks: number;
    credits: number | null; knownCredits: number; costMicros: number | null; knownCostMicros: number;
    invoiceStatus: "invoice_verified" | "partially_verified" | "unverified";
    creditsPerUsableSecond: number | null;
    costMicrosPerUsableSecond: number | null;
    reusedAssets: number;
  };
}

export interface CreatorInsights {
  since: string; until: string;
  stages: Array<{ event: string; users: number; events: number }>;
  runs: Array<{ status: string; count: number }>;
  firstAccepted: { projects: number; medianSeconds: number | null };
  feedback: { acceptedEdits: number; acceptedUnchanged: number };
}
