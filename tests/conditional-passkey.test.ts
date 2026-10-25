import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { beginConditionalPasskey } from "../apps/web/src/lib/conditional-passkey";

function fixture() {
  const calls: string[] = [];
  const adapter = {
    supported: async () => true,
    options: async (_signal: AbortSignal) => { calls.push("options"); return "challenge"; },
    authenticate: async (_options: string) => { calls.push("authenticate"); return "assertion"; },
    verify: async (_assertion: string, _signal: AbortSignal) => { calls.push("verify"); return true; },
    cancel: () => { calls.push("cancel"); },
  };
  const signedIn = async () => { calls.push("signedIn"); };
  return { calls, adapter, signedIn };
}

test("conditional passkey completes login only after verification", async () => {
  const f = fixture();
  const stop = beginConditionalPasskey(f.adapter, f.signedIn);
  await setImmediate();
  assert.deepEqual(f.calls, ["options", "authenticate", "verify", "signedIn"]);
  stop();
  assert.ok(!f.calls.includes("cancel"));
});

test("unsupported browsers do not request authentication options", async () => {
  const f = fixture();
  f.adapter.supported = async () => false;
  beginConditionalPasskey(f.adapter, f.signedIn);
  await setImmediate();
  assert.deepEqual(f.calls, []);
});

test("leaving during options fetch prevents a delayed browser prompt", async () => {
  const f = fixture();
  let finish!: (value: string) => void;
  let signal!: AbortSignal;
  f.adapter.options = async value => { signal = value; return new Promise(resolve => { finish = resolve; }); };
  const stop = beginConditionalPasskey(f.adapter, f.signedIn);
  await setImmediate();
  stop();
  assert.ok(signal.aborted);
  finish("challenge");
  await setImmediate();
  assert.deepEqual(f.calls, []);
});

test("switching login method cancels a pending ceremony exactly once", async () => {
  const f = fixture();
  let finish!: (value: string) => void;
  f.adapter.authenticate = async () => new Promise(resolve => { finish = resolve; });
  const stop = beginConditionalPasskey(f.adapter, f.signedIn);
  await setImmediate();
  stop();
  stop();
  finish("assertion");
  await setImmediate();
  assert.deepEqual(f.calls, ["options", "cancel"]);
});

test("a rejected verification never completes login", async () => {
  const f = fixture();
  f.adapter.verify = async () => false;
  beginConditionalPasskey(f.adapter, f.signedIn);
  await setImmediate();
  assert.deepEqual(f.calls, ["options", "authenticate"]);
});

test("background cancellation or failure is silent", async () => {
  const f = fixture();
  f.adapter.authenticate = async () => { throw new Error("Cancelled"); };
  beginConditionalPasskey(f.adapter, f.signedIn);
  await setImmediate();
  assert.deepEqual(f.calls, ["options"]);
});
