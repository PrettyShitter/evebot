import { it, expect } from "vitest";
import rifter from "../fixtures/rifter-sde.json";
import { packagedVolume } from "../../engine/market/volume";
it("official SDE build 3561556 Rifter uses packaged volume, not assembled hull", () => {
  expect(rifter._key).toBe(587);
  expect(rifter.packagedVolume).toBe(2500);
  expect(rifter.volume).toBe(27289);
  expect(
    packagedVolume(
      {
        packagedVolume: String(rifter.packagedVolume),
        volume: String(rifter.volume),
      },
      true,
    ),
  ).toBe("2500");
  expect(packagedVolume({ volume: "27289" }, true)).toBeNull();
});
