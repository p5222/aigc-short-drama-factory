import type { ModelModality, ModelPrice } from "./index.js";

export type PriceConfigurationState = "ready" | "missing" | "conflict" | "invalid";
type PriceRow = Pick<ModelPrice, "model" | "unitCredits" | "enabled"> & { providerId?: string | null; modality: string; unit: string };

const units: Record<ModelModality, readonly ModelPrice["unit"][]> = {
  text: ["text_run"],
  image: ["image", "image2"],
  video: ["video_second"],
  tts: ["tts_character"],
  embedding: ["text_run"]
};

/** Validate one exact route before displaying, reserving or settling its price. */
export function inspectModelPrice<T extends PriceRow>(
  prices: readonly T[],
  route: { providerId: string | null; model: string; modality: ModelModality }
): { state: PriceConfigurationState; price?: T } {
  const matches = prices.filter(price => price.enabled && price.providerId === route.providerId
    && price.model === route.model && price.modality === route.modality);
  if (!matches.length) return { state: "missing" };
  if (matches.length > 1) return { state: "conflict" };
  const price = matches[0];
  if (!units[route.modality].some(unit => unit === price.unit) || !Number.isSafeInteger(price.unitCredits) || price.unitCredits < 0) {
    return { state: "invalid" };
  }
  return { state: "ready", price };
}
