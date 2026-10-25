import { test } from "node:test";
import assert from "node:assert/strict";
import { pushErrorMessage } from "../apps/web/src/components/push-errors";
test("push registration failures provide browser-specific recovery instructions", () => {
  const error = new DOMException("Registration failed - push service error", "AbortError");
  assert.match(pushErrorMessage(error,true),/brave:\/\/settings\/privacy/);
  assert.doesNotMatch(pushErrorMessage(error),/Brave/);
  assert.doesNotMatch(pushErrorMessage(error),/Registration failed/);
  assert.match(pushErrorMessage(new DOMException("Denied","NotAllowedError")),/Разрешите уведомления/);
  assert.equal(pushErrorMessage(new Error("Достигнут лимит устройств")),"Достигнут лимит устройств");
});
