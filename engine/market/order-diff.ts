import type { Order } from "../../shared/contracts/esi";

export interface OrderVersion {
  typeId: string;
  signature: string;
}

export function indexOrderVersions(orders: Order[]) {
  return new Map(
    orders.map((order) => [
      order.order_id,
      {
        typeId: order.type_id,
        signature: JSON.stringify([
          order.type_id,
          order.location_id,
          order.system_id,
          order.is_buy_order,
          order.price,
          order.volume_remain,
          order.volume_total,
          order.min_volume,
          order.range,
        ]),
      },
    ]),
  );
}

export function changedOrderTypes(
  previous: Map<string, OrderVersion>,
  current: Map<string, OrderVersion>,
) {
  const changed = new Set<string>();
  for (const [id, version] of previous) {
    const next = current.get(id);
    if (!next || next.signature !== version.signature)
      changed.add(version.typeId);
  }
  for (const [id, version] of current) {
    const old = previous.get(id);
    if (!old || old.signature !== version.signature) changed.add(version.typeId);
  }
  return changed;
}
