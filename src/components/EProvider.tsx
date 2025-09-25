'use client';

import { useStore } from '@/lib/store';
import { fetchAccountBalance, fetchOpenOrders } from '@/services/api';
import type {
  AccountAsset,
  AccountBalanceInfo,
  AccountLiveState,
  AccountPosition,
  FuturesOpenOrder,
  PositionSide,
} from '@/lib/types';
import { useCallback, useEffect, useMemo, useRef, useState, createContext, useContext } from 'react';

type AccountMap = Record<string, AccountLiveState>;

interface EContextType {
  accountMap: AccountMap;
  balanceMap: AccountMap;
  refreshAccountInfo: void;
}

interface UserCredentials {
  name: string;
  apiKey: string;
  apiSecret: string;
}

interface PollControl {
  timer: ReturnType<typeof setInterval> | null;
  apiKey: string;
  apiSecret: string;
}

const ACCOUNT_POLL_INTERVAL = 300 * 1000; // 15 seconds

interface RawAccountAsset extends Partial<AccountAsset> {
  asset?: string;
  a?: string;
  wb?: string;
  cw?: string;
  up?: string;
  bc?: string;
}

interface RawAccountPosition extends Partial<AccountPosition> {
  symbol?: string;
  s?: string;
  positionAmt?: string;
  pa?: string;
  entryPrice?: string;
  ep?: string;
  markPrice?: string;
  mp?: string;
  unRealizedProfit?: string;
  up?: string;
  isolatedMargin?: string;
  iw?: string;
  positionSide?: PositionSide;
  ps?: PositionSide;
  cumulativeRealized?: string;
  cr?: string;
}

const EContext = createContext<EContextType | null>(null);

const createDefaultAccountState = (): AccountLiveState => ({
  assets: [],
  positions: [],
  orders: {},
});

const normalizeAsset = (asset: RawAccountAsset): AccountAsset => {
  const name = asset.asset ?? asset.a ?? '';
  return {
    asset: name.toUpperCase(),
    walletBalance: asset.walletBalance ?? asset.wb,
    crossWalletBalance: asset.crossWalletBalance ?? asset.cw,
    availableBalance: asset.availableBalance,
    marginBalance: asset.marginBalance,
    maxWithdrawAmount: asset.maxWithdrawAmount,
    unrealizedProfit: asset.unrealizedProfit ?? asset.up,
    balanceChange: asset.balanceChange ?? asset.bc,
  };
};

const normalizePosition = (position: RawAccountPosition): AccountPosition | null => {
  const symbol = (position.symbol ?? position.s ?? '').toUpperCase();
  if (!symbol) {
    return null;
  }

  const side = position.positionSide ?? position.ps ?? 'BOTH';

  return {
    symbol,
    positionAmt: position.positionAmt ?? position.pa ?? '0',
    positionSide: side,
    entryPrice: position.entryPrice ?? position.ep,
    ep: position.ep ?? position.entryPrice,
    markPrice: position.markPrice ?? position.mp,
    mp: position.mp ?? position.markPrice,
    unRealizedProfit: position.unRealizedProfit ?? position.up,
    up: position.up ?? position.unRealizedProfit,
    liquidationPrice: position.liquidationPrice,
    leverage: position.leverage,
    maxNotionalValue: position.maxNotionalValue,
    marginType: position.marginType,
    isolatedMargin: position.isolatedMargin ?? position.iw,
    iw: position.iw ?? position.isolatedMargin,
    isAutoAddMargin: position.isAutoAddMargin,
    notional: position.notional,
    isolatedWallet: position.isolatedWallet,
    updateTime: position.updateTime,
    breakEvenPrice: position.breakEvenPrice,
    cumulativeRealized: position.cumulativeRealized ?? position.cr,
    cr: position.cr ?? position.cumulativeRealized,
  };
};

const deriveProtectionPrices = (positions: AccountPosition[], openOrders: FuturesOpenOrder[]): AccountPosition[] => {
  if (positions.length === 0 || openOrders.length === 0) {
    return positions;
  }

  const map = new Map<string, FuturesOpenOrder[]>();

  const pushOrder = (key: string, order: FuturesOpenOrder) => {
    const list = map.get(key);
    if (list) {
      list.push(order);
    } else {
      map.set(key, [order]);
    }
  };

  openOrders.forEach((order) => {
    if (!order.symbol) {
      return;
    }
    const symbol = order.symbol.toUpperCase();
    const sideKey = order.positionSide ?? 'BOTH';
    pushOrder(`${symbol}_${sideKey}`, order);
    if (sideKey !== 'BOTH') {
      pushOrder(`${symbol}_BOTH`, order);
    }
  });

  const resolvePrice = (order: FuturesOpenOrder) => {
    if (order.stopPrice && order.stopPrice !== '0') {
      return order.stopPrice;
    }
    if (order.price && order.price !== '0') {
      return order.price;
    }
    return undefined;
  };

  return positions.map((position) => {
    const key = `${position.symbol}_${position.positionSide ?? 'BOTH'}`;
    const candidates = map.get(key) ?? [];

    let takeProfitPrice: string | undefined;
    let stopLossPrice: string | undefined;

    candidates.forEach((order) => {
      const orderType = (order.type ?? order.origType ?? '').toUpperCase();
      const price = resolvePrice(order);
      if (!price) {
        return;
      }
      if (!takeProfitPrice && orderType.includes('TAKE_PROFIT')) {
        takeProfitPrice = price;
        return;
      }
      if (!stopLossPrice && orderType.includes('STOP')) {
        stopLossPrice = price;
      }
    });

    if (takeProfitPrice === position.takeProfitPrice && stopLossPrice === position.stopLossPrice) {
      return position;
    }

    return {
      ...position,
      takeProfitPrice: takeProfitPrice ?? position.takeProfitPrice,
      stopLossPrice: stopLossPrice ?? position.stopLossPrice,
    };
  });
};

