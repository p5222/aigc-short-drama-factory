import assert from "node:assert/strict";
import test from "node:test";
import { lockAdminDocumentScroll } from "./adminDialogScroll.ts";

function documentFixture() { return { body: { style: { overflow: "auto", overscrollBehavior: "contain" } }, documentElement: { style: { overflow: "scroll", overscrollBehavior: "" } } }; }

test("dialog locks both scrolling roots and restores the original page styles", () => {
  const target = documentFixture();
  const release = lockAdminDocumentScroll(target);
  assert.equal(target.body.style.overflow, "hidden");
  assert.equal(target.documentElement.style.overflow, "hidden");
  release();
  assert.deepEqual(target, documentFixture());
});

test("closing one overlapping dialog does not unlock another and cleanup is idempotent", () => {
  const target = documentFixture();
  const closeFirst = lockAdminDocumentScroll(target);
  const closeSecond = lockAdminDocumentScroll(target);
  closeFirst(); closeFirst();
  assert.equal(target.body.style.overflow, "hidden");
  closeSecond();
  assert.deepEqual(target, documentFixture());
});
