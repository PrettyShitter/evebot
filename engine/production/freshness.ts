const DEFAULT_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function isValidTimestamp(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

/** Reject malformed, stale, or implausibly future-dated evidence. */
export function isFreshTimestamp(
  value: string | null | undefined,
  maxAgeMs: number,
  now = Date.now(),
  clockSkewMs = DEFAULT_CLOCK_SKEW_MS,
): value is string {
  if (!isValidTimestamp(value) || !Number.isFinite(now) || maxAgeMs < 0) return false;
  const observedAt = Date.parse(value);
  return observedAt <= now + clockSkewMs && now - observedAt <= maxAgeMs;
}

export function isUnexpiredTimestamp(value: string | null | undefined, now = Date.now()): value is string {
  return isValidTimestamp(value) && Number.isFinite(now) && Date.parse(value) > now;
}
