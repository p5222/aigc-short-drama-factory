import type { StoryboardShot } from "@aifilm/shared";

export type DeliveryExportType = "tts" | "subtitle" | "video_export";
export interface DeliveryExportQuote {
  type: DeliveryExportType;
  providerId: string;
  providerName: string;
  model: string;
  characters: number;
  estimatedCredits: number;
  unitCredits: number;
  unit: "tts_character";
  cached: boolean;
  cueCount: number;
}

export function deliveryQuoteScopeKey(projectId: string, episode: number | "all", shots: Pick<StoryboardShot, "id" | "duration" | "dialogue" | "voiceOver">[]) {
  return JSON.stringify([projectId, episode, shots.map((shot) => [shot.id, shot.duration, shot.dialogue, shot.voiceOver])]);
}

export function confirmedDeliveryCredits(quote: DeliveryExportQuote | null, type: DeliveryExportType, quotedScope: string, currentScope: string): number | null {
  if (!quote || quote.type !== type || quotedScope !== currentScope) return null;
  if (!Number.isSafeInteger(quote.estimatedCredits) || quote.estimatedCredits < 0) return null;
  if ((quote.cached || type === "subtitle") && quote.estimatedCredits !== 0) return null;
  return quote.estimatedCredits;
}
