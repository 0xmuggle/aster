import type { AccountPosition, HedgeSymbol } from "./types";

export const SYMBOL_OPTIONS: HedgeSymbol[] = ["BTC", "SOL", "ETH"];

export const MARKET_SYMBOL_MAP: Record<HedgeSymbol, string> = {
  BTC: "BTCUSDT",
  SOL: "SOLUSDT",
  ETH: "ETHUSDT",
};

export const SYMBOL_PRECISION: Record<HedgeSymbol, { price: number; quantity: number }> = {
  BTC: { price: 1, quantity: 3 },
  ETH: { price: 2, quantity: 2 },
  SOL: { price: 2, quantity: 1 },
};

export const parseNumeric = (value?: string | number | null) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric;
};

export const trimTrailingZeros = (value: string) => value.replace(/(?:\.0+|0+)$/, "").replace(/\.$/, "");

export const formatWithPrecision = (value: number, fractionDigits: number) => {
  const safeValue = Number.isFinite(value) ? value : 0;
  return trimTrailingZeros(safeValue.toFixed(fractionDigits));
};

export const formatQuantityForSymbol = (symbol: HedgeSymbol, amount: number) => {
  const decimals = SYMBOL_PRECISION[symbol]?.quantity ?? 4;
  return formatWithPrecision(Math.abs(amount), decimals);
};

export const formatPriceForSymbol = (symbol: HedgeSymbol, price: number) => {
  const decimals = SYMBOL_PRECISION[symbol]?.price ?? 2;
  return formatWithPrecision(price, decimals);
};

export const formatNumber = (value?: string | number, fractionDigits = 2) => {
  if (value === undefined || value === null || value === "") {
    return "--";
  }
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) {
    return "--";
  }
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  });
};

export const formatDateTime = (value?: string | number) => {
  if (value === undefined || value === null || value === "") {
    return "--";
  }

  try {
    const date = typeof value === "number" ? new Date(value) : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return typeof value === "string" ? value : String(value);
    }
    return date.toLocaleString();
  } catch {
    return typeof value === "string" ? value : String(value);
  }
};

export const formatTime = (diff: number) => {

  try {
    if(diff < 60) return diff.toFixed(0) + "分钟";
    const h = Math.floor(diff / 60);
    const m =  Math.floor(diff % 60);
    return `${h}小时${m}分钟`;
  } catch {
    return "--";
  }
}

export const formatSignedNumber = (value: number | null, fractionDigits = 2) => {
  if (value === null) {
    return "--";
  }
  const formatted = formatNumber(value, fractionDigits);
  if (value > 0) {
    return `+${formatted}`;
  }
  return formatted;
};

export const resolveCloseSide = (position: AccountPosition): "BUY" | "SELL" | null => {
  if (position.positionSide === "LONG") {
    return "SELL";
  }
  if (position.positionSide === "SHORT") {
    return "BUY";
  }
  const amount = parseNumeric(position.positionAmt);
  if (amount === null || amount === 0) {
    return null;
  }
  return amount > 0 ? "SELL" : "BUY";
};
