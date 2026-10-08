# Этап all: автоматические проверки

UTC: 2026-10-08T05:07:02.405Z

Commit: e6df1c878c1005e18e44ed332ef64a99509e35bf; проверяется рабочее дерево.

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


 Test Files  23 passed (23)
      Tests  112 passed (112)
   Start at  12:07:21
   Duration  2.24s (transform 43%, import 35%, tests 20%, worker 2%)

  Transform  transforming modules took 3.67s · 43% of tracked time, re-done on every run
             persist transforms across runs with fsModuleCache: true
             learn more: https://vitest.dev/guide/improving-performance#caching-between-reruns

$ vitest run tests/unit

```

## pnpm test:integration

Exit code: 0; PASS

```text

 RUN  v5.0.3 /Users/wozglas/Documents/ChatGPT/eve online bot


 Test Files  13 passed (13)
      Tests  38 passed (38)
   Start at  12:07:24
   Duration  12.52s (import 51%, tests 38%, transform 10%)

$ vitest run tests/integration

```

## pnpm build

Exit code: 0; PASS

```text
vite v8.3.2 building client environment for production...
transforming...
✓ 2069 modules transformed.
rendering chunks...
computing gzip size...
dist/renderer/index.html                   0.61 kB │ gzip:   0.37 kB
dist/renderer/assets/index-DLl-6XzT.css   28.74 kB │ gzip:   6.39 kB
dist/renderer/assets/index-X-u4Vgki.js   526.89 kB │ gzip: 158.34 kB

✓ built in 524ms
$ node scripts/build.mjs
[plugin builtin:vite-reporter]
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.

```

## pnpm test:e2e

Exit code: 0; PASS

```text

Running 8 tests using 1 worker

  ✓  1 tests/e2e/accounting.spec.ts:5:1 › stage 7: desktop selection, imported operations, review and explicit closing survives restart (4.9s)
  ✓  2 tests/e2e/market.spec.ts:5:1 › stage 5: filters, quantity quote, basket and idempotent acceptance (3.2s)
  -  3 tests/e2e/performance.spec.ts:15:1 › stage 9: full saved regional dataset, local filter latency and renderer responsiveness
  ✓  4 tests/e2e/production-contract-confirmation.spec.ts:7:1 › unknown public BPC attributes can be confirmed in the desktop UI (3.9s)
  -  5 tests/e2e/production-live.spec.ts:6:1 › local production tab loads live public ESI data without GitHub or SSO
  -  6 tests/e2e/production-packaged.spec.ts:6:1 › packaged macOS app starts non-demo and reads live public ESI without GitHub
  -  7 tests/e2e/production-private-live.spec.ts:3:1 › authorized private production data syncs in non-demo Electron
  ✓  8 tests/e2e/shell.spec.ts:5:1 › shell: four tabs, production data panel, restricted preload and settings survive restart (4.7s)

  4 skipped
  4 passed (19.1s)
$ playwright test
(node:12672) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

```

## Область проверки

Наличие PASS у команд не подтверждает выполнение всех требований этапа. Покрытие требует отдельного отчёта.

Приватный live SSO: BLOCKED до согласия пользователя. Проверка сборки и packaged smoke для каждой платформы подтверждается соответствующей задачей GitHub Actions; локальный прогон не заявляет кроссплатформенную проверку.
