# EVE market fees: primary-source findings

Verified 2026-10-02. These are baseline rates; station-specific or temporary modifiers must be represented separately.

## Baseline fees

- NPC broker rate, as a fraction: `0.03 - 0.003 * BrokerRelationsLevel - 0.0003 * rawFactionStanding - 0.0002 * rawStationOwnerCorpStanding`. Maximum skills and +10/+10 standings give 1%; level V with neutral standings gives 1.5%. Connections and Diplomacy do not affect the raw standings used here.
- Sales tax: `0.075 * (1 - 0.11 * AccountingLevel)`. Level V gives exactly 3.375% arithmetically; CCP support displays 3.37%. Keep precision internally and verify actual ISK rounding against in-game transactions.
- Broker fee applies to non-immediate orders on creation. Immediate buying from a sell order incurs no buyer broker fee. Selling to an existing buy order still incurs seller sales tax but no listing fee.
- Upwell broker fees use the structure's settings; Broker Relations does not apply. CCP says 0.5% of creating/modifying order value goes to an NPC sink and the rest to the owner. Do not add 0.5% twice if a configured value is already the total fee.
- Repricing incurs a relist cost. For remaining quantity q and unit prices p1/p2, the published formula implies `q * (max(0, b * (p2-p1)) + (1-d) * b * p2)` where `d = 0.50 + 0.06 * AdvancedBrokerRelationsLevel`. At V, d=80%. Future repricing count is uncertain and should be budgeted rather than treated as zero.

Sources:

- [CCP support: Broker Fee and Sales Tax](https://support.eveonline.com/hc/en-us/articles/203218962-Broker-Fee-and-Sales-Tax), updated 2026-03-02.
- [CCP support: Buy and Sell Orders](https://support.eveonline.com/hc/en-us/articles/203218932-Buy-and-Sell-Orders).
- Live official ESI static type descriptions fetched without authentication: [Accounting, type 16622](https://esi.evetech.net/latest/universe/types/16622/) and [Advanced Broker Relations, type 16597](https://esi.evetech.net/latest/universe/types/16597/). Accounting confirms 11% per level against 7.5%; Advanced Broker Relations confirms base 50% discount plus 6 percentage points per level.

## Profit calculation (model recommendation)

For immediate purchase in A and a later sell listing in B:

`expectedNetProfit = expectedGrossSaleProceeds - actualDepthWeightedPurchaseCost - salesTax - initialSellBrokerFee - budgetedRelistFees - haulCost - riskReserve`

A buy-order acquisition strategy adds acquisition broker/relisting costs and fill risk. Immediate resale into destination buy orders substitutes actual executable buy-side depth for a future ask price and omits the sell listing fee. The gross ask-to-ask spread alone is not executable guaranteed profit.

Use the actual selling character's active skill levels and standings, rather than the hauling or scanning character. Configure seller per destination if using multiple characters. No need for those characters to be online merely to read their authenticated ESI data.

## 2026 exceptions worth preserving in the data model

- Jita sovereignty changed in May 2026, but CCP explicitly states the Caldari Navy still owns Jita IV-4 and station taxes are unaffected. Resolve faction from station-owning corporation, not current system sovereignty. [Version 23.02, 2026-05-12](https://www.eveonline.com/news/view/patch-notes-version-23-02).
- Amarr's Blessed Exchange campaign promises a station-local tax/broker reduction if successful. No active percentage/activation date verified in this review; do not assert an active 50% reduction from forum reports. [Cradle of War In Focus](https://www.eveonline.com/news/view/cradle-of-war-in-focus). [Version 24.01](https://www.eveonline.com/news/view/patch-notes-version-24-01) reports construction progress on 2026-08-06, not tax activation.
- Exordium has an additional 5% fee for non-instant orders. Not relevant to conventional three hubs but shows why fees should allow location overrides. [Cradle of War expansion notes](https://www.eveonline.com/news/view/cradle-of-war-expansion-notes).
- PLEX became a global order book in July 2025. Exclude it from ordinary physical inter-hub transport arbitrage. [Version 23.01, 2025-07-07](https://www.eveonline.com/news/view/patch-notes-version-23-01).

## API feasibility (verified by coordinating research agent)

The coordinating agent inspected all 40 tags / 218 paths in the [current OpenAPI schema, compatibility 2026-08-18](https://esi.evetech.net/meta/openapi.json?compatibility_date=2026-08-18), plus the user-linked [overview](https://developers.eveonline.com/docs/services/esi/overview/) and [API Explorer](https://developers.eveonline.com/api-explorer).

- Public `GET /markets/{region_id}/orders` provides regional orders. Filter `location_id` for the hub's exact NPC station and iterate all pages. No market observer character at that station, no online character, and no authentication are required. One authenticated character is sufficient for that character's personalized fee calculation.
- Live unauthenticated The Forge/tritanium request returned HTTP 200 and 85 records for Jita IV-4. Headers on 2026-10-02 UTC showed Last-Modified 04:46:42, Expires 04:51:42. This is a cached polling API, not a tick-by-tick real-time market stream. [Official 2026 rate-limit announcement](https://developers.eveonline.com/blog/market-orders-rate-limit-rolls-out-on-february-24-2026) confirms five-minute cache and market-orders group 12,000 tokens per fifteen minutes. Follow returned rate-limit/cache headers rather than polling faster.
- Private character skill/standing data requires SSO authorization with the scopes declared in the schema (`esi-skills.read_skills.v1`, `esi-characters.read_standings.v1`). Structure markets require authenticated access and `esi-markets.structure_markets.v1`; authorization/access rights matter, not station presence.
- Character skills endpoint documents an offline completion freshness caveat. Overlay relevant completed entries from authorized skillqueue data rather than assuming the skills endpoint always reflects an offline completion immediately. Reconcile active skill restrictions separately.
- Market history gives daily regional statistics, not exact station fill history. It supports a regional volume filter but cannot prove how many units traded at a particular hub or guarantee sell-through time. Order snapshots can support estimates; disappearing orders can also have been canceled, expired, or changed.
- Three hubs give six directed source/destination routes. Separate sell-order acquisition to destination buy-order execution from sell-order acquisition to forecast destination sell-order resale. Evaluate quantity against actual depth, `min_volume`, buy-order range applicability, budget, cargo volume, transport cost, and expected turnover.
- There are no API endpoints to execute, create, reprice, or cancel market orders in the inspected schema. ESI can power a scanner and alerts, not autonomous market execution.

Recommended app outputs are timestamped estimates: weighted purchase/sale prices for selected quantity, gross spread, tax and broker components, logistics/repricing budgets, expected net profit and ROI, regional daily volume, order-book depth and estimated turnover confidence. Actual net profit is known only after execution.
