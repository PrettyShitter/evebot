import { D } from "../accounting/money";
export function packagedVolume(
  type: { packagedVolume?: string; volume?: string },
  isShip: boolean,
): string | null {
  const v = type.packagedVolume ?? (isShip ? undefined : type.volume);
  return v !== undefined && D(v).gte(0) ? D(v).toFixed() : null;
}
