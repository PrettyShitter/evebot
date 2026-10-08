# Этап all: автоматические проверки

UTC: 2026-10-08T03:47:54.195Z

Commit: 6b439fc56718c2b4e5ec133a8af19ce7eb26309c; проверяется рабочее дерево.

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


 Test Files  22 passed (22)
      Tests  110 passed (110)
   Start at  10:47:59
   Duration  721ms (transform 50%, import 32%, tests 15%, worker 3%)

$ vitest run tests/unit

```

## pnpm test:integration

Exit code: 0; PASS

```text

 RUN  v5.0.3 /Users/wozglas/Documents/ChatGPT/eve online bot


 Test Files  13 passed (13)
      Tests  38 passed (38)
   Start at  10:48:00
   Duration  4.58s (import 49%, tests 44%, transform 6%)

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
dist/renderer/index.html                   0.61 kB │ gzip:   0.38 kB
dist/renderer/assets/index-UUP6GV9n.css   28.51 kB │ gzip:   6.35 kB
dist/renderer/assets/index-BBU3JTnf.js   525.16 kB │ gzip: 157.95 kB

✓ built in 234ms
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

  ✓  1 tests/e2e/accounting.spec.ts:5:1 › stage 7: desktop selection, imported operations, review and explicit closing survives restart (2.5s)
  ✓  2 tests/e2e/market.spec.ts:5:1 › stage 5: filters, quantity quote, basket and idempotent acceptance (1.5s)
  -  3 tests/e2e/performance.spec.ts:15:1 › stage 9: full saved regional dataset, local filter latency and renderer responsiveness
  ✓  4 tests/e2e/production-contract-confirmation.spec.ts:7:1 › unknown public BPC attributes can be confirmed in the desktop UI (1.7s)
  -  5 tests/e2e/production-live.spec.ts:6:1 › local production tab loads live public ESI data without GitHub or SSO
  -  6 tests/e2e/production-packaged.spec.ts:6:1 › packaged macOS app starts non-demo and reads live public ESI without GitHub
  ✓  7 tests/e2e/shell.spec.ts:5:1 › shell: four tabs, production data panel, restricted preload and settings survive restart (2.4s)

  3 skipped
  4 passed (9.1s)
$ playwright test
(node:82104) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

```

## Область проверки

Наличие PASS у команд не подтверждает выполнение всех требований этапа. Покрытие требует отдельного отчёта.

Live SSO: BLOCKED — нет авторизации пользователя. Windows smoke: BLOCKED — нет Windows runner в локальной сессии.
