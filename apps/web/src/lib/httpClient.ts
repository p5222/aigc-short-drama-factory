import { clearAuthToken, readAuthToken } from "./authStorage";
import { createHttpTransport } from "./httpTransport";
export { HttpError } from "./httpTransport";

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "/api";

export const AUTH_SESSION_EXPIRED_EVENT = "manjiao:auth-session-expired";

function notifySessionExpired(path: string) {
  const hadToken = Boolean(readAuthToken());
  clearAuthToken();
  if (!hadToken || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AUTH_SESSION_EXPIRED_EVENT, { detail: { path } }));
}

const transport = createHttpTransport({ baseUrl, readToken: readAuthToken, expireSession: notifySessionExpired });

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return transport(path, { ...init, headers }, async response => {
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  });
}

export async function requestText(path: string, init?: RequestInit): Promise<string> {
  return transport(path, init, response => response.text());
}

export async function requestBlob(path: string, init?: RequestInit): Promise<Blob> {
  return transport(path, init, response => response.blob());
}
