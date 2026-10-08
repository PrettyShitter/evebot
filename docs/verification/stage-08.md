# Этап 8: автоматические проверки

UTC: 2026-10-07T20:09:21.918Z

Commit: 50e8aeb44d7e1fbbd832468e90fe52d4606322f0; проверяется рабочее дерево.

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


 Test Files  15 passed (15)
      Tests  61 passed (61)
   Start at  03:09:25
   Duration  283ms (transform 45%, import 34%, tests 17%, worker 3%)

$ vitest run tests/unit

```

## pnpm test:integration

Exit code: 0; PASS

```text

 RUN  v5.0.3 /Users/wozglas/Documents/ChatGPT/eve online bot


 Test Files  13 passed (13)
      Tests  37 passed (37)
   Start at  03:09:25
   Duration  2.28s (tests 46%, import 46%, transform 7%, worker 1%)

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
dist/renderer/assets/index-BZsZL-xu.css   27.39 kB │ gzip:   6.13 kB
dist/renderer/assets/index-BEnYPCGe.js   489.68 kB │ gzip: 150.39 kB

✓ built in 138ms
$ node scripts/build.mjs

```

## pnpm test:e2e

Exit code: 0; PASS

```text

Running 5 tests using 1 worker

  ✓  1 tests/e2e/accounting.spec.ts:5:1 › stage 7: desktop selection, imported operations, review and explicit closing survives restart (1.7s)
  ✓  2 tests/e2e/market.spec.ts:5:1 › stage 5: filters, quantity quote, basket and idempotent acceptance (901ms)
  -  3 tests/e2e/performance.spec.ts:15:1 › stage 9: full saved regional dataset, local filter latency and renderer responsiveness
  -  4 tests/e2e/production-live.spec.ts:6:1 › local production tab loads live public ESI data without GitHub or SSO
  ✓  5 tests/e2e/shell.spec.ts:5:1 › shell: four tabs, production data panel, restricted preload and settings survive restart (1.3s)

  2 skipped
  3 passed (4.6s)
$ playwright test
(node:29156) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

```

## Область проверки

См. [покрытие и ограничения](./scope-08.md).

Live SSO: BLOCKED — нет авторизации пользователя. Windows smoke: BLOCKED — нет Windows runner в локальной сессии.
