type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type AuthStores = { local?: StorageLike; session?: StorageLike };
export const AUTH_TOKEN_KEY = "aifilm_auth_token";
const REMEMBER_KEY = "aifilm_auth_remember";

export function createAuthStorage(stores: () => AuthStores) {
  let memoryToken = "";
  const read = (storage?: StorageLike) => { try { return storage?.getItem(AUTH_TOKEN_KEY) || ""; } catch { return ""; } };
  const remove = (storage: StorageLike | undefined, key: string) => { try { storage?.removeItem(key); } catch { /* unavailable browser storage */ } };
  return {
    read() { const { local, session } = stores(); return read(session) || read(local) || memoryToken; },
    clear() {
      const { local, session } = stores();
      remove(local, AUTH_TOKEN_KEY); remove(session, AUTH_TOKEN_KEY); remove(local, REMEMBER_KEY);
      memoryToken = "";
    },
    write(token: string, remember: boolean) {
      const { local, session } = stores();
      remove(local, AUTH_TOKEN_KEY); remove(session, AUTH_TOKEN_KEY); remove(local, REMEMBER_KEY);
      memoryToken = token;
      try {
        const target = remember ? local : session;
        if (target) { target.setItem(AUTH_TOKEN_KEY, token); memoryToken = ""; }
        if (remember) local?.setItem(REMEMBER_KEY, "1");
      } catch { /* The current page can still sign in if browser storage is blocked. */ }
    }
  };
}

const authStorage = createAuthStorage(() => {
  const stores: AuthStores = {};
  try { stores.local = window.localStorage; } catch { /* browser blocks persistence */ }
  try { stores.session = window.sessionStorage; } catch { /* browser blocks persistence */ }
  return stores;
});

export const readAuthToken = () => authStorage.read();
export const clearAuthToken = () => authStorage.clear();
export const storeAuthToken = (token: string, remember: boolean) => authStorage.write(token, remember);
