CREATE TABLE "pinned_message" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"pinned_by" uuid NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "presence_lease" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat" DROP CONSTRAINT "chat_kind_check";--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pinned_message" ADD CONSTRAINT "pinned_message_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinned_message" ADD CONSTRAINT "pinned_message_pinned_by_user_id_fk" FOREIGN KEY ("pinned_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence_lease" ADD CONSTRAINT "presence_lease_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence_lease" ADD CONSTRAINT "presence_lease_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "presence_lease_user_idx" ON "presence_lease" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "presence_lease_expiry_idx" ON "presence_lease" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_kind_check" CHECK ("chat"."kind" in ('direct','group','saved'));