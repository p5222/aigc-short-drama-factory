export interface CreatorSearchItem { id: string; label: string; detail: string; kind: "project" | "content" | "task"; projectId?: string }
export function searchCreatorItems(items: CreatorSearchItem[], query: string, limit = 12): CreatorSearchItem[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return items.filter((item) => words.every((word) => `${item.label} ${item.detail}`.toLocaleLowerCase().includes(word))).slice(0, limit);
}
