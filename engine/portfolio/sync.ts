import { z } from "zod";
import type { EsiClient } from "../esi/client";
import { id, decimal, transactionSchema } from "../../shared/contracts/esi";
export const journalSchema = z.object({
  id,
  date: z.iso.datetime(),
  ref_type: z.string(),
  amount: decimal.optional(),
  balance: decimal.optional(),
  first_party_id: id.optional(),
  second_party_id: id.optional(),
  context_id: id.optional(),
  context_id_type: z.string().optional(),
  description: z.string().optional(),
});
export type Journal = z.infer<typeof journalSchema>;
export interface WalletData {
  id: string;
  balance: string;
  modified: string | null;
  expires: number;
  transactions: z.infer<typeof transactionSchema>[];
  journal: Journal[];
  orders?: unknown[];
  orderHistory?: unknown[];
}
export async function fetchWallet(
  client: EsiClient,
  id: string,
  token: string,
  includeOrders = false,
): Promise<WalletData> {
  const balance = await client.get(`/characters/${id}/wallet`, token, id);
  const journal: Journal[] = [];
  let page = 1;
  let pages: number;
  do {
    const r = await client.get(
      `/characters/${id}/wallet/journal?page=${page}`,
      token,
      id,
    );
    pages = r.pages;
    journal.push(...z.array(journalSchema).parse(r.body));
    page++;
  } while (page <= pages);
  const transactions: z.infer<typeof transactionSchema>[] = [];
  let from: string | undefined;
  const seen = new Set<string>();
  while (true) {
    const r = await client.get(
      `/characters/${id}/wallet/transactions${from ? "?from_id=" + from : ""}`,
      token,
      id,
    );
    const rows = z.array(transactionSchema).parse(r.body);
    let added = 0;
    for (const t of rows)
      if (!seen.has(t.transaction_id)) {
        seen.add(t.transaction_id);
        transactions.push(t);
        added++;
      }
    if (!added || !rows.length) break;
    const next = rows.at(-1)!.transaction_id;
    if (next === from) break;
    from = next;
  }
  const allPages = async (path: string) => {
    const rows: unknown[] = [];
    let page = 1;
    let pages: number;
    do {
      const r = await client.get(path + "?page=" + page, token, id);
      pages = r.pages;
      if (!Array.isArray(r.body)) throw Error("Некорректные ордера персонажа");
      rows.push(...r.body);
      page++;
    } while (page <= pages);
    return rows;
  };
  const orders = includeOrders
    ? await allPages("/characters/" + id + "/orders")
    : [];
  const orderHistory = includeOrders
    ? await allPages("/characters/" + id + "/orders/history")
    : [];
  return {
    orders,
    orderHistory,
    id,
    balance: decimal.parse(balance.body),
    modified: balance.modified,
    expires: balance.expires,
    transactions,
    journal,
  };
}
