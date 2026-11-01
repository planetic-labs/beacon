CREATE TABLE "call" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"chat_id" uuid NOT NULL,
	"caller_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'ringing' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"reason" text,
	CONSTRAINT "call_mode_check" CHECK ("call"."mode" in ('audio','video')),
	CONSTRAINT "call_status_check" CHECK ("call"."status" in ('ringing','active','ended'))
);
--> statement-breakpoint
CREATE TABLE "call_participant" (
	"call_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_participant_call_id_user_id_pk" PRIMARY KEY("call_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "call" ADD CONSTRAINT "call_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chat"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call" ADD CONSTRAINT "call_caller_id_user_id_fk" FOREIGN KEY ("caller_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_participant" ADD CONSTRAINT "call_participant_call_id_call_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."call"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_participant" ADD CONSTRAINT "call_participant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_chat_created_idx" ON "call" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "call_participant_user_idx" ON "call_participant" USING btree ("user_id");