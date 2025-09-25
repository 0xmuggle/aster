'use client';

import { useEffect, useMemo, useRef, useState } from "react";
import type { HedgeSymbol } from "@/lib/types";

const SYMBOL_STREAM_MAP: Record<HedgeSymbol, string> = {
  BTC: "btcusdt@ticker",
  ETH: "ethusdt@ticker",
  SOL: "solusdt@ticker",
};

interface RawTickerPayload {
  stream?: string;
  data?: {
    c?: string;
    p?: string;
    [key: string]: unknown;
  };
  op?: string;
  event?: string;
  e?: string;
  type?: string;
  method?: string;
  ping?: string | number;
  [key: string]: unknown;
}

type PriceMap = Partial<Record<HedgeSymbol, number>>;

interface UseTickersResult {
  prices: PriceMap;
}

/**
 * Subscribe to Aster futures ticker websocket streams for the provided symbols.
 */
export function useTickers(symbols: HedgeSymbol[]): UseTickersResult {
  const [prices, setPrices] = useState<PriceMap>({});
  const streamsKey = useMemo(() => {
    const uniqueSymbols = Array.from(new Set(symbols));
    return uniqueSymbols
      .map((symbol) => SYMBOL_STREAM_MAP[symbol])
      .filter(Boolean)
      .join("/");
  }, [symbols]);

  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!streamsKey) {
      return;
    }

    const wsUrl = `wss://fstream.asterdex.com/stream?streams=${streamsKey}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    const sendPong = (source?: unknown) => {
      if (ws.readyState !== WebSocket.OPEN || source === undefined || source === null) {
        return;
      }

      const sendJson = (payload: Record<string, unknown>) => {
        try {
          ws.send(JSON.stringify(payload));
        } catch {
          // ignore send failures
        }
      };

      if (source && typeof source === "object") {
        const record = source as Record<string, unknown>;
        if ("ping" in record) {
          sendJson({ pong: record.ping });
          return;
        }
        if ("id" in record) {
          sendJson({ pong: record.id });
          return;
        }
      }

      if (typeof source === "number") {
        sendJson({ pong: source });
        return;
      }

      if (typeof source === "string") {
        if (/^\d+(\.\d+)?$/.test(source)) {
          sendJson({ pong: Number(source) });
        } else {
          sendJson({ pong: Date.now() });
        }
        return;
      }

      sendJson({ pong: Date.now() });
    };

    ws.onopen = () => {
      // rely on browser-managed websocket pong frames; only respond to explicit ping payloads.
    };

    const processText = (text: string) => {
      if (text.toLowerCase() === "ping") {
        sendPong(text);
        return;
      }

      try {
        const payload = JSON.parse(text) as RawTickerPayload;
        const maybePing = String(
          payload?.op ?? payload?.event ?? payload?.type ?? payload?.method ?? payload?.e ?? "",
        ).toLowerCase();
        if (maybePing === "ping" || Object.prototype.hasOwnProperty.call(payload ?? {}, "ping")) {
          sendPong(payload);
          return;
        }

        const stream = typeof payload.stream === "string" ? payload.stream : undefined;
        const priceStringCandidate = payload.data?.c ?? payload.data?.p;
        const priceString = typeof priceStringCandidate === "string" ? priceStringCandidate : undefined;
        if (!stream || !priceString) {
          return;
        }
        const matchedSymbol = (Object.entries(SYMBOL_STREAM_MAP) as Array<[HedgeSymbol, string]>).find(
          ([, value]) => value === stream,
        )?.[0];

        if (!matchedSymbol) {
          return;
        }

        const price = Number(priceString);
        if (Number.isFinite(price)) {
          setPrices((prev) => ({
            ...prev,
            [matchedSymbol]: price,
          }));
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onmessage = (event) => {
      const { data } = event;

      if (typeof data === "string") {
        processText(data);
        return;
      }

      if (data instanceof Blob) {
        data
          .text()
          .then(processText)
          .catch(() => {
            // ignore blob parse errors
          });
        return;
      }

      if (data instanceof ArrayBuffer) {
        try {
          const text = new TextDecoder().decode(data);
          processText(text);
        } catch {
          // ignore decode failures
        }
      }
    };

    ws.onerror = () => {
      ws.close();
    };

    ws.onclose = () => {
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [streamsKey]);

  return { prices };
}
