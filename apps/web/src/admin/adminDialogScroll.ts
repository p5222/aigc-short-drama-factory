type ScrollStyle = Pick<CSSStyleDeclaration, "overflow" | "overscrollBehavior">;
type ScrollDocument = { body: { style: ScrollStyle }; documentElement: { style: ScrollStyle } };
const locks = new WeakMap<ScrollDocument, { count: number; bodyOverflow: string; bodyOverscroll: string; rootOverflow: string; rootOverscroll: string }>();

export function lockAdminDocumentScroll(target: ScrollDocument) {
  let state = locks.get(target);
  if (!state) {
    state = { count: 0, bodyOverflow: target.body.style.overflow, bodyOverscroll: target.body.style.overscrollBehavior, rootOverflow: target.documentElement.style.overflow, rootOverscroll: target.documentElement.style.overscrollBehavior };
    locks.set(target, state);
    target.body.style.overflow = "hidden";
    target.body.style.overscrollBehavior = "none";
    target.documentElement.style.overflow = "hidden";
    target.documentElement.style.overscrollBehavior = "none";
  }
  state.count += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.count -= 1;
    if (state.count > 0) return;
    target.body.style.overflow = state.bodyOverflow;
    target.body.style.overscrollBehavior = state.bodyOverscroll;
    target.documentElement.style.overflow = state.rootOverflow;
    target.documentElement.style.overscrollBehavior = state.rootOverscroll;
    locks.delete(target);
  };
}
