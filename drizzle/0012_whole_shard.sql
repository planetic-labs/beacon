CREATE TABLE "receipt_checkpoint" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"chat_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp (6) with time zone NOT NULL,
	"kind" text NOT NULL,
	"from_at" timestamp (6) with time zone NOT NULL,
	"through_at" timestamp (6) with time zone NOT NULL,
	"acknowledged_at" timestamp (6) with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "receipt_checkpoint_kind" CHECK ("receipt_checkpoint"."kind" in ('delivered','read')),
	CONSTRAINT "receipt_checkpoint_range" CHECK ("receipt_checkpoint"."from_at"<"receipt_checkpoint"."through_at")
);
--> statement-breakpoint
ALTER TABLE "receipt_checkpoint" ADD CONSTRAINT "receipt_checkpoint_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chat"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_checkpoint" ADD CONSTRAINT "receipt_checkpoint_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipt_checkpoint_lookup_idx" ON "receipt_checkpoint" USING btree ("chat_id","user_id","joined_at","kind","through_at");--> statement-breakpoint
CREATE INDEX "message_attachment_idx" ON "message" USING btree ("chat_id","type","created_at","id") WHERE "message"."deleted_at" is null and "message"."type" in ('photo','video','circle','file','audio');--> statement-breakpoint
CREATE INDEX "message_links_idx" ON "message" USING btree ("chat_id","created_at","id") WHERE "message"."deleted_at" is null and ("message"."content"->>'text') ~* 'https?://';