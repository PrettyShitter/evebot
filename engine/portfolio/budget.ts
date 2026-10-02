import { D, Decimal, isk, sum } from "../accounting/money";
export function budget(
  balances: string[],
  purchaseReservations: string[],
  feeReservations: string[],
) {
  const wallet = sum(balances);
  const pool = wallet.mul(".8");
  const reserved = sum([...purchaseReservations, ...feeReservations]);
  return {
    wallet: isk(wallet),
    protected: isk(wallet.mul(".2")),
    pool: isk(pool),
    reserved: isk(reserved),
    available: isk(Decimal.max(0, pool.minus(reserved))),
  };
}
export function typeCapacity(
  pool: string,
  share: string,
  unsoldCost: string,
  reserved: string,
) {
  if (D(share).lt(0) || D(share).gt(1)) throw Error("Доля должна быть 0–100%");
  return isk(
    Decimal.max(0, D(pool).mul(share).minus(unsoldCost).minus(reserved)),
  );
}
export class WalletBarrier {
  private last: string[];
  private staged = new Map<string, string>();
  constructor(
    readonly characterIds: string[],
    initial: string[],
  ) {
    if (characterIds.length !== 3 || initial.length !== 3)
      throw Error("Нужны три кошелька");
    this.last = [...initial];
  }
  stage(characterId: string, balance: string) {
    if (!this.characterIds.includes(characterId))
      throw Error("Неизвестный персонаж");
    this.staged.set(characterId, balance);
  }
  // Caller must prove journals/transfers are reconciled; completeness alone isn't financial consistency.
  commit(reconciled: boolean) {
    if (!reconciled || this.staged.size !== 3) return false;
    this.last = this.characterIds.map((id) => this.staged.get(id)!);
    this.staged.clear();
    return true;
  }
  current() {
    return budget(this.last, [], []);
  }
}
