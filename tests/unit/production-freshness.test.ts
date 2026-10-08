import { describe, expect, it } from "vitest";
import { isFreshTimestamp, isUnexpiredTimestamp, isValidTimestamp } from "../../engine/production/freshness";

describe("production evidence timestamps", () => {
  const now = Date.parse("2026-10-08T00:00:00.000Z");

  it("rejects malformed timestamps instead of treating NaN comparisons as fresh", () => {
    expect(isValidTimestamp("not-a-date")).toBe(false);
    expect(isFreshTimestamp("not-a-date", 30_000, now)).toBe(false);
    expect(isUnexpiredTimestamp("not-a-date", now)).toBe(false);
  });

  it("accepts recent evidence within clock skew and rejects stale or implausibly future evidence", () => {
    expect(isFreshTimestamp("2026-10-07T23:59:00.000Z", 60_000, now)).toBe(true);
    expect(isFreshTimestamp("2026-10-08T00:04:00.000Z", 60_000, now)).toBe(true);
    expect(isFreshTimestamp("2026-10-08T00:06:00.000Z", 60_000, now)).toBe(false);
    expect(isFreshTimestamp("2026-10-07T23:57:00.000Z", 60_000, now)).toBe(false);
  });

  it("requires expiry timestamps to be valid and strictly in the future", () => {
    expect(isUnexpiredTimestamp("2026-10-08T00:00:01.000Z", now)).toBe(true);
    expect(isUnexpiredTimestamp("2026-10-08T00:00:00.000Z", now)).toBe(false);
  });
});
