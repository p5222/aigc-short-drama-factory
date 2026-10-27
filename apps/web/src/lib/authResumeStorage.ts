export interface AuthResume {
  userId: string;
  page: string;
  projectId?: string;
}

const RESUME_KEY = "manjiao-auth-resume";
const legacyKeys = ["manjiao-auth-resume-user", "manjiao-auth-resume-page", "manjiao-auth-resume-project"];
type ResumeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Recovery metadata is optional. Storage failures must never interrupt logout
 * or leave the UI signed in after the transport has cleared its token. */
export function createAuthResumeStorage(storage: () => ResumeStorage | undefined) {
  let memory: AuthResume | null = null;
  let cleared = false;
  const access = () => { try { return storage(); } catch { return undefined; } };
  return {
    write(value: AuthResume) {
      cleared = false;
      memory = { ...value };
      try { access()?.setItem(RESUME_KEY, JSON.stringify(value)); } catch { /* Keep this page's in-memory recovery. */ }
    },
    read(): AuthResume | null {
      if (cleared) return null;
      if (memory) return { ...memory };
      try {
        const store = access();
        const raw = store?.getItem(RESUME_KEY);
        const value = raw ? JSON.parse(raw) : { userId: store?.getItem(legacyKeys[0]), page: store?.getItem(legacyKeys[1]), projectId: store?.getItem(legacyKeys[2]) };
        if (value && typeof value.userId === "string" && value.userId && typeof value.page === "string" && value.page) {
          return { userId: value.userId, page: value.page, ...(typeof value.projectId === "string" ? { projectId: value.projectId } : {}) };
        }
      } catch { /* Missing or malformed recovery starts at a safe page. */ }
      return null;
    },
    clear() {
      memory = null;
      cleared = true;
      const store = access();
      for (const key of [RESUME_KEY, ...legacyKeys]) {
        try { store?.removeItem(key); } catch { /* Continue even if one key cannot be removed. */ }
      }
    }
  };
}

export const authResumeStorage = createAuthResumeStorage(() => window.sessionStorage);
