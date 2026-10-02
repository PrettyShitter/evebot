# Этап 1: автоматические проверки

UTC: 2026-10-02T08:40:29.206Z

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


 Test Files  2 passed (2)
      Tests  19 passed (19)
   Start at  15:40:31
   Duration  178ms (import 41%, transform 39%, tests 17%, worker 3%)

$ vitest run tests/unit

```

## pnpm test:integration

Exit code: 0; PASS

```text

 RUN  v5.0.3 /Users/wozglas/Documents/ChatGPT/eve online bot


 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  15:40:32
   Duration  339ms (import 83%, transform 8%, tests 8%, worker 1%)

$ vitest run tests/integration

```

## pnpm build

Exit code: 0; PASS

```text
vite v8.3.2 building client environment for production...
transforming...
✓ 1953 modules transformed.
rendering chunks...
computing gzip size...
dist/renderer/index.html                   0.61 kB │ gzip:  0.38 kB
dist/renderer/assets/index-F6KDutu2.css   19.48 kB │ gzip:  4.64 kB
dist/renderer/assets/index-DCR_En78.js   315.91 kB │ gzip: 99.94 kB

✓ built in 146ms
$ node scripts/build.mjs

```

## pnpm test:e2e

Exit code: 0; PASS

```text

Running 1 test using 1 worker

  ✓  1 tests/e2e/shell.spec.ts:5:1 › stage 1: three tabs, restricted preload, settings survive restart; 1280 and 1440 (2.5s)

  1 passed (2.7s)
$ playwright test
(node:47281) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

```

## Область проверки

См. [покрытие и ограничения](./scope-01.md).

Live SSO: BLOCKED — нет авторизации пользователя. Windows smoke: BLOCKED — нет Windows runner в локальной сессии.
