import {
  type AnyPgColumn,
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
// Calls and participants are separate so group rooms can reuse the lifecycle later.
export const call = pgTable("call", {
  id: id(), chatId: uuid("chat_id").notNull().references(()=>chats.id),
  callerId: uuid("caller_id").notNull().references(()=>user.id),
  mode: text("mode").notNull(), status: text("status").notNull().default("ringing"),
  createdAt: time("created_at"), acceptedAt: timestamp("accepted_at",{withTimezone:true}),
  endedAt: timestamp("ended_at",{withTimezone:true}), reason: text("reason"),
},t=>[index("call_chat_created_idx").on(t.chatId,t.createdAt),check("call_mode_check",sql`${t.mode} in ('audio','video')`),check("call_status_check",sql`${t.status} in ('ringing','active','ended')`)]);
export const callParticipant = pgTable("call_participant", {
  callId: uuid("call_id").notNull().references(()=>call.id),
  userId: uuid("user_id").notNull().references(()=>user.id),
  clientId: uuid("client_id"),
  heartbeatAt: time("heartbeat_at"),
},t=>[primaryKey({columns:[t.callId,t.userId]}),index("call_participant_user_idx").on(t.userId)]);
export const callPushDelivery = pgTable('call_push_delivery',{
 id:id(),callId:uuid('call_id').notNull().references(()=>call.id),
 subscriptionId:uuid('subscription_id').notNull().references(()=>pushSubscriptions.id,{onDelete:'cascade'}),
 kind:text('kind').notNull(),attempts:integer('attempts').notNull().default(0),
 createdAt:time('created_at'),nextAttemptAt:time('next_attempt_at'),
 leaseUntil:timestamp('lease_until',{withTimezone:true}),completedAt:timestamp('completed_at',{withTimezone:true}),outcome:text('outcome'),
},t=>[uniqueIndex('call_push_unique_idx').on(t.callId,t.subscriptionId,t.kind),index('call_push_pending_idx').on(t.nextAttemptAt).where(sql`${t.completedAt} is null`),check('call_push_kind_check',sql`${t.kind} in ('invite','state')`)]);
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
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { withTimezone: true }),
  createdAt: time("created_at"),
  updatedAt: time("updated_at"),
}, (t) => [check("user_email_canonical", sql`${t.email} = lower(btrim(${t.email}))`)]);
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
    description: text("description").notNull().default(""),
    historyRevision: integer("history_revision").notNull().default(0),
    image: text("image"),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => user.id),
    directKey: text("direct_key").unique(),
    createdAt: time("created_at"),
    updatedAt: time("updated_at"),
  },
  (t) => [check("chat_kind_check", sql`${t.kind} in ('direct','group','saved')`)],
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
    pinned: boolean("pinned").notNull().default(false),
    draft: jsonb("draft").notNull().default(sql`'{"text":"","mentions":[]}'::jsonb`),
    draftRevision: integer("draft_revision").notNull().default(0),
    joinedAt: time("joined_at"),
    lastReadAt: time("last_read_at"),
    lastDeliveredAt: timestamp("last_delivered_at", { withTimezone: true, precision: 6 }).notNull().default(sql`'epoch'::timestamptz`),
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
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("message_retry_idx").on(t.authorId, t.clientMessageId),
    index("message_history_idx").on(t.chatId, t.createdAt, t.id),
    index("message_attachment_idx").on(t.chatId,t.type,t.createdAt,t.id).where(sql`${t.deletedAt} is null and ${t.type} in ('photo','video','circle','file','audio')`),
    index("message_links_idx").on(t.chatId,t.createdAt,t.id).where(sql`${t.deletedAt} is null and (${t.content}->>'text') ~* 'https?://'`),
    index("message_search_text_idx").using("gin",sql`to_tsvector('simple',beacon_search_normalize(coalesce(${t.content}->>'text','')))`)
      .where(sql`${t.type} in ('text','photo')`),
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
  originalName: text("original_name"),
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

export const stickerPacks = pgTable("sticker_pack", {
  id: id(),
  ownerId: uuid("owner_id").references(() => user.id),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: time("created_at"),
}, t => [index("sticker_pack_owner_idx").on(t.ownerId)]);
export const stickers = pgTable("sticker", {
  id: id(),
  packId: uuid("pack_id").notNull().references(() => stickerPacks.id),
  fileId: uuid("file_id").notNull().unique().references(() => files.id),
  label: text("label").notNull(),
  emojis: text("emojis").array().notNull().default(sql`'{}'::text[]`),
  keywords: text("keywords").array().notNull().default(sql`'{}'::text[]`),
  createdAt: time("created_at"),
}, t => [index("sticker_pack_idx").on(t.packId)]);

// A pin belongs to its message; access always follows current chat membership.
export const pinnedMessages = pgTable("pinned_message", {
  messageId: uuid("message_id").primaryKey().references(()=>messages.id,{onDelete:"cascade"}),
  pinnedBy: uuid("pinned_by").notNull().references(()=>user.id),
  createdAt: timestamp("created_at",{withTimezone:true,precision:6}).notNull().default(sql`clock_timestamp()`),
});
// Per-connection leases let multiple devices/instances share presence without Redis.
export const presenceLeases = pgTable("presence_lease", {
  id: id(),
  userId: uuid("user_id").notNull().references(()=>user.id),
  sessionId: uuid("session_id").notNull().references(()=>session.id,{onDelete:"cascade"}),
  seenAt: time("seen_at"),
  expiresAt: time("expires_at"),
},t=>[index("presence_lease_user_idx").on(t.userId),index("presence_lease_expiry_idx").on(t.expiresAt)]);

