export class HttpError extends Error {
  readonly status: number;
  readonly requestId?: string;
  constructor(message: string, status: number, requestId?: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.requestId = requestId;
  }
}

interface TransportOptions {
  baseUrl: string;
  readToken: () => string;
  expireSession: (path: string) => void;
  fetch?: typeof fetch;
  readTimeoutMs?: number;
  writeTimeoutMs?: number;
}

const statusMessages: Record<number, string> = {
  401: "登录状态已过期，请重新登录。",
  403: "你没有执行此操作的权限，请联系管理员。",
  404: "内容不存在或已被删除，请刷新列表。",
  409: "数据状态已变化，请刷新后核对。",
  429: "操作过于频繁，请稍后重试。",
  500: "服务暂时不可用，请稍后重试。",
  502: "服务暂时不可用，请稍后重试。",
  503: "服务正在维护，请稍后重试。"
};

export function createHttpTransport(options: TransportOptions) {
  return async function request<T>(path: string, init: RequestInit = {}, consume: (response: Response) => Promise<T>): Promise<T> {
    const requestToken = options.readToken();
    const headers = new Headers(init.headers);
    if (requestToken && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${requestToken}`);
    const authorizedToken = headers.get("Authorization");
    const controller = new AbortController();
    const isRead = !init.method || /^(GET|HEAD)$/i.test(init.method);
    const timeoutMs = isRead ? options.readTimeoutMs ?? 30_000 : options.writeTimeoutMs ?? 180_000;
    let timedOut = false;
    const abort = () => controller.abort(init.signal?.reason);
    if (init.signal?.aborted) abort();
    else init.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const response = await (options.fetch ?? fetch)(`${options.baseUrl}${path}`, { ...init, headers, signal: controller.signal });
      // A response from the previous login must never sign out the new session.
      if (response.status === 401 && requestToken && authorizedToken === `Bearer ${requestToken}` && options.readToken() === requestToken) {
        options.expireSession(path);
      }
      if (!response.ok) {
        const text = await response.text();
        let message = statusMessages[response.status] ?? `请求失败（${response.status}），请稍后重试。`;
        try {
          const data = JSON.parse(text);
          const fields = Object.values(data.fieldErrors ?? {}).flat().filter(value => typeof value === "string");
          const detail = data.message || data.error || [...(data.formErrors ?? []), ...fields].join("；");
          if (typeof detail === "string" && detail.trim()) message = detail;
        } catch { /* Proxy HTML and stack traces are not user-facing error messages. */ }
        throw new HttpError(message, response.status, response.headers.get("x-request-id") ?? undefined);
      }
      return await consume(response);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (init.signal?.aborted) throw error;
      if (timedOut) throw new HttpError(isRead ? "读取超时，请重试。" : "等待响应超时，操作可能已受理。请先刷新状态核对，避免重复提交。", 408);
      if (error instanceof SyntaxError) throw new HttpError("服务返回的数据格式异常，请刷新重试。", 502);
      throw new HttpError(isRead ? "网络连接中断，请检查网络后重试。" : "连接中断，暂时无法确认操作结果。请恢复网络并刷新状态核对，避免重复提交。", 0);
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", abort);
    }
  };
}
