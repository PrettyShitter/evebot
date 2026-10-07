# Этап all: автоматические проверки

UTC: 2026-10-07T23:48:27.402Z

Commit: af7e6287c7e3c7a333ea7e083a0282106dc2a670; проверяется рабочее дерево.

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


 Test Files  20 passed (20)
      Tests  100 passed (100)
   Start at  06:48:36
   Duration  986ms (transform 44%, import 36%, tests 16%, worker 4%)

    Isolate  20 workers spawned · ~226ms startup each (spawn + environment, per file)
             at least ~276ms faster with isolate: false — reuses workers across files instead of one per file

$ vitest run tests/unit

```

## pnpm test:integration

Exit code: 0; PASS

```text

 RUN  v5.0.3 /Users/wozglas/Documents/ChatGPT/eve online bot


 Test Files  13 passed (13)
      Tests  37 passed (37)
   Start at  06:48:38
   Duration  5.30s (import 50%, tests 43%, transform 7%)

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
dist/renderer/assets/index-C29dAqiN.css   27.98 kB │ gzip:   6.26 kB
dist/renderer/assets/index-BECRiSAE.js   517.39 kB │ gzip: 156.21 kB

✓ built in 388ms
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

Running 6 tests using 1 worker

  ✓  1 tests/e2e/accounting.spec.ts:5:1 › stage 7: desktop selection, imported operations, review and explicit closing survives restart (4.2s)
  ✓  2 tests/e2e/market.spec.ts:5:1 › stage 5: filters, quantity quote, basket and idempotent acceptance (2.8s)
  -  3 tests/e2e/performance.spec.ts:15:1 › stage 9: full saved regional dataset, local filter latency and renderer responsiveness
  -  4 tests/e2e/production-live.spec.ts:6:1 › local production tab loads live public ESI data without GitHub or SSO
  -  5 tests/e2e/production-packaged.spec.ts:6:1 › packaged macOS app starts non-demo and reads live public ESI without GitHub
  ✓  6 tests/e2e/shell.spec.ts:5:1 › shell: four tabs, production data panel, restricted preload and settings survive restart (4.2s)

  3 skipped
  3 passed (12.9s)
$ playwright test
(node:6183) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

```

## Область проверки

Наличие PASS у команд не подтверждает выполнение всех требований этапа. Покрытие требует отдельного отчёта.

Live SSO: BLOCKED — нет авторизации пользователя. Windows smoke: BLOCKED — нет Windows runner в локальной сессии.
