ALTER TABLE "sticker" ADD COLUMN "emojis" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "sticker" ADD COLUMN "keywords" text[] DEFAULT '{}'::text[] NOT NULL;