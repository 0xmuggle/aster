'use client';

import { useStore } from '@/lib/store';
import { fetchAccountBalance, fetchOpenOrders } from '@/services/api';
import type { AccountLiveState } from '@/lib/types';
import { useCallback, useEffect, useMemo, useState, createContext, useContext, useRef } from 'react';
import { SYMBOL_OPTIONS } from '@/lib/common';

type AccountMap = Record<string, AccountLiveState>;

interface EContextType {
  accountMap: AccountMap;
  refreshAccount: (name: string) => Promise<void>;
}

const EContext = createContext<EContextType | null>(null);

const EContextProvider = EContext.Provider;

export function EProvider({ children }: { children: React.ReactNode }) {
  const { users } = useStore();
  const [accountMap, setAccountMap] = useState<AccountMap>({});
  const timer = useRef<any>(null);

  const refreshAccountInfo = useCallback(
    async (name: string, apiKey: string, apiSecret: string) => {
      const info = await fetchAccountBalance(apiKey, apiSecret);
      if (!info) {
        return;
      }

      let positions = info.positions.filter((position: any) => SYMBOL_OPTIONS.includes(position.symbol.replace('USDT', '')));
      if (positions.length > 0) {
        const symbols = positions.filter((position: any) => Number(position.positionAmt) !== 0).map((position: any) => position.symbol);
        const ordersBatches = await Promise.all(positions.filter((position: any) => Number(position.positionAmt) !== 0).map((position: any) => fetchOpenOrders(apiKey, apiSecret, position.symbol)));
        symbols.forEach((symbol: string, index: number) => {
          let takeProfitPrice: any = 0;
          let stopLossPrice: any = 0;
          ordersBatches[index].forEach((order: any) => {
            if(!takeProfitPrice && order?.type.includes('TAKE_PROFIT')) {
              takeProfitPrice = order.stopPrice;
            } else if(!stopLossPrice && order?.type.includes('STOP')) {
              stopLossPrice = order.stopPrice;
            }
          });
          positions = positions.map((position: any) => {
            if(position.symbol === symbol) {
              return {
                ...position,
                takeProfitPrice,
                stopLossPrice
              }
            }
            return position;
          });
        })
      }
      delete info.assets;
      setAccountMap((prev) => ({
        ...prev,
        [name]: {
           ...info,
          positions,
          lastAccountUpdate: Date.now(),
        }
      }));
    },
    [setAccountMap],
  );

  const refreshAccount = useCallback(async (name?: string) => {
    users.filter(user => user.name === name || !name).forEach(user => {
      refreshAccountInfo(user.name, user.apiKey, user.apiSecret)
    });
  }, [users]);


  useEffect(() => {
    if (users.length === 0) {
      return;
    }
    refreshAccount();
    if(!timer.current) {
      timer.current = setInterval(() => {
        refreshAccount();
      }, 180_000);
    }
    
    return () => {
      if(timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    }
  }, [users]);

  const contextValue = useMemo<EContextType>(() => ({
    accountMap,
    refreshAccount,
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
