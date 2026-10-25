# Этап all: автоматические проверки

UTC: 2026-10-25T05:22:27.616Z

Commit: f556de469aaf7e768503e7eeb27d2fd218d8e840; проверяется рабочее дерево.

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


 Test Files  24 passed (24)
      Tests  116 passed (116)
   Start at  12:23:07
   Duration  9.23s (import 41%, transform 37%, tests 18%, worker 4%)

  Transform  transforming modules took 14.47s · 37% of tracked time, re-done on every run
             persist transforms across runs with fsModuleCache: true
             learn more: https://vitest.dev/guide/improving-performance#caching-between-reruns

$ vitest run tests/unit

```

## pnpm test:integration

Exit code: 0; PASS

```text

 RUN  v5.0.3 /Users/wozglas/Documents/ChatGPT/eve online bot


 Test Files  16 passed (16)
      Tests  44 passed (44)
   Start at  12:23:20
   Duration  25.55s (import 52%, tests 45%, transform 3%)

$ vitest run tests/integration

```

## pnpm build

Exit code: 0; PASS

```text
vite v8.3.2 building client environment for production...
transforming...
✓ 2068 modules transformed.
rendering chunks...
computing gzip size...
dist/renderer/index.html                   0.61 kB │ gzip:   0.37 kB
dist/renderer/assets/index-Dk-XX-4o.css   24.20 kB │ gzip:   5.58 kB
dist/renderer/assets/index-CfgI1Rli.js   442.72 kB │ gzip: 140.03 kB

✓ built in 2.92s
$ node scripts/build.mjs

```

## pnpm test:e2e

Exit code: 0; PASS

```text

Running 5 tests using 1 worker

  ✓  1 tests/e2e/accounting.spec.ts:5:1 › stage 7: desktop selection, imported operations, review and explicit closing survives restart (5.2s)
  ✓  2 tests/e2e/market.spec.ts:5:1 › stage 5: filters, quantity quote, basket and idempotent acceptance (9.4s)
  -  3 tests/e2e/performance.spec.ts:15:1 › stage 9: full saved regional dataset, local filter latency and renderer responsiveness
  ✓  4 tests/e2e/production-retired.spec.ts:6:1 › production tab remains available and empty while market and deal tabs remain (3.3s)
  ✓  5 tests/e2e/shell.spec.ts:5:1 › shell: trading tabs, restricted preload and settings survive restart (3.5s)

  1 skipped
  4 passed (28.2s)
$ playwright test
(node:67306) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

```

## Область проверки

Наличие PASS у команд не подтверждает выполнение всех требований этапа. Покрытие требует отдельного отчёта.

Приватный live SSO: BLOCKED до согласия пользователя. Проверка сборки и packaged smoke для каждой платформы подтверждается соответствующей задачей GitHub Actions; локальный прогон не заявляет кроссплатформенную проверку.
