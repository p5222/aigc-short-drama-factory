import type { ModelPrice, Plan } from "@aifilm/shared";

export function rechargeCheckoutUrl(plan: Pick<Plan, "enabled" | "shopUrl">): string | null {
  if (!plan.enabled || !plan.shopUrl?.trim()) return null;
  try {
    const url = new URL(plan.shopUrl.trim());
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function modelCreditRange(prices: ModelPrice[], unit: ModelPrice["unit"]): string | null {
  const amounts = prices.filter(price => price.enabled && price.unit === unit && Number.isFinite(price.unitCredits) && price.unitCredits >= 0).map(price => price.unitCredits);
  if (!amounts.length) return null;
  const minimum = Math.min(...amounts), maximum = Math.max(...amounts);
  return minimum === maximum ? String(minimum) : `${minimum}–${maximum}`;
}
