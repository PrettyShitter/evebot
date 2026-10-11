# Этап all: автоматические проверки

UTC: 2026-10-11T04:16:58.128Z

Commit: f03e91bb47d4ebfb353f4ad0e66aac31c9f90598; проверяется рабочее дерево.

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
   Start at  11:17:09
   Duration  1.50s (transform 41%, import 39%, tests 16%, worker 5%)

    Isolate  23 workers spawned · ~267ms startup each (spawn + environment, per file)
             at least ~415ms faster with isolate: false — reuses workers across files instead of one per file

$ vitest run tests/unit

```

## pnpm test:integration

Exit code: 0; PASS

```text

 RUN  v5.0.3 /Users/wozglas/Documents/ChatGPT/eve online bot


 Test Files  14 passed (14)
      Tests  39 passed (39)
   Start at  11:17:12
   Duration  9.23s (import 60%, tests 33%, transform 7%)

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
dist/renderer/assets/index-BL7aOOyT.css   28.48 kB │ gzip:   6.36 kB
dist/renderer/assets/index-Dmep3-7i.js   517.76 kB │ gzip: 156.59 kB

✓ built in 303ms
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

  ✓  1 tests/e2e/accounting.spec.ts:5:1 › stage 7: desktop selection, imported operations, review and explicit closing survives restart (3.4s)
  ✓  2 tests/e2e/market.spec.ts:5:1 › stage 5: filters, quantity quote, basket and idempotent acceptance (1.6s)
  -  3 tests/e2e/performance.spec.ts:15:1 › stage 9: full saved regional dataset, local filter latency and renderer responsiveness
  ✓  4 tests/e2e/production-contract-confirmation.spec.ts:6:1 › production shows craft opportunities without a standalone public-contract inventory (1.0s)
  -  5 tests/e2e/production-live.spec.ts:6:1 › local production tab loads live public ESI data without GitHub or SSO
  -  6 tests/e2e/production-packaged.spec.ts:6:1 › packaged macOS app starts non-demo and reads live public ESI without GitHub
  -  7 tests/e2e/production-private-live.spec.ts:3:1 › authorized private production data syncs in non-demo Electron
  ✓  8 tests/e2e/shell.spec.ts:5:1 › shell: four tabs, production data panel, restricted preload and settings survive restart (3.2s)

  4 skipped
  4 passed (10.8s)
$ playwright test
(node:46549) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

```

## Область проверки

Наличие PASS у команд не подтверждает выполнение всех требований этапа. Покрытие требует отдельного отчёта.

Приватный live SSO: BLOCKED до согласия пользователя. Проверка сборки и packaged smoke для каждой платформы подтверждается соответствующей задачей GitHub Actions; локальный прогон не заявляет кроссплатформенную проверку.
