import { canLeaveAdminEditor } from "./adminDirtyState";
import { createAdminNavigation } from "./adminNavigationModel";

export const ADMIN_NAVIGATION_ACCEPTED = "aifilm:admin-navigation-accepted";
const navigations = new WeakMap<Window, ReturnType<typeof createAdminNavigation>>();

function navigation() {
  let value = navigations.get(window);
  if (!value) {
    value = createAdminNavigation({
      readHash: () => window.location.hash,
      writeHash: (hash, mode) => window.history[mode === "push" ? "pushState" : "replaceState"](window.history.state, "", `${window.location.pathname}${window.location.search}${hash}`),
      canLeave: canLeaveAdminEditor,
      accepted: () => window.dispatchEvent(new Event(ADMIN_NAVIGATION_ACCEPTED))
    });
    navigations.set(window, value);
    const sync = () => value!.syncLocation();
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
  }
  return value;
}

export function readAcceptedAdminHash() {
  return decodeURIComponent(navigation().readAccepted().slice(1)) || "运营总览";
}

export function navigateAdminHash(value: string) {
  return navigation().navigate(value);
}

export function subscribeAdminNavigation(listener: () => void) {
  navigation();
  window.addEventListener(ADMIN_NAVIGATION_ACCEPTED, listener);
  return () => window.removeEventListener(ADMIN_NAVIGATION_ACCEPTED, listener);
}
