-- Stop rather than merge distinct identities that normalize to the same address.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "user" GROUP BY lower(btrim(email)) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Email normalization requires resolving duplicate identities';
  END IF;
END $$;
--> statement-breakpoint
UPDATE "user" SET email=lower(btrim(email)),updated_at=now() WHERE email<>lower(btrim(email));
--> statement-breakpoint
CREATE FUNCTION beacon_normalize_user_email() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.email := lower(btrim(NEW.email));
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER normalize_user_email BEFORE INSERT OR UPDATE OF email ON "user"
FOR EACH ROW EXECUTE FUNCTION beacon_normalize_user_email();
--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_email_canonical" CHECK ("user"."email" = lower(btrim("user"."email")));