import { describe, expect, it } from "vitest";
import {
  completedWeekRange,
  completedWeekRows,
  summarizeCompletedWeek,
} from "../../engine/history/history";
import type { HistoryDay } from "../../shared/contracts/esi";

const days: HistoryDay[] = [
  { date: "2026-10-16", volume: 999, order_count: 1, average: "1", lowest: "1", highest: "1" },
  { date: "2026-10-17", volume: 10, order_count: 1, average: "10", lowest: "10", highest: "10" },
  { date: "2026-10-18", volume: 20, order_count: 2, average: "20", lowest: "20", highest: "20" },
  { date: "2026-10-20", volume: 0, order_count: 0, average: "30", lowest: "30", highest: "30" },
  { date: "2026-10-21", volume: 20, order_count: 2, average: "30", lowest: "30", highest: "30" },
  { date: "2026-10-22", volume: 30, order_count: 3, average: "30", lowest: "30", highest: "30" },
  { date: "2026-10-23", volume: 40, order_count: 4, average: "40", lowest: "40", highest: "40" },
  { date: "2026-10-24", volume: 500, order_count: 5, average: "50", lowest: "50", highest: "50" },
];

describe("weekly_v1 UTC market history", () => {
  it("uses D-7 through D-1, excluding older data and the current partial day", () => {
    const range = completedWeekRange("2026-10-24T23:59:00Z");
    expect(range).toEqual({ start: "2026-10-17", end: "2026-10-24" });
    expect(completedWeekRows(days, "2026-10-24T23:59:00Z").map((day) => day.date)).toEqual([
      "2026-10-17", "2026-10-18", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23",
    ]);
  });

  it("reports gaps as missing coverage and calculates weekly metrics from observed days", () => {
    expect(summarizeCompletedWeek(days, "2026-10-24T12:00:00Z")).toMatchObject({
      version: "weekly_v1",
      startDate: "2026-10-17",
      endDateExclusive: "2026-10-24",
      observedDays: 6,
      missingDays: 1,
      activeDays: 5,
      weeklyVolume: "120",
      medianDailyVolume: "20",
      medianDailyPrice: "30",
      weightedPrice: "30",
      rangePercent: "1",
      priceChange: "3",
      volumeChange: "0.5",
    });
  });

  it("returns unknown when no completed day is present", () => {
    expect(summarizeCompletedWeek([], "2026-10-24T12:00:00Z")).toBeNull();
    expect(
      summarizeCompletedWeek(
        [days.at(-1)!],
        "2026-10-24T12:00:00Z",
      ),
    ).toBeNull();
  });
});
