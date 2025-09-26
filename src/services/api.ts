// src/services/api.ts
import crypto from "crypto";
import type { AccountBalanceInfo, FuturesOpenOrder, PositionSide } from "@/lib/types";

/**
 * Creates an HMAC-SHA256 signature for the API request.
 * @param queryString - The query string to sign.
 * @param apiSecret - The user's API secret.
 * @returns The hex-encoded signature.
 */

function createSignature(queryString: string, apiSecret: string) {
  const hmac = crypto.createHmac('sha256', apiSecret);
  hmac.update(queryString);
  return hmac.digest('hex');
}

const API_BASE_URL = "https://fapi.asterdex.com";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

type ParamValue = string | number | boolean | null | undefined;

type FuturesOrderSide = "BUY" | "SELL";

type FuturesOrderType =
  | "MARKET"
  | "LIMIT"
  | "STOP"
  | "STOP_MARKET"
  | "TAKE_PROFIT"
  | "TAKE_PROFIT_MARKET"
  | "TRAILING_STOP_MARKET";

interface FuturesOrderParams {
  symbol: string;
  side: FuturesOrderSide;
  type: FuturesOrderType;
  quantity?: string;
  positionSide?: PositionSide;
  reduceOnly?: boolean;
  timeInForce?: string;
  price?: string;
  stopPrice?: string;
  workingType?: string;
  closePosition?: boolean;
  priceProtect?: boolean;
  callbackRate?: string;
  activationPrice?: string;
  newClientOrderId?: string;
  [key: string]: ParamValue;
}

interface ApiFetchOptions {
  path: string;
  method?: HttpMethod;
  apiKey?: string;
  apiSecret?: string;
  params?: Record<string, ParamValue>;
  headers?: HeadersInit;
  body?: BodyInit | null;
  requireSignature?: boolean;
}

/**
 * Minimal fetch wrapper that handles signing and shared headers for Asterdex endpoints.
 */
async function apiFetch({
  path,
  method = "GET",
  apiKey,
  apiSecret,
  params,
  headers,
  body,
  requireSignature = false,
}: ApiFetchOptions) {
  const searchParams = new URLSearchParams();

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null) {
        return;
      }
      searchParams.set(key, typeof value === "boolean" ? (value ? "true" : "false") : String(value));
    });
  }

  if (requireSignature) {
    if (!apiKey || !apiSecret) {
      throw new Error("Signed requests require both apiKey and apiSecret");
    }
    if (!searchParams.has("timestamp")) {
      searchParams.set("timestamp", Date.now().toString());
    }
  }

  let url = `${API_BASE_URL}${path}`;
  const queryString = searchParams.toString();

  if (requireSignature && apiSecret) {
    const signature = createSignature(queryString, apiSecret);
    url = `${url}?${queryString}&signature=${signature}`;
  } else if (queryString) {
    url = `${url}?${queryString}`;
  }

  const requestHeaders = new Headers(headers);
  if (apiKey) {
    requestHeaders.set("X-MBX-APIKEY", apiKey);
  }

  return fetch(url, {
    method,
    headers: requestHeaders,
    body,
  });
}

export type FuturesOrderResponse = Record<string, unknown>;

export async function submitFuturesOrder(
  apiKey: string,
  apiSecret: string,
  order: FuturesOrderParams,
): Promise<FuturesOrderResponse> {
  const response = await apiFetch({
    path: "/fapi/v1/order",
    method: "POST",
    apiKey,
    apiSecret,
    params: order,
    requireSignature: true,
  });

  if (!response.ok) {
    const errorData = (await response.json().catch(() => null)) as { msg?: string } | null;
    const message = errorData?.msg || "Failed to submit futures order";
    throw new Error(message);
  }

  return response.json() as Promise<FuturesOrderResponse>;
}

/**
 * Fetches the account balance from the Asterdex API.
 * @param apiKey - The user's API key.
 * @param apiSecret - The user's API secret.
 * @returns A promise that resolves to an array of balance information.
 */
export async function fetchAccountBalance(apiKey: string, apiSecret: string): Promise<AccountBalanceInfo | null> {
  try {
    const response = await apiFetch({
      path: "/fapi/v4/account",
      apiKey,
      apiSecret,
      requireSignature: true,
    });

    if (!response.ok) {
      // Try to parse the error message from the API, otherwise throw a generic error
      const errorData = await response.json().catch(() => ({ msg: "Unknown API error" }));
      throw new Error(errorData.msg || "Failed to fetch balance");
    }

    return response.json();
  } catch {
    return null;
  }
}

