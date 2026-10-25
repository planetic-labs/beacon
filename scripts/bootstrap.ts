import { emailSchema, normalizeEmail } from "../packages/shared/src/email";
import { sql } from "drizzle-orm";
import { db, pool } from "../apps/api/src/db";
const emails = [
  ...new Set(
    (process.env.INITIAL_ADMIN_EMAILS ?? "")
      .split(",")
      .map(normalizeEmail)
      .filter(Boolean),
  ),
];
try {
  for (const email of emails) {
    emailSchema.parse(email);
    await db.execute(
      sql`insert into "user"(name,email,role) values('',${email},'admin') on conflict(email) do nothing`,
    );
  }
  console.log("INFO bootstrap complete", {
    configuredAdministrators: emails.length,
  });
} finally {
  await pool.end();
}
