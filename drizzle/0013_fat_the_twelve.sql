ALTER TABLE "chat_member" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_member" ADD COLUMN "draft" jsonb DEFAULT '{"text":"","mentions":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_member" ADD COLUMN "draft_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "description" text DEFAULT '' NOT NULL;