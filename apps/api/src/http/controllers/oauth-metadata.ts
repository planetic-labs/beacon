import { auth } from "@api/modules/auth/config";
import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
export const GET = oauthProviderAuthServerMetadata(auth);
