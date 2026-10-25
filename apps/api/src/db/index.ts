import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
const globalDb = globalThis as unknown as { beaconPool?: pg.Pool };
export const pool =
  globalDb.beaconPool ??
  new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
if (process.env.NODE_ENV !== "production") globalDb.beaconPool = pool;
export const db = drizzle(pool, { schema });
