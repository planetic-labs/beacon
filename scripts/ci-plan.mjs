import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const browserTests = [
  "browser-pwa.ts", "browser-chat-features.ts", "browser-message-layout.ts", "browser-chat-scroll.ts",
  "browser-offline.ts", "browser-attachments.ts", "browser-community-chats.ts", "browser-chat-media.ts",
  "browser-emoji.ts", "browser-settings.ts", "browser-sticker-ownership.ts", "browser-stickers.ts",
  "browser-passkey-registration.ts", "browser-recordings.ts",
];
const documentation = path => /(?:^|\/)\w[^/]*\.md$/i.test(path) || ["LICENSE", ".gitignore"].includes(path);
const critical = path => path === ".dockerignore" || /^(?:\.github\/|drizzle\/|apps\/api\/src\/(?:server\.|db(?:\/|\.)|http\/controllers\/(?:auth|openid|oauth-metadata)\.|modules\/auth\/|http\/server\.|lib\/http\.)|apps\/web\/src\/auth-client\.|apps\/web\/src\/components\/(?:forms|passkey-confirmation)\.|apps\/web\/(?:vite\.config\.|build\/)|scripts\/(?:ci|migrate|bootstrap|realtime|unit-tests)|Dockerfile|docker-compose|tsconfig|pnpm-|package\.json)/.test(path)
  || /(?:^|\/)package\.json$/.test(path);
const features = [
  [/sticker/i, ["browser-stickers.ts", "browser-sticker-ownership.ts"]],
  [/(?:attachment|message-types|photo|chat-media|read-details)/i, ["browser-attachments.ts", "browser-chat-media.ts"]],
  [/(?:recording|circle|audio)/i, ["browser-recordings.ts"]],
  [/(?:offline|draft|device-data)/i, ["browser-offline.ts", "browser-chat-scroll.ts"]],
  [/(?:chat-features|search|mention|receipt)/i, ["browser-chat-features.ts"]],
  [/(?:presence|preferences|saved|pins|community)/i, ["browser-community-chats.ts"]],
  [/(?:emoji)/i, ["browser-emoji.ts"]],
  [/(?:settings|about|router)/i, ["browser-settings.ts"]],
  [/(?:sw\.js|shell-cache|index\.html|pwa)/i, ["browser-pwa.ts"]],
];
export function planChecks(paths, { event = "pull_request", forceFull = false } = {}) {
  if (!Array.isArray(paths) || paths.some(path => typeof path !== "string" || !path || path.startsWith("/") || path.split("/").includes(".."))) throw new Error("Invalid changed paths");
  const full = reason => ({ mode:"full", integration:true, browsers:browserTests, summary:`Full checks: ${reason}` });
  if (forceFull || event === "workflow_dispatch") return full("manual run or unavailable comparison base");
  if (!paths.length || paths.every(documentation)) return { mode:"docs", integration:false, browsers:[], summary:"Documentation/metadata only: no application build or tests" };
  // Main rechecks types, unit tests and audit. PR checks already exercised affected
  // features; the release gate independently runs the complete suite on its exact SHA.
  if (event === "push") return { mode:"quick", integration:false, browsers:[], summary:"Main: types, unit tests and dependency audit" };
  if (event !== "pull_request") return full("unknown event");
  if (paths.some(path => !documentation(path) && critical(path))) return full("authentication, schema, dependencies, build or CI configuration changed");
  const selected = new Set();
  let integration = false;
  for (const path of paths) {
    if (documentation(path)) continue;
    if (/^tests\/[^/]+\.test\.ts$/.test(path)) {
      if (/(?:integration|email-normalization)\.test\.ts$/.test(path)) integration = true;
      continue;
    }
    if (/^tests\/browser-/.test(path)) {
      const name = path.slice("tests/".length);
      if (!browserTests.includes(name)) return full("database-backed browser fixture or unknown browser test changed");
      selected.add(name); continue;
    }
    if (/^tests\/(?:.*-scenarios|.*-fixtures|chat-fixtures)\.ts$/.test(path)) { integration=true; continue; }
    if (path === "scripts/release.sh") continue;
    if (path.startsWith("apps/api/src/")) {
      integration = true;
      selected.add("browser-chat-features.ts");
      for (const [pattern, tests] of features) if (pattern.test(path)) tests.forEach(test => selected.add(test));
      continue;
    }
    if (path.startsWith("packages/shared/src/")) {
      integration = true; selected.add("browser-chat-features.ts");
      for (const [pattern, tests] of features) if (pattern.test(path)) tests.forEach(test => selected.add(test));
      continue;
    }
    if (path.startsWith("apps/web/")) {
      if (/\.(?:css|png|jpe?g|webp|svg|ico|webmanifest)$/.test(path)) {
        selected.add("browser-chat-scroll.ts"); selected.add("browser-settings.ts"); continue;
      }
      if (/\/(?:beacon|ui)\.tsx$/.test(path)) {
        browserTests.forEach(test => selected.add(test)); continue;
      }
      let matched=false;
      for (const [pattern, tests] of features) if (pattern.test(path)) {matched=true;tests.forEach(test => selected.add(test));}
      if (!matched) return full("unclassified frontend code changed");
      continue;
    }
    return full("unclassified code changed");
  }
  return { mode:"selective", integration, browsers:browserTests.filter(test => selected.has(test)), summary:`PR: types, unit tests, audit${integration?", database integration":""}; ${selected.size} browser suites` };
}
export function validatePlan(plan, expectedMode) {
  if (!plan || plan.mode !== expectedMode || !["quick","selective","full","docs"].includes(plan.mode) || typeof plan.integration !== "boolean"
    || !Array.isArray(plan.browsers) || plan.browsers.some(test => !browserTests.includes(test))) throw new Error("Invalid CI plan");
  if (plan.mode === "quick" && (plan.integration || plan.browsers.length)) throw new Error("Quick checks cannot include extended suites");
  return plan;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--field") {
    const [, , , field, file, mode] = process.argv;
    const plan=validatePlan(JSON.parse(readFileSync(file,"utf8")),mode);
    if(field==="browsers")process.stdout.write(plan.browsers.join("\n")+(plan.browsers.length?"\n":""));
    else if(field==="integration")console.log(plan.integration);
    else throw new Error("Unknown CI plan field");
  } else {
    const paths=readFileSync(0,"utf8").split("\0").filter(Boolean);
    console.log(JSON.stringify(planChecks(paths,{event:process.env.CI_EVENT,forceFull:process.env.CI_FORCE_FULL==="true"}),null,2));
  }
}
