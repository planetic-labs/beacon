import { test } from "node:test";
import assert from "node:assert/strict";
import { byteRange } from "../apps/api/src/modules/media/range";
test("private media byte ranges support seeking and suffixes", () => {
  assert.equal(byteRange(null, 100), undefined);
  assert.deepEqual(byteRange("bytes=0-9", 100), { start: 0, end: 9 });
  assert.deepEqual(byteRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(byteRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(byteRange("bytes=95-999", 100), { start: 95, end: 99 });
  for (const range of ["bytes=-", "bytes=100-", "bytes=9-2", "bytes=-0", "bytes=0-1,3-4", "invalid", "bytes=999999999999999999-"]) assert.throws(() => byteRange(range, 100), RangeError);
});
