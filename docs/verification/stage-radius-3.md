# Этап radius-3: автоматические проверки

UTC: 2026-10-02T10:02:52.655Z

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


 Test Files  4 passed (4)
      Tests  22 passed (22)
   Start at  17:02:56
   Duration  159ms (import 49%, transform 35%, tests 14%, worker 2%)

$ vitest run tests/unit

```

## pnpm test:integration

Exit code: 0; PASS

```text

 RUN  v5.0.3 /Users/wozglas/Documents/ChatGPT/eve online bot


 Test Files  9 passed (9)
      Tests  20 passed (20)
   Start at  17:02:57
   Duration  1.07s (import 85%, transform 8%, tests 7%)

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
dist/renderer/index.html                   0.61 kB │ gzip:   0.37 kB
dist/renderer/assets/index-CXtB1Sl9.css   22.88 kB │ gzip:   5.24 kB
dist/renderer/assets/index-BbqHt7SI.js   430.07 kB │ gzip: 136.62 kB

✓ built in 145ms
$ node scripts/build.mjs

```

## pnpm test:e2e

Exit code: 0; PASS

```text

Running 4 tests using 1 worker

  ✓  1 tests/e2e/accounting.spec.ts:5:1 › stage 7: desktop selection, imported operations, review and explicit closing survives restart (1.8s)
  ✓  2 tests/e2e/market.spec.ts:5:1 › stage 5: filters, quantity quote, basket and idempotent acceptance (856ms)
  -  3 tests/e2e/performance.spec.ts:15:1 › stage 9: full saved regional dataset, local filter latency and renderer responsiveness
  ✓  4 tests/e2e/shell.spec.ts:5:1 › stage 1: three tabs, restricted preload, settings survive restart; 1280 and 1440 (1.1s)

  1 skipped
  3 passed (4.4s)
$ playwright test
(node:58188) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

```

## Область проверки

Наличие PASS у команд не подтверждает выполнение всех требований этапа. Покрытие требует отдельного отчёта.

Live SSO: BLOCKED — нет авторизации пользователя. Windows smoke: BLOCKED — нет Windows runner в локальной сессии.
