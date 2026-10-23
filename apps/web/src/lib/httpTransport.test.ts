import { test } from "node:test";
import assert from "node:assert/strict";
import { createHttpTransport, HttpError } from "./httpTransport.ts";

test("late 401 does not invalidate a replacement session", async () => {
  let token = "old";
  let expired = 0;
  const request = createHttpTransport({
    baseUrl: "/api", readToken: () => token, expireSession: () => expired++,
    fetch: async () => { token = "new"; return new Response("", { status: 401 }); }
  });
  await assert.rejects(request("/me", {}, response => response.json()), { status: 401 });
  assert.equal(expired, 0);
});

test("current 401 expires once and Headers instances preserve custom fields", async () => {
  let expired = 0;
  const request = createHttpTransport({
    baseUrl: "/api", readToken: () => "current", expireSession: () => expired++,
    fetch: async (_, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("X-Request-ID"), "test");
      assert.equal(headers.get("Authorization"), "Bearer current");
      return new Response("", { status: 401 });
    }
  });
  await assert.rejects(request("/me", { headers: new Headers({ "X-Request-ID": "test" }) }, response => response.json()));
  assert.equal(expired, 1);
});

test("write timeout warns about uncertain acceptance and never retries mutation", async () => {
  let calls = 0;
  const request = createHttpTransport({
    baseUrl: "/api", readToken: () => "", expireSession: () => {}, writeTimeoutMs: 5,
    fetch: async (_, init) => {
      calls++;
      return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
    }
  });
  await assert.rejects(request("/purchase", { method: "POST" }, response => response.json()), error => error instanceof HttpError && error.status === 408 && error.message.includes("避免重复提交"));
  assert.equal(calls, 1);
});

test("proxy HTML is replaced with actionable text while request id remains available", async () => {
  const request = createHttpTransport({
    baseUrl: "/api", readToken: () => "", expireSession: () => {},
    fetch: async () => new Response("<html>stack trace</html>", { status: 502, headers: { "x-request-id": "r1" } })
  });
  await assert.rejects(request("/", {}, response => response.json()), error => error instanceof HttpError && error.requestId === "r1" && !error.message.includes("<html>"));
});

test("explicit cancellation is preserved and malformed JSON has a recoverable message", async () => {
  const abort = new AbortController();
  abort.abort();
  const request = createHttpTransport({
    baseUrl: "/api", readToken: () => "", expireSession: () => {},
    fetch: async (_, init) => { init?.signal?.throwIfAborted(); return new Response("invalid"); }
  });
  await assert.rejects(request("/", { signal: abort.signal }, response => response.json()), { name: "AbortError" });
  await assert.rejects(request("/", {}, response => response.json()), { status: 502 });
});
