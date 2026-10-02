# Этап 7: автоматические проверки

UTC: 2026-10-02T09:20:16.509Z

Commit: репозиторий без коммитов; проверяется рабочее дерево.

## pnpm lint

Exit code: 0; PASS

```text
$ eslint .

```

## pnpm typecheck

Exit code: 0; PASS

```text
$ tsc --noEmit

```

## pnpm test:unit

Exit code: 0; PASS

```text

 RUN  v5.0.3 /Users/wozglas/Documents/ChatGPT/eve online bot


 Test Files  3 passed (3)
      Tests  21 passed (21)
   Start at  16:20:19
   Duration  151ms (import 47%, transform 33%, tests 17%, worker 3%)

$ vitest run tests/unit

```

## pnpm test:integration

Exit code: 0; PASS

```text

 RUN  v5.0.3 /Users/wozglas/Documents/ChatGPT/eve online bot


 Test Files  7 passed (7)
      Tests  14 passed (14)
   Start at  16:20:19
   Duration  577ms (import 81%, transform 12%, tests 6%, worker 1%)

$ vitest run tests/integration

```

## pnpm build

Exit code: 0; PASS

```text
vite v8.3.2 building client environment for production...
transforming...
✓ 2065 modules transformed.
rendering chunks...
computing gzip size...
dist/renderer/index.html                   0.61 kB │ gzip:   0.38 kB
dist/renderer/assets/index-BjQrdqzS.css   22.41 kB │ gzip:   5.18 kB
dist/renderer/assets/index-DAICYBaR.js   426.74 kB │ gzip: 135.73 kB

✓ built in 145ms
$ node scripts/build.mjs

```

## pnpm test:e2e

Exit code: 0; PASS

```text

Running 3 tests using 1 worker

  ✓  1 tests/e2e/accounting.spec.ts:5:1 › stage 7: desktop selection, imported operations, review and explicit closing survives restart (1.9s)
  ✓  2 tests/e2e/market.spec.ts:5:1 › stage 5: filters, quantity quote, basket and idempotent acceptance (840ms)
  ✓  3 tests/e2e/shell.spec.ts:5:1 › stage 1: three tabs, restricted preload, settings survive restart; 1280 and 1440 (1.3s)

  3 passed (4.2s)
$ playwright test
(node:51704) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

```

## Область проверки

Наличие PASS у команд не подтверждает выполнение всех требований этапа. Покрытие требует отдельного отчёта.

Live SSO: BLOCKED — нет авторизации пользователя. Windows smoke: BLOCKED — нет Windows runner в локальной сессии.