const EContextProvider = EContext.Provider;

export function EProvider({ children }: { children: React.ReactNode }) {
  const { users } = useStore();

  const [accountMap, setAccountMap] = useState<AccountMap>({});
  const pollControls = useRef<Record<string, PollControl>>({});

  const updateAccountState = useCallback((name: string, updater: (prev: AccountLiveState) => AccountLiveState) => {
    setAccountMap((prev) => {
      const previous = prev[name] ?? createDefaultAccountState();
      const next = updater(previous);
      if (next === previous) {
        return prev;
      }
      return {
        ...prev,
        [name]: next,
      };
    });
  }, []);

  const refreshAccountInfo = useCallback(
    async (name: string, apiKey: string, apiSecret: string) => {
      const info = await fetchAccountBalance(apiKey, apiSecret);
      if (!info) {
        return;
      }

      const assets = (info.assets ?? [])
        .map((asset) => normalizeAsset(asset))
        .filter((asset) => Boolean(asset.asset));

      let positions = (info.positions ?? [])
        .map((position) => normalizePosition(position))
        .filter((position: AccountPosition | null): position is AccountPosition => position !== null && Number(position.positionAmt) !== 0);
      if (positions.length > 0) {
        const symbols = Array.from(new Set(positions.map((position) => position.symbol))).filter(Boolean);
        if (symbols.length > 0) {
          const ordersBatches = await Promise.all(symbols.map((symbol) => fetchOpenOrders(apiKey, apiSecret, symbol)));
          const openOrders = ordersBatches.flat();
          positions = deriveProtectionPrices(positions, openOrders);
        }
      }

      const normalizedInfo: AccountBalanceInfo = {
        ...info,
        assets,
        positions,
      };

      updateAccountState(name, (prev) => ({
        ...prev,
        info: normalizedInfo,
        assets,
        positions,
        lastAccountUpdate: Date.now(),
      }));
    },
    [updateAccountState],
  );

  const ensurePolling = useCallback(
    async (user: UserCredentials) => {
      const existing = pollControls.current[user.name];

      if (existing) {
        existing.apiKey = user.apiKey;
        existing.apiSecret = user.apiSecret;
      } else {
        pollControls.current[user.name] = {
          timer: null,
          apiKey: user.apiKey,
          apiSecret: user.apiSecret,
        };
      }

      const control = pollControls.current[user.name];
      if (!control) {
        return;
      }

      await refreshAccountInfo(user.name, control.apiKey, control.apiSecret);

      if (!control.timer) {
        control.timer = setInterval(() => {
          const latest = pollControls.current[user.name];
          if (!latest) {
            return;
          }
          void refreshAccountInfo(user.name, latest.apiKey, latest.apiSecret);
        }, ACCOUNT_POLL_INTERVAL);
      }
    },
    [refreshAccountInfo],
  );

  const cleanupUser = useCallback(
    (name: string) => {
      const control = pollControls.current[name];
      if (control?.timer) {
        clearInterval(control.timer);
      }
      delete pollControls.current[name];
    },
    [],
  );

  useEffect(() => {
    const activeNames = new Set(users.map((user) => user.name));

    Object.keys(pollControls.current).forEach((name) => {
      if (!activeNames.has(name)) {
        cleanupUser(name);
        setAccountMap((prev) => {
          const next = { ...prev };
          delete next[name];
          return next;
        });
      }
    });

    if (users.length === 0) {
      setAccountMap({});
      return;
    }

    users.forEach((user) => {
      ensurePolling(user);
    });

    const cleanupTargets = Object.keys(pollControls.current);

    return () => {
      cleanupTargets.forEach((name) => {
        cleanupUser(name);
      });
    };
  }, [cleanupUser, ensurePolling, users]);

  const contextValue = useMemo<EContextType>(() => ({
    accountMap,
    balanceMap: accountMap,
    refreshAccountInfo,
  }), [accountMap]);

  return <EContextProvider value={contextValue}>{children}</EContextProvider>;
}

export const useExtension = () => {
  const context = useContext(EContext);
  if (!context) {
    throw new Error('useExtension must be used within an ExtensionProvider');
  }
  return context;
};
