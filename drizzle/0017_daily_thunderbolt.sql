ALTER TABLE "storage_node" DROP CONSTRAINT "storage_node_state_check";--> statement-breakpoint
ALTER TABLE "storage_node" ADD COLUMN "filesystem_path" text;--> statement-breakpoint
ALTER TABLE "storage_node" ADD COLUMN "filesystem_mtime" text;--> statement-breakpoint
ALTER TABLE "storage_node" ADD CONSTRAINT "storage_node_state_check" CHECK ("storage_node"."state" in ('uploading','processing','ready','copying','purging','error','missing'));