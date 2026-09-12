const showcaseFields = ["title", "description", "category", "creatorName", "coverUrl", "videoUrl", "durationLabel", "featured", "sortOrder"] as const;
type ShowcaseDraft = Record<(typeof showcaseFields)[number], unknown> & { reviewNote?: string };

export function hasShowcaseDraftChanges(saved: ShowcaseDraft | null, draft: ShowcaseDraft | null, reviewNote: string) {
  return Boolean(saved && draft && (showcaseFields.some(field => saved[field] !== draft[field]) || reviewNote !== (saved.reviewNote ?? "")));
}

type FeedbackDraft = { status: string; priority: string; rootCause: string; assignee: string; resolution: string };
type SavedFeedback = Omit<FeedbackDraft, "rootCause" | "assignee" | "resolution"> & { rootCause?: string; assignee?: string; resolution?: string };
export function hasFeedbackDraftChanges(saved: SavedFeedback | undefined, draft: FeedbackDraft, inferredRootCause: string) {
  return Boolean(saved && (draft.status !== saved.status || draft.priority !== saved.priority || draft.rootCause !== (saved.rootCause ?? inferredRootCause) || draft.assignee !== (saved.assignee ?? "") || draft.resolution !== (saved.resolution ?? "")));
}
