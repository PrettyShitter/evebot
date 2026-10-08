# Этап 1 — данные и площадки (частично)

Дата: 2026-10-08 (Asia/Ho_Chi_Minh)
Исходная точка: `50e8aeb44d7e1fbbd832468e90fe52d4606322f0`; локальная ветка `codex/production-tab`, без commit/push.

## Что добавлено

- Версионированная миграция SQLite v3: профиль основы и разрешённые scopes, площадки/системные индексы, assets, blueprints, jobs, contracts, проекты и ledger-сущности. Старая торговая схема не переинтерпретируется.
- Текущий официальный SDE bundle `3586130`: 4 867 manufacturing-рецептов, 9 566 составов `typeMaterials`, Alpha skill caps и имена NPC-станций Jita/Perimeter. Команда обновления: `pnpm sde:bundle`.
- Новый экран «Производство», статусы scope/freshness и отдельный public ESI refresh. До SSO синхронизируются только публичные industry facilities/system indices; личные данные основы запрашиваются отдельно и только с согласованными read-only scopes.
- Alpha helper ограничивает active skill level минимумом из active/trained/SDE Alpha cap; Omega-only skills дают нулевой доступ. Вкладка показывает сводку, но ещё не отбирает по ней производственные рецепты.
- Dev/test можно гонять через `pnpm dev`; для изолированного профиля задаётся `EVE_USER_DATA=/tmp/eve-production-dev`. Переменная `EVE_OFFLINE=1` отключает фоновые market scans, но кнопка вкладки всё равно обращается к публичному ESI.

## Проверки

| Проверка | Результат |
|---|---|
| `pnpm test:unit` | PASS — 44 теста |
| `pnpm test:integration` | PASS — 37 тестов; есть атомарный импорт полного снимка, rollback плохого снимка и сохранение старой сделки |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm build` | PASS |
| `pnpm test:e2e` | PASS — 3; 2 ожидаемо пропущено (benchmark требует большого fixture, live ESI включается отдельно) |
| `pnpm test:e2e:live` | PASS — локальный Electron не-DEMO вызвал настоящий публичный ESI без GitHub/SSO, сохранил ответ и показал 8 площадок и 12 системных индексов для Jita/Perimeter |
| Live private character scopes / game Industry/Reprocess preview | BLOCKED — тестовый профиль изолирован и не имеет токена; игровые действия не запускались |
| Screenshot QA | PASS — [production-live.png](../../../test-results/production-live.png), Electron, полный экран |

## Остаток этапа и gate

Этап 1 **не закрыт**: Alpha caps пока не применяются к отбору рецептов; ручное редактирование/подтверждение facility services, access, tax и bonuses не сделано; проверка доступности действия до рекомендации отсутствует. Выдавать вычисленные офферы пока нельзя — экран явно сообщает, что расчётов ещё нет.

Этапы 2–8 не начаты: public BPC discovery/allocation, экономика производств и reprocessing, цепочки, возможности UI, проектный ledger, фактическая сверка и полный сквозной QA остаются обязательной работой. GitHub release не создавался и пользовательская установленная база не мигрировала.
