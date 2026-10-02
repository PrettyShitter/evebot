import { verify } from "node:crypto";
import { z } from "zod";
export const RELEASE_REPOSITORY = "PrettyShitter/evebot";
export const manifestName = (arch: string) =>
  `eve-trader-darwin-${arch}.update.json`;
const stable = z
  .string()
  .regex(/^(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,7})$/);
const payloadSchema = z
  .object({
    schema: z.literal(1),
    version: stable,
    platform: z.literal("darwin"),
    arch: z.enum(["arm64", "x64"]),
    size: z
      .number()
      .int()
      .positive()
      .max(2 * 1024 ** 3),
    sha512: z.string().regex(/^[a-f0-9]{128}$/),
    url: z.url(),
  })
  .strict();
export type UpdateManifest = z.infer<typeof payloadSchema>;
export function isNewer(next: string, current: string) {
  const a = stable.parse(next).split(".").map(BigInt),
    b = stable.parse(current).split(".").map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}
export function verifyManifest(
  raw: unknown,
  key: string,
  arch: string,
): UpdateManifest {
  const signed = z
    .object({
      payload: z.string().max(16384),
      signature: z
        .string()
        .regex(/^[A-Za-z0-9+/]+={0,2}$/)
        .max(128),
    })
    .strict()
    .parse(raw);
  if (
    !verify(
      null,
      Buffer.from(signed.payload),
      key,
      Buffer.from(signed.signature, "base64"),
    )
  )
    throw Error("Invalid release signature");
  const payload = payloadSchema.parse(JSON.parse(signed.payload));
  if (payload.arch !== arch) throw Error("Wrong release architecture");
  const expected = `https://github.com/${RELEASE_REPOSITORY}/releases/download/v${payload.version}/EVE-Trader-${payload.version}-mac-${arch}.zip`;
  if (payload.url !== expected) throw Error("Unexpected release URL");
  return payload;
}
