import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { TextSubmissionError, requestTextJson, textSubmissionOutcome, withTextSubmissionGuard } from "./textSubmission.js";

test("text submission distinguishes explicit rejection, unreadable success and uncertain HTTP failures", async () => {
  const original = globalThis.fetch;
  try {
    for (const [status, expected] of [[400, "rejected"], [401, "rejected"], [404, "rejected"], [429, "rejected"], [408, "unknown"], [409, "unknown"], [500, "unknown"], [502, "unknown"]] as const) {
      globalThis.fetch = async () => new Response("fixture", { status });
      await assert.rejects(requestTextJson("https://fixture.invalid", {}, "test"), error => textSubmissionOutcome(error) === expected);
    }
    globalThis.fetch = async () => new Response("<html>not JSON</html>");
    await assert.rejects(requestTextJson("https://fixture.invalid", {}, "test"), error => error instanceof TextSubmissionError && error.outcome === "unknown");
    const wrapped = new Error("outer", { cause: new TextSubmissionError("unknown", "inner") });
    assert.equal(textSubmissionOutcome(wrapped), "unknown");
    assert.equal(textSubmissionOutcome(new Error("timeout in plain language")), undefined);
  } finally { globalThis.fetch = original; }
});

test("request timeout covers the response body after headers, and the durable marker precedes network IO", async () => {
  let marked = false, calls = 0;
  const server = http.createServer((_request, response) => {
    calls++; assert.equal(marked, true);
    response.writeHead(200, { "content-type": "application/json" });
    response.write('{"unfinished":');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as import("node:net").AddressInfo;
  try {
    await assert.rejects(withTextSubmissionGuard(async () => { marked = true; }, () =>
      requestTextJson(`http://127.0.0.1:${address.port}`, { method: "POST" }, "fixture", 150)),
    error => textSubmissionOutcome(error) === "unknown");
    assert.equal(calls, 1);
    await assert.rejects(withTextSubmissionGuard(async () => { throw new Error("checkpoint unavailable"); }, () =>
      requestTextJson(`http://127.0.0.1:${address.port}`, {}, "fixture")), /checkpoint unavailable/);
    assert.equal(calls, 1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
