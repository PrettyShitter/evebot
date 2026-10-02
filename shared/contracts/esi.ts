import { z } from "zod";
import { parse } from "lossless-json";
export const id = z.string().regex(/^[1-9]\d*$/);
export const decimal = z.string().regex(/^-?\d+(\.\d+)?$/);
const integer = z.preprocess(
  (v) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v),
  z.number().int().safe().nonnegative(),
);
export const orderSchema = z.object({
  order_id: id,
  type_id: id,
  location_id: id,
  system_id: id,
  price: decimal.refine((v) => !v.startsWith("-")),
  is_buy_order: z.boolean(),
  volume_remain: integer,
  volume_total: integer,
  min_volume: integer,
  range: z.enum([
    "station",
    "region",
    "solarsystem",
    "1",
    "2",
    "3",
    "4",
    "5",
    "10",
    "20",
    "30",
    "40",
  ]),
  duration: integer,
  issued: z.iso.datetime(),
});
export type Order = z.infer<typeof orderSchema>;
export const historySchema = z.object({
  date: z.iso.date(),
  average: decimal,
  highest: decimal,
  lowest: decimal,
  volume: integer,
  order_count: integer,
});
export type HistoryDay = z.infer<typeof historySchema>;
export const transactionSchema = z.object({
  transaction_id: id,
  date: z.iso.datetime(),
  type_id: id,
  location_id: id,
  quantity: integer.refine((v) => v > 0),
  unit_price: decimal,
  is_buy: z.boolean(),
  is_personal: z.boolean(),
  client_id: id,
  journal_ref_id: id,
});
export function parseExact(text: string): unknown {
  return parse(text, undefined, (value) => value);
}
export function parseOrders(text: string): Order[] {
  return z.array(orderSchema).parse(parseExact(text));
}
