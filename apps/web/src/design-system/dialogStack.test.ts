import assert from "node:assert/strict";
import test from "node:test";
import { createDialogStack } from "./dialogStack.ts";

class Surface {
  inert = false;
  connected = true;
  readonly name: string;
  readonly parent: Surface | null;
  constructor(name: string, parent: Surface | null = null) { this.name = name; this.parent = parent; }
  get isConnected(): boolean { return this.connected && (this.parent?.isConnected ?? true); }
  contains(other: Surface): boolean {
    for (let node: Surface | null = other; node; node = node.parent) if (node === this) return true;
    return false;
  }
}

function fixture() {
  const app = new Surface("app"), trigger = new Surface("trigger", app), existingInert = new Surface("existing-inert");
  existingInert.inert = true;
  const children = [app, existingInert];
  let active = trigger, overflow = "clip";
  const focused: string[] = [];
  const focus = (node: Surface) => {
    if (!node.isConnected) return false;
    for (let ancestor: Surface | null = node; ancestor; ancestor = ancestor.parent) if (ancestor.inert) return false;
    active = node; focused.push(node.name); return true;
  };
  const stack = createDialogStack({ children: () => children.filter(node => node.isConnected), activeElement: () => active, getOverflow: () => overflow, setOverflow: value => { overflow = value; }, focus });
  const surface = (name: string) => {
    const layer = new Surface(name), control = new Surface(`${name}-button`, layer);
    children.push(layer);
    return { layer, control };
  };
  const open = (item: ReturnType<typeof surface>, onEscape = () => {}) => stack.register({ element: item.layer, focusInitial: () => { focus(item.control); }, onEscape });
  return { app, existingInert, children, trigger, focused, focus, stack, surface, open, active: () => active, overflow: () => overflow };
}

test("closing the lower layer first keeps background locked and final close restores the first baseline", () => {
  const f = fixture(), a = f.surface("a"), aLock = f.open(a), b = f.surface("b"), bLock = f.open(b);
  a.layer.connected = false; aLock.release();
  assert.equal(f.app.inert, true); assert.equal(b.layer.inert, false); assert.equal(f.overflow(), "hidden"); assert.equal(f.active(), b.control);
  b.layer.connected = false; bLock.release();
  assert.equal(f.app.inert, false); assert.equal(f.existingInert.inert, true); assert.equal(f.overflow(), "clip"); assert.equal(f.active(), f.trigger);
});

test("two portals mounted before either registration leave only the last registration interactive", () => {
  const f = fixture(), a = f.surface("a"), b = f.surface("b");
  const aLock = f.open(a), bLock = f.open(b);
  assert.equal(a.layer.inert, true); assert.equal(b.layer.inert, false); assert.equal(f.active(), b.control);
  b.layer.connected = false; bLock.release();
  assert.equal(a.layer.inert, false); assert.equal(f.active(), a.control); assert.equal(f.app.inert, true);
  a.layer.connected = false; aLock.release();
  assert.equal(f.app.inert, false); assert.equal(f.active(), f.trigger);
});

test("only the top registration consumes Escape, including a busy layer that refuses to close", () => {
  const f = fixture(), calls: string[] = [], a = f.surface("a"), aLock = f.open(a, () => calls.push("a")), b = f.surface("b"), bLock = f.open(b, () => calls.push("busy-b"));
  assert.equal(aLock.escape(), false); assert.equal(bLock.escape(), true); assert.deepEqual(calls, ["busy-b"]);
  assert.equal(bLock.isTop(), true); assert.equal(f.app.inert, true);
  b.layer.connected = false; bLock.release();
  assert.equal(aLock.escape(), true); assert.deepEqual(calls, ["busy-b", "a"]);
  aLock.release(); assert.equal(aLock.escape(), false);
});

test("returning from an inner layer restores its opener, then the original page opener", () => {
  const f = fixture(), a = f.surface("a"), aLock = f.open(a), nestedTrigger = new Surface("nested-trigger", a.layer);
  f.focus(nestedTrigger);
  const b = f.surface("b"), bLock = f.open(b);
  b.layer.connected = false; bLock.release();
  assert.equal(f.active(), nestedTrigger);
  a.layer.connected = false; aLock.release();
  assert.equal(f.active(), f.trigger); assert.equal(f.overflow(), "clip");
});

test("release is idempotent and a later opening captures a fresh page focus baseline", () => {
  const f = fixture(), a = f.surface("a"), aLock = f.open(a);
  a.layer.connected = false; aLock.release(); const count = f.focused.length; aLock.release(); assert.equal(f.focused.length, count);
  const otherTrigger = new Surface("other-trigger", f.app); f.focus(otherTrigger);
  const b = f.surface("b"), bLock = f.open(b); b.layer.connected = false; bLock.release();
  assert.equal(f.active(), otherTrigger); assert.equal(f.overflow(), "clip");
});

test("nested mobile navigation and a portal share the document lock without replacing React-owned inert state", () => {
  const f = fixture(), nav = new Surface("nav", f.app), navButton = new Surface("nav-button", nav);
  const navLock = f.stack.register({ element: nav, focusInitial: () => { f.focus(navButton); }, onEscape: () => {} });
  assert.equal(f.app.inert, false); assert.equal(f.existingInert.inert, true);
  const b = f.surface("b"), bLock = f.open(b);
  assert.equal(f.app.inert, true);
  nav.inert = true; navLock.release();
  assert.equal(f.app.inert, true); assert.equal(f.overflow(), "hidden");
  b.layer.connected = false; bLock.release();
  assert.equal(f.app.inert, false); assert.equal(nav.inert, true); assert.equal(f.active(), f.trigger); assert.equal(f.overflow(), "clip");
});