const normalizePositionSide = (value?: string): PositionSide | undefined => {
  if (!value) {
    return undefined;
  }
  const normalized = value.toUpperCase();
  if (normalized === 'LONG' || normalized === 'SHORT' || normalized === 'BOTH') {
    return normalized;
  }
  return undefined;
};

export async function fetchOpenOrders(apiKey: string, apiSecret: string, symbol: string): Promise<FuturesOpenOrder[]> {
  const uppercaseSymbol = symbol.toUpperCase();

  try {
    const response = await apiFetch({
      path: "/fapi/v1/openOrders",
      method: "GET",
      apiKey,
      apiSecret,
      params: {
        symbol: uppercaseSymbol,
      },
      requireSignature: true,
    });

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as Array<Record<string, unknown>>;
    return payload
      .map((item) => ({
        symbol: String(item.symbol ?? item.s ?? '').toUpperCase(),
        clientOrderId: String(item.clientOrderId ?? item.c ?? ''),
        orderId: Number(item.orderId ?? item.i ?? 0),
        positionSide: normalizePositionSide(String(item.positionSide ?? item.ps ?? '')),
        type: String(item.type ?? item.o ?? ''),
        origType: item.origType ? String(item.origType) : undefined,
        price: item.price ? String(item.price) : undefined,
        stopPrice: item.stopPrice ? String(item.stopPrice) : undefined,
        workingType: item.workingType ? String(item.workingType) : undefined,
        status: item.status ? String(item.status) : undefined,
        side: item.side ? (String(item.side).toUpperCase() as 'BUY' | 'SELL') : undefined,
      }))
      .filter((order) => order.symbol && order.clientOrderId);
  } catch {
    return [];
  }
}

interface ClosePositionRequest {
  symbol: string;
  side: "BUY" | "SELL";
  quantity: string;
  positionSide?: PositionSide;
}

export async function closeFuturesPosition(
  apiKey: string,
  apiSecret: string,
  params: ClosePositionRequest,
): Promise<boolean> {
  try {
    await submitFuturesOrder(apiKey, apiSecret, {
      symbol: params.symbol.toUpperCase(),
      side: params.side,
      type: "MARKET",
      reduceOnly: true,
      quantity: params.quantity,
      positionSide:
        params.positionSide && params.positionSide !== "BOTH" ? params.positionSide : undefined,
    });
    await apiFetch({
      path: "/fapi/v1/allOpenOrders",
      method: "DELETE",
      apiKey,
      apiSecret,
      params: {
        symbol: params.symbol.toUpperCase(),
      },
      requireSignature: true,
    }); 

    return true;
  } catch {
    return false;
  }
}
interface ListenKeyResponse {
  listenKey: string;
}

const USER_STREAM_PATH = "/fapi/v1/listenKey";

async function handleListenKeyRequest(
  method: "POST" | "PUT" | "DELETE",
  apiKey: string,
  body?: URLSearchParams,
) {
  const response = await apiFetch({
    path: USER_STREAM_PATH,
    method,
    apiKey,
    body,
  });

  if (!response.ok) {
    throw new Error(`Failed to ${method} listenKey`);
  }

  return response;
}

export async function createListenKey(apiKey: string): Promise<string | null> {
  try {
    const response = await handleListenKeyRequest("POST", apiKey);
    const payload = (await response.json()) as ListenKeyResponse;
    return payload.listenKey;
  } catch {
    return null;
  }
}

export async function keepAliveListenKey(apiKey: string, listenKey: string): Promise<boolean> {
  try {
    const params = new URLSearchParams();
    params.set("listenKey", listenKey);
    await handleListenKeyRequest("PUT", apiKey, params);
    return true;
  } catch {
    return false;
  }
}

export async function closeListenKey(apiKey: string, listenKey: string): Promise<boolean> {
  try {
    const params = new URLSearchParams();
    params.set("listenKey", listenKey);
    await handleListenKeyRequest("DELETE", apiKey, params);
    return true;
  } catch {
    return false;
  }
}
