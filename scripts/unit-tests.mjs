import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
// These two suites require a disposable PostgreSQL database and run in integration/full CI.
const database = new Set(["integration.test.ts", "email-normalization.test.ts"]);
const files=readdirSync("tests").filter(file=>file.endsWith(".test.ts")&&!database.has(file)).sort().map(file=>`tests/${file}`);
if(!files.length)throw new Error("No unit tests found");
const result=spawnSync("pnpm",["exec","tsx","--test",...files],{stdio:"inherit"});
if(result.error)throw result.error;
process.exitCode=result.status??1;
