import type { PageKey } from "../components/Shell";

export const BEFORE_CREATOR_NAVIGATION = "manjiao:before-navigation";
const pages = new Set<PageKey>(["workbench", "content", "wizard", "scripts", "studio", "tasks", "models", "profile", "recharge", "ledger", "settings", "help"]);
export type TaskQueueFilter = "all" | "active" | "failed" | "succeeded" | "pending" | "canceled" | "refunded";
export const taskQueueFilters: readonly TaskQueueFilter[] = ["all", "active", "failed", "succeeded", "pending", "canceled", "refunded"];
export interface CreatorRoute { page: PageKey; projectId?: string; contentId?: string; taskFilter?: TaskQueueFilter; taskId?: string }

export function readCreatorRoute(hash: string): CreatorRoute {
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?", 2);
  const [page, encodedId] = path.split("/");
  let id = "";
  try { id = decodeURIComponent(encodedId ?? ""); } catch { return { page: "scripts" }; }
  if (id.length > 200 || /[\s/\\?#]/.test(id)) return { page: "scripts" };
  if (page === "project") return id ? { page, projectId: id } : { page: "scripts" };
  if (page === "content" && id) return { page, contentId: id };
  if (page === "tasks") {
    const params = new URLSearchParams(query);
    const filter = params.get("status") as TaskQueueFilter;
    const taskId = params.get("task") ?? "";
    return { page, ...(filter !== "all" && taskQueueFilters.includes(filter) ? { taskFilter: filter } : {}),
      ...(taskId && taskId.length <= 200 && !/[\s/\\?#]/.test(taskId) ? { taskId } : {}) };
  }
  return { page: pages.has(page as PageKey) ? page as PageKey : "workbench" };
}

export function creatorRouteHash(route: CreatorRoute): string {
  if (route.page === "project") return route.projectId ? `#/project/${encodeURIComponent(route.projectId)}` : "#/scripts";
  if (route.page === "content" && route.contentId) return `#/content/${encodeURIComponent(route.contentId)}`;
  if (route.page === "tasks") {
    const params = new URLSearchParams();
    if (route.taskFilter && route.taskFilter !== "all" && taskQueueFilters.includes(route.taskFilter)) params.set("status", route.taskFilter);
    if (route.taskId) params.set("task", route.taskId);
    return `#/tasks${params.size ? `?${params}` : ""}`;
  }
  return `#/${pages.has(route.page) ? route.page : "workbench"}`;
}

/** Async reads must not update another project or a newer account session. */
export function createRequestEpoch() {
  let epoch = 0;
  return { begin: () => ++epoch, invalidate: () => { epoch++; }, current: (token: number) => token === epoch };
}

export interface RefreshResource<T = unknown> { label: string; read: () => Promise<T>; apply: (value: T) => void }
export async function refreshResources(resources: RefreshResource<any>[], isCurrent: () => boolean = () => true, onRead?: (labels: string[]) => void): Promise<void> {
  const results = await Promise.allSettled(resources.map((resource) => Promise.resolve().then(resource.read)));
  if (!isCurrent()) return;
  const failed: string[] = [];
  const read: string[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      resources[index].apply(result.value);
      read.push(resources[index].label);
    }
    else failed.push(resources[index].label);
  });
  onRead?.(read);
  if (failed.length) throw new Error(`${failed.join("、")}未能刷新，已保留原有数据。请稍后重试。`);
}
