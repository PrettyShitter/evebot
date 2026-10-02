import Decimal from "decimal.js";
export function money(value: string | null, decimals = 0) {
  if (value === null) return "—";
  const [whole, fraction] = new Decimal(value).toFixed(decimals).split(".");
  return (
    whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ") +
    (fraction ? "," + fraction : "")
  );
}
export const roi = (v: string | null) =>
  v === null ? "—" : new Decimal(v).mul(100).toFixed(1) + "%";
export const signClass = (v: string | null) =>
  v === null
    ? "text-muted-foreground"
    : v.startsWith("-")
      ? "negative"
      : "positive";
