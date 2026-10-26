export function byteRange(header: string | null, size: number): { start: number; end: number } | undefined {
  if (!header) return;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || !match[1] && !match[2] || !size) throw new RangeError("Invalid range");
  const first = match[1] ? Number(match[1]) : undefined;
  const last = match[2] ? Number(match[2]) : undefined;
  if (first !== undefined && !Number.isSafeInteger(first) || last !== undefined && !Number.isSafeInteger(last)) throw new RangeError("Invalid range");
  const start = first ?? Math.max(0, size - (last ?? 0));
  const end = first === undefined ? size - 1 : Math.min(last ?? size - 1, size - 1);
  if (start >= size || start > end || first === undefined && last === 0) throw new RangeError("Invalid range");
  return { start, end };
}
