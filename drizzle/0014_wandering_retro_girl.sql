ALTER TABLE "sticker_pack" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "sticker_pack" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sticker_pack" ADD CONSTRAINT "sticker_pack_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sticker_pack_owner_idx" ON "sticker_pack" USING btree ("owner_id");--> statement-breakpoint
-- Recover legacy ownership only when all existing stickers have one uploader.
-- Empty or mixed legacy packs stay administrator-managed until assigned explicitly.
UPDATE sticker_pack p SET owner_id=legacy.owner_id
FROM (
  SELECT s.pack_id,(array_agg(DISTINCT f.owner_id))[1] AS owner_id
  FROM sticker s JOIN media_file f ON f.id=s.file_id
  GROUP BY s.pack_id HAVING count(DISTINCT f.owner_id)=1
) legacy WHERE p.id=legacy.pack_id AND p.owner_id IS NULL;
