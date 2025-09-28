"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";

import { useStore } from "@/lib/store";
import type { AccountPosition, HedgeOrder, HedgeSymbol, User } from "@/lib/types";
import { useExtension } from "@/components/EProvider";
import { useTickers } from "@/hooks/useTickers";
import { closeFuturesPosition, submitFuturesOrder } from "@/services/api";
import {
  MARKET_SYMBOL_MAP,
  SYMBOL_OPTIONS,
  formatDateTime,
  formatNumber,
  formatPriceForSymbol,
  formatQuantityForSymbol,
  formatSignedNumber,
  formatTime,
  parseNumeric,
  resolveCloseSide,
} from "@/lib/common";
import { isEmpty } from "lodash";
import OrderForm from "@/components/OrderForm";

const toMarketSymbol = (symbol: HedgeSymbol) => MARKET_SYMBOL_MAP[symbol];

export default function Home() {
  const { users, orders, setOrderStatus, deleteOrder, updateUser } = useStore();
  const { accountMap, refreshAccount } = useExtension();

  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [closingOrderId, setClosingOrderId] = useState<string | null>(null);
  const [openingOrderId, setOpeningOrderId] = useState<string | null>(null);

  const [filterOpen, setFilterOpen] = useState(false);
  const [filterClose, setFilterClose] = useState(false);

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

  const editingOrder = useMemo(() => {
    if (!editingOrderId) {
      return null;
    }
    return orders.find((order) => order.id === editingOrderId) ?? null;
  }, [editingOrderId, orders]);


  const closeAccountPositions = useCallback(
    async (accountName: string, symbol: HedgeSymbol) => {
      const marketSymbol = toMarketSymbol(symbol);
      const credentials = userMap.get(accountName);
      if (!credentials) {
        setFormError(`找不到账户 ${accountName} 的API信息，请先在配置中完善。`);
        return;
      }

      const account = accountMap[accountName];
      if (!account) {
        return;
      }

      const position = account?.positions.find((position) => position.symbol === marketSymbol);
      if (position) {
        const side = resolveCloseSide(position);
        if (!side) {
          return null;
        }
        const amount = parseNumeric(position.positionAmt);
        if (amount === null || Math.abs(amount) < 1e-8) {
          return null;
        }
        await closeFuturesPosition(credentials.apiKey, credentials.apiSecret, {
          symbol: marketSymbol,
          side,
          quantity: Math.abs(amount).toString(),
          positionSide: position.positionSide !== "BOTH" ? position.positionSide : undefined,
        });
        refreshAccount(accountName);
        updateUser(accountName, amount * (prices[symbol] || 0));
      };
    },
    [accountMap, updateUser, userMap, refreshAccount, prices],
  );

  const handleEdit = (order: HedgeOrder) => {
    setEditingOrderId(order.id);
    setFormError(null);
  };

  const handleOpen = useCallback(
    async (order: HedgeOrder, main: any, huges: any) => {
      if (openingOrderId === order.id) {
        return;
      }
      const amount = Number(formatQuantityForSymbol(order.symbol, order.amount));
      if (amount === null || amount <= 0) {
        setFormError("开仓金额必须大于0。");
        return;
      }

      const price = prices[order.symbol];
      if (!price) {
        setFormError("无法获取当前行情价格，请稍后重试。");
        return;
      }

      if (huges.length === 0) {
        setFormError("请配置至少一个对冲账户。");
        return;
      }

      const marketSymbol = toMarketSymbol(order.symbol);
      const leverages = new Set([main.leverage, ...huges.map((item: any) => item.leverage)]);
      if (leverages.size > 1) {
        setFormError("杠杆需一致");
        return;
      }

      const hugeAmount = huges.reduce((pre: any, next: any) => pre + next.canPosition, 0);
      const canAmount = Math.min(main.canPosition, hugeAmount) * 0.9;

      if (amount > Number(canAmount)) {
        setFormError(`开仓金额必须小于${canAmount.toFixed(3)}。`);
        return;
      }

      const hugeAmounts: any = [];
      huges.forEach((item: any, index: number) => {
        let q = 0;
        if (index === 0) {
          const ratio = huges.length > 1 ? (Math.random() * (60 - 30) + 30) / 100 : 1;
          q = Number(formatQuantityForSymbol(order.symbol, amount * ratio));
          hugeAmounts.push(q);
        } else {
          q = Number(formatQuantityForSymbol(order.symbol, amount - hugeAmounts[0]));
          hugeAmounts.push(q);
        }
        if (q > (item.canPosition * 0.9)) {
          setFormError(`${item.name}开仓金额必须小于${(item.canPosition * 0.9).toFixed(3)}。`);
          return;
        }
      });
      const takeProfitPct = order.takeProfit;
      const stopLossPct = order.stopLoss;

      let primarySide: "BUY" | "SELL" = "BUY";
      let hedgeSide: "BUY" | "SELL" = "SELL";
      if (Math.random() > 0.5) {
        primarySide = "SELL";
        hedgeSide = "BUY";
      }

      const legs = [
        {
          accountName: order.primaryAccount,
          positionSide: "BOTH",
          entrySide: primarySide,
          quantity: amount,
          leverage: main.leverage,
        },
        ...huges.map((huge: any, index: number) => ({
          accountName: huge.name,
          positionSide: "BOTH",
          entrySide: hedgeSide,
          quantity: hugeAmounts[index],
          leverage: huge.leverage,
        })),
      ];
      setOpeningOrderId(order.id);
      setFormError(null);
      try {
        await Promise.all(
          legs.map(async ({ accountName, positionSide, entrySide, quantity, leverage: legLeverage = 0 }) => {
            const credentials = userMap.get(accountName);
            if (!credentials) {
              throw new Error(`找不到账户 ${accountName} 的API信息，请前往配置页面设置。`);
            }
            const closingSide = entrySide === "BUY" ? "SELL" : "BUY";
            const effectiveLeverage = legLeverage || 1;

            await submitFuturesOrder(credentials.apiKey, credentials.apiSecret, {
              symbol: marketSymbol,
              side: entrySide,
              type: "MARKET",
              quantity,
              positionSide,
            });

            const takeProfitPriceRaw =
              entrySide === "BUY"
                ? price * (1 + takeProfitPct / 100 / effectiveLeverage)
                : price * (1 - takeProfitPct / 100 / effectiveLeverage);
            const stopLossPriceRaw =
              entrySide === "BUY"
                ? price * (1 - stopLossPct / 100 / effectiveLeverage)
                : price * (1 + stopLossPct / 100 / effectiveLeverage);

            const takeProfitPrice =
              takeProfitPriceRaw && takeProfitPriceRaw > 0
                ? formatPriceForSymbol(order.symbol, takeProfitPriceRaw)
                : null;
            const stopLossPrice =
              stopLossPriceRaw && stopLossPriceRaw > 0
                ? formatPriceForSymbol(order.symbol, stopLossPriceRaw)
                : null;

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
            updateUser(accountName, quantity * price);
          }),
        );
        setOrderStatus(order.id, "open");
      } catch (error) {
        const message = error instanceof Error ? error.message : "开仓失败，请稍后重试。";
        setFormError(message);
      } finally {
        setOpeningOrderId((current) => (current === order.id ? null : current));
      }
    },
    [openingOrderId, prices, refreshAccount, setOrderStatus, updateUser, userMap],
  );

  const handleClose = async (order: HedgeOrder) => {
    if (closingOrderId === order.id) {
      return;
    }
    
    const hedgingAccounts = [order.hedgeAccount, order.hedgeAccount2 ?? undefined].filter(
      (account): account is string => Boolean(account),
    );
    setClosingOrderId(order.id);
    setFormError(null);
    try {
      await Promise.all([
        closeAccountPositions(order.primaryAccount, order.symbol),
        ...hedgingAccounts.map((accountName) => closeAccountPositions(accountName, order.symbol)),
      ]);
      setOrderStatus(order.id, "closed");
    } catch {
      setFormError("平仓失败，请稍后重试。");
    } finally {
      setClosingOrderId((current) => (current === order.id ? null : current));
    }
  };

  const us = useMemo(() => {
    const res = Object.keys(accountMap).map(name => {
      const { availableBalance, positions } = accountMap[name];
      return {
        balance: Number(availableBalance),
        isOpen: positions.filter(p => Math.abs(p.positionAmt) > 0.000001).length > 0,
        name: name,
        vol: Number(userMap.get(name)?.vol || 0),
      }
    }).sort((a, b) => b.balance - a.balance);
    return res;
  }, [accountMap, userMap]);

  const orderRes = useMemo(() => {
    const res = orders.map((order) => {
      const marketSymbol = toMarketSymbol(order.symbol);
      const price = prices[order.symbol];

      const mainAccount = accountMap[order.primaryAccount];
      const mainBalance = mainAccount?.availableBalance || 0;
      const mainPosition = mainAccount?.positions.find((position) => position.symbol === marketSymbol);
      const primaryLeverage = mainPosition?.leverage || 0;
      const primaryAmt = parseNumeric(mainPosition?.positionAmt) || 0;
      const mainCanPosition = mainBalance && primaryLeverage && price ? (Number(mainBalance) * Number(primaryLeverage)) / price : 0;

      const main = {
        account: mainAccount,
        name: order.primaryAccount,
        balance: mainBalance,
        leverage: primaryLeverage,
        canPosition: mainCanPosition,
        position: mainPosition,
        user: userMap.get(order.primaryAccount),
      }

      const hedges = [order.hedgeAccount, order.hedgeAccount2]
        .filter(name => Boolean(name))
        .map((name: any) => {
          const account = accountMap[name];
          const balance = account?.availableBalance;
          const position = account?.positions.find((position) => position.symbol === marketSymbol);
          const leverage = position?.leverage;
          const amt = parseNumeric(position?.positionAmt) || 0;
          const canPosition = balance && leverage && price ? (Number(balance) * Number(leverage)) / price : 0;
          return {
            account,
            name,
            balance,
            position,
            leverage,
            canPosition,
            amt,
            ratio: Math.abs(amt) / Math.abs(primaryAmt || 1),
            user: userMap.get(name),
          }
        });
      let isOpen = false;
      if (Math.abs(primaryAmt) > 0) {
        if (hedges.length === 2 && hedges[0].amt * hedges[1].amt > 0 && Number((primaryAmt + hedges[0].amt + hedges[1].amt).toFixed(3)) === 0) {
          if (
            hedges[0].position?.updateTime &&
            main.position?.updateTime &&
            hedges[1].position?.updateTime &&
            Math.abs(new Date(hedges[0].position?.updateTime).getTime() - new Date(main.position?.updateTime).getTime()) <= 2000 &&
            Math.abs(new Date(hedges[1].position?.updateTime).getTime() - new Date(main.position?.updateTime).getTime()) <= 2000
          ) {
            isOpen = true;
          }
        } else if (hedges.length === 1 && hedges[0].amt + primaryAmt === 0) {
          if (
            hedges[0].position?.updateTime &&
            main.position?.updateTime &&
            Math.abs(new Date(hedges[0].position?.updateTime).getTime() - new Date(main.position?.updateTime).getTime()) <= 2000
          ) {
            isOpen = true;
          }
        }
      }
      const anyOpen = primaryAmt !== 0 || hedges.some((hedge) => Math.abs(hedge.amt) > 0);
      return {
        order,
        main,
        hedges,
        anyOpen,
        isOpen,
        price,
      }
    })
    return res.filter(item => filterClose && item.isOpen || filterOpen && !item.anyOpen || !filterOpen && !filterClose)
  }, [orders, accountMap, userMap, prices, filterClose, filterOpen]);

  const delFilished = useCallback(() => {
    orderRes.forEach(item => {
      if(!item.anyOpen && item.order.createdAt !== item.order.updatedAt) {
        deleteOrder(item.order.id);
      }
    })
  }, [orderRes]);

  const renderPositionCard = (accountKey: string, price: number, position?: AccountPosition) => {
    const positionAmt = parseNumeric(position?.positionAmt) ?? 0;

    if (!position || Math.abs(positionAmt) === 0) {
      return (
        <div key={`${accountKey}-empty`} className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">
          暂无仓位
        </div>
      );
    }

    const entryPrice = parseNumeric(position.entryPrice) ?? 0;
    const unrealized = price ? (price - entryPrice) * positionAmt : 0;
    const takeProfitPrice = position.takeProfitPrice ? formatNumber(position.takeProfitPrice, 2) : "--";
    const stopLossPrice = position.stopLossPrice ? formatNumber(position.stopLossPrice, 2) : "--";

    const diff = (new Date().getTime() - new Date(position.updateTime || Date.now()).getTime()) / 1000 / 60;
    return (
      <div key={`${accountKey}-${position.symbol}-${position.positionSide}`} className="border-t border-gray-200 text-xs">
        <div className="flex justify-between">
          <span>
            仓位大小：<span className="text-xl">{formatNumber(positionAmt, 3)}</span>
            {positionAmt > 0 && <span className="ml-2 bg-emerald-500 p-[2px] text-white">多</span>}
            {positionAmt < 0 && <span className="ml-2 bg-red-500 p-[2px] text-white">空</span>}
          </span>
          <span className={unrealized > 0 ? "text-xl text-emerald-700" : "text-xl text-red-600"}>
            {formatSignedNumber(unrealized, 2)}
          </span>
        </div>
        <div>入场价：{formatNumber(entryPrice, 2)}</div>
        <div>止盈/止损价格：{takeProfitPrice} / {stopLossPrice}</div>
        <div className="flex justify-between items-center">
          <span>开仓时间: {formatDateTime(position.updateTime)}</span>
          <span className={diff > 120 ? "text-blue-500 text-sm font-bold" : ""}>{formatTime(diff)}</span>
        </div>
      </div>
    );
  };

  const total = useMemo(() => {
    const totalBalance = Object.keys(accountMap).reduce((pre, next) => pre + Number(accountMap[next]?.totalWalletBalance || 0), 0);
    const totalVol = users.reduce((pre, next) => pre + (next.vol || 0), 0);
    return {
      totalBalance: Number(totalBalance.toFixed(1)).toLocaleString(),
      totalVol: Number(totalVol.toFixed(1)).toLocaleString(),
    }
  }, [accountMap, users]);

  return (
    <div className="relative min-h-screen pb-64">
      <header className="mb-2 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">对冲订单管理</h1>
          <p className="text-sm text-slate-500">在此创建和管理对冲订单。账户管理请前往<Link href="/config" className="mx-2 text-blue-500 hover:underline">账户配置</Link>页面。(<span className="text-purple-500">总金额: ${total.totalBalance} 总交易量: ${total.totalVol})</span></p>
        </div>
        <div className="flex gap-2">
          <div className="flex items-center">
            <input checked={filterOpen} onChange={e => setFilterOpen(e.target.checked)} name="checkbox" type="checkbox" />
            <label id="checkbox">只显示<span className="text-green-600">可开仓</span></label>
          </div>
          <div className="flex items-center">
            <input checked={filterClose} onChange={e => setFilterClose(e.target.checked)} name="checkbox" type="checkbox" />
            <label id="checkbox">只显示<span className="text-red-600">可平仓</span></label>
          </div>
          <button onClick={delFilished} className="rounded-md border border-red-500 px-3 hover:text-white py-1 text-sm hover:bg-red-600">删除已完成</button>
          <div className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600">
          已创建订单：{orders.length}
          </div>
        </div>
      </header>
      <section className="flex flex-wrap gap-2 text-center pb-4 text-sm">
        {
          us.map((user) => (
            <div className={`shadow-sm py-2 ${user.isOpen ? 'bg-green-100/70 shadow' : 'bg-slate-100'}`} key={user.name}>
              <div className={`px-2 font-bold text-base ${user.vol > 10000 ? 'text-green-500' : ''} ${user.vol > 50000 ? 'text-orange-500' : ''} ${user.vol > 100000 ? 'text-purple-500' : ''} ${user.vol > 150000 ? 'text-blue-500' : ''} ${user.vol > 200000 ? 'text-red-500' : ''}`}>
                {user.name}
              </div>
              <div className="px-2 text-xs space-x-3 mt-1">
                <div>
                  余额: {Number(user.balance).toFixed(1)} {' '}
                </div>
                <div> 交易量: ${Math.floor(user.vol).toLocaleString()}</div>
              </div>
            </div>
          ))
        }
      </section>
      <div className="space-y-4">
        {orders.length > 0 && !isEmpty(userMap) ? <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4">
          {
            orderRes.map(({ order, isOpen, main, hedges, price, anyOpen }: any) => (
              <div key={order.id} className={`rounded-lg relative border border-slate-200 bg-white/80 p-4 text-left ${isOpen ? "shadow-md shadow-blue-400/50" : ""}`}>
                {order.num && <div className="absolute right-0 top-0 bg-blue-100 p-2 rounded-bl-lg">{order.num}</div>}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xl font-semibold">
                      {order.symbol}/USDT
                      <span className={`px-3 text-base font-normal ${isOpen ? "text-emerald-600" : "text-slate-500"}`}>{isOpen ? "已开仓" : "待开仓"}</span>
                      <span className="text-base font-normal text-gray-700">{price ? `$${formatNumber(price, 2)}` : "--"}</span>
                    </div>
                    <div className="mt-1 flex space-x-4 text-sm">
                      <div>
                        开仓金额：{order.amount}
                        <span className="text-slate-500">{price ? ` ($${formatNumber(order.amount * price, 2)})` : ""}</span>
                      </div>
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
                        hedges.forEach((hedge: any) => refreshAccount(hedge.name));
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
                      onClick={() => handleOpen(order, main, hedges)}
                      className="rounded-md border border-emerald-500 bg-emerald-500 text-white px-3 py-1 text-sm text-emerald-600 hover:bg-emerald-600 disabled:border-slate-200 disabled:bg-white disabled:text-slate-400"
                      disabled={isOpen || openingOrderId === order.id || anyOpen}
                    >
                      {openingOrderId === order.id ? "开仓中..." : "开仓"}
                    </button>
                    <button
                      onClick={() => handleClose(order)}
                      className="rounded-md border border-rose-500 bg-rose-500 text-white px-3 py-1 text-sm text-rose-600 hover:bg-rose-600 disabled:border-slate-200 disabled:bg-white disabled:text-slate-400"
                      disabled={!isOpen || closingOrderId === order.id}
                    >
                      {closingOrderId === order.id ? "平仓中..." : "平仓"}
                    </button>
                    {
                      !isOpen && (
                        <button
                          onClick={() => deleteOrder(order.id)}
                          className="rounded-md border border-slate-200 px-3 py-1 text-sm text-slate-500 hover:bg-slate-100"
                        >
                          删除
                        </button>
                      )
                    }
                  </div>
                </div>
                <div className="mt-2 space-y-2">
                  <div className="rounded-md bg-slate-100 p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold">主账户：{order.primaryAccount || "--"}</div>
                      <div className="text-xs text-slate-500">杠杆：{main.leverage ?? "--"}X</div>
                    </div>
                    <div className="mt-1 space-x-4 text-xs text-slate-500">
                      <span>
                        可用余额：{formatNumber(main.balance)} (可开: {main.canPosition.toFixed(3)})
                      </span>
                      <span>次数: {main.user?.txs ?? "-"}</span>
                      <span>Vol: ${(main.user?.vol)?.toFixed(2) ?? "-"}</span>
                    </div>
                    <div className="mt-1">{renderPositionCard(`${order.id}-primary`, price, main.position)}</div>
                  </div>
                  {hedges.map((detail: any, index: number) => (
                    <div key={`${order.id}-hedge-${detail.name}`} className="rounded-md bg-slate-100 px-3 py-1">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold">
                          对冲账户{hedges.length > 1 ? index + 1 : ""}：{detail.name || "--"}
                        </div>
                        <div className="text-xs text-slate-500">杠杆：{detail.leverage ?? "--"}X</div>
                      </div>
                      <div className="mt-1 space-x-2 text-xs text-slate-500">
                        <span>
                          可用余额: {formatNumber(detail.balance)} (可开: {detail.canPosition.toFixed(3)})
                        </span>
                        <span>占比: {formatNumber((detail.ratio ?? 0) * 100, 1)}%</span>
                        <span>次数: {detail.user?.txs ?? "-"}</span>
                        <span>Vol: ${detail.user?.vol.toFixed(2) ?? "-"}</span>
                      </div>
                      <div className="mt-1">{renderPositionCard(`${order.id}-hedge-${index}`, price, detail.position)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          }
        </div> : (
          <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-500">
            暂无对冲订单，使用底部表单创建一个吧。
          </div>
        )}
      </div>

      <OrderForm
        users={users}
        editingOrder={editingOrder}
        formError={formError}
        onSetFormError={setFormError}
        noUs={us.filter(item => !item.isOpen)}
        onCancelEdit={() => setEditingOrderId(null)}
      />
    </div>
  );
}
