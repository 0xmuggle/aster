"use client";

import { ChangeEvent, useCallback, useEffect, useState } from "react";

import { SYMBOL_OPTIONS, SYMBOL_PRECISION } from "@/lib/common";
import type { HedgeOrder, HedgeSymbol, User } from "@/lib/types";
import { useStore } from "@/lib/store";
import { generateGroups } from "@/lib/radomOrder";

interface OrderFormState {
  symbol: HedgeSymbol;
  primaryAccount: string;
  hedgeAccount: string;
  hedgeAccount2: string;
  amount: number;
  takeProfit: number;
  stopLoss: number;
};

interface OrderFormProps {
  noUs: any[];
  users: User[];
  editingOrder: HedgeOrder | null;
  formError: string | null;
  onSetFormError: (message: string | null) => void;
  onCancelEdit: () => void;
};

const initState:OrderFormState  = {
  symbol: "BTC",
  primaryAccount: '',
  hedgeAccount: '',
  hedgeAccount2: '',
  amount: 0,
  takeProfit: 50,
  stopLoss: 50,
}

export function OrderForm({
  noUs,
  users,
  editingOrder,
  formError,
  onSetFormError,
  onCancelEdit,
}: OrderFormProps) {
  const { updateOrder, addOrder } = useStore();
  const [formState, setFormState] = useState<OrderFormState>(initState);
  const cancelEditAndReset = () => {
    setFormState({...initState});
    onCancelEdit();
    onSetFormError(null);
  };

  useEffect(() => {
    setFormState((prev) => {
      if (!editingOrder) {
        return prev;
      }

      return {
        ...editingOrder,
        hedgeAccount2: editingOrder.hedgeAccount2 ?? "",
      };
    });
  }, [editingOrder]);

  const handleChange = <T extends keyof OrderFormState>(field: T) =>
    (event: ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
      const value = event.target.value;
      setFormState((prev) => ({
        ...prev,
        [field]: value,
      }));
    };

  const handleSubmit = (event: any) => {
    event?.preventDefault?.();
    onSetFormError(null);

    if (!formState.primaryAccount || !formState.hedgeAccount) {
      onSetFormError("请选择两个账户。");
      return;
    }

    if (formState.primaryAccount === formState.hedgeAccount) {
      onSetFormError("两个账户不能相同。");
      return;
    }

    if (formState.hedgeAccount2) {
      if (formState.hedgeAccount2 === formState.primaryAccount) {
        onSetFormError("第二对冲账户不能与主账户相同。");
        return;
      }
      if (formState.hedgeAccount2 === formState.hedgeAccount) {
        onSetFormError("两个对冲账户需不同。");
        return;
      }
    }

    const state = {
      ...formState,
      amount: Number(formState.amount),
      takeProfit: Number(formState.takeProfit),
      stopLoss: Number(formState.stopLoss),
    }
    if (!Number.isFinite(state.amount) || state.amount <= 0) {
      onSetFormError("请输入有效的下单金额。");
      return;
    }

    if (!Number.isFinite(state.takeProfit) || state.takeProfit <= 20) {
      onSetFormError("请输入有效的止盈比例 > 20%");
      return;
    }

    if (!Number.isFinite(state.stopLoss) || state.stopLoss <= 20) {
      onSetFormError("请输入有效的止损比例 > 20%");
      return;
    }

    if (editingOrder) {
      updateOrder(editingOrder.id, formState);
    } else {
      addOrder(formState);
    }

    cancelEditAndReset();
  };

  const handleCancel = () => {
    cancelEditAndReset();
  };

  const randomValue = (base: number, range: number, persion: number) => {
    const min = base * (1 - range); // 8 * 0.9 = 7.2
    const max = base * (1 + range); // 8 * 1.1 = 8.8 
    const val = Math.random() * (max - min) + min;
    const result = Number(val.toFixed(persion));
    return result;
  }

  const batchOrder = (e: any) => {
    e?.preventDefault?.();
    const groups = generateGroups(users);
    groups.forEach(((item, index) => {
      addOrder({
        ...item,
        symbol: formState.symbol,
        amount: randomValue(formState.amount, 0.2, SYMBOL_PRECISION[formState.symbol].quantity),
        takeProfit: Math.max(50, Math.min(randomValue(formState.takeProfit, 0.3, 0), 95)),
        stopLoss: Math.max(50, Math.min(randomValue(formState.stopLoss, 0.3, 0), 95)),
        num: index+ 1,
      })
    }));
  }

  const randomOrder = useCallback((e: any) => {
    e?.preventDefault?.();
    const len = noUs.length;
    if(len >= 3) {
      addOrder({
        ...formState,
        takeProfit: Math.max(50, Math.min(randomValue(80, 0.3, 0), 95)),
        stopLoss: Math.max(50, Math.min(randomValue(80, 0.3, 0), 95)),
        primaryAccount: noUs[0].name,
        hedgeAccount: noUs[len - 1].name,
        hedgeAccount2: noUs[len - 2].name,
      });
    }
  }, [noUs, formState])

  const submitLabel = editingOrder ? "更新订单" : "创建订单";

  return (
    <form
      className="fixed bottom-0 left-0 right-0 border-t border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur"
    >
      <div className="mx-auto flex flex-wrap items-end justify-center gap-4">
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
          <label className="text-xs text-slate-500">对冲账户2 (可选 30% ~ 60%)</label>
          <select
            value={formState.hedgeAccount2}
            onChange={handleChange("hedgeAccount2")}
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

        <div className="flex items-center gap-2">
          {formError && <span className="text-sm text-rose-600">{formError}</span>}
          {editingOrder && (
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-100"
            >
              取消编辑
            </button>
          )}
          <button
            type="submit"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
            disabled={users.length < 2}
            onClick={handleSubmit}
          >
            {submitLabel}
          </button>
          <button
            onClick={batchOrder}
            className="rounded-md border border-blue-600 px-4 py-2 text-blue-600 text-sm font-semibold hover:bg-blue-200 disabled:bg-slate-300"
            disabled={formState.amount <= 0 || Boolean(editingOrder)}
          >
            批量订单
          </button>
          <button
            onClick={randomOrder}
            className="rounded-md border border-blue-600 px-4 py-2 text-blue-600 text-sm font-semibold hover:bg-blue-200 disabled:bg-slate-300"
            disabled={formState.amount <= 0 || noUs.length < 3 || Boolean(editingOrder)}
          >
            随机订单
          </button>
        </div>
      </div>
      {users.length < 2 && (
        <p className="mt-2 text-center text-xs text-rose-500">
          至少需要两个账户才能创建对冲订单，请先前往配置页面添加账户。
        </p>
      )}
    </form>
  );
}

export default OrderForm;
