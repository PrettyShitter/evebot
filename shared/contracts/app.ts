import { z } from "zod";
import type {
  basketTotals,
  Opportunity,
} from "../../engine/market/opportunities";
import type { DealView } from "../../engine/portfolio/trades";
export const settingsSchema = z
  .object({
    clientId: z.string().max(200),
    minProfit: z.string().regex(/^\d+(\.\d{1,2})?$/),
    minTripProfit: z.string().regex(/^\d+(\.\d{1,2})?$/),
    minROI: z.number().min(0).max(10000),
    roiEnabled: z.boolean(),
    maxTypeShare: z.number().min(0.01).max(1),
    notificationThreshold: z.string().regex(/^\d+(\.\d{1,2})?$/),
    sound: z.boolean(),
    relistPerDay: z.number().int().min(0).max(24),
    sort: z.enum(["buy", "sell", "best"]),
  })
  .strict();
export type Settings = z.infer<typeof settingsSchema>;
export const DEFAULT_SETTINGS: Settings = {
  clientId: "",
  minProfit: "1000000",
  minTripProfit: "5000000",
  minROI: 0,
  roiEnabled: false,
  maxTypeShare: 0.2,
  notificationThreshold: "10000000",
  sound: false,
  relistPerDay: 2,
  sort: "best",
};
import type { Reconciler } from "../../engine/accounting/reconcile";
export const requestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("state") }).strict(),
  z.object({ kind: z.literal("update.check") }).strict(),
  z.object({ kind: z.literal("update.download") }).strict(),
  z.object({ kind: z.literal("update.install") }).strict(),
  z
    .object({
      kind: z.literal("purchase.bind"),
      characterId: z.string(),
      transactionId: z.string(),
      dealId: z.string(),
    })
    .strict(),
  z.object({ kind: z.literal("transfer.confirm"), lotId: z.string() }).strict(),
  z
    .object({
      kind: z.literal("expense.bind"),
      dealId: z.string(),
      characterId: z.string(),
      journalId: z.string(),
      amount: z
        .string()
        .regex(/^\d+(\.\d{1,2})?$/)
        .optional(),
    })
    .strict(),
  z.object({ kind: z.literal("expenses.confirm"), id: z.string() }).strict(),
  z.object({ kind: z.literal("demo.operations"), id: z.string() }).strict(),
  z.object({ kind: z.literal("deal.reconcile"), id: z.string() }).strict(),
  z
    .object({
      kind: z.literal("quote"),
      id: z.string(),
      quantity: z.number().int().positive().safe(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("basket.preview"),
      items: z.array(
        z.object({
          id: z.string(),
          quantity: z.number().int().positive().safe(),
        }),
      ),
    })
    .strict(),
  z
    .object({
      kind: z.literal("basket.copy"),
      items: z.array(
        z.object({
          id: z.string(),
          quantity: z.number().int().positive().safe(),
        }),
      ),
    })
    .strict(),
  z
    .object({
      kind: z.literal("deal.accept"),
      id: z.uuid(),
      items: z
        .array(
          z
            .object({
              id: z.string(),
              quantity: z.number().int().positive().safe(),
            })
            .strict(),
        )
        .min(1),
      parentId: z.string().optional(),
    })
    .strict(),
  z.object({ kind: z.literal("deal.cancel"), id: z.string() }).strict(),
  z
    .object({
      kind: z.literal("deal.route"),
      id: z.string(),
      mode: z.enum(["highsec", "lowsec"]),
    })
    .strict(),
  z.object({ kind: z.literal("market.sync") }).strict(),
  z.object({ kind: z.literal("static.update") }).strict(),
  z
    .object({
      kind: z.literal("character.connect"),
      seller: z.boolean(),
      expectedId: z.string().regex(/^\d+$/).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("character.disconnect"),
      id: z.string().regex(/^\d+$/),
    })
    .strict(),
  z.object({ kind: z.literal("wallet.sync") }).strict(),
  z
    .object({ kind: z.literal("settings.save"), value: settingsSchema })
    .strict(),
  z.object({ kind: z.literal("export") }).strict(),
  z.object({ kind: z.literal("backup") }).strict(),
  z.object({ kind: z.literal("restore") }).strict(),
  z.object({ kind: z.literal("demo.enable") }).strict(),
  z.object({ kind: z.literal("demo.disable") }).strict(),
]);
export type AppRequest = z.infer<typeof requestSchema>;
export interface CharacterView {
  id: string;
  name: string;
  status: string;
  isSeller: boolean;
  balance: string | null;
}
export interface AppState {
  ownSellOrders?: ReturnType<
    typeof import("../../engine/portfolio/orders").ownSellOrders
  >;
  update?: import("./update").UpdateView;
  demo: boolean;
  notifications: { id: string; name: string; profit: string; at: string }[];
  review: ReturnType<Reconciler["review"]>;
  systemNames: Record<string, string>;
  preview: Opportunity | null;
  basket: {
    items: Opportunity[];
    totals: ReturnType<typeof basketTotals>;
    multibuy: string;
  } | null;
  settings: Settings;
  characters: CharacterView[];
  deals: DealView[];
  opportunities: Opportunity[];
  available: string;
  wallet: string;
  reserved: string;
  mainBalance: string | null;
  sync: string;
  databaseSize: number;
  market: {
    version: string | null;
    systems: number;
    stations: number;
    regions: number;
    loadedRegions: number;
    historyPairs: number;
    status: string;
  };
}
export interface Bridge {
  request: (request: AppRequest) => Promise<AppState>;
}
