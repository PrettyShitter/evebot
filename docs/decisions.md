# Решения реализации

Дата: 2026-10-02. Актуальное задание: [ТЗ v1](spec/EVE_TRADER_CODEX_BUILD_TZ.md). Оно уточняет предыдущий CONTEXT.md: ровно три персонажа, один продавец, радиус три прыжка (последующее уточнение пользователя вместо пяти в исходном ТЗ), перевозка без денежной оценки.

## Контракты и источники

- ESI compatibility date 2026-08-18; публичные region orders/history, персональные wallet/skills/skillqueue/standings/orders. [Спецификация](https://esi.evetech.net/meta/openapi.json?compatibility_date=2026-08-18).
- Desktop SSO: Authorization Code + PKCE S256, public client, без client secret. Системный браузер, фиксированный loopback callback `http://localhost:43827/callback`, точное совпадение регистрации, state одноразовый/с TTL. JWT проверяется по metadata/JWKS, issuer/audience/exp/sub; refresh single-flight на персонажа. Фактическая регистрация callback и пользовательские логины ещё требуют live-проверки. [CCP SSO](https://developers.eveonline.com/docs/services/sso/).
- Scopes: wallet всех троих; skills, skillqueue, standings, character orders продавца. Не запрашивать права управления игрой. Для разрешения публичного имени персонажа авторизация не требуется.
- Secrets только main/safeStorage, вне торговой SQLite и экспортов. UI не получает токены. [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).
- SDE теперь находится в `/docs/services/static-data/`; прежний адрес `/services/sde/` возвращает 404. Скачивание официального versioned JSONL ZIP, сохранение build/version. [Документация](https://developers.eveonline.com/docs/services/static-data/).
- Граф — обычные stargates. Raw security >=0.45 highsec, 0<x<0.45 lowsec, x<=0 nullsec. Радиус поиска без фильтра безопасности. [CCP system security](https://developers.eveonline.com/docs/guides/system-security/).
- ID на границах — строки. Lossless JSON parser сохраняет числовые лексемы до schema validation; количества — проверенные safe integers, деньги decimal.js; SQLite хранит ISK как текст фиксированной точности 2 знака, распределения расходов сохраняют сумму методом наибольших остатков.
- Налоги: Accounting `0.075*(1-.11*L)`; NPC broker `.03-.003*L-.0003*faction-.0002*corp` по raw standings. [CCP fees](https://support.eveonline.com/hc/en-us/articles/203218962-Broker-Fee-and-Sales-Tax). [Accounting](https://esi.evetech.net/latest/universe/types/16622/).
- Relist: `max(0,broker*(new-old))+(1-discount)*broker*new` по полной стоимости оставшегося ордера, discount=.5+.06*AdvancedBrokerRelations. Минимум создания/изменения 100 ISK; цена до четырёх значащих цифр с минимальным шагом .01. Исторический devblog используется только для tick/minimum; нынешние ставки — из актуального support. [Broker Relations](https://www.eveonline.com/news/view/broker-relations), [matching/relist](https://support.eveonline.com/hc/en-us/articles/203218932-Buy-and-Sell-Orders).
- Округление прогнозных расходов до .01 HALF_UP — локальная конвенция модели, не обещание точного серверного округления каждого события; подтверждённые wallet/journal суммы имеют приоритет. Реальное исполнение пользователем по нескольким уровням требует отдельных подходящих цен: агрегат стакана не обещает автоматическое получение лучшей цены единым вводом.
- Buy range учитывает регион, систему, станцию и расстояние без safety-фильтра; общий order_id не размножает доступный спрос. min_volume трактуется как минимум отдельного исполнения; остаток самого ордера меньше min_volume может быть исполнен целиком. Нужен live read-only sanity check плюс ручная проверка игроком перед продажей.
- История региональная. Нет history — неизвестность. Исчезновение ордера не продажа. До достаточных локальных признаков sell-ликвидность не подтверждена. [Market contracts](https://developers.eveonline.com/api-explorer).
- Пятиминутный cache, headers важнее таймеров приложения. [Market limits](https://developers.eveonline.com/blog/market-orders-rate-limit-rolls-out-on-february-24-2026), [cache](https://developers.eveonline.com/docs/services/esi/best-practices/).

## Архитектура

Main — окно, системные диалоги и безопасное хранение. Минимальный preload — конечный перечень проверяемых команд. Выделенный worker — единственный писатель SQLite, расчёты и импорт. React только представление. Demo отделён отдельным файлом базы; реальные данные не заменяются fixtures при ошибке.

## Внешние ограничения

Live SSO требует зарегистрированного Client ID и входа пользователя. ESI не предоставляет атомарный общий снимок трёх кошельков, точную станционную ленту продаж, доказательство передачи предмета между альтами, гарантированное сопоставление всех комиссий. Такие случаи требуют консервативной сверки/NEEDS_REVIEW. Windows build и smoke требуют Windows runner; подпись/notarization — credentials владельца. Ни одно из этих ограничений не должно маркироваться PASS по fixtures.

## Официальный справочник первой сборки

SDE build 3561556 от 2026-09-30. Из него в resources/static-data.json извлечены 8490 систем, 19565 опубликованных рыночных типов (PLEX исключён), 456 систем объединения радиусов и 1516 NPC-станций в 15 регионах. Это результат BFS актуального графа, не предположение, что нужны только три региона. Точные названия станций разрешены публичным `/universe/names` по официальным station IDs. Упакованный объём берётся из packagedVolume; для корабля без него возвращается неизвестность. Справочник обновляется пользователем через приложение; старые сделки сохраняют исходный контекст.

## Уточнения по результатам реализации 2026-10-02

- Последний согласованный wallet snapshot выбирается по последовательности commit (SQLite rowid), а не по настенным часам. Проверка двух сценариев выявила, что скачок часов иначе возвращает старый капитал.
- Затраты по journal.context_id автоматически связываются только с context_id_type=market_transaction_id; разные пространства ID нельзя смешивать.
- Сверка покупки требует явной привязки; физическая передача альта подтверждается отдельно. Это точнее доступных wallet-данных, чем обещание полной автоматизации.
- Покупки до создания сделки остаются кандидатами для ручной привязки; их нельзя автоматически относить к новой сделке. Для ранее импортированной продажи соответствующий налог без `context_id` можно предложить для ручного распределения, если время журнала совпадает с найденной продажей.
- Для снижения диска полные стаканы ограничены двумя поколениями на регион. Forecast принятой сделки автономен.
- Быстрые фильтры переиспользуют подготовленные кандидаты; ROI пересчитывает количество по исходным лестницам.
- Повторно проверены [актуальные заголовки rate limit](https://developers.eveonline.com/docs/services/esi/rate-limiting/): Remaining, Group, Limit и Retry-After; при малом Remaining замедляем очередь. Глобальное торможение консервативнее независимых buckets.

- CI macos-15 выбран как актуальный arm64 runner по [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). Наличие workflow не означает состоявшийся запуск.

## Радиус поиска v0.1.1

По запросу пользователя поиск заменён на ровно три системы хабов: Jita, Amarr и Dodixie. Это 26 NPC-станций в трёх регионах в SDE build 3561556. Старые сохранённые зоны сужаются на старте без удаления сделок; полный системный граф сохраняется для прокладки маршрутов и проверки дальности buy-ордеров. История цен остаётся региональной.

Обновление 2026-10-03: история рынка не должна инвалидировать весь скан при каждом сохранении отдельной пары товар/регион. Снимки ордеров сравниваются по ID, цене и оставшемуся объёму; перерасчёт касается только изменившихся типов. При одинаковом стакане метаданные предложений обновляются без сканирования. В UI видны только пороги минимального профита сделки и ROI; общий порог прибыли рейса удалён из принятия.
