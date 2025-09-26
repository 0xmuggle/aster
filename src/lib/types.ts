export interface User {
  name: string;
  apiKey: string;
  apiSecret: string;
  txs: number;
  vol: number;
}

export type HedgeSymbol = "BTC" | "ETH" | "SOL";

export interface HedgeOrder {
  id: string;
  symbol: HedgeSymbol;
  primaryAccount: string;
  hedgeAccount: string;
  hedgeAccount2?: string | null;
  amount: number;
  takeProfit: number;
  stopLoss: number;
  status: HedgeOrderStatus;
  createdAt: string;
  updatedAt: string;
}

export interface HedgeOrderDraft {
  symbol: HedgeSymbol;
  primaryAccount: string;
  hedgeAccount: string;
  hedgeAccount2: string;
  amount: number;
  takeProfit: number;
  stopLoss: number;
}

export type HedgeOrderStatus = "draft" | "open" | "closed";

export type PositionSide = "BOTH" | "LONG" | "SHORT" | "BUY" | "SELL";

export interface AccountPosition {
  symbol: string;
  positionAmt: number;
  leverage: number;
  entryPrice?: string;
  ep?: string;
  markPrice?: string;
  mp?: string;
  unRealizedProfit?: string;
  up?: string;
  liquidationPrice?: string;
  maxNotionalValue?: string;
  marginType?: string;
  isolatedMargin?: string;
  iw?: string;
  isAutoAddMargin?: string;
  positionSide: PositionSide;
  notional?: string;
  isolatedWallet?: string;
  updateTime?: number;
  breakEvenPrice?: string;
  cumulativeRealized?: string;
  cr?: string;
  takeProfitPrice?: string;
  stopLossPrice?: string;
}

export interface FuturesOpenOrder {
  symbol: string;
  clientOrderId: string;
  orderId: number;
  positionSide?: PositionSide;
  type: string;
  origType?: string;
  price?: string;
  stopPrice?: string;
  workingType?: string;
  status?: string;
  side?: 'BUY' | 'SELL';
  [key: string]: unknown;
}

export interface AccountBalanceInfo {
  totalWalletBalance: string;
  availableBalance: string;
  positions: AccountPosition[];
}

export interface AccountAsset {
  asset: string;
  walletBalance?: string;
  crossWalletBalance?: string;
  balanceChange?: string;
  availableBalance?: string;
  marginBalance?: string;
  maxWithdrawAmount?: string;
  unrealizedProfit?: string;
  collateralRate?: string;
  marginAvailable?: boolean;
  [key: string]: unknown;
}

export interface FuturesOrderUpdate {
  symbol: string;
  clientOrderId: string;
  orderId: number;
  side: "BUY" | "SELL";
  orderType: string;
  status: string;
  executionType: string;
  positionSide: PositionSide;
  quantity: string;
  price: string;
  stopPrice?: string;
  avgPrice: string;
  lastFilledQty: string;
  cumulativeFilledQty: string;
  lastFilledPrice: string;
  realizedProfit: string;
  commissionAsset?: string;
  commission?: string;
  reduceOnly?: boolean;
  workingType?: string;
  originalOrderType?: string;
  updateTime: number;
  tradeId?: number;
}

export interface AccountLiveState extends AccountBalanceInfo {
  positions: AccountPosition[];
  lastAccountUpdate?: number;
  lastOrderUpdate?: number;
}
