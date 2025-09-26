"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { useStore } from "@/lib/store";
import type {
  AccountLiveState,
  AccountPosition,
  HedgeOrder,
  HedgeOrderDraft,
  HedgeSymbol,
  User,
} from "@/lib/types";
import { useExtension } from "@/components/EProvider";
import { useTickers } from "@/hooks/useTickers";
import { closeFuturesPosition, submitFuturesOrder } from "@/services/api";
import { MARKET_SYMBOL_MAP, SYMBOL_OPTIONS } from "@/lib/common";
import { isEmpty } from "lodash";

type OrderFormState = {
  symbol: HedgeSymbol;
  primaryAccount: string;
  hedgeAccount: string;
  amount: string;
  takeProfit: string;
  stopLoss: string;
};

const SYMBOL_PRECISION: Record<HedgeSymbol, { price: number; quantity: number }> = {
  BTC: { price: 1, quantity: 4 },
  ETH: { price: 2, quantity: 4 },
  SOL: { price: 3, quantity: 3 },
};

const toMarketSymbol = (symbol: HedgeSymbol) => MARKET_SYMBOL_MAP[symbol];

const parseNumeric = (value?: string | number | null) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric;
};

const findPositions = (account: AccountLiveState | undefined, marketSymbol: string) => {
  if (!account) {
    return [] as AccountPosition[];
  }
  return account.positions.filter((position) => position.symbol?.toUpperCase() === marketSymbol);
};

const findOpenPositions = (account: AccountLiveState | undefined, marketSymbol: string) =>
  findPositions(account, marketSymbol).filter((position) => {
    const size = parseNumeric(position.positionAmt);
    return size !== null && Math.abs(size) > 0;
  });

const createEmptyForm = (): OrderFormState => ({
  symbol: "BTC",
  primaryAccount: "",
  hedgeAccount: "",
  amount: "",
  takeProfit: "",
  stopLoss: "",
});

const trimTrailingZeros = (value: string) => value.replace(/(?:\.0+|0+)$/, "").replace(/\.$/, "");

const formatWithPrecision = (value: number, fractionDigits: number) => {
  const safeValue = Number.isFinite(value) ? value : 0;
  return trimTrailingZeros(safeValue.toFixed(fractionDigits));
};

const formatQuantityForSymbol = (symbol: HedgeSymbol, amount: number) => {
  const decimals = SYMBOL_PRECISION[symbol]?.quantity ?? 4;
  return formatWithPrecision(Math.abs(amount), decimals);
};

const formatPriceForSymbol = (symbol: HedgeSymbol, price: number) => {
  const decimals = SYMBOL_PRECISION[symbol]?.price ?? 2;
  return formatWithPrecision(price, decimals);
};

const toDraft = (form: OrderFormState): HedgeOrderDraft => ({
  symbol: form.symbol,
  primaryAccount: form.primaryAccount,
  hedgeAccount: form.hedgeAccount,
  amount: Number(form.amount),
  takeProfit: Number(form.takeProfit),
  stopLoss: Number(form.stopLoss),
});

