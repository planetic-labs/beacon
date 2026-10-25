import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { pool } from "../apps/api/src/db";

// Input and the ID mapping must remain outside the repository.
const inputSchema = z.array(z.object({
  sourceId: z.string().min(1),
  email: z.email().transform((value) => value.trim().toLowerCase()),
  firstName: z.string().trim(),
  lastName: z.string().trim(),
  emailVerified: z.boolean(),
  banned: z.boolean(),
  role: z.enum(["user", "admin"]),
}));
const [inputPath, ...args] = process.argv.slice(2);
const apply = args.includes("--apply");
const reportPath = args.find((arg) => arg.startsWith("--report="))?.slice(9);
let committed = false;
try {
  if (!inputPath?.startsWith("/run/") || (apply && !reportPath?.startsWith("/run/")))
    throw new Error("External input and mapping paths are required");
  const parsed = inputSchema.safeParse(JSON.parse(await readFile(inputPath, "utf8")));
  if (!parsed.success) throw new Error("Invalid import format");
  const users = parsed.data;
  if (new Set(users.map((u) => u.email)).size !== users.length ||
      new Set(users.map((u) => u.sourceId)).size !== users.length)
    throw new Error("Duplicate source identities");
  // Reserve the private report before changing the database; never overwrite one.
  if (apply) await writeFile(reportPath!, "{}\n", { flag: "wx", mode: 0o600 });
  const client = await pool.connect();
  const summary = { total: users.length, created: 0, matched: 0, completedProfiles: 0 };
  const mapping: { sourceId: string; userId: string }[] = [];
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(917340)");
    await client.query('LOCK TABLE "user" IN SHARE ROW EXCLUSIVE MODE');
    for (const u of users) {
      const existing = await client.query(
        'SELECT id, first_name, last_name FROM "user" WHERE lower(trim(email))=$1', [u.email],
      );
      if (existing.rowCount! > 1) throw new Error("Ambiguous target identity");
      let userId: string;
      if (existing.rowCount) {
        const row = existing.rows[0];
        userId = row.id;
        summary.matched++;
        const firstName = row.first_name.trim() ? row.first_name : u.firstName;
        const lastName = row.last_name.trim() ? row.last_name : u.lastName;
        if (firstName !== row.first_name || lastName !== row.last_name) {
          await client.query(
            'UPDATE "user" SET first_name=$2,last_name=$3,name=$4,updated_at=now() WHERE id=$1',
            [userId, firstName, lastName, [firstName, lastName].filter(Boolean).join(" ")],
          );
          summary.completedProfiles++;
        }
        // Existing roles, blocks, verification, avatars, sessions and history are preserved.
      } else {
        const created = await client.query(
          'INSERT INTO "user"(email,first_name,last_name,name,email_verified,banned,role) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
          [u.email, u.firstName, u.lastName, [u.firstName, u.lastName].filter(Boolean).join(" "),
            u.emailVerified, u.banned, u.role],
        );
        userId = created.rows[0].id;
        summary.created++;
      }
      mapping.push({ sourceId: u.sourceId, userId });
    }
    await client.query(apply ? "COMMIT" : "ROLLBACK");
    committed = apply;
    if (apply) await writeFile(reportPath!, JSON.stringify({ summary, mapping }, null, 2), { mode: 0o600 });
    console.log("INFO user import", { applied: apply, ...summary });
  } catch (error) {
    if (!committed) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} catch {
  // Database errors may contain personal data; never print the raw error.
  console.error(committed
    ? "ERROR import committed but mapping could not be saved; use the database backup and source input"
    : "ERROR user import stopped; no changes committed");
  process.exitCode = 1;
} finally {
  await pool.end();
}
