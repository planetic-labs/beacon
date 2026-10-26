CREATE TABLE "sticker_pack" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sticker" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"pack_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sticker_file_id_unique" UNIQUE("file_id")
);
--> statement-breakpoint
ALTER TABLE "sticker" ADD CONSTRAINT "sticker_pack_id_sticker_pack_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."sticker_pack"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sticker" ADD CONSTRAINT "sticker_file_id_media_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."media_file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sticker_pack_idx" ON "sticker" USING btree ("pack_id");