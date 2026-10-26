import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestPasskeyLabel } from "../apps/web/src/lib/passkey-label";

test("key labels distinguish device platforms and browser variants", () => {
  assert.equal(suggestPasskeyLabel({ userAgent: "Mozilla/5.0 (Linux; Android 13) Chrome/120 Safari/537.36" }), "Android · Chrome");
  assert.equal(suggestPasskeyLabel({ userAgent: "Mozilla/5.0 (Linux; Android 13) Chrome/120 SamsungBrowser/23 Safari/537.36" }), "Android · Samsung Internet");
  assert.equal(suggestPasskeyLabel({ userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36 Edg/120" }), "Windows · Edge");
  assert.equal(suggestPasskeyLabel({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X) Version/17 Safari/605", platform: "MacIntel", maxTouchPoints: 5 }), "iPadOS · Safari");
  assert.equal(suggestPasskeyLabel({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X) Version/17 Safari/605", platform: "MacIntel", maxTouchPoints: 0 }), "macOS · Safari");
  assert.equal(suggestPasskeyLabel({ userAgent: "Mozilla/5.0 (iPhone) FxiOS/120 Safari/605" }), "iOS · Firefox");
  assert.equal(suggestPasskeyLabel({ userAgent: "" }), "Устройство · Браузер");
});
