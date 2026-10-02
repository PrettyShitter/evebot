# Этап 0: автоматические проверки

UTC: 2026-10-02T08:33:30.037Z

Commit: репозиторий без коммитов; проверяется рабочее дерево.

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
   Start at  15:33:31
   Duration  161ms (import 44%, transform 37%, tests 16%, worker 3%)

$ vitest run tests/unit

```

## Область проверки

См. [покрытие и ограничения](./scope-00.md).

Live SSO: BLOCKED — нет авторизации пользователя. Windows smoke: BLOCKED — нет Windows runner в локальной сессии.
