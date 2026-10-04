# ESI market history, liquidity ranking, and seller fees

Verified against CCP's official ESI documentation and live ESI on 2026-10-04. This is an API feasibility note, not a claim that any item is permanently liquid or profitable.

## Direct answer

ESI can support a data-driven ranking of liquid market types in The Forge (Jita), Domain (Amarr), and Sinq Laison (Dodixie). It cannot establish a timeless “top 10 items that are always liquid.” Regional market history is a daily aggregate by `region_id` and `type_id`; it does not report executions by station, exact individual transactions, or who bought/sold them. Current regional orders do include `location_id`, so current Jita/Amarr/Dodixie station order books can be isolated, but historical daily volume cannot be attributed to those hubs specifically.

The practical ranking should therefore be labelled as a recent regional-liquidity screen, not as guaranteed hub-level sell-through. A useful version would combine: recent history volume and its consistency, current hub order-book depth on both sides, depth-weighted executable price, estimated net profit after the actual seller's fees, and turnover confidence. Keep any “top 10” date-stamped and recompute it; do not encode names as permanently good trades.

## Public market endpoints and what they return

The current official OpenAPI schema exposes these relevant routes:

| Route | Access and granularity | Useful fields / limitation |
|---|---|---|
| `GET /markets/{region_id}/history/?type_id={type_id}` | Public; one item type in one region per request | Daily `date`, `volume`, `order_count`, `average`, `highest`, `lowest`. It is an aggregate, not a list of transactions or stations. The route description says it expires daily at 11:05. |
| `GET /markets/{region_id}/orders/?order_type=all&type_id={type_id}` | Public; regional live-order pages | Each order has `location_id`, `system_id`, `type_id`, `price`, `volume_remain`, `min_volume`, `is_buy_order`, `range`, and issue/duration data. Filter `location_id` to the hub station for a hub-local current book. Buy-order `range` must be interpreted when deciding whether it can fill at the sale location. |
| `GET /markets/{region_id}/types/` | Public; paginated list of item types currently having active regional orders | Useful as an active-market candidate index. It is not the complete historical universe: an item without active orders is absent. |

These route definitions and schemas are in CCP's [official OpenAPI document](https://esi.evetech.net/meta/openapi.json?compatibility_date=2026-08-18), linked through the [ESI overview](https://developers.eveonline.com/docs/services/esi/overview/) and [API Explorer](https://developers.eveonline.com/api-explorer). ESI has no public bulk market-history endpoint in that schema: broad history collection means one region/type request per candidate type.

The `order_count` field is the API's daily aggregate count; it should not be presented as an exact number of player transactions or executions. `volume` is the daily unit volume across the region. History contains no station identifier, so it cannot prove that a commodity sold in Amarr VIII or Jita IV-4 on a given day.

## Practical scale and freshness

On 2026-10-04 I queried the public `/markets/{region_id}/types/` route for page 1. ESI reported `X-Pages` of 20 for The Forge, 16 for Domain, and 14 for Sinq Laison, with 1,000 type IDs returned per first page: approximately 20,000, 16,000, and 14,000 currently active order types respectively. This is a live snapshot and varies as the market changes. It implies roughly 50,000 individual history requests to refresh every currently active type in all three regions, in addition to paginating the type indexes. That is unsuitable as a blocking startup scan.

For a sample type (Tritanium, type 34), all three history routes returned 397 daily rows in the 2026-10-04 check, dated 2025-09-01 through 2026-10-02. The schema does not promise that exact retention window; treat this as observed data, not a contract. The response carried `Last-Modified: Fri, 02 Oct 2026 11:06:09 GMT` and `Expires: Sun, 04 Oct 2026 11:05:00 GMT` for the checked regions. The market-history route description says it expires daily at 11:05. Respect ESI's actual response headers and do not assume sub-daily history refresh.

