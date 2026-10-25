import { sql } from "drizzle-orm";
import { z } from "zod";
import { db, pool } from "../src/db";
const emails = [
  ...new Set(
    (process.env.INITIAL_ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  ),
];
try {
  for (const email of emails) {
    z.email().parse(email);
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
