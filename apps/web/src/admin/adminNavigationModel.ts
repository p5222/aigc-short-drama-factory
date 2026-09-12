export interface AdminNavigationHost {
  readHash: () => string;
  writeHash: (hash: string, mode: "push" | "replace") => void;
  canLeave: () => boolean;
  accepted: (hash: string) => void;
}

/** Keep one canonical URL even when a browser history event arrives after a cancelled traversal. */
export function canonicalAdminHash(value: string) {
  if (!value.startsWith("#")) return value ? `#${encodeURIComponent(value)}` : "";
  try { return value.length > 1 ? `#${encodeURIComponent(decodeURIComponent(value.slice(1)))}` : ""; }
  catch { return ""; }
}

export function createAdminNavigation(host: AdminNavigationHost) {
  let acceptedHash = canonicalAdminHash(host.readHash());
  function accept(next: string) {
    acceptedHash = next;
    host.accepted(next);
  }
  return {
    readAccepted: () => acceptedHash,
    navigate(value: string) {
      const next = canonicalAdminHash(value);
      if (next === acceptedHash) return true;
      if (!host.canLeave()) return false;
      host.writeHash(next, "push");
      accept(next);
      return true;
    },
    syncLocation() {
      // Read the current URL, not a queued HashChangeEvent.newURL from an earlier traversal.
      const next = canonicalAdminHash(host.readHash());
      if (next === acceptedHash) return true;
      if (!host.canLeave()) {
        host.writeHash(acceptedHash, "replace");
        return false;
      }
      accept(next);
      return true;
    }
  };
}
