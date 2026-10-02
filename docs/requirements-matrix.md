# Матрица требований → реализация → доказательства

| Область | Реализация | Проверка / статус |
|---|---|---|
| 0: ID, деньги, формулы, объём | contracts/esi, accounting/money, market/fees/depth | 22 unit, real Rifter SDE fixture; stage-00 |
| 1: оболочка, SQLite, IPC | desktop, db, renderer | store integration, shell Electron E2E; stage-01 |
| 2: 3 SSO, кошельки, переводы | auth, vault, portfolio | auth unit, portfolio/regression integration; live SSO BLOCKED |
| 3: зоны, NPC, страницы, история | static-data, graph, snapshots, scheduler | static/sync tests, реальный полный The Forge; stage-03 |
| 4: обе модели и лимиты | opportunities/depth/fees/liquidity | эталоны 410/300/380, budgets, min-volume, market tests; stage-04 |
| 5: таблица, фильтры, корзина | MarketView, worker | market E2E, screenshots 1280/1440; stage-05 |
| 6: маршруты, допсделки | graph, trades, DealsView | unit graph + routes persistence integration; stage-06 |
| 7: FIFO, review, закрытие | Reconciler, ReviewPanel | accounting integration, accounting E2E, two-type regression; stage-07 |
| 8: фон, dedup, retention/export | maintenance, tray/powerMonitor | background tests, packaged tray; физический sleep BLOCKED |
| 9: регрессия / скорость | весь suite + benchmark | stage-09, benchmark.json, renderer-benchmark.json; все 15 регионов soak не измерены |
| 10: macOS binary | electron-builder, packaged-smoke | .dmg/.app, packaged-darwin.json; Windows/signing BLOCKED |
| История региона 7/30/90 | summarize/historyWindows | gaps/unknown/stale fixtures, UI раскрытие |
| Собственные ордера | character_orders, wallet sync | read-only imports реализованы; real SSO BLOCKED |
| Станционные наблюдения | station_observations daily snapshot | не объявляются исполненными сделками; own confirmed sales за 7 дней входят в локальное ограничение партии |
| Неизменяемый прогноз / revisions | deals.forecast + result.snapshot events | retention/export tests, late commission test |
| Начальная себестоимость старого товара | блокировка неизвестной стоимости | review; редактор начальных партий отсутствует |
| Live полностью автоматическая атрибуция | ограничена API | явная привязка покупки/передачи/расходов; см. KNOWN_LIMITATIONS |

PASS автоматических команд не эквивалентен выполнению всех требований исходного ТЗ. Реальные логи в stage-NN.md, области/исключения в scope-NN.md. Актуальные ограничения перечислены в ../../KNOWN_LIMITATIONS.md.
