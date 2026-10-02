# Исправление 0.1.4 — целостность подписи macOS

PASS: проверка codesign внутри DMG и после реального обновления через GitHub 0.1.3 → 0.1.4. Настройки, сделка и резерв сохранились. [Отчёт обновления](docs/verification/update-macos.json).

Скачанный пользователем DMG 0.1.3 совпал с опубликованным SHA-256. На исходной и смонтированной сборках codesign и spctl возвращали `code has no resources but signature indicates they must be present`. Причина: build.mac.identity=null оставлял недействительную подпись изменённого Electron bundle. Предыдущий smoke запускал бинарник напрямую и не проверял целостность подписи; это был пробел в проверке выпуска.

Добавлена обязательная codesign --verify --deep --strict проверка в packaged smoke: на 0.1.3 она воспроизвела ошибку. В 0.1.4 identity="-" включает штатную ad-hoc подпись electron-builder. Новая сборка проходит codesign и packaged smoke (SQLite/worker, настройки, трей, повторный запуск).

Gatekeeper spctl всё ещё отклоняет недоверенную сборку: Developer ID/notarization отсутствуют. Это отдельно от исправленной целостности подписи. Первый запуск скачанного приложения может требовать пользовательского «Всё равно открыть» по [инструкции Apple](https://support.apple.com/en-ie/102445); подтверждение пользователем ещё не проверено. Системные настройки безопасности и quarantine не изменялись.

# Обновление 0.1.3 — GitHub Releases внутри приложения

PASS: lint, typecheck, 27 unit + 22 integration теста, build и 3 Electron E2E; performance-тест не повторялся. Подпись с другим ключом, подмена манифеста, неверный хеш, неподходящая архитектура и понижение версии проверены негативными тестами. Установщик проверен на успешную замену и восстановление старого приложения/базы при ошибке нового процесса.

Реальное обновление локальной упакованной 0.1.2 до публичного GitHub Releases 0.1.3 прошло через кнопки интерфейса. Проверены загрузка, подпись, размер, SHA-512, резервная копия, перезапуск, новая версия и сохранность настроек, принятой сделки и резерва бюджета. После перезапуска приложение подтвердило, что установлена последняя версия. Рабочие данные пользователя не использовались. Отчёт: [update-macos-0.1.3.json](docs/verification/update-macos-0.1.3.json), [скриншот](docs/verification/screenshots/update-macos.png), [проверки](docs/verification/stage-updater.md).

Apple Developer ID/notarization отсутствуют; Ed25519 — подпись проекта. Первый запуск загруженного DMG через Gatekeeper на отдельном Mac не проверен. Windows in-app update и пользовательский SSO остаются непроверенными.

GitHub Actions для тега v0.1.3: [оба runner прошли проверки, сборку и packaged smoke](https://github.com/PrettyShitter/evebot/actions/runs/36995923836), macOS arm64 и Windows x64. Дублирующий прогон того же коммита по push main остановлен после зависания macOS smoke; в workflow добавлены ограничения времени. Это ограничение стабильности CI; успешный прогон тега и локальная проверка обновления зафиксированы отдельно.

# Обновление 0.1.1 — радиус 3 прыжка

PASS: lint, typecheck, 22 unit + 20 integration тестов, build и 3 Electron E2E. Отдельный performance-сценарий не повторялся; измерения ниже относятся к 0.1.0. Проверены включение третьего/исключение четвёртого прыжка, переход существующей пяти-прыжковой базы и сохранность сделок. Текущий размер зоны: 159 систем, 637 станций, 11 регионов. Логи: [radius-3](docs/verification/stage-radius-3.md). Упаковка: [stage-10](docs/verification/stage-10.md).

# Итог проверок EVE Trader 0.1.0

Дата: 2026-10-02. Проверялось рабочее дерево в исходно пустом репозитории без коммитов. Подробные исходные stdout/exit codes: [stage-09](docs/verification/stage-09.md), [stage-10](docs/verification/stage-10.md). Ранние этапы 00–08 также имеют отдельные отчёты; они фиксируют состояние соответствующего этапа, а не заменяют последний прогон.

## Автоматически проверено

| Команда / группа | Результат |
|---|---|
| pnpm lint | PASS |
| pnpm typecheck | PASS |
| pnpm test:unit | PASS: 22 теста |
| pnpm test:integration | PASS: 19 тестов |
| pnpm build | PASS |
| Electron E2E с EVE_BENCHMARK=1 | PASS: 4 сценария |
| macOS arm64 packaging / native SQLite / worker | PASS: последняя сборка и packaged smoke, см. stage-10 и packaged-darwin.json |
| Windows build / packaged smoke | BLOCKED: runner не запускался |
| Live SSO, 3 реальных персонажа | BLOCKED: пользовательские авторизации отсутствуют |
| Подпись / notarization | BLOCKED: сертификаты не предоставлены |

Стандартный pnpm verify:all не скачивает данные: performance E2E пропускается без opt-in. Последний stage-09 запущен с EVE_BENCHMARK=1 и сохранённым реальным снимком, поэтому все четыре Electron-сценария выполнены.

Основные независимые эталоны: ladder profit 410; sell net 300 / ROI 300÷1050; FIFO cost 1240 / net 380 / остаток 8; W=1 млрд и pool=800 млн; внутренние переводы в обоих порядках; paid reserve не списывается повторно. Сквозная цепочка для основы и альта: две позиции, стоимость 4000, выручка 6000, расходы 300, результат 1700. Поздняя комиссия меняет подтверждённый net 500 → 480 через review и новый снимок результата.

Проверены неполная страница/старый полный снимок, 304/429, retry, отзыв одного токена в фикстурах, refresh single-flight, отсутствие произвольного IPC, SQLite rollback/backup/restore, FK/integrity, shared order depth, min_volume, отсутствие sell-ликвидности при недостаточных данных, highsec/lowsec/BFS boundary и независимость допсделок.

## Производительность на сохранённом публичном рынке

Машина: Apple M5, 24 GiB, macOS arm64. Полный The Forge: **404 495 ордеров** с единым Last-Modified, все страницы, без top-N. Снимок сохранён локально в .cache/the-forge-orders.json; в git не включён. Кошелёк/навыки для benchmark искусственные; реальные покупки не выполнялись.

- Полный scanner: **2602 мс**, отдельный worker.
- Фильтр по подготовленным лестницам: **8,5 мс**.
- Фактическое нажатие «Высокий ROI» до изменения UI: **83,2 мс**.
- Пересчёт фильтра через Electron IPC: **14,5 мс**.
- Максимальный timer gap renderer во время полного пересчёта: **17,1 мс**.
- Peak RSS самостоятельного benchmark: примерно **1059 MiB**.

Порог UI ≤300 мс и отсутствие renderer gap >1 с пройдены в этом сценарии. Это не подтверждение скорости на любом компьютере и не soak-test всех 15 регионов. Полные параметры: [benchmark.json](docs/verification/benchmark.json), [renderer-benchmark.json](docs/verification/renderer-benchmark.json).

## Live проверено

Официальный SDE build 3561556 от 2026-09-30 загружен и разобран; названия NPC-станций разрешены через ESI. Объединение зон содержит 456 систем / 1516 NPC-станций / 15 регионов. Публичный The Forge полностью загружен с paging и проверкой поколения.

Live SSO, реальные кошельки, scopes конкретной регистрации и торговые действия пользователя не проверены. Прогнозная прибыль не является обещанием фактического исполнения.

## Артефакты

- release/EVE-Trader-0.1.0-mac-arm64.dmg и release/mac-arm64/EVE Trader.app.
- release/checksums.sha256 и docs/verification/checksums.sha256.
- Скриншоты: [рынок](docs/verification/screenshots/real-regional-market.png), [корзина](docs/verification/screenshots/market-selected-1440.png), [закрытая сделка](docs/verification/screenshots/closed-deal.png), [1280×800](docs/verification/screenshots/shell-1280.png), [1440×900 / 125%](docs/verification/screenshots/shell-1440-125.png).
- Полный список оставшихся ограничений: [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

Проверки подтверждают рабочую первую сборку. Полная приёмка исходного ТЗ требует как минимум live SSO/read-only smoke пользователя и Windows runner.
