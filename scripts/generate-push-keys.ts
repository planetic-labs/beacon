import webpush from "web-push";
import { readFile, writeFile, rename, open, unlink } from "node:fs/promises";
const output=process.argv[2];
if (!output?.startsWith("/run/")) throw new Error("Provide an environment file in a mounted external /run directory");
const lock=await open(`${output}.vapid.lock`,"wx",0o600);
const temporary=`${output}.vapid.tmp`;
try {
let text="";
try { text=await readFile(output,"utf8"); } catch(error) { if ((error as NodeJS.ErrnoException).code!=="ENOENT") throw error; }
const publicSet=/^VAPID_PUBLIC_KEY=.+$/m.test(text),privateSet=/^VAPID_PRIVATE_KEY=.+$/m.test(text);
if (publicSet!==privateSet) throw new Error("Incomplete VAPID configuration; existing keys were not changed");
if (publicSet) console.log("INFO existing push keys retained");
else {
  const keys=webpush.generateVAPIDKeys();
  text=text.replace(/^VAPID_(PUBLIC|PRIVATE)_KEY=.*\r?\n?/gm,"").trimEnd();
  await writeFile(temporary,`${text}\nVAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\n`,{mode:0o600,flag:"wx"});
  await rename(temporary,output);
  console.log("INFO push keys saved to external configuration");
}
} finally {
  await lock.close();
  await unlink(`${output}.vapid.lock`);
}
