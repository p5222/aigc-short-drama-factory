import { useCallback, useEffect, useRef, useState } from "react";
import { BEFORE_CREATOR_NAVIGATION, creatorRouteHash, readCreatorRoute, type CreatorRoute } from "./creatorNavigation";

export function useCreatorNavigation(enabled: boolean) {
  const [route, setRoute] = useState<CreatorRoute>(() => enabled ? readCreatorRoute(window.location.hash) : { page: "workbench" });
  const routeRef = useRef(route);
  const apply = useCallback((next: CreatorRoute) => { routeRef.current = next; setRoute(next); }, []);
  const navigate = useCallback((next: CreatorRoute, replace = false, force = false) => {
    if (!enabled) return;
    next = readCreatorRoute(creatorRouteHash(next));
    if (creatorRouteHash(next) === creatorRouteHash(routeRef.current)) return;
    if (!force && !window.dispatchEvent(new CustomEvent(BEFORE_CREATOR_NAVIGATION, { cancelable: true, detail: next }))) return;
    window.history[replace ? "replaceState" : "pushState"](null, "", creatorRouteHash(next));
    apply(next);
    window.scrollTo({ top: 0 });
  }, [apply, enabled]);
  useEffect(() => {
    if (!enabled) return;
    const sync = () => {
      const next = readCreatorRoute(window.location.hash);
      if (creatorRouteHash(next) === creatorRouteHash(routeRef.current)) return;
      if (!window.dispatchEvent(new CustomEvent(BEFORE_CREATOR_NAVIGATION, { cancelable: true, detail: next }))) {
        window.history.pushState(null, "", creatorRouteHash(routeRef.current));
        return;
      }
      apply(next);
    };
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => { window.removeEventListener("popstate", sync); window.removeEventListener("hashchange", sync); };
  }, [apply, enabled]);
  return { route, routeRef, navigate };
}
