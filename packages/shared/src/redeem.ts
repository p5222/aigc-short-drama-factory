/** Preserve hyphens as part of code identity; accept pasted whitespace/full-width text. */
export function normalizeRedeemCode(value: string) {
  return value.normalize("NFKC").toUpperCase().replace(/[‐‑‒–—−]/g, "-").replace(/\s+/g, "");
}

export function redeemCodeStatus(code: {
  enabled: boolean; batchEnabled?: boolean; startsAt?: string | Date | null; endsAt?: string | Date | null;
  usedCount: number; maxRedemptions: number;
}, now = Date.now()): "active" | "disabled" | "used_up" | "expired" | "scheduled" {
  if (!code.enabled || code.batchEnabled === false) return "disabled";
  if (code.endsAt && new Date(code.endsAt).getTime() <= now) return "expired";
  if (code.startsAt && new Date(code.startsAt).getTime() > now) return "scheduled";
  if (code.usedCount >= code.maxRedemptions) return "used_up";
  return "active";
}
