import { auth } from "@/modules/auth/config";
import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
export const GET = oauthProviderAuthServerMetadata(auth);
