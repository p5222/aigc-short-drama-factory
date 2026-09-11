import type { StoryboardShot } from "@aifilm/shared";
import type { ShotDraftState } from "../model.ts";

export function contentShotDraft(shot?: StoryboardShot): Partial<StoryboardShot> {
  if (!shot) return {};
  return { pictureDesc: shot.pictureDesc, action: shot.action, dialogue: shot.dialogue, voiceOver: shot.voiceOver, emotion: shot.emotion };
}

export function canDiscardContentDraft(state: ShotDraftState, confirm: () => boolean): boolean {
  if (state.activeOperation || state.status === "saving") return false;
  return state.committed || (state.status !== "dirty" && state.status !== "error") || confirm();
}
