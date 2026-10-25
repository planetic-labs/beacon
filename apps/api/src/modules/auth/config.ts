import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, emailOTP, jwt } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { oauthProvider } from "@better-auth/oauth-provider";
import { v7 } from "uuid";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import * as schema from "../../db/schema";
import { mailDelivery } from "../mail";

const createAuth = () => betterAuth({
  logger: {
    level: "warn",
    log(level) {
      console.log(`${level.toUpperCase()} authentication library event`);
    },
  },
  onAPIError: {
    onError(error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (!status || status >= 500)
        console.error("ERROR authentication request failed");
    },
  },
  appName: "Beacon",
  baseURL: process.env.APP_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  trustedOrigins: [process.env.APP_URL!],
  disabledPaths: [
    "/sign-up/email",
    "/delete-user",
    "/admin/remove-user",
    "/admin/impersonate-user",
    "/token",
    "/oauth2/create-client",
    "/oauth2/update-client",
    "/oauth2/delete-client",
    "/oauth2/rotate-client-secret",
  ],
  advanced: {
    database: { generateId: () => v7() },
    ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
  },
  user: {
    additionalFields: {
      firstName: { type: "string", defaultValue: "", input: false },
      lastName: { type: "string", defaultValue: "", input: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 90,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: false },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    modelName: "rateLimits",
    window: 60,
    max: 60,
  },
  plugins: [
    admin(),
    emailOTP({
      disableSignUp: true,
      expiresIn: 600,
      allowedAttempts: 5,
      storeOTP: "hashed",
      async sendVerificationOTP({ email, otp, type }) {
        if (type !== "sign-in") return;
        const [u] = await db
          .select()
          .from(schema.user)
          .where(eq(schema.user.email, email.toLowerCase()));
        if (!u || u.banned) return;
        await mailDelivery.send({
          to: email,
          subject: "Код входа в Beacon",
          text: `Код входа: ${otp}. Действует 10 минут.`,
          html: `<p>Код входа: <strong>${otp}</strong></p><p>Действует 10 минут.</p>`,
        });
      },
    }),
    passkey({
      rpName: "Beacon",
      rpID: process.env.APP_URL
        ? new URL(process.env.APP_URL).hostname
        : "localhost",
      origin: process.env.APP_URL,
    }),
    jwt(),
    oauthProvider({
      loginPage: "/",
      consentPage: "/consent",
      scopes: ["openid", "profile", "email", "groups", "offline_access"],
      clientPrivileges: async ({ user: u }) => u?.role === "admin" && !u.banned,
      customUserInfoClaims: async ({ user: u, scopes }) => {
        const memberships = await db
          .select({ code: schema.groups.code })
          .from(schema.groupMembers)
          .innerJoin(
            schema.groups,
            eq(schema.groups.id, schema.groupMembers.groupId),
          )
          .where(eq(schema.groupMembers.userId, u.id));
        return {
          ...(scopes.includes("profile")
            ? { given_name: u.firstName, family_name: u.lastName, role: u.role }
            : {}),
          ...(scopes.includes("groups")
            ? { groups: memberships.map((g) => g.code) }
            : {}),
        };
      },
    }),
  ],
});

// Build images without deployment secrets. Initialize authentication only when
// a runtime request (or an explicit administrative command) needs it.
let instance:ReturnType<typeof createAuth>|undefined;
function configuredAuth(){return instance??=createAuth()}
export const auth={
  get handler(){return configuredAuth().handler},
  get api(){return configuredAuth().api},
  get $context(){return configuredAuth().$context},
  get options(){return configuredAuth().options},
};
