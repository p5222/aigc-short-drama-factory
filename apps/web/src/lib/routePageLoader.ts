import { BEFORE_CREATOR_NAVIGATION } from "./creatorNavigation.ts";

export class RoutePageLoadError extends Error {
  constructor() {
    super("页面资源暂时无法加载");
    this.name = "RoutePageLoadError";
  }
}

/** React.lazy owns the module cache. Loading never navigates, reloads or resets a mounted page. */
export function routePageLoader<T>(load: () => Promise<T>): () => Promise<T> {
  return async () => {
    try { return await load(); }
    catch { throw new RoutePageLoadError(); }
  };
}

/** Only the explicit reload button calls this; preserve the existing navigation veto contract. */
export function requestRoutePageReload(target: Pick<Window, "dispatchEvent"> & { location: Pick<Location, "reload"> } = window): boolean {
  if (!target.dispatchEvent(new CustomEvent(BEFORE_CREATOR_NAVIGATION, { cancelable: true, detail: { reload: true } }))) return false;
  target.location.reload();
  return true;
}
