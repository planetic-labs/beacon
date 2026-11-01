CREATE TABLE "chat_folder" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_folder_item" (
	"folder_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	CONSTRAINT "chat_folder_item_folder_id_chat_id_pk" PRIMARY KEY("folder_id","chat_id")
);
--> statement-breakpoint
ALTER TABLE "chat_folder" ADD CONSTRAINT "chat_folder_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_folder_item" ADD CONSTRAINT "chat_folder_item_folder_id_chat_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."chat_folder"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_folder_item" ADD CONSTRAINT "chat_folder_item_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_folder_user_idx" ON "chat_folder" USING btree ("user_id");