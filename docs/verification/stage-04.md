# Этап 4: автоматические проверки

UTC: 2026-10-02T09:00:06.970Z

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
   Start at  16:00:09
   Duration  147ms (import 46%, transform 34%, tests 17%, worker 3%)

$ vitest run tests/unit

```

## pnpm test:integration

Exit code: 0; PASS

```text

 RUN  v5.0.3 /Users/wozglas/Documents/ChatGPT/eve online bot


 Test Files  5 passed (5)
      Tests  12 passed (12)
   Start at  16:00:09
   Duration  428ms (import 79%, transform 13%, tests 7%, worker 1%)

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
dist/renderer/index.html                   0.61 kB │ gzip:   0.37 kB
dist/renderer/assets/index-u-yynwPN.css   19.71 kB │ gzip:   4.65 kB
dist/renderer/assets/index-fDGhcpkq.js   317.61 kB │ gzip: 100.37 kB

✓ built in 136ms
$ node scripts/build.mjs

```

## pnpm test:e2e

Exit code: 0; PASS

```text

Running 1 test using 1 worker

  ✓  1 tests/e2e/shell.spec.ts:5:1 › stage 1: three tabs, restricted preload, settings survive restart; 1280 and 1440 (1.7s)

  1 passed (1.8s)
$ playwright test
(node:49722) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

```

## Область проверки

См. [покрытие и ограничения](./scope-04.md).

Live SSO: BLOCKED — нет авторизации пользователя. Windows smoke: BLOCKED — нет Windows runner в локальной сессии.
