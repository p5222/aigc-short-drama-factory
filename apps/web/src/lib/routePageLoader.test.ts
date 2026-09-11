import assert from "node:assert/strict";
import test from "node:test";
import { BEFORE_CREATOR_NAVIGATION } from "./creatorNavigation.ts";
import { requestRoutePageReload, RoutePageLoadError, routePageLoader } from "./routePageLoader.ts";

test("page module loading starts only when requested and preserves the imported component", async () => {
  let calls = 0;
  const module = { default: () => "page" };
  const load = routePageLoader(async () => { calls++; return module; });
  assert.equal(calls, 0);
  assert.equal(await load(), module);
  assert.equal(calls, 1);
});

test("chunk failures yield a safe recoverable error without retrying or exposing remote URLs", async () => {
  let calls = 0;
  const load = routePageLoader(async () => { calls++; throw new Error("https://private.example/chunk?token=secret"); });
  await assert.rejects(load(), error => error instanceof RoutePageLoadError && !error.message.includes("secret"));
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(calls, 1);
});

test("explicit reload honors pending-save navigation protection and never reloads after a veto", () => {
  let reloads = 0;
  const target = new EventTarget();
  const browser = Object.assign(target, { location: { reload: () => { reloads++; } } });
  const veto = (event: Event) => { assert.equal(event.cancelable, true); event.preventDefault(); };
  target.addEventListener(BEFORE_CREATOR_NAVIGATION, veto);
  assert.equal(requestRoutePageReload(browser), false);
  assert.equal(reloads, 0);
  target.removeEventListener(BEFORE_CREATOR_NAVIGATION, veto);
  assert.equal(requestRoutePageReload(browser), true);
  assert.equal(reloads, 1);
});
