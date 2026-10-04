import { expect, it } from "vitest";
import { waitForUpdateIdle } from "../../desktop/update-readiness";

it("waits for active wallet and engine work instead of failing the update immediately", async () => {
  let now = 0;
  let busy = true;
  const sleeps: number[] = [];
  const ready = waitForUpdateIdle(() => busy, {
    timeoutMs: 1000,
    intervalMs: 100,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
      if (now >= 300) busy = false;
    },
  });

  await expect(ready).resolves.toBeUndefined();
  expect(sleeps).toEqual([100, 100, 100]);
});

it("times out when active work never settles", async () => {
  let now = 0;
  await expect(
    waitForUpdateIdle(() => true, {
      timeoutMs: 200,
      intervalMs: 100,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    }),
  ).rejects.toThrow("Timed out waiting for active operations");
});
