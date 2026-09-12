export interface DialogStackNode {
  inert: boolean;
  isConnected: boolean;
  contains(node: this): boolean;
}

export interface DialogStackHost<T extends DialogStackNode> {
  children: () => T[];
  activeElement: () => T | null;
  getOverflow: () => string;
  setOverflow: (value: string) => void;
  focus: (target: T) => boolean;
}

export interface DialogStackEntry<T> {
  element: T;
  focusInitial: () => void;
  onEscape: () => void;
}

/** Own the document lock once, independently of the order overlays unmount. */
export function createDialogStack<T extends DialogStackNode>(host: DialogStackHost<T>) {
  const entries: Array<DialogStackEntry<T> & { id: symbol; origin: T | null }> = [];
  const originalInert = new Map<T, boolean>();
  let originalOverflow = "";
  let originalFocus: T | null = null;

  function sync() {
    const top = entries.at(-1);
    if (!top) return;
    for (const node of host.children()) {
      if (!originalInert.has(node)) originalInert.set(node, node.inert);
      // A navigation overlay may live inside the app root rather than a portal.
      node.inert = node === top.element || node.contains(top.element) ? originalInert.get(node)! : true;
    }
    host.setOverflow("hidden");
  }

  return {
    register(entry: DialogStackEntry<T>) {
      if (!entries.length) {
        originalOverflow = host.getOverflow();
        originalFocus = host.activeElement();
      }
      const current = { ...entry, id: Symbol("dialog"), origin: host.activeElement() };
      entries.push(current);
      sync();
      entry.focusInitial();
      let released = false;
      return {
        isTop: () => !released && entries.at(-1)?.id === current.id,
        escape() {
          if (released || entries.at(-1)?.id !== current.id) return false;
          entry.onEscape();
          return true;
        },
        release() {
          if (released) return;
          released = true;
          const wasTop = entries.at(-1)?.id === current.id;
          const index = entries.findIndex(item => item.id === current.id);
          if (index !== -1) entries.splice(index, 1);
          if (entries.length) {
            sync();
            const top = entries.at(-1)!;
            if (wasTop && !(current.origin?.isConnected && top.element.contains(current.origin) && host.focus(current.origin))) top.focusInitial();
            return;
          }
          for (const [node, inert] of originalInert) node.inert = inert;
          originalInert.clear();
          host.setOverflow(originalOverflow);
          if (originalFocus?.isConnected) host.focus(originalFocus);
          originalFocus = null;
        }
      };
    }
  };
}

const documentStacks = new WeakMap<Document, ReturnType<typeof createDialogStack<HTMLElement>>>();

/** Reuse for portals or nested modal navigation. Nested surfaces retain ownership of their internal inert attributes. */
export function dialogStackForDocument(document: Document) {
  let stack = documentStacks.get(document);
  if (!stack) {
    stack = createDialogStack<HTMLElement>({
      children: () => [...document.body.children].filter((node): node is HTMLElement => node instanceof HTMLElement),
      activeElement: () => document.activeElement instanceof HTMLElement ? document.activeElement : null,
      getOverflow: () => document.body.style.overflow,
      setOverflow: value => { document.body.style.overflow = value; },
      focus: target => {
        if (!target.isConnected || target.closest("[inert]") || target.matches(":disabled") || !target.getClientRects().length) return false;
        target.focus({ preventScroll: true });
        return document.activeElement === target;
      }
    });
    documentStacks.set(document, stack);
  }
  return stack;
}
