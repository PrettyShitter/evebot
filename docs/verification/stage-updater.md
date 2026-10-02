# Этап updater: автоматические проверки

UTC: 2026-10-02T10:27:56.898Z

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


 Test Files  5 passed (5)
      Tests  27 passed (27)
   Start at  17:27:59
   Duration  179ms (import 49%, transform 34%, tests 15%, worker 2%)

$ vitest run tests/unit

```

## pnpm test:integration

Exit code: 0; PASS

```text

 RUN  v5.0.3 /Users/wozglas/Documents/ChatGPT/eve online bot


 Test Files  10 passed (10)
      Tests  22 passed (22)
   Start at  17:28:00
   Duration  2.35s (import 56%, tests 35%, transform 9%)

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
dist/renderer/assets/index-ClN-pwBa.css   22.92 kB │ gzip:   5.25 kB
dist/renderer/assets/index-Crr7RGmU.js   432.06 kB │ gzip: 137.03 kB

✓ built in 147ms
$ node scripts/build.mjs

```

## pnpm test:e2e

Exit code: 0; PASS

```text

Running 4 tests using 1 worker

  ✓  1 tests/e2e/accounting.spec.ts:5:1 › stage 7: desktop selection, imported operations, review and explicit closing survives restart (1.9s)
  ✓  2 tests/e2e/market.spec.ts:5:1 › stage 5: filters, quantity quote, basket and idempotent acceptance (845ms)
  -  3 tests/e2e/performance.spec.ts:15:1 › stage 9: full saved regional dataset, local filter latency and renderer responsiveness
  ✓  4 tests/e2e/shell.spec.ts:5:1 › stage 1: three tabs, restricted preload, settings survive restart; 1280 and 1440 (1.2s)

  1 skipped
  3 passed (4.6s)
$ playwright test
(node:60478) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

```

## Область проверки

Наличие PASS у команд не подтверждает выполнение всех требований этапа. Покрытие требует отдельного отчёта.

Live SSO: BLOCKED — нет авторизации пользователя. Windows smoke: BLOCKED — нет Windows runner в локальной сессии.
