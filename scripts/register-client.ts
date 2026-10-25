import { writeFile } from "node:fs/promises";
import { auth } from "../src/modules/auth/config";
import { pool } from "../src/db";
// Run explicitly; credentials are written to a mounted external directory, never stdout.
const [redirectUri, output] = process.argv.slice(2);
if (!redirectUri || !output?.startsWith("/run/"))
  throw new Error(
    "Provide redirect URI and /run/... output path in an external mount",
  );
if (!process.env.ADMIN_SESSION_COOKIE)
  throw new Error("An active administrator session is required");
try {
  const client = await auth.api.adminCreateOAuthClient({
    headers: new Headers({ cookie: process.env.ADMIN_SESSION_COOKIE }),
    body: {
      redirect_uris: [redirectUri],
      client_name: "Connected application",
      scope: "openid profile email groups offline_access",
      skip_consent: true,
      require_pkce: true,
      client_secret_expires_at: 0,
    },
  });
  await writeFile(output, JSON.stringify(client, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  console.log(
    "INFO OIDC client registered; credentials saved to external file",
  );
} finally {
  await pool.end();
}
