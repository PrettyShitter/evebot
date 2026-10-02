# Этап 8: автоматические проверки

UTC: 2026-10-02T09:24:52.226Z

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
   Start at  16:24:54
   Duration  151ms (import 48%, transform 33%, tests 16%, worker 3%)

$ vitest run tests/unit

```

## pnpm test:integration

Exit code: 0; PASS

```text

 RUN  v5.0.3 /Users/wozglas/Documents/ChatGPT/eve online bot


 Test Files  8 passed (8)
      Tests  17 passed (17)
   Start at  16:24:55
   Duration  630ms (import 81%, transform 12%, tests 6%)

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
dist/renderer/assets/index-2B4VHJgY.js   428.04 kB │ gzip: 136.09 kB

✓ built in 150ms
$ node scripts/build.mjs

```

## pnpm test:e2e

Exit code: 0; PASS

```text

Running 3 tests using 1 worker

  ✓  1 tests/e2e/accounting.spec.ts:5:1 › stage 7: desktop selection, imported operations, review and explicit closing survives restart (1.8s)
  ✓  2 tests/e2e/market.spec.ts:5:1 › stage 5: filters, quantity quote, basket and idempotent acceptance (1.0s)
  ✓  3 tests/e2e/shell.spec.ts:5:1 › stage 1: three tabs, restricted preload, settings survive restart; 1280 and 1440 (1.4s)

  3 passed (4.4s)
$ playwright test
(node:52303) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

```

## Область проверки

Наличие PASS у команд не подтверждает выполнение всех требований этапа. Покрытие требует отдельного отчёта.

Live SSO: BLOCKED — нет авторизации пользователя. Windows smoke: BLOCKED — нет Windows runner в локальной сессии.
