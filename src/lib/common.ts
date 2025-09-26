import { HedgeSymbol } from "./types";

export const SYMBOL_OPTIONS: HedgeSymbol[] = ["BTC", "SOL", "ETH"];

export const MARKET_SYMBOL_MAP: Record<HedgeSymbol, string> = {
  BTC: "BTCUSDT",
  SOL: "SOLUSDT",
  ETH: "ETHUSDT",
};