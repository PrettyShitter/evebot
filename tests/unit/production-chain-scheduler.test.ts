import { describe, expect, it } from "vitest";
import { scheduleChainPlan, type ChainPlan } from "../../engine/production/chain-planner";

const baseTime = Date.parse("2026-01-01T00:00:00.000Z");
function plan(actions: ChainPlan["actions"]): ChainPlan {
  return {
    status: "ready", reasons: [], targetTypeId: "FINAL", targetQuantity: 1,
    totalCost: "1.00", productionSeconds: 25, slotSeconds: 25,
    schedule: null, actions, searchStates: 1,
  };
}
const job = (id: string, recipeId: string, timeSeconds: number, parents: string[] = []) => ({
  id, kind: "manufacturing" as const, typeId: id, quantity: 1, cost: "0.00",
  facilityId: "station", recipeId, blueprintId: recipeId, runs: 1, parents, timeSeconds,
});

describe("manufacturing chain scheduler", () => {
  it("runs independent branches in parallel and waits for both before the final job", () => {
    const result = scheduleChainPlan({
      plan: plan([job("root", "bp-root", 5), job("a", "bp-a", 10, ["root"]), job("b", "bp-b", 10, ["root"])]),
      availableSlots: 2, activeJobs: [], now: baseTime,
    });
    expect(result.slotSeconds).toBe(25);
    expect(result.productionSeconds).toBe(15);
    expect(result.schedule).toMatchObject({ status: "ready", availableSlots: 2, occupiedSlots: 0, calendarSeconds: 15 });
    expect(result.schedule?.jobs.find((item) => item.actionId === "root")?.startAt).toBe("2026-01-01T00:00:10.000Z");
  });

  it("serializes independent jobs when only one slot is available", () => {
    const result = scheduleChainPlan({
      plan: plan([job("root", "bp-root", 5), job("a", "bp-a", 10, ["root"]), job("b", "bp-b", 10, ["root"])]),
      availableSlots: 1, activeJobs: [], now: baseTime,
    });
    expect(result.productionSeconds).toBe(25);
  });

  it("serializes reuse of one physical blueprint even when two slots are free", () => {
    const result = scheduleChainPlan({
      plan: plan([job("root", "bp-root", 1), job("a", "bp-same", 10, ["root"]), job("b", "bp-same", 10, ["root"])]),
      availableSlots: 2, activeJobs: [], now: baseTime,
    });
    expect(result.productionSeconds).toBe(21);
    expect(result.schedule?.jobs.find((item) => item.actionId === "b")?.startAt).toBe("2026-01-01T00:00:10.000Z");
  });

  it("accounts for an active ESI job occupying a slot and blueprint", () => {
    const endAt = new Date(baseTime + 30_000).toISOString();
    const result = scheduleChainPlan({
      plan: plan([job("root", "bp-root", 5)]), availableSlots: 1,
      activeJobs: [{ blueprintId: "bp-root", status: "active", endAt }], now: baseTime,
    });
    expect(result.productionSeconds).toBe(35);
    expect(result.schedule).toMatchObject({ occupiedSlots: 1, availableSlots: 1 });
  });

  it("marks schedules for review when ESI shows more active jobs than skill slots", () => {
    const result = scheduleChainPlan({
      plan: plan([job("root", "bp-root", 5)]), availableSlots: 1,
      activeJobs: [
        { blueprintId: "busy-1", status: "active", endAt: new Date(baseTime + 30_000).toISOString() },
        { blueprintId: "busy-2", status: "active", endAt: new Date(baseTime + 60_000).toISOString() },
      ], now: baseTime,
    });
    expect(result.schedule).toMatchObject({ status: "review", calendarSeconds: null });
  });

  it("does not discard an active ESI job when its end date is malformed", () => {
    const result = scheduleChainPlan({
      plan: plan([job("root", "bp-root", 5)]), availableSlots: 2,
      activeJobs: [{ blueprintId: "busy", status: "active", endAt: "not-a-date" }], now: baseTime,
    });
    expect(result.schedule).toMatchObject({ status: "review", calendarSeconds: null });
  });

  it("does not invent a finish date for a paused manufacturing job", () => {
    const result = scheduleChainPlan({
      plan: plan([job("root", "bp-root", 5)]), availableSlots: 2,
      activeJobs: [{ blueprintId: "busy", status: "paused", endAt: new Date(baseTime + 30_000).toISOString() }],
      now: baseTime,
    });
    expect(result.schedule?.status).toBe("review");
  });

  it("recalculates only the unfinished project stages after a predecessor completes", () => {
    const result = scheduleChainPlan({
      plan: plan([job("final", "bp-final", 5)]), availableSlots: 1, activeJobs: [],
      dependenciesByAction: { final: ["component"] },
      completedActions: { component: new Date(baseTime - 60_000).toISOString() },
      now: baseTime,
    });
    expect(result.productionSeconds).toBe(5);
    expect(result.schedule?.jobs).toHaveLength(1);
    expect(result.schedule?.jobs[0]?.actionId).toBe("final");
  });
});
