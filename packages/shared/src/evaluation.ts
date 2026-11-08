import type { EvaluationStage, QualityReport } from "./index.js";

export type EvaluationEvidenceScope = "legacy" | "structure" | "text" | "media";
export interface EvaluationComparability {
  status: "descriptive" | "insufficient";
  reasons: string[];
  paired: number;
  changed: number;
  unmatched: number;
  regressions: number;
  channels: Array<{ channel: string; paired: number; baseline: number; candidate: number; delta: number; passRateDelta: number }>;
}
export interface EvaluationReview {
  id: string;
  attemptId: string;
  version: number;
  fingerprint: string;
  scope: "structure" | "text" | "media";
  verdict: "usable" | "unusable" | "insufficient";
  reason: string;
  mediaIds: string[];
  createdAt: string;
}
export interface EvaluationReviewInput {
  requestId: string;
  expectedVersion: number;
  fingerprint: string;
  scope: EvaluationReview["scope"];
  verdict: EvaluationReview["verdict"];
  reason: string;
  mediaIds?: string[];
}
export interface EvaluationAttempt {
  id: string;
  runId: string;
  channel: string;
  evaluatorKey: string;
  contractHash: string;
  contract: Record<string, unknown>;
  status: "prepared" | "submitted" | "succeeded" | "failed" | "unknown" | "skipped";
  submittedAt?: string;
  finishedAt?: string;
  errorReason?: string;
  durationMs?: number;
  reviewVersion: number;
  reconciliation?: { outcome: "provider_completed" | "provider_failed"; reason: string; reference: string; reconciledAt: string };
  report?: QualityReport;
  usage: { calls?: Array<{ provider: string; model: string; reportedModel?: string; requestId?: string; usage: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number } }> };
  cost: { status?: "unknown" | "usage_derived"; estimatedMicros?: number; actualMicros?: number; [key: string]: unknown };
  sample: { id: string; projectId: string; stage: EvaluationStage; sampleKey: string; fingerprint: string; snapshot: Record<string, unknown>; createdAt: string };
  reviews: EvaluationReview[];
}