The market-orders route has an explicit rate-limit group in the current schema: `market-order`, 12,000 tokens per 15-minute window. A successful 2xx request costs 2 tokens, so the theoretical bucket allows at most 6,000 successful market-order requests per 15 minutes, before leaving headroom and accounting for any other route/group behavior. CCP specifically says these order pages are cached for five minutes and should not be polled faster; the application must honor `Expires`/cache headers and `Retry-After`. Do not infer a numeric history-route allowance from the order route's group: history has no `x-rate-limit` extension in the inspected schema. General ESI error limiting and any additional server-side limits still apply. See CCP's [market-order rate-limit announcement](https://developers.eveonline.com/blog/market-orders-rate-limit-rolls-out-on-february-24-2026), [rate-limit guide](https://developers.eveonline.com/docs/services/esi/rate-limiting/), and [best practices](https://developers.eveonline.com/docs/services/esi/best-practices/).

## A robust way to derive a “top 10 liquid” list

1. Use `/markets/{region_id}/types/` to discover currently active candidate types. Use a relevant tradeable-item allowlist/category policy if the app should exclude blueprints, structures, obsolete items, or other non-haulable entries; market history itself does not define “good for resale.”
2. Filter candidates from the current hub order books. Require meaningful ask quantity at the source and executable bid or ask depth at the destination for the intended sale method; exclude orders with a `min_volume` the planned trade cannot satisfy. Keep the book snapshots' timestamps visible.
3. Fetch daily history only for candidates, cache by `(region_id, type_id, date)`, and refresh after the daily ESI expiry. Prioritize types already in the UI/watchlist and types with fresh, meaningful hub books, then expand in background. Do not try all ~50k candidates synchronously at application launch.
4. Score multiple recent windows (for example 7, 14, and 30 days) for total daily volume, days with nonzero volume, median and variation in volume, and price range/volatility. These are app-side statistical choices, not values specified by CCP. Prefer consistently traded types over a single volume spike.
5. Keep **regional historical liquidity** separate from **current hub depth**. A region can have strong volume while the specific station book is thin. Show both signals and do not translate regional volume into a guaranteed hub fill.
6. For each route, calculate the cost from actual source sell-order depth and the proceeds from either destination buy-order depth (immediate exit) or destination sell orders (slower listing exit). Subtract sale tax, relevant broker/listing/relisting fees, transport and the app's chosen risk reserve. Only show quantities supported by the actual depth and the configured budget/cargo limits.
7. Publish a dated “top 10” with region/hub coverage, measurement window, confidence, current data age, and the reason each candidate ranks. A historical ranking is evidence of past activity, not a promise that the market will remain liquid.

ESI supplies raw fields and snapshots; this scoring methodology is an application recommendation, not an official CCP liquidity classification.

## Seller character: skills, standings, and tax inputs

Public order/history endpoints do not expose the user's personal fee profile. The selling character must authorize the app using EVE SSO. The inspected OpenAPI schema declares:

- `GET /characters/{character_id}/skills/` requires `esi-skills.read_skills.v1`. It provides trained skills and active levels. CCP explicitly warns that this endpoint can be stale when a character has not logged in after training completes; the app should overlay any already-finished training levels from the authorized queue response.
- `GET /characters/{character_id}/skillqueue/` requires `esi-skills.read_skillqueue.v1`.
- `GET /characters/{character_id}/standings/` requires `esi-characters.read_standings.v1`. The rows distinguish `from_type` (`npc_corp`, `faction`, or `agent`), `from_id`, and numeric `standing`.

SSO access is per selected character and granted scopes; the player chooses the character and consents to scopes. See the [official SSO guide](https://developers.eveonline.com/docs/services/sso/) and API route/security declarations in the [OpenAPI schema](https://esi.evetech.net/meta/openapi.json?compatibility_date=2026-08-18). Only the character whose orders are being sold should supply the sell-side fee profile. The character does not need to be at a station for the app to read that character's authorized skills or standings.

For NPC stations, calculate the seller's Accounting-adjusted sales tax from Accounting skill, and the applicable listing/broker fees from Broker Relations plus standings toward the station's owning NPC corporation and its faction, using CCP's current [Broker Fee and Sales Tax](https://support.eveonline.com/hc/en-us/articles/203218962-Broker-Fee-and-Sales-Tax) rules. For a sale into an existing buy order, account for sales tax but not a new sell listing fee. For a listed sell order, include the placement fee and any scenario-based relisting cost. The current project already implements the profile fetch in `engine/portfolio/profile.ts` and fee calculations in `engine/market/fees.ts`; its model uses the main/selling character's Accounting, Broker Relations, Advanced Broker Relations, station-owner corporation standing, and faction standing. The route scopes in the project match the OpenAPI declarations above. The app should show the fee inputs and calculated rate in the UI so a stale or mismatched seller profile is visible.

CCP's [buy/sell matching rules](https://support.eveonline.com/hc/en-us/articles/203218932-Buy-and-Sell-Orders) also matter to net-profit calculations: an advertised spread is not guaranteed profit. Calculate fills against the relevant order-book levels, and keep immediate buy-to-existing-sell and immediate sell-to-existing-buy scenarios distinct from placing passive orders.

## What this means for EVE Trader

The seven previously discussed improvements are technically compatible with ESI, with these boundaries:

- Expected profit, execution depth, liquidity/turnover confidence, price-history and volatility indicators, suspicious thin-book warnings, and dated item rankings can be derived from public orders plus regional history.
- Actual seller taxes and NPC broker-fee estimates can be personalized from the main character's authorized skills and standings; the current app already has the essential reads and fee model.
- Passive order trading can be modelled from order books and fee formulas, but ESI does not place, amend, or cancel the app user's orders. The app remains an advisor/monitor.
- “Station trading” and hub-to-hub hauling are distinct strategy modes. Regional history is suitable as a market-wide demand signal; current orders are required to estimate the chosen station/hub execution.
- Exact past station-level sale counts for every player and a guarantee that an item is always liquid are not obtainable from these public history routes.

## Sources and verification notes

- [ESI overview](https://developers.eveonline.com/docs/services/esi/overview/) and [API Explorer](https://developers.eveonline.com/api-explorer).
- [Current official ESI OpenAPI schema, compatibility date 2026-08-18](https://esi.evetech.net/meta/openapi.json?compatibility_date=2026-08-18). Inspected the route definitions and response schemas for regional market history, regional orders, regional market types, character skills, character skillqueue, and character standings.
- [CCP announcement: market-order rate limit](https://developers.eveonline.com/blog/market-orders-rate-limit-rolls-out-on-february-24-2026), [ESI rate limiting](https://developers.eveonline.com/docs/services/esi/rate-limiting/), [ESI best practices](https://developers.eveonline.com/docs/services/esi/best-practices/), and [X-Pages pagination](https://developers.eveonline.com/docs/services/esi/pagination/x-pages/).
- [EVE SSO](https://developers.eveonline.com/docs/services/sso/), [CCP broker fee and sales tax](https://support.eveonline.com/hc/en-us/articles/203218962-Broker-Fee-and-Sales-Tax), and [CCP buy/sell orders](https://support.eveonline.com/hc/en-us/articles/203218932-Buy-and-Sell-Orders).
- Live read-only ESI checks on 2026-10-04: `/markets/{region_id}/types/?page=1` for region IDs 10000002 (The Forge), 10000043 (Domain), and 10000032 (Sinq Laison); and `/markets/{region_id}/history/?type_id=34` in those regions. The row counts, page counts, dates, and HTTP cache headers above describe those observations only.
