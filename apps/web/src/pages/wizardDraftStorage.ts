import type { CreateProjectInput } from "@aifilm/shared";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
import { CREATION_ATTEMPT_KEY } from "./creationAttemptStorage.ts";
export const MANUAL_WIZARD_DRAFT_KEY = "aifilm_creation_draft";
export const SESSION_WIZARD_DRAFT_KEY = "aifilm_creation_session_draft";

export function createWizardDraftStorage(stores: () => { local?: StorageLike; session?: StorageLike }) {
  return {
    read(): CreateProjectInput | null {
      const { local, session } = stores();
      for (const [storage, key] of [[session, SESSION_WIZARD_DRAFT_KEY], [local, MANUAL_WIZARD_DRAFT_KEY]] as const) {
        try {
          const raw = storage?.getItem(key);
          const value = raw ? JSON.parse(raw) as unknown : null;
          if (value && typeof value === "object" && !Array.isArray(value) && typeof (value as CreateProjectInput).content === "string") return value as CreateProjectInput;
        } catch { /* Ignore a corrupt or unavailable draft and try the explicit manual copy. */ }
      }
      return null;
    },
    save(draft: CreateProjectInput, persistent = false): boolean {
      const { local, session } = stores();
      try {
        const target = persistent ? local : session;
        if (!target) return false;
        target.setItem(persistent ? MANUAL_WIZARD_DRAFT_KEY : SESSION_WIZARD_DRAFT_KEY, JSON.stringify(draft));
        return true;
      } catch { return false; }
    },
    clear() {
      const { local, session } = stores();
      try { local?.removeItem(MANUAL_WIZARD_DRAFT_KEY); } catch { /* unavailable */ }
      try { session?.removeItem(SESSION_WIZARD_DRAFT_KEY); } catch { /* unavailable */ }
      try { session?.removeItem(CREATION_ATTEMPT_KEY); } catch { /* unavailable */ }
    }
  };
}

const draftStorage = createWizardDraftStorage(() => {
  const stores: { local?: StorageLike; session?: StorageLike } = {};
  try { stores.local = window.localStorage; } catch { /* browser blocks storage */ }
  try { stores.session = window.sessionStorage; } catch { /* browser blocks storage */ }
  return stores;
});
export const readWizardDraft = () => draftStorage.read();
export const saveWizardDraft = (draft: CreateProjectInput, persistent = false) => draftStorage.save(draft, persistent);
export const clearWizardDraft = () => draftStorage.clear();
