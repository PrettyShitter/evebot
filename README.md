# EVE Trader

Локальное desktop-приложение для поиска торговли между NPC-станциями в пределах трёх обычных прыжков от Jita, Amarr и Dodixie. Рабочая первая версия: рынок, расчёты, корзина, маршруты, три кошелька, FIFO и сверка фактических расходов.

**Текущий статус: macOS/Windows сборки и автоматические проверки проходят; live SSO пользователя ещё не проверен. Полную производственную готовность по ТЗ не заявляем.** Приложение ничего не покупает и не продаёт в EVE.

## Запуск

- Готовый образ: [последний релиз macOS arm64](https://github.com/PrettyShitter/evebot/releases/latest).
- Приложение: [EVE Trader.app](release/mac-arm64/EVE%20Trader.app).
- Сборка без Developer ID/notarization. На macOS неподписанная загрузка может потребовать открытия через системное «Открыть».
- Для знакомства откройте Настройки → «Открыть DEMO отдельно». DEMO хранится в другой базе.
- Для реального портфеля: [SSO_SETUP.md](SSO_SETUP.md).

Из исходников, Node 26 / pnpm 11:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

## Проверки и сборка

```sh
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build
pnpm test:e2e
pnpm verify:stage -- 9
pnpm verify:all
pnpm dist:mac
node scripts/packaged-smoke.mjs
```

Windows: `pnpm dist:win` на Windows runner; сборка и запуск упакованного приложения прошли [GitHub Actions](https://github.com/PrettyShitter/evebot/actions/runs/36995923836). Установка Windows-обновления ещё не проверена.

## Документы

- [Обновления внутри приложения и публикация релизов](UPDATES.md)
- [Руководство](USER_GUIDE.md)
- [Архитектура](ARCHITECTURE.md)
- [Результаты тестов](TEST_REPORT.md)
- [Ограничения](KNOWN_LIMITATIONS.md)
- [Матрица требований](docs/requirements-matrix.md)
- [Исходное ТЗ](docs/spec/EVE_TRADER_CODEX_BUILD_TZ.md)
- [Решения и официальные источники](docs/decisions.md)

Не требуется держать персонажей онлайн или размещать их на сканируемых NPC-станциях. Три SSO-подключения нужны этой реализации для согласованного портфеля по вашему ТЗ. Обновление публичного рынка ограничено кешем ESI — это не поток сделок в реальном времени. История торгов региональная; текущие ордера и ваши wallet transactions содержат location_id.
