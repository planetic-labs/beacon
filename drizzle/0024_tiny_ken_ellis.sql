CREATE TABLE "call_push_delivery" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"call_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"outcome" text,
	CONSTRAINT "call_push_kind_check" CHECK ("call_push_delivery"."kind" in ('invite','state'))
);
--> statement-breakpoint
ALTER TABLE "call_push_delivery" ADD CONSTRAINT "call_push_delivery_call_id_call_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."call"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_push_delivery" ADD CONSTRAINT "call_push_delivery_subscription_id_push_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."push_subscription"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "call_push_unique_idx" ON "call_push_delivery" USING btree ("call_id","subscription_id","kind");--> statement-breakpoint
CREATE INDEX "call_push_pending_idx" ON "call_push_delivery" USING btree ("next_attempt_at") WHERE "call_push_delivery"."completed_at" is null;