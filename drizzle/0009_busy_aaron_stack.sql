ALTER TABLE "chat_member" ADD COLUMN "last_delivered_at" timestamp (6) with time zone DEFAULT 'epoch'::timestamptz NOT NULL;--> statement-breakpoint
CREATE FUNCTION beacon_search_normalize(value text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT replace(lower(value),'ё','е') $$;
--> statement-breakpoint
CREATE INDEX "message_search_text_idx" ON "message" USING gin (to_tsvector('simple',beacon_search_normalize(coalesce("content"->>'text','')))) WHERE "message"."type" in ('text','photo');
