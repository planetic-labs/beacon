import { passkeyRegistrationError } from "./lib/passkey-error";
import { startRegistration, startAuthentication, WebAuthnAbortService } from "@simplewebauthn/browser";
import { beginConditionalPasskey } from "./lib/conditional-passkey";
import { createAuthClient } from "better-auth/react";
import { emailOTPClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
export const authClient = createAuthClient({
  fetchOptions: { timeout: 15000 },
  plugins: [emailOTPClient(), passkeyClient(), oauthProviderClient()],
});

export function beginPasskeyAutofill(signedIn: () => Promise<void>) {
  return beginConditionalPasskey({
    supported: async () => typeof PublicKeyCredential !== "undefined"
      && typeof PublicKeyCredential.isConditionalMediationAvailable === "function"
      && await PublicKeyCredential.isConditionalMediationAvailable(),
    options: async signal => {
      const result = await authClient.$fetch<Parameters<typeof startAuthentication>[0]["optionsJSON"]>(
        "/passkey/generate-authenticate-options", { method: "GET", signal },
      );
      if (result.error || !result.data) throw new Error("Passkey options unavailable");
      return result.data;
    },
    authenticate: optionsJSON => startAuthentication({ optionsJSON, useBrowserAutofill: true }),
    verify: async (assertion, signal) => {
      const { clientExtensionResults: _, ...response } = assertion;
      const result = await authClient.$fetch("/passkey/verify-authentication", {
        method: "POST", body: { response }, signal,
      });
      if (result.error) return false;
      authClient.$store.notify("$sessionSignal");
      return true;
    },
    cancel: () => WebAuthnAbortService.cancelCeremony(),
  }, signedIn);
}

// Safari must retain the button's user gesture through the options request.
// Keep a native fetch before WebAuthn instead of the auth client's fetch wrapper.
export async function registerPasskey(name: string) {
  try {
    const response = await fetch("/api/auth/passkey/generate-register-options", {
      credentials: "same-origin", cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw { status: response.status, code: body?.code };
    }
    const optionsJSON: Parameters<typeof startRegistration>[0]["optionsJSON"] = await response.json();
    const { clientExtensionResults: _, ...credential } = await startRegistration({ optionsJSON });
    const result = await authClient.$fetch("/passkey/verify-registration", {
      method: "POST", body: { response: credential, name },
    });
    if (result.error) throw result.error;
  } catch (error) { throw passkeyRegistrationError(error); }
}
