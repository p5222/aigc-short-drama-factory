import { useEffect, useState } from "react";
import { parseModelPreferences } from "./modelCatalog";

const key = "manjiao-model-preferences-v1";
const eventName = "manjiao:model-preferences";
function read() {
  try { return parseModelPreferences(localStorage.getItem(key)); }
  catch { return parseModelPreferences(null); }
}

/** Only public route IDs live here. Preferences do not choose a model or trigger a generation. */
export function useModelPreferences() {
  const [preferences, setPreferences] = useState(read);
  useEffect(() => {
    const refresh = () => setPreferences(read());
    const storage = (event: StorageEvent) => { if (event.key === key || event.key === null) refresh(); };
    window.addEventListener(eventName, refresh);
    window.addEventListener("storage", storage);
    return () => { window.removeEventListener(eventName, refresh); window.removeEventListener("storage", storage); };
  }, []);
  const update = (change: (value: ReturnType<typeof read>) => ReturnType<typeof read>) => {
    const next = change(preferences);
    setPreferences(next);
    try { localStorage.setItem(key, JSON.stringify(next)); window.dispatchEvent(new Event(eventName)); }
    catch { /* Private browsing or full storage must not prevent choosing a model. */ }
  };
  return {
    ...preferences,
    toggleFavorite: (route: string) => update(value => ({
      ...value, favorites: value.favorites.includes(route) ? value.favorites.filter(item => item !== route) : [...value.favorites, route].slice(-64)
    })),
    recordSelection: (route: string) => update(value => ({ ...value, recent: [route, ...value.recent.filter(item => item !== route)].slice(0, 8) }))
  };
}