// Non-overlapping acknowledgement ranges retain exact server times without a row per message/recipient pair.
export const receiptCheckpoints = pgTable("receipt_checkpoint", {
  id: id(),
  chatId: uuid("chat_id").notNull().references(()=>chats.id),
  userId: uuid("user_id").notNull().references(()=>user.id),
  joinedAt: timestamp("joined_at",{withTimezone:true,precision:6}).notNull(),
  kind: text("kind").notNull(),
  fromAt: timestamp("from_at",{withTimezone:true,precision:6}).notNull(),
  throughAt: timestamp("through_at",{withTimezone:true,precision:6}).notNull(),
  acknowledgedAt: timestamp("acknowledged_at",{withTimezone:true,precision:6}).notNull().default(sql`clock_timestamp()`),
},t=>[
  index("receipt_checkpoint_lookup_idx").on(t.chatId,t.userId,t.joinedAt,t.kind,t.throughAt),
  check("receipt_checkpoint_kind",sql`${t.kind} in ('delivered','read')`),
  check("receipt_checkpoint_range",sql`${t.fromAt}<${t.throughAt}`),
]);

// Managed file spaces share users/authentication with Beacon, never chat permissions.
export const storageSpaces = pgTable("storage_space", {
  id: id(), name: text("name").notNull(),
  personalFolderLabel: text("personal_folder_label").notNull().default("Пользователи"),
  ownerId: uuid("owner_id").references(() => user.id),
  provider: text("provider").notNull().default("local"),
  createdAt: time("created_at"),
}, t => [uniqueIndex("storage_personal_owner_idx").on(t.ownerId)]);
export const storageNodes = pgTable("storage_node", {
  id: id(), spaceId: uuid("space_id").notNull().references(() => storageSpaces.id),
  parentId: uuid("parent_id").references(():AnyPgColumn=>storageNodes.id), name: text("name").notNull(),
  filesystemPath: text("filesystem_path"), filesystemMtime: text("filesystem_mtime"),
  directory: boolean("directory").notNull().default(false),
  createdBy: uuid("created_by").notNull().references(() => user.id),
  state: text("state").notNull().default("ready"),
  size: bigint("size", { mode: "number" }).notNull().default(0),
  mime: text("mime").notNull().default("application/octet-stream"),
  sha256: text("sha256"), hashState: text("hash_state").notNull().default("none"),
  sourceId: uuid("source_id").references(():AnyPgColumn=>storageNodes.id), deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: time("created_at"), updatedAt: time("updated_at"),
}, t => [index("storage_node_parent_idx").on(t.spaceId,t.parentId),
  uniqueIndex("storage_node_name_idx").on(t.spaceId,sql`coalesce(${t.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,t.name).where(sql`${t.deletedAt} is null and ${t.state}<>'missing'`),
  check("storage_node_state_check",sql`${t.state} in ('uploading','processing','ready','copying','purging','error','missing')`),
  check("storage_node_size_check",sql`${t.size}>=0`),
  check("storage_node_parent_check",sql`${t.parentId} is null or ${t.parentId}<>${t.id}`)]);
export const storageGrants = pgTable("storage_grant", {
  id: id(), spaceId: uuid("space_id").notNull().references(() => storageSpaces.id),
  nodeId: uuid("node_id").references(() => storageNodes.id,{onDelete:"cascade"}),
  groupId: uuid("group_id").notNull().references(() => groups.id),
  access: text("access").notNull(),
},t=>[check("storage_grant_access_check",sql`${t.access} in ('read','write')`)]);
export const storageUserNodes = pgTable("storage_user_node", {
  userId: uuid("user_id").notNull().references(() => user.id),
  nodeId: uuid("node_id").notNull().references(() => storageNodes.id,{onDelete:"cascade"}),
  favorite: boolean("favorite").notNull().default(false),
  visitedAt: timestamp("visited_at",{withTimezone:true}),
},t=>[primaryKey({columns:[t.userId,t.nodeId]})]);
export const storageAudit = pgTable("storage_audit", {
  id: id(), userId: uuid("user_id").notNull().references(()=>user.id),
  action: text("action").notNull(), nodeId: uuid("node_id"),
  spaceId: uuid("space_id").notNull(), createdAt: time("created_at"),
});

// Personal chat folders never change conversation membership or other users' lists.
export const chatFolder = pgTable("chat_folder", {
  id:id(), userId:uuid("user_id").notNull().references(()=>user.id), name:text("name").notNull(), createdAt:time("created_at"),
}, t=>[index("chat_folder_user_idx").on(t.userId)]);
export const chatFolderItem = pgTable("chat_folder_item", {
  folderId:uuid("folder_id").notNull().references(()=>chatFolder.id,{onDelete:"cascade"}),
  chatId:uuid("chat_id").notNull().references(()=>chats.id,{onDelete:"cascade"}),
},t=>[primaryKey({columns:[t.folderId,t.chatId]})]);
