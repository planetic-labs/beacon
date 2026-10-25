import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const id = () =>
  uuid("id")
    .primaryKey()
    .default(sql`uuidv7()`);
const time = (name: string) =>
  timestamp(name, { withTimezone: true }).notNull().defaultNow();
export const user = pgTable("user", {
  id: id(),
  name: text("name").notNull(),
  firstName: text("first_name").notNull().default(""),
  lastName: text("last_name").notNull().default(""),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: text("role").notNull().default("user"),
  banned: boolean("banned").notNull().default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { withTimezone: true }),
  createdAt: time("created_at"),
  updatedAt: time("updated_at"),
});
export const session = pgTable(
  "session",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    impersonatedBy: text("impersonated_by"),
    createdAt: time("created_at"),
    updatedAt: time("updated_at"),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);
export const account = pgTable("account", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: time("created_at"),
  updatedAt: time("updated_at"),
});
export const verification = pgTable(
  "verification",
  {
    // Better Auth also uses deterministic digest IDs for atomic verification locks.
    id: text("id")
      .primaryKey()
      .default(sql`uuidv7()::text`),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: time("created_at"),
    updatedAt: time("updated_at"),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);
export const passkey = pgTable("passkey", {
  id: id(),
  name: text("name"),
  publicKey: text("public_key").notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id),
  credentialID: text("credential_id").notNull(),
  counter: integer("counter").notNull(),
  deviceType: text("device_type").notNull(),
  backedUp: boolean("backed_up").notNull(),
  transports: text("transports"),
  createdAt: time("created_at"),
  aaguid: text("aaguid"),
});
export const jwks = pgTable("jwks", {
  id: id(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  alg: text("alg"),
  crv: text("crv"),
  createdAt: time("created_at"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

export const groups = pgTable("membership_group", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  createdAt: time("created_at"),
});
export const groupMembers = pgTable(
  "group_member",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })],
);
export const chats = pgTable(
  "chat",
  {
    id: id(),
    kind: text("kind").notNull(),
    title: text("title"),
    image: text("image"),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => user.id),
    directKey: text("direct_key").unique(),
    createdAt: time("created_at"),
    updatedAt: time("updated_at"),
  },
  (t) => [check("chat_kind_check", sql`${t.kind} in ('direct','group')`)],
);
export const chatMembers = pgTable(
  "chat_member",
  {
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    joinedAt: time("joined_at"),
    lastReadAt: time("last_read_at"),
  },
  (t) => [
    primaryKey({ columns: [t.chatId, t.userId] }),
    index("chat_member_user_idx").on(t.userId),
  ],
);
export const messages = pgTable(
  "message",
  {
    id: id(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id),
    authorId: uuid("author_id")
      .notNull()
      .references(() => user.id),
    clientMessageId: uuid("client_message_id").notNull(),
    type: text("type").notNull().default("text"),
    content: jsonb("content").notNull().$type<{ text: string }>(),
    replyToId: uuid("reply_to_id"),
    forwardedFrom: jsonb("forwarded_from").$type<{
      authorName: string;
      authorId: string;
    }>(),
    // Use insertion time (after the chat lock), not transaction start time.
    // History serializes this value as an ISO string without losing microseconds.
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6 })
      .notNull()
      .default(sql`clock_timestamp()`),
    editedAt: timestamp("edited_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("message_retry_idx").on(t.authorId, t.clientMessageId),
    index("message_history_idx").on(t.chatId, t.createdAt, t.id),
  ],
);
export const reactions = pgTable(
  "reaction",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    emoji: text("emoji").notNull(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId] })],
);
export const files = pgTable("media_file", {
  id: id(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => user.id),
  key: text("storage_key").notNull().unique(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  createdAt: time("created_at"),
});
export const outbox = pgTable(
  "outbox",
  {
    id: id(),
    kind: text("kind").notNull(),
    payload: jsonb("payload")
      .notNull()
      .$type<{ chatId?: string; userIds?: string[]; blockedUserId?: string }>(),
    createdAt: time("created_at"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    index("outbox_pending_idx")
      .on(t.createdAt)
      .where(sql`${t.processedAt} is null`),
  ],
);
export const rateLimits = pgTable("rate_limit", {
  id: id(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export const pushSubscriptions = pgTable("push_subscription", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => user.id),
  sessionId: uuid("session_id").notNull().references(() => session.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: time("created_at"),
  updatedAt: time("updated_at"),
}, (t) => [index("push_subscription_user_idx").on(t.userId)]);

export const notificationPreferences = pgTable("notification_preference", {
  userId: uuid("user_id").primaryKey().references(() => user.id),
  enabled: boolean("enabled").notNull().default(true),
  showPreview: boolean("show_preview").notNull().default(false),
});

export const chatNotificationPreferences = pgTable("chat_notification_preference", {
  userId: uuid("user_id").notNull().references(() => user.id),
  chatId: uuid("chat_id").notNull().references(() => chats.id),
  muted: boolean("muted").notNull().default(false),
}, (t) => [primaryKey({ columns: [t.userId, t.chatId] })]);

export const pushDeliveries = pgTable("push_delivery", {
  id: id(),
  subscriptionId: uuid("subscription_id").notNull().references(() => pushSubscriptions.id, { onDelete: "cascade" }),
  messageId: uuid("message_id").notNull().references(() => messages.id),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().default(sql`now()+interval '3 seconds'`),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  outcome: text("outcome"),
  createdAt: time("created_at"),
}, (t) => [
  uniqueIndex("push_delivery_message_subscription_idx").on(t.messageId, t.subscriptionId),
  index("push_delivery_pending_idx").on(t.nextAttemptAt).where(sql`${t.completedAt} is null`),
]);

// OAuth Provider schema generated from the pinned plugin metadata.
export const oauthClient = pgTable("oauth_client", {
  id: id(),
  clientId: text("client_id").notNull().unique(),
  clientSecret: text("client_secret"),
  clientDiscoveryId: text("client_discovery_id"),
  disabled: boolean("disabled"),
  skipConsent: boolean("skip_consent"),
  enableEndSession: boolean("enable_end_session"),
  subjectType: text("subject_type"),
  scopes: text("scopes").array(),
  clientCredentialsScopes: text("client_credentials_scopes").array(),
  userId: uuid("user_id").references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
  name: text("name"),
  uri: text("uri"),
  icon: text("icon"),
  contacts: text("contacts").array(),
  tos: text("tos"),
  policy: text("policy"),
  softwareId: text("software_id"),
  softwareVersion: text("software_version"),
  softwareStatement: text("software_statement"),
  redirectUris: text("redirect_uris").array().notNull(),
  postLogoutRedirectUris: text("post_logout_redirect_uris").array(),
  backchannelLogoutUri: text("backchannel_logout_uri"),
  backchannelLogoutSessionRequired: boolean(
    "backchannel_logout_session_required",
  ),
  tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
  applicationType: text("application_type"),
  jwks: text("jwks"),
  jwksUri: text("jwks_uri"),
  grantTypes: text("grant_types").array(),
  responseTypes: text("response_types").array(),
  requirePKCE: boolean("require_p_k_c_e"),
  dpopBoundAccessTokens: boolean("dpop_bound_access_tokens"),
  referenceId: text("reference_id"),
  metadata: jsonb("metadata"),
});
export const oauthResource = pgTable("oauth_resource", {
  id: id(),
  identifier: text("identifier").notNull().unique(),
  name: text("name").notNull(),
  accessTokenTtl: integer("access_token_ttl"),
  refreshTokenTtl: integer("refresh_token_ttl"),
  signingAlgorithm: text("signing_algorithm"),
  signingKeyId: text("signing_key_id"),
  allowedScopes: text("allowed_scopes").array(),
  customClaims: jsonb("custom_claims"),
  dpopBoundAccessTokensRequired: boolean("dpop_bound_access_tokens_required"),
  disabled: boolean("disabled"),
  createdAt: timestamp("created_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
  policyVersion: integer("policy_version"),
  metadata: jsonb("metadata"),
});
export const oauthClientResource = pgTable("oauth_client_resource", {
  id: id(),
  clientId: text("client_id").notNull(),
  resourceId: text("resource_id").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }),
});
export const oauthRefreshToken = pgTable("oauth_refresh_token", {
  id: id(),
  token: text("token").notNull().unique(),
  clientId: text("client_id").notNull(),
  sessionId: uuid("session_id"),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id),
  referenceId: text("reference_id"),
  authorizationCodeId: text("authorization_code_id"),
  resources: text("resources").array(),
  requestedUserInfoClaims: text("requested_user_info_claims").array(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  revoked: timestamp("revoked", { withTimezone: true }),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }),
  rotationReplayResponse: text("rotation_replay_response"),
  rotationReplayExpiresAt: timestamp("rotation_replay_expires_at", {
    withTimezone: true,
  }),
  authTime: timestamp("auth_time", { withTimezone: true }),
  confirmation: jsonb("confirmation"),
  scopes: text("scopes").array().notNull(),
});
export const oauthAccessToken = pgTable("oauth_access_token", {
  id: id(),
  token: text("token").notNull().unique(),
  clientId: text("client_id").notNull(),
  sessionId: uuid("session_id"),
  userId: uuid("user_id").references(() => user.id),
  referenceId: text("reference_id"),
  authorizationCodeId: text("authorization_code_id"),
  resources: text("resources").array(),
  requestedUserInfoClaims: text("requested_user_info_claims").array(),
  refreshId: uuid("refresh_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  revoked: timestamp("revoked", { withTimezone: true }),
  confirmation: jsonb("confirmation"),
  scopes: text("scopes").array().notNull(),
});
export const oauthConsent = pgTable("oauth_consent", {
  id: id(),
  clientId: text("client_id").notNull(),
  userId: uuid("user_id").references(() => user.id),
  referenceId: text("reference_id"),
  resources: text("resources").array(),
  requestedUserInfoClaims: text("requested_user_info_claims").array(),
  scopes: text("scopes").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
export const oauthClientAssertion = pgTable("oauth_client_assertion", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
