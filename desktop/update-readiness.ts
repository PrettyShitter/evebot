export async function waitForUpdateIdle(
  isBusy: () => boolean,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
) {
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  const intervalMs = options.intervalMs ?? 200;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + timeoutMs;
  while (isBusy()) {
    if (now() >= deadline)
      throw new Error("Timed out waiting for active operations");
    await sleep(intervalMs);
  }
}
