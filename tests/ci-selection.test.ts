import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { planChecks, validatePlan } from "../scripts/ci-plan.mjs";

test("documentation skips application checks, main runs quick checks", () => {
  assert.equal(planChecks(["docs/releases.md"]).mode, "docs");
  assert.equal(planChecks(["apps/web/src/beacon.tsx"], { event: "push" }).mode, "quick");
  assert.equal(planChecks([], { forceFull: true }).mode, "full");
});
test("security, infrastructure and unknown files fail closed", () => {
  for (const path of [".dockerignore", ".github/workflows/checks.yml", "drizzle/0015.sql", "apps/api/src/modules/auth/service.ts", "apps/api/src/http/server.ts", "pnpm-lock.yaml", "Dockerfile", "docs/code.ts", "unknown.ts"]) {
    assert.equal(planChecks([path]).mode, "full", path);
  }
  assert.equal(planChecks(["apps/api/src/modules/auth/old.ts", "docs/renamed.md"]).mode, "full");
});
test("ordinary frontend and API edits select relevant suites", () => {
  const emoji = planChecks(["apps/web/src/components/emoji.tsx"]);
  assert.equal(emoji.mode, "selective");
  assert.deepEqual(emoji.browsers, ["browser-emoji.ts"]);
  assert.equal(emoji.integration, false);
  assert.equal(planChecks(["apps/api/src/modules/chats/service.ts"]).integration, true);
  assert.equal(planChecks(["scripts/release.sh"]).browsers.length, 0);
});
test("plans reject arbitrary commands and invalid paths", () => {
  assert.throws(() => planChecks(["../outside"]));
  assert.throws(() => validatePlan({ mode: "selective", integration: false, browsers: ["$(touch injected)"] }, "selective"));
  assert.throws(() => validatePlan({ mode: "quick", integration: true, browsers: [] }, "quick"));
});
test("runner keeps quick checks free of database, browser and production builds", () => {
  const directory = mkdtempSync(join(tmpdir(), "beacon-ci-runner-"));
  try {
    const log = join(directory, "commands");
    const docker = join(directory, "docker");
    writeFileSync(docker, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CI_COMMAND_LOG"\ncase "$*" in\n *"--field integration"*) echo "${CI_TEST_INTEGRATION:-false}" ;;\n *"--field browsers"*) printf "%s" "${CI_TEST_BROWSERS:-}" ;;\nesac\n');
    chmodSync(docker, 0o755);
    const plan = join(directory, "plan.json");
    writeFileSync(plan, JSON.stringify(planChecks(["app.ts"], { event: "push" })));
    const run = (mode: string) => spawnSync("sh", ["scripts/ci.sh", mode, plan], { env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, CI_COMMAND_LOG: log }, encoding: "utf8" });
    assert.equal(run("docs").status, 0);
    assert.equal(run("quick").status, 0);
    const commands = readFileSync(log, "utf8");
    assert.match(commands, /pnpm typecheck/);
    assert.match(commands, /pnpm audit/);
    assert.match(commands, /scripts\/unit-tests.mjs/);
    assert.doesNotMatch(commands, /compose|beacon-browser|target production/);
    assert.notEqual(run("invalid").status, 0);
    const extended = (mode: string, extra: Record<string, string>) => spawnSync("sh", ["scripts/ci.sh", mode, plan], { env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, CI_COMMAND_LOG: log, ...extra }, encoding: "utf8" });
    writeFileSync(log, "");
    assert.equal(extended("selective", { CI_TEST_INTEGRATION: "true", CI_TEST_BROWSERS: "browser-emoji.ts" }).status, 0);
    const selective = readFileSync(log, "utf8");
    assert.match(selective, /tests\/browser-emoji.ts/);
    assert.match(selective, /pnpm db:migrate/);
    assert.match(selective, /tests\/integration.test.ts tests\/email-normalization.test.ts/);
    assert.doesNotMatch(selective, /target production|up -d.*web realtime/);
    writeFileSync(log, "");
    assert.equal(extended("full", { CI_RELEASE_VERSION: "v2026.01.01" }).status, 0);
    const full = readFileSync(log, "utf8");
    assert.match(full, /RELEASE_VERSION=v2026.01.01/);
    assert.match(full, /target production/);
    assert.match(full, /tests\/browser-dev.ts/);
    assert.match(full, /tests\/realtime-chat-features.ts/);
    assert.match(full, /down --volumes --remove-orphans/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test("image publication waits for full validation of the exact release commit", () => {
  const release = readFileSync(".github/workflows/release-image.yml", "utf8");
  assert.match(release, /needs: \[validate, full-checks\]/);
  assert.match(release, /uses: \.\/\.github\/workflows\/full-checks.yml/);
  assert.match(release, /revision: \$\{\{ needs.validate.outputs.revision \}\}/);
});