const formatNumber = (value?: string | number, fractionDigits = 2) => {
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

const formatDateTime = (value?: string | number) => {
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

const formatSignedNumber = (value: number | null, fractionDigits = 2) => {
  if (value === null) {
    return "--";
  }
  const formatted = formatNumber(value, fractionDigits);
  if (value > 0) {
    return `+${formatted}`;
  }
  return formatted;
};

const resolveCloseSide = (position: AccountPosition): "BUY" | "SELL" | null => {
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

export default function Home() {
  const { users, orders, addOrder, updateOrder, setOrderStatus, deleteOrder, updateUser } = useStore();
  const { accountMap, refreshAccount } = useExtension();

  const [formState, setFormState] = useState<OrderFormState>(createEmptyForm);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [closingOrderId, setClosingOrderId] = useState<string | null>(null);
  const [openingOrderId, setOpeningOrderId] = useState<string | null>(null);

  const subscribedSymbols = useMemo(() => {
    const unique = new Set<HedgeSymbol>(SYMBOL_OPTIONS);
    orders.forEach((order) => unique.add(order.symbol));
    return Array.from(unique);
  }, [orders]);
  const { prices } = useTickers(subscribedSymbols);

  const userMap = useMemo(() => {
    const map = new Map<string, User>();
    users.forEach((user) => {
      map.set(user.name, user);
    });
    return map;
  }, [users]);

  const closeAccountPositions = useCallback(
    async (accountName: string, marketSymbol: string) => {
      const credentials = userMap.get(accountName);
      if (!credentials) {
        setFormError(`找不到账户 ${accountName} 的API信息，请先在配置中完善。`);
        return;
      }

      const accountState = accountMap[accountName];
      if (!accountState) {
        return;
      }

      const positions = findOpenPositions(accountState, marketSymbol);
      const tasks = positions
        .map((position) => {
          const side = resolveCloseSide(position);
          if (!side) {
            return null;
          }
          const amount = parseNumeric(position.positionAmt);
          if (amount === null || Math.abs(amount) < 1e-8) {
            return null;
          }

          return closeFuturesPosition(credentials.apiKey, credentials.apiSecret, {
            symbol: marketSymbol,
            side,
            quantity: Math.abs(amount).toString(),
            positionSide: position.positionSide !== "BOTH" ? position.positionSide : undefined,
          });
        })
        .filter((task): task is Promise<boolean> => task !== null);

      if (tasks.length === 0) {
        return;
      }

      await Promise.all(tasks);
      
      refreshAccount(accountName);
    },
    [accountMap, userMap],
  );

  useEffect(() => {
    if (users.length === 0) {
      return;
    }

    setFormState((prev) => {
      const primary = prev.primaryAccount && users.some((user) => user.name === prev.primaryAccount)
        ? prev.primaryAccount
        : users[0]?.name ?? "";

      let hedge = prev.hedgeAccount && users.some((user) => user.name === prev.hedgeAccount)
        ? prev.hedgeAccount
        : users.find((user) => user.name !== primary)?.name ?? "";

      if (primary && hedge && primary === hedge) {
        const alternative = users.find((user) => user.name !== primary)?.name ?? "";
        hedge = alternative;
      }

      return {
        ...prev,
        primaryAccount: primary,
        hedgeAccount: hedge,
      };
    });
  }, [users]);

  const resetForm = () => {
    setFormState({
      ...createEmptyForm(),
      primaryAccount: users[0]?.name ?? "",
      hedgeAccount: users[1]?.name ?? users[0]?.name ?? "",
    });
    setEditingOrderId(null);
    setFormError(null);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    if (!formState.primaryAccount || !formState.hedgeAccount) {
      setFormError("请选择两个账户。");
      return;
    }

    if (formState.primaryAccount === formState.hedgeAccount) {
      setFormError("两个账户不能相同。");
      return;
    }

    const draft = toDraft(formState);

    if (!Number.isFinite(draft.amount) || draft.amount <= 0) {
      setFormError("请输入有效的下单金额。");
      return;
    }

    if (!Number.isFinite(draft.takeProfit) || draft.takeProfit <= 0) {
      setFormError("请输入有效的止盈比例。");
      return;
    }

    if (!Number.isFinite(draft.stopLoss) || draft.stopLoss <= 0) {
      setFormError("请输入有效的止损比例。");
      return;
    }

    if (editingOrderId) {
      updateOrder(editingOrderId, draft);
    } else {
      addOrder(draft);
    }

    resetForm();
  };

  const handleEdit = (order: HedgeOrder) => {
    setFormState({
      symbol: order.symbol,
      primaryAccount: order.primaryAccount,
      hedgeAccount: order.hedgeAccount,
      amount: order.amount.toString(),
      takeProfit: order.takeProfit.toString(),
      stopLoss: order.stopLoss.toString(),
    });
    setEditingOrderId(order.id);
    setFormError(null);
  };

  const handleChange = <T extends keyof OrderFormState>(field: T) =>
    (event: ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
      const value = event.target.value;
      setFormState((prev) => ({
        ...prev,
        [field]: value,
      }));
    };

  const handleOpen = useCallback(
    async (order: HedgeOrder, acanp: number, bcanp: number, aLevel: number = 0, bLevel: number = 0) => {
      if (openingOrderId === order.id) {
        return;
      }

      const amount = parseNumeric(order.amount);

      const maxCanPosition = Math.min(acanp, bcanp) * 0.9;

      if(aLevel !== bLevel) {
        setFormError("杠杆需一致");
        return;
      }

      if (amount === null || amount <= 0) {
        setFormError("开仓金额必须大于0。");
        return;
      }

      if(amount > maxCanPosition) {
        setFormError(`开仓金额必须小于于${maxCanPosition.toFixed(3)}。`);
        return;
      }

      const price = prices[order.symbol];
      if (!price) {
        setFormError("无法获取当前行情价格，请稍后重试。");
        return;
      }

      const marketSymbol = toMarketSymbol(order.symbol);
      const quantity = formatQuantityForSymbol(order.symbol, amount);
      const takeProfitPct = order.takeProfit;
      const stopLossPct = order.stopLoss;

      let aSide: any = "BUY";
      let bSide: any = "SELL";
      if(Math.random() > 0.5) {
        aSide = "SELL";
        bSide = "BUY";
      }
      const legs: any = [
        {
          accountName: order.primaryAccount,
          positionSide: "BOTH",
          entrySide: aSide,
        },
        {
          accountName: order.hedgeAccount,
          positionSide: "BOTH",
          entrySide: bSide,
        },
      ];

      setOpeningOrderId(order.id);
      setFormError(null);

      try {
        await Promise.all(
          legs.map(async ({ accountName, positionSide, entrySide }: any) => {
            const credentials = userMap.get(accountName);
            if (!credentials) {
              throw new Error(`找不到账户 ${accountName} 的API信息，请前往配置页面设置。`);
            }

            const closingSide = entrySide === "BUY" ? "SELL" : "BUY";

            await submitFuturesOrder(credentials.apiKey, credentials.apiSecret, {
              symbol: marketSymbol,
              side: entrySide,
              type: "MARKET",
              quantity,
              positionSide,
            });

            const takeProfitPriceRaw = entrySide === "BUY"
                  ? price * ((1 + takeProfitPct / 100 / aLevel))
                  : price * (1 - takeProfitPct / 100 / aLevel)
            const stopLossPriceRaw = entrySide === "BUY"
                  ? price * (1 - stopLossPct / 100 / aLevel)
                  : price * (1 + stopLossPct / 100 / aLevel)

            const takeProfitPrice =
              takeProfitPriceRaw && takeProfitPriceRaw > 0 ? formatPriceForSymbol(order.symbol, takeProfitPriceRaw) : null;
            const stopLossPrice =
              stopLossPriceRaw && stopLossPriceRaw > 0 ? formatPriceForSymbol(order.symbol, stopLossPriceRaw) : null;

            if (takeProfitPrice) {
              await submitFuturesOrder(credentials.apiKey, credentials.apiSecret, {
                symbol: marketSymbol,
                side: closingSide,
                type: "TAKE_PROFIT_MARKET",
                stopPrice: takeProfitPrice,
                positionSide,
                closePosition: true,
                workingType: "MARK_PRICE",
              });
            }

            if (stopLossPrice) {
              await submitFuturesOrder(credentials.apiKey, credentials.apiSecret, {
                symbol: marketSymbol,
                side: closingSide,
                type: "STOP_MARKET",
                stopPrice: stopLossPrice,
                positionSide,
                closePosition: true,
                workingType: "MARK_PRICE",
              });
            }
            refreshAccount(accountName);
          }),
        );
        setOrderStatus(order.id, "open");
        updateUser(order.primaryAccount, order.amount);
        updateUser(order.hedgeAccount, order.amount);
      } catch (error) {
        const message = error instanceof Error ? error.message : "开仓失败，请稍后重试。";
        setFormError(message);
      } finally {
        setOpeningOrderId((current) => (current === order.id ? null : current));
      }
    },
    [openingOrderId, prices, setOrderStatus, userMap],
  );

  const handleClose = async (order: HedgeOrder) => {
    if (closingOrderId === order.id) {
      return;
    }

    const marketSymbol = toMarketSymbol(order.symbol);
    setClosingOrderId(order.id);
    setFormError(null);
    try {
      await Promise.all([
        closeAccountPositions(order.primaryAccount, marketSymbol),
        closeAccountPositions(order.hedgeAccount, marketSymbol),
      ]);
      setOrderStatus(order.id, "closed");
      updateUser(order.primaryAccount, order.amount);
      updateUser(order.hedgeAccount, order.amount);
    } catch {
      setFormError("平仓失败，请稍后重试。");
    } finally {
      setClosingOrderId((current) => (current === order.id ? null : current));
    }
  };
  
  const orderSections = orders.map((order) => {
    const marketSymbol = toMarketSymbol(order.symbol);
    const price = prices[order.symbol];
    const mainAccount = accountMap[order.primaryAccount];
    const hedgeAccount = accountMap[order.hedgeAccount];
    const mainPosition = mainAccount?.positions.find(p => p.symbol === marketSymbol);
    const hedgePosition = hedgeAccount?.positions.find(p => p.symbol === marketSymbol);
    const isOpen = Math.abs(mainPosition?.positionAmt || 0) > 0 && Math.abs(hedgePosition?.positionAmt || 0) > 0
    const statusLabel = isOpen ? "已开仓" : order.status === "closed" ? "已平仓" : "待开仓";
    const statusClass = isOpen
      ? "text-emerald-600"
      : order.status === "closed"
        ? "text-slate-400"
        : "text-slate-500";
    const mainLeverage = mainPosition?.leverage;
    const hedgeLeverage = hedgePosition?.leverage;
    const mainBalance = mainAccount?.availableBalance;
    const hedgeBalance = hedgeAccount?.availableBalance;
    const mainCanPosition = mainBalance && mainLeverage && price ? Number(mainBalance) * mainLeverage / price : 0;
    const hegeCanPosition = hedgeBalance && hedgeLeverage && price ? Number(hedgeBalance) * hedgeLeverage / price : 0;
    
    const renderPositionCard = (accountKey: string, position: AccountPosition | any) => {
      if (!position || Math.abs(position.positionAmt) === 0) {
        return <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">暂无仓位</div>;
      }
      const unrealized = ((price || 0) - position.entryPrice) * position.positionAmt;
      const takeProfitPrice = position.takeProfitPrice ? formatNumber(position.takeProfitPrice, 2) : '--';
      const stopLossPrice = position.stopLossPrice ? formatNumber(position.stopLossPrice, 2) : '--';
      return (
        <div
          key={`${accountKey}-${position.symbol}-${position.positionSide}`}
          className="text-sm border-t pt-2 border-gray-200"
        >
          <div className="flex justify-between">
            <span>
              仓位大小：{formatNumber(position.positionAmt, 3)}
              {position.positionAmt > 0 && <span className="ml-2 p-[2px] bg-emerald-500 text-white">多</span>}
              {position.positionAmt < 0 && <span className="ml-2 p-[2px] bg-red-500 text-white">空</span>}
            </span>
            <span className={unrealized > 0 ? "text-emerald-700 text-base" : "text-red-600 text-base"}>{formatSignedNumber(unrealized, 2)}</span>
          </div>
          <div>入场价：{formatNumber(position.entryPrice, 2)}</div>
          <div>止盈/止损价格：{takeProfitPrice} / {stopLossPrice}</div>
          <div>开仓时间：{formatDateTime(position.updateTime)}</div>
        </div>
      );
    };
    
    return (
      <div key={order.id} className="rounded-lg border border-slate-200 bg-white/80 p-4 text-left shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xl font-semibold">
              {order.symbol}/USDT
              <span className={`text-base font-normal px-3 ${statusClass}`}>{statusLabel}</span>
              <span className="text-base font-normal text-gray-700">{price ? `$${formatNumber(price, 2)}` : "--"}</span>
            </div>
            <div className="mt-1 text-sm flex space-x-4">
              <div>开仓金额：{order.amount}<span className="text-slate-500">(${price ? formatNumber(order.amount * price, 2) : ''})</span></div>
              <div>止盈比例：{order.takeProfit}%</div>
              <div>止损比例：{order.stopLoss}%</div>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              <span className="mr-4">创建时间：{formatDateTime(order.createdAt)}</span>
              最近更新：{formatDateTime(order.updatedAt)}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                refreshAccount(order.primaryAccount);
                refreshAccount(order.hedgeAccount);
              }}
              className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
            >
              刷新
            </button>
            <button
              disabled={isOpen}
              onClick={() => handleEdit(order)}
              className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100 disabled:border-slate-200 disabled:text-slate-400"
            >
              编辑
            </button>
            <button
              onClick={() => handleOpen(order, mainCanPosition, hegeCanPosition, mainLeverage, hedgeLeverage)}
              className="rounded-md border border-emerald-500 px-3 py-1 text-sm text-emerald-700 hover:bg-emerald-50 disabled:border-slate-200 disabled:text-slate-400"
              disabled={isOpen || openingOrderId === order.id || Math.abs(mainPosition?.positionAmt || 0) > 0 || Math.abs(hedgePosition?.positionAmt|| 0) > 0}
            >
              {openingOrderId === order.id ? "开仓中..." : "开仓"}
            </button>
            <button
              onClick={() => handleClose(order)}
              className="rounded-md border border-rose-500 px-3 py-1 text-sm text-rose-600 hover:bg-rose-50 disabled:border-slate-200 disabled:text-slate-400"
              disabled={!isOpen || closingOrderId === order.id || Math.abs(mainPosition?.positionAmt || 0) !== Math.abs(hedgePosition?.positionAmt|| 0)}
            >
              {closingOrderId === order.id ? "平仓中..." : "平仓"}
            </button>
            <button
              onClick={() => deleteOrder(order.id)}
              className="rounded-md border border-slate-200 px-3 py-1 text-sm text-slate-500 hover:bg-slate-100"
            >
              删除
            </button>
          </div>
        </div>
        <div className="mt-2 grid gap-4 md:grid-cols-2">
          <div className="rounded-md bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-600">主账户：{order.primaryAccount || "--"}</div>
              <div className="text-xs text-slate-500">杠杆：{mainLeverage}</div>
            </div>
             <div className="mt-1 text-xs text-slate-500 space-x-4">
              <span>可用余额：{formatNumber(mainBalance)}(可开: {mainCanPosition.toFixed(3)})</span>
              <span>交易次数: {userMap.get(order.primaryAccount)?.txs || '-'}</span>
              <span>交易量: {userMap.get(order.primaryAccount)?.vol || '-'}</span>
            </div>
            <div className="mt-1">{renderPositionCard(`${order.id}-primary`, mainPosition)}</div>
          </div>
          <div className="rounded-md bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <div className=" font-semibold">对冲账户：{order.hedgeAccount || "--"}</div>
              <div className="text-xs text-slate-500">杠杆：{hedgeLeverage}</div>
            </div>
            <div className="mt-1 text-xs text-slate-500 space-x-4">
              <span>可用余额: {formatNumber(hedgeBalance)}(可开: {hegeCanPosition.toFixed(3)})</span>
              <span>交易次数: {userMap.get(order.hedgeAccount)?.txs || '-'}</span>
              <span>交易量: {userMap.get(order.hedgeAccount)?.vol || '-'}</span>
            </div>
            <div className="mt-1">{renderPositionCard(`${order.id}-hedge`, hedgePosition)}</div>
          </div>
        </div>
      </div>
    );
  });

  return (
    <div className="relative min-h-screen pb-64">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">对冲订单管理</h1>
          <p className="text-sm text-slate-500">在此创建和管理对冲订单。账户管理请前往<Link href="/config" className="ml-2 text-blue-500 hover:underline">账户配置</Link>页面。</p>
        </div>
        <div className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600">
          已创建订单：{orders.length}
        </div>
      </header>

      <div className="space-y-4">
        {orders.length > 0 && !isEmpty(userMap) ? orderSections : (
          <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-500">
            暂无对冲订单，使用底部表单创建一个吧。
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="fixed bottom-0 left-0 right-0 border-t border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur"
      >
        <div className="mx-auto flex max-w-5xl flex-wrap items-end gap-4">
          <div className="flex flex-col">
            <label className="text-xs text-slate-500">交易对</label>
            <select
              value={formState.symbol}
              onChange={handleChange("symbol")}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {SYMBOL_OPTIONS.map((symbol) => (
                <option key={symbol} value={symbol}>
                  {symbol}/USDT
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col">
            <label className="text-xs text-slate-500">主账户</label>
            <select
              value={formState.primaryAccount}
              onChange={handleChange("primaryAccount")}
              className="min-w-[160px] rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">选择账户</option>
              {users.map((user) => (
                <option key={user.name} value={user.name}>
                  {user.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col">
            <label className="text-xs text-slate-500">对冲账户</label>
            <select
              value={formState.hedgeAccount}
              onChange={handleChange("hedgeAccount")}
              className="min-w-[160px] rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">选择账户</option>
              {users.map((user) => (
                <option key={user.name} value={user.name}>
                  {user.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col">
            <label className="text-xs text-slate-500">金额</label>
            <input
              type="number"
              step="0.0001"
              min="0"
              value={formState.amount}
              onChange={handleChange("amount")}
              className="w-32 rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="0"
            />
          </div>

          <div className="flex flex-col">
            <label className="text-xs text-slate-500">止盈比例(%)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={formState.takeProfit}
              onChange={handleChange("takeProfit")}
              className="w-32 rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="0"
            />
          </div>

          <div className="flex flex-col">
            <label className="text-xs text-slate-500">止损比例(%)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={formState.stopLoss}
              onChange={handleChange("stopLoss")}
              className="w-32 rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="0"
            />
          </div>

          <div className="ml-auto flex items-center gap-2">
            {formError && <span className="text-sm text-rose-600">{formError}</span>}
            {editingOrderId && (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-100"
              >
                取消编辑
              </button>
            )}
            <button
              type="submit"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
              disabled={users.length < 2}
            >
              {editingOrderId ? "更新订单" : "创建订单"}
            </button>
          </div>
        </div>
        {users.length < 2 && (
          <p className="mt-2 text-center text-xs text-rose-500">
            至少需要两个账户才能创建对冲订单，请先前往配置页面添加账户。
          </p>
        )}
      </form>
    </div>
  );
}
