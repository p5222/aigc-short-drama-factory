import type { Plan } from "@aifilm/shared";

export function rechargeCheckoutUrl(plan: Pick<Plan, "enabled" | "shopUrl">): string | null {
  if (!plan.enabled || !plan.shopUrl?.trim()) return null;
  try {
    const url = new URL(plan.shopUrl.trim());
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
