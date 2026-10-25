import { spawnSync } from "node:child_process";

// Run both checks even when the first one reports available updates.
const checks = [
  ["Доступные обновления (включая новые основные версии)", ["outdated", "--long"]],
  ["Аудит безопасности всех зависимостей, включая зависимости разработки", ["audit", "--audit-level", "low"]],
];
let failed = false;
for (const [title, args] of checks) {
  process.stdout.write(`\n${title}\n\n`);
  const result = spawnSync("pnpm", args, { stdio: "inherit", timeout: 180_000 });
  if (result.error) console.error(`Не удалось завершить проверку: ${result.error.message}`);
  if (result.status !== 0 || result.error) failed = true;
}
process.exitCode = failed ? 1 : 0;
