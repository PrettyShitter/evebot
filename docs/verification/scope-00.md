# Покрытие этапа 0

Каркас TypeScript создан; Vitest исполняет реальные deterministic tests. `mechanics.test.ts` покрывает эталоны 1–8, eligibility допостановок из 9, точные большие ID/decimal/валидацию, отрицательный результат, минимум buy, общую глубину, signed allocation property. `volume.test.ts`: Rifter из официального SDE build 3561556, packagedVolume 2500 против assembled 27289 м³.

Исходный SDE: https://developers.eveonline.com/static-data/tranquility/eve-online-static-data-3561556-jsonl.zip ; fixture извлечён из types.jsonl без изменения исходных полей. Архитектура и границы в decisions.md. Это базовые механики, а не утверждение о реализованном конечном UI или автоматической сверке.

Live авторизация BLOCKED без пользователя. Правило min_volume при остатке ниже минимума и серверное округление расходов дополнительно подлежат сверке с игрой. Прогноз использует явно документированную конвенцию округления; факт будет использовать исходные journal суммы.
