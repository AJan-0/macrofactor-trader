// 实时价格流 —— WebSocket 优先，HTTP 轮询兜底
// CryptoCompare WebSocket: wss://streamer.cryptocompare.com/v2
// 注意：v2 WebSocket 可能需要 API key，无 key 时自动降级为 HTTP 轮询

import { useState, useEffect } from "react";
import type { AssetSymbol } from "@/store/appStore";
import { fetchRealtimePrice } from "./cryptoCompare";

const WS_URL = "wss://streamer.cryptocompare.com/v2";
const SYMBOL_MAP: Record<AssetSymbol, string> = {
  "BTC-USDT": "BTC",
  "ETH-USDT": "ETH",
  "GC=F": "PAXG",
};

type PriceListener = (price: number, changePct: number, ts: number) => void;

interface Subscription {
  symbol: AssetSymbol;
  listeners: Set<PriceListener>;
}

class PriceStream {
  private ws: WebSocket | null = null;
  private subs = new Map<AssetSymbol, Subscription>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private connected = false;
  private fallback = false;

  subscribe(symbol: AssetSymbol, listener: PriceListener) {
    let sub = this.subs.get(symbol);
    if (!sub) {
      sub = { symbol, listeners: new Set() };
      this.subs.set(symbol, sub);
      this._addSymbol(symbol);
    }
    sub.listeners.add(listener);

    // 立即返回一个取消订阅函数
    return () => {
      sub!.listeners.delete(listener);
      if (sub!.listeners.size === 0) {
        this.subs.delete(symbol);
        this._removeSymbol(symbol);
      }
    };
  }

  private _addSymbol(symbol: AssetSymbol) {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      const fsym = SYMBOL_MAP[symbol];
      this.ws.send(JSON.stringify({ action: "SubAdd", subs: [`5~CCCAGG~${fsym}~USD`] }));
    } else if (!this.ws && !this.fallback) {
      this._connect();
    } else if (this.fallback) {
      this._startPolling();
    }
  }

  private _removeSymbol(symbol: AssetSymbol) {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      const fsym = SYMBOL_MAP[symbol];
      this.ws.send(JSON.stringify({ action: "SubRemove", subs: [`5~CCCAGG~${fsym}~USD`] }));
    }
    if (this.subs.size === 0) {
      this._disconnect();
    }
  }

  private _connect() {
    try {
      this.ws = new WebSocket(WS_URL);
      const connectTimeout = setTimeout(() => {
        // 3s 内未连接成功 → 降级轮询
        if (!this.connected) {
          console.warn("[PriceStream] WS connect timeout, falling back to HTTP polling");
          this._disconnect();
          this.fallback = true;
          this._startPolling();
        }
      }, 3000);

      this.ws.onopen = () => {
        clearTimeout(connectTimeout);
        this.connected = true;
        console.log("[PriceStream] WebSocket connected");
        // 发送所有已订阅的 symbol
        for (const { symbol } of this.subs.values()) {
          const fsym = SYMBOL_MAP[symbol];
          this.ws!.send(JSON.stringify({ action: "SubAdd", subs: [`5~CCCAGG~${fsym}~USD`] }));
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.TYPE !== "5" || !msg.PRICE) return;
          const fsym = msg.FROMSYMBOL;
          const asset = (Object.entries(SYMBOL_MAP).find(([, v]) => v === fsym)?.[0]) as AssetSymbol | undefined;
          if (!asset) return;
          const sub = this.subs.get(asset);
          if (!sub) return;
          const changePct = msg.CHANGE24HOURPCT ?? 0;
          for (const cb of sub.listeners) {
            cb(msg.PRICE, changePct, msg.LASTUPDATE ?? Date.now());
          }
        } catch { /* ignore */ }
      };

      this.ws.onclose = () => {
        this.connected = false;
        if (!this.fallback && this.subs.size > 0) {
          console.warn("[PriceStream] WebSocket closed, falling back to HTTP polling");
          this.fallback = true;
          this._startPolling();
        }
      };

      this.ws.onerror = () => {
        clearTimeout(connectTimeout);
        this.connected = false;
        this._disconnect();
        if (!this.fallback) {
          console.warn("[PriceStream] WebSocket error, falling back to HTTP polling");
          this.fallback = true;
          this._startPolling();
        }
      };
    } catch {
      this.fallback = true;
      this._startPolling();
    }
  }

  private _disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private _startPolling() {
    if (this.pollTimer) return;
    const poll = async () => {
      for (const { symbol, listeners } of this.subs.values()) {
        try {
          const data = await fetchRealtimePrice(symbol);
          for (const cb of listeners) {
            cb(data.price, data.change24hPct, data.lastUpdate * 1000);
          }
        } catch { /* 静默失败 */ }
      }
    };
    poll();
    this.pollTimer = setInterval(poll, 30000);
  }
}

export const priceStream = new PriceStream();

/** React Hook: 订阅实时价格 */
export function useRealtimePrice(symbol: AssetSymbol) {
  const [price, setPrice] = useState<number | null>(null);
  const [changePct, setChangePct] = useState<number | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number>(0);

  useEffect(() => {
    const unsubscribe = priceStream.subscribe(symbol, (p, cp, ts) => {
      setPrice(p);
      setChangePct(cp);
      setLastUpdate(ts);
    });
    return unsubscribe;
  }, [symbol]);

  return { price, changePct, lastUpdate };
}

