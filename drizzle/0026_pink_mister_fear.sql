CREATE TABLE "storage_material_folder" (
	"folder_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "storage_material_folder" ADD CONSTRAINT "storage_material_folder_folder_id_storage_node_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."storage_node"("id") ON DELETE cascade ON UPDATE no action;