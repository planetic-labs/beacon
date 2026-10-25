import { auth } from "@/modules/auth/config";
import { oauthProviderOpenIdConfigMetadata } from "@better-auth/oauth-provider";
export const GET = oauthProviderOpenIdConfigMetadata(auth);
