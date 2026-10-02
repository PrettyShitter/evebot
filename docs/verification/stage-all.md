# Этап all: автоматические проверки

UTC: 2026-10-02T13:39:33.933Z

Commit: e242b3874fcffaa330ceaca05a72c5a6dc38da5b; проверяется рабочее дерево.

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


 Test Files  5 passed (5)
      Tests  27 passed (27)
   Start at  20:39:48
   Duration  1.39s (import 47%, transform 37%, tests 12%, worker 4%)

$ vitest run tests/unit

```

## pnpm test:integration

Exit code: 0; PASS

```text

 RUN  v5.0.3 /Users/wozglas/Documents/ChatGPT/eve online bot


 Test Files  12 passed (12)
      Tests  25 passed (25)
   Start at  20:39:52
   Duration  11.85s (import 60%, tests 32%, transform 7%, worker 1%)

    Isolate  12 workers spawned · ~2.72s startup each (spawn + environment, per file)
             at least ~905ms faster with isolate: false — reuses workers across files instead of one per file

$ vitest run tests/integration

```

## pnpm build

Exit code: 0; PASS

```text
vite v8.3.2 building client environment for production...
transforming...
✓ 2066 modules transformed.
rendering chunks...
computing gzip size...
dist/renderer/index.html                   0.61 kB │ gzip:   0.37 kB
dist/renderer/assets/index-DQEV8N2e.css   23.65 kB │ gzip:   5.38 kB
dist/renderer/assets/index-9UFy79Hi.js   435.54 kB │ gzip: 137.80 kB

✓ built in 532ms
$ node scripts/build.mjs

```

## pnpm test:e2e

Exit code: 0; PASS

```text

Running 4 tests using 1 worker

  ✓  1 tests/e2e/accounting.spec.ts:5:1 › stage 7: desktop selection, imported operations, review and explicit closing survives restart (6.7s)
  ✓  2 tests/e2e/market.spec.ts:5:1 › stage 5: filters, quantity quote, basket and idempotent acceptance (2.2s)
  -  3 tests/e2e/performance.spec.ts:15:1 › stage 9: full saved regional dataset, local filter latency and renderer responsiveness
  ✓  4 tests/e2e/shell.spec.ts:5:1 › stage 1: three tabs, restricted preload, settings survive restart; 1280 and 1440 (3.5s)

  1 skipped
  3 passed (16.0s)
$ playwright test
(node:94623) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

```

## Область проверки

Наличие PASS у команд не подтверждает выполнение всех требований этапа. Покрытие требует отдельного отчёта.

Live SSO: BLOCKED — нет авторизации пользователя. Windows smoke: BLOCKED — нет Windows runner в локальной сессии.
