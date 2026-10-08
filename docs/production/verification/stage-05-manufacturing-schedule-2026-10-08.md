# Stage 5 — manufacturing slot and calendar scheduling

Date: 2026-10-08 (Asia/Ho_Chi_Minh). Offer schedules and project remaining-production estimates are implemented; live private-account verification remains open.

## Changes

- Manufacturing slot count is calculated from the main character's active Alpha-capped Mass Production and Advanced Mass Production levels, plus the base slot. The skill IDs are resolved from the bundled SDE names.
- Selected make/buy chain actions retain each job duration and physical blueprint item ID.
- A deterministic dependency-aware scheduler assigns jobs to character slots and serializes reuse of a physical BPO/BPC. It also reserves the slots and blueprints held by active/paused manufacturing jobs in the latest stored ESI snapshot.
- The plan reports summed slot-seconds independently from projected elapsed calendar time. The UI exposes slot-hours, calendar duration, available slots, and current ESI job occupancy.
- Profit-per-slot-hour sorting divides by total manufacturing slot-hours, not the critical-path calendar duration.
- Invalid or inconsistent active-job dates, slot over-capacity, missing job duration/blueprint IDs and dependency cycles put the offer in review instead of showing a false delivery estimate.
- The production offer cache key changes as active job end times approach, at minute resolution, so a completed job frees forecast capacity without waiting for a full profile change.
- Started projects persist the estimated duration per manufacturing node. Their remaining schedule is recalculated from complete stages, currently bound ESI job end times, physical blueprint IDs, dependencies, and current character slot occupancy. The UI labels the forecast as production-only and explicitly excludes purchase and transport waits.

## Verification

| Check | Result |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm test:unit` | PASS — includes parallel two-slot DAG, one-slot serialization, physical blueprint reuse, occupied ESI slot, invalid/over-capacity job states, Alpha caps and base slot |
| `pnpm test:integration` | PASS — 37 tests |
| `pnpm lint` | PASS |
| `git diff --check` | PASS |

CCP's [Activities and Job Types](https://support.eveonline.com/hc/en-us/articles/203210272-Activities-and-Job-Types) states that Manufacturing slots are determined by Industry and Mass Production (+1 per level) and Advanced Mass Production (+1 per level), and manufacturing slots are independent of science slots. CCP's [Manufacturing guide](https://support.eveonline.com/hc/en-us/articles/203210292-Manufacturing) says there are no time restrictions on manufacturing jobs; the SDE blueprint run limit remains enforced by the recipe's `maxProductionLimit`.

## Remaining gate

The schedule is an offer forecast built from the last successful private ESI sync. Projects do not yet persist this schedule or recompute a rolling completion forecast as real jobs finish. A full private-account QA still requires a fresh profile with consented ESI access; the public-only live ESI smoke test cannot prove the user's Alpha skill/job state. No release is ready until remaining requirements and final QA pass.
