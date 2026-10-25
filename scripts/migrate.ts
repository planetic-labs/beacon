import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../apps/api/src/db";
const client = await pool.connect();
try {
  await client.query("select pg_advisory_lock(917341)");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("INFO migrations complete");
} finally {
  await client.query("select pg_advisory_unlock(917341)");
  client.release();
  await pool.end();
}
