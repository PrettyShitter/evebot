# Этап 5: автоматические проверки

UTC: 2026-10-02T09:06:21.914Z

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


 Test Files  3 passed (3)
      Tests  21 passed (21)
   Start at  16:06:24
   Duration  148ms (import 47%, transform 33%, tests 17%, worker 3%)

$ vitest run tests/unit

```

## pnpm test:integration

Exit code: 0; PASS

```text

 RUN  v5.0.3 /Users/wozglas/Documents/ChatGPT/eve online bot


 Test Files  5 passed (5)
      Tests  12 passed (12)
   Start at  16:06:24
   Duration  438ms (import 81%, transform 12%, tests 7%, worker 1%)

$ vitest run tests/integration

```

## pnpm build

Exit code: 0; PASS

```text
vite v8.3.2 building client environment for production...
transforming...
✓ 2063 modules transformed.
rendering chunks...
computing gzip size...
dist/renderer/index.html                   0.61 kB │ gzip:   0.37 kB
dist/renderer/assets/index-dwUBUiUi.css   21.71 kB │ gzip:   5.11 kB
dist/renderer/assets/index-Bw_-Bhmm.js   417.62 kB │ gzip: 133.37 kB

✓ built in 148ms
$ node scripts/build.mjs

```

## pnpm test:e2e

Exit code: 0; PASS

```text

Running 2 tests using 1 worker

  ✓  1 tests/e2e/market.spec.ts:5:1 › stage 5: filters, quantity quote, basket and idempotent acceptance (1.1s)
  ✓  2 tests/e2e/shell.spec.ts:5:1 › stage 1: three tabs, restricted preload, settings survive restart; 1280 and 1440 (1.2s)

  2 passed (2.5s)
$ playwright test
(node:50395) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

```

## Область проверки

См. [покрытие и ограничения](./scope-05.md).

Live SSO: BLOCKED — нет авторизации пользователя. Windows smoke: BLOCKED — нет Windows runner в локальной сессии.
