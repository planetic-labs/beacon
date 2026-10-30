import { transaction, syncConfiguredSpaces } from "./modules/storage/service";
import { storageJobs, stopStorageJobs } from "./modules/storage/jobs";
import { createApp } from "./http/server";
import { pool } from "./db";

const app = await createApp({ dev: process.argv.includes("--dev") });
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, async () => {
  await app.close(); await stopStorageJobs(); await pool.end();
});
try {
  await transaction(syncConfiguredSpaces);
  await storageJobs();
  await app.listen({ host: "0.0.0.0", port: 3000 });
  console.log("INFO HTTP server ready");
} catch {
  console.error("ERROR HTTP server startup failed");
  await app.close(); await stopStorageJobs(); await pool.end(); process.exitCode = 1;
}
