# Этап all: автоматические проверки

UTC: 2026-10-08T03:10:25.053Z

Commit: efb623101f9993e8f94e9425d12b83f99a906085; проверяется рабочее дерево.

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


 Test Files  21 passed (21)
      Tests  107 passed (107)
   Start at  10:10:28
   Duration  439ms (transform 42%, import 37%, tests 16%, worker 4%)

$ vitest run tests/unit

```

## pnpm test:integration

Exit code: 0; PASS

```text

 RUN  v5.0.3 /Users/wozglas/Documents/ChatGPT/eve online bot


 Test Files  13 passed (13)
      Tests  38 passed (38)
   Start at  10:10:29
   Duration  3.21s (tests 50%, import 44%, transform 6%)

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
dist/renderer/index.html                   0.61 kB │ gzip:   0.38 kB
dist/renderer/assets/index-bGJJNQMv.css   28.34 kB │ gzip:   6.32 kB
dist/renderer/assets/index-CjW3QoaR.js   523.86 kB │ gzip: 157.61 kB

✓ built in 161ms
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

Running 7 tests using 1 worker

  ✓  1 tests/e2e/accounting.spec.ts:5:1 › stage 7: desktop selection, imported operations, review and explicit closing survives restart (1.5s)
  ✓  2 tests/e2e/market.spec.ts:5:1 › stage 5: filters, quantity quote, basket and idempotent acceptance (1.1s)
  -  3 tests/e2e/performance.spec.ts:15:1 › stage 9: full saved regional dataset, local filter latency and renderer responsiveness
  ✓  4 tests/e2e/production-contract-confirmation.spec.ts:7:1 › unknown public BPC attributes can be confirmed in the desktop UI (1.2s)
  -  5 tests/e2e/production-live.spec.ts:6:1 › local production tab loads live public ESI data without GitHub or SSO
  -  6 tests/e2e/production-packaged.spec.ts:6:1 › packaged macOS app starts non-demo and reads live public ESI without GitHub
  ✓  7 tests/e2e/shell.spec.ts:5:1 › shell: four tabs, production data panel, restricted preload and settings survive restart (1.4s)

  3 skipped
  4 passed (5.9s)
$ playwright test
(node:52353) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

```

## Область проверки

Наличие PASS у команд не подтверждает выполнение всех требований этапа. Покрытие требует отдельного отчёта.

Live SSO: BLOCKED — нет авторизации пользователя. Windows smoke: BLOCKED — нет Windows runner в локальной сессии.
