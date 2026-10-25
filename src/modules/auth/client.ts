import { createAuthClient } from "better-auth/react";
import { emailOTPClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
export const authClient = createAuthClient({
  fetchOptions: { timeout: 15000 },
  plugins: [emailOTPClient(), passkeyClient(), oauthProviderClient()],
});
