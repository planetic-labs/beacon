import { useLayoutEffect, useSyncExternalStore, type ReactNode, type RefObject } from "react";

// Only the composer subscribes: typing must not invalidate the conversation tree.
export function createComposerState() {
  let value = { text: "", cursor: 0 };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    text(text: string) { if (text !== value.text) { value = { ...value, text }; listeners.forEach(listener => listener()); } },
    cursor(cursor: number) { if (cursor !== value.cursor) { value = { ...value, cursor }; listeners.forEach(listener => listener()); } },
  };
}
export function ComposerFrame({ state, textarea, device, context, children }: {
  state: ReturnType<typeof createComposerState>;
  textarea: RefObject<HTMLTextAreaElement | null>;
  device: string;
  context: unknown;
  children: (text: string, cursor: number) => ReactNode;
}) {
  const { text, cursor } = useSyncExternalStore(state.subscribe, state.getSnapshot);
  useLayoutEffect(() => {
    const input = textarea.current;
    if (!input) return;
    input.style.height = "auto";
    const style = getComputedStyle(input), line = parseFloat(style.lineHeight) || 20;
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    input.style.height = Math.max(line * (device === "mobile" ? 1 : 2) + padding, Math.min(input.scrollHeight, line * (device === "mobile" ? 8 : 13) + padding)) + "px";
    input.style.overflowY = input.scrollHeight > parseFloat(input.style.height) ? "auto" : "hidden";
  }, [text, device, context, textarea]);
  return children(text, cursor);
}
