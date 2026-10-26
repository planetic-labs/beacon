import { writeFile } from "node:fs/promises";
import { pool } from "../apps/api/src/db";
import { createChatFixtures } from "./chat-fixtures";
try {
  const fixtures=await createChatFixtures();
  await writeFile("/run/test/browser.json",JSON.stringify(fixtures),{mode:0o600});
  console.log("INFO browser fixtures ready");
}finally{await pool.end();}
