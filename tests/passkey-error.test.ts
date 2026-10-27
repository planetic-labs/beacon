import { test } from "node:test";
import assert from "node:assert/strict";
import { passkeyRegistrationError, FreshSessionRequiredError } from "../apps/web/src/lib/passkey-error";

test("registration errors distinguish device rejection, duplicate keys and session failures", () => {
  assert.match(passkeyRegistrationError({name:"NotAllowedError"}).message, /Устройство не разрешило/);
  assert.match(passkeyRegistrationError({code:"ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED"}).message, /уже есть ключ/);
  assert.match(passkeyRegistrationError({status:401}).message, /Сессия истекла/);
  assert.match(passkeyRegistrationError({status:429}).message, /Слишком много/);
  assert.match(passkeyRegistrationError({code:"ERROR_INVALID_RP_ID"}).message, /адрес приложения/);
});
test("raw exception contents never leak into the notification", () => {
  assert.doesNotMatch(passkeyRegistrationError({message:"private payload",code:"private payload"}).message, /private payload/);
  assert.doesNotMatch(passkeyRegistrationError(null).message, /undefined|null/);
});

test("only an explicit freshness rejection requests email confirmation", () => {
  assert.ok(passkeyRegistrationError({status:403,code:"SESSION_NOT_FRESH"}) instanceof FreshSessionRequiredError);
  assert.equal(passkeyRegistrationError({status:403,code:"FORBIDDEN"}) instanceof FreshSessionRequiredError,false);
});
