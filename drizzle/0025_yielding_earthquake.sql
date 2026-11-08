CREATE TABLE "material" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"cover_id" uuid,
	"published" boolean DEFAULT false NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"duration" integer NOT NULL,
	"source_hash" text NOT NULL,
	"fingerprint" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_attachment" (
	"material_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"label" text NOT NULL,
	"file_id" uuid,
	"url" text,
	CONSTRAINT "material_attachment_material_id_ordinal_pk" PRIMARY KEY("material_id","ordinal"),
	CONSTRAINT "material_attachment_target_check" CHECK (("material_attachment"."file_id" is not null)::int+("material_attachment"."url" is not null)::int=1)
);
--> statement-breakpoint
CREATE TABLE "material_chapter" (
	"material_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"seconds" integer NOT NULL,
	"title" text NOT NULL,
	CONSTRAINT "material_chapter_material_id_ordinal_pk" PRIMARY KEY("material_id","ordinal"),
	CONSTRAINT "material_chapter_seconds_check" CHECK ("material_chapter"."seconds">=0)
);
--> statement-breakpoint
CREATE TABLE "material_playlist" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_playlist_item" (
	"playlist_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	CONSTRAINT "material_playlist_item_playlist_id_material_id_pk" PRIMARY KEY("playlist_id","material_id")
);
--> statement-breakpoint
CREATE TABLE "material_progress" (
	"user_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"position" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_progress_user_id_material_id_pk" PRIMARY KEY("user_id","material_id"),
	CONSTRAINT "material_progress_position_check" CHECK ("material_progress"."position">=0)
);
--> statement-breakpoint
ALTER TABLE "material" ADD CONSTRAINT "material_id_storage_node_id_fk" FOREIGN KEY ("id") REFERENCES "public"."storage_node"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material" ADD CONSTRAINT "material_cover_id_storage_node_id_fk" FOREIGN KEY ("cover_id") REFERENCES "public"."storage_node"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material" ADD CONSTRAINT "material_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_attachment" ADD CONSTRAINT "material_attachment_material_id_material_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_attachment" ADD CONSTRAINT "material_attachment_file_id_storage_node_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."storage_node"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_chapter" ADD CONSTRAINT "material_chapter_material_id_material_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_playlist_item" ADD CONSTRAINT "material_playlist_item_playlist_id_material_playlist_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."material_playlist"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_playlist_item" ADD CONSTRAINT "material_playlist_item_material_id_material_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_progress" ADD CONSTRAINT "material_progress_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_progress" ADD CONSTRAINT "material_progress_material_id_material_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE cascade ON UPDATE no action;