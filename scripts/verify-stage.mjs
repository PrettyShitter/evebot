import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
const stage = process.argv.filter((a) => a !== "--")[2] ?? "0";
const commands =
  stage === "0"
    ? [["typecheck"], ["test:unit"]]
    : [
        ["lint"],
        ["typecheck"],
        ["test:unit"],
        ["test:integration"],
        ["build"],
        ["test:e2e"],
      ];
const dir = "docs/verification";
mkdirSync(dir, { recursive: true });
const git = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
let text = `# Этап ${stage}: автоматические проверки\n\nUTC: ${new Date().toISOString()}\n\nCommit: ${git.status === 0 ? git.stdout.trim() : "репозиторий без коммитов"}; проверяется рабочее дерево.\n\n`;
let failed = false;
for (const args of commands) {
  const r = spawnSync("pnpm", args, {
    encoding: "utf8",
    env: process.env,
    shell: process.platform === "win32",
  });
  process.stdout.write(r.stdout ?? "");
  process.stderr.write(r.stderr ?? "");
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`.replace(/[\t ]+$/gm, "");
  text += `## pnpm ${args.join(" ")}\n\nExit code: ${r.status}; ${r.status === 0 ? "PASS" : "FAIL"}\n\n\`\`\`text\n${output}\n\`\`\`\n\n`;
  if (r.status !== 0) {
    failed = true;
    break;
  }
}
const scope = `docs/verification/scope-${String(stage).padStart(2, "0")}.md`;
text += `## Область проверки\n\n${existsSync(scope) ? `См. [покрытие и ограничения](./scope-${String(stage).padStart(2, "0")}.md).` : "Наличие PASS у команд не подтверждает выполнение всех требований этапа. Покрытие требует отдельного отчёта."}\n\nПриватный live SSO: BLOCKED до согласия пользователя. Проверка сборки и packaged smoke для каждой платформы подтверждается соответствующей задачей GitHub Actions; локальный прогон не заявляет кроссплатформенную проверку.\n`;
writeFileSync(`${dir}/stage-${String(stage).padStart(2, "0")}.md`, text);
process.exit(failed ? 1 : 0);
