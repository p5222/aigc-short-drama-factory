const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "/api";

export const AUTH_SESSION_EXPIRED_EVENT = "manjiao:auth-session-expired";

export class HttpError extends Error {
  constructor(message: string, readonly status: number, readonly requestId?: string) {
    super(message);
    this.name = "HttpError";
  }
}

function authHeaders(headers?: HeadersInit) {
  const token = localStorage.getItem("aifilm_auth_token");
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...headers
  };
}

function notifySessionExpired(path: string) {
  const hadToken = Boolean(localStorage.getItem("aifilm_auth_token"));
  localStorage.removeItem("aifilm_auth_token");
  if (!hadToken || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AUTH_SESSION_EXPIRED_EVENT, { detail: { path } }));
}

async function fetchApi(path: string, init?: RequestInit) {
  try {
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers: authHeaders(init?.headers) });
    if (response.status === 401) notifySessionExpired(path);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(`网络连接中断，请检查网络后重试。${message ? `（${message}）` : ""}`, 0);
  }
}

async function responseError(response: Response): Promise<never> {
  const text = await response.text();
  const requestId = response.headers.get("x-request-id") ?? undefined;
  let message = response.status === 401 ? "登录状态已过期，当前页面和草稿已保留。" : `请求失败：${response.status}`;
  if (text) {
    try {
      const data = JSON.parse(text) as { message?: string; error?: string; formErrors?: string[]; fieldErrors?: Record<string, string[]> };
      const fieldMessages = Object.entries(data.fieldErrors ?? {}).flatMap(([field, values]) => values.map((value) => `${field}: ${value}`));
      message = data.message || data.error || [...(data.formErrors ?? []), ...fieldMessages].join("；") || message;
    } catch {
      message = text;
    }
  }
  throw new HttpError(message, response.status, requestId);
}

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchApi(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }
  });
  if (!response.ok) return responseError(response);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function requestText(path: string, init?: RequestInit): Promise<string> {
  const response = await fetchApi(path, init);
  if (!response.ok) return responseError(response);
  return response.text();
}

export async function requestBlob(path: string, init?: RequestInit): Promise<Blob> {
  const response = await fetchApi(path, init);
  if (!response.ok) return responseError(response);
  return response.blob();
}
