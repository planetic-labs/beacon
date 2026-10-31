CREATE TABLE "storage_audit" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"node_id" uuid,
	"space_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_grant" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"space_id" uuid NOT NULL,
	"node_id" uuid,
	"group_id" uuid NOT NULL,
	"access" text NOT NULL,
	CONSTRAINT "storage_grant_access_check" CHECK ("storage_grant"."access" in ('read','write'))
);
--> statement-breakpoint
CREATE TABLE "storage_node" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"space_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"directory" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"state" text DEFAULT 'ready' NOT NULL,
	"size" bigint DEFAULT 0 NOT NULL,
	"mime" text DEFAULT 'application/octet-stream' NOT NULL,
	"sha256" text,
	"hash_state" text DEFAULT 'none' NOT NULL,
	"source_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_node_state_check" CHECK ("storage_node"."state" in ('uploading','processing','ready','copying','purging','error')),
	CONSTRAINT "storage_node_size_check" CHECK ("storage_node"."size">=0)
);
--> statement-breakpoint
CREATE TABLE "storage_space" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"owner_id" uuid,
	"provider" text DEFAULT 'local' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_user_node" (
	"user_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"visited_at" timestamp with time zone,
	CONSTRAINT "storage_user_node_user_id_node_id_pk" PRIMARY KEY("user_id","node_id")
);
--> statement-breakpoint
ALTER TABLE "storage_audit" ADD CONSTRAINT "storage_audit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_grant" ADD CONSTRAINT "storage_grant_space_id_storage_space_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."storage_space"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_grant" ADD CONSTRAINT "storage_grant_node_id_storage_node_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."storage_node"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_grant" ADD CONSTRAINT "storage_grant_group_id_membership_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."membership_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_node" ADD CONSTRAINT "storage_node_space_id_storage_space_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."storage_space"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_node" ADD CONSTRAINT "storage_node_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_space" ADD CONSTRAINT "storage_space_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_user_node" ADD CONSTRAINT "storage_user_node_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_user_node" ADD CONSTRAINT "storage_user_node_node_id_storage_node_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."storage_node"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storage_node_parent_idx" ON "storage_node" USING btree ("space_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_node_name_idx" ON "storage_node" USING btree ("space_id",coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),"name") WHERE "storage_node"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "storage_personal_owner_idx" ON "storage_space" USING btree ("owner_id");