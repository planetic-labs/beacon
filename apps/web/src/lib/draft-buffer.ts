// Coalesce local writes, with a maximum delay during continuous typing.
export function createDraftBuffer<T>(write: (id: string, value: T) => void, backup: () => void, delay = 200, maximumDelay = 1000) {
  const pending = new Map<string, T>();
  let idle: ReturnType<typeof setTimeout> | undefined;
  let maximum: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(idle); clearTimeout(maximum); idle = maximum = undefined;
    if (!pending.size) return;
    const entries = [...pending]; pending.clear();
    for (const [id, value] of entries) write(id, value);
    backup();
  };
  return {
    change(id: string, value: T) {
      pending.set(id, value);
      clearTimeout(idle); idle = setTimeout(flush, delay);
      maximum ??= setTimeout(flush, maximumDelay);
    },
    flush,
  };
}
