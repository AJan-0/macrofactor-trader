/**
 * K-line WebSocket Stream Service (v0.4.0)
 *
 * 连接后端 /ws/klines 端点，接收 OKX 实时 K 线增量推送。
 * 替代原有的 30s 轮询 fetchRealtimePrice 机制。
 *
 * 协议:
 *   客户端 → 服务端: {"type":"subscribe","subscriptions":[{"symbol":"BTC-USDT","timeframe":"1H"}]}
 *   服务端 → 客户端: {"type":"candle","symbol":"BTC-USDT","timeframe":"1H","candle":{...}}
 *
 * 特性:
 *   - 单 WebSocket 连接，多 symbol/timeframe 复用
 *   - 断线自动重连（指数退避 1s → 30s）
 *   - 重连后自动恢复所有订阅
 *   - React Hook useKlineStream 管理生命周期
 */

import { useEffect, useRef, useState } from 'react';
import type { Timeframe } from '@/store/appStore';

// ── 类型 ──

export interface KlineCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  confirm: boolean;   // bar 已收线
  is_new: boolean;    // 新 bar 的第一笔
  symbol: string;
  timeframe: string;
}

export type CandleHandler = (candle: KlineCandle) => void;

// ── 配置 ──

const RECONNECT_BASE = 1000;
const RECONNECT_MAX = 30000;
const PING_INTERVAL = 30000;

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws/klines`;
}

// ── 单例管理器 ──

interface SubEntry {
  symbol: string;
  timeframe: string;
  handlers: Set<CandleHandler>;
}

class KlineStreamManager {
  private ws: WebSocket | null = null;
  private subs = new Map<string, SubEntry>();
  private rd = RECONNECT_BASE;
  private rt: ReturnType<typeof setTimeout> | null = null;
  private pt: ReturnType<typeof setInterval> | null = null;
  private _connected = false;
  private _statusListeners = new Set<(connected: boolean) => void>();

  connect(): void {
    if (this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      this.ws = new WebSocket(wsUrl());
    } catch {
      this._schedule();
      return;
    }

    this.ws.onopen = () => {
      console.log('[KlineWS] connected');
      this._connected = true;
      this.rd = RECONNECT_BASE;
      this._resubAll();
      this._startPing();
      this._emitStatus();
    };

    this.ws.onmessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data as string);
        this._handle(msg);
      } catch { /* ignore malformed */ }
    };

    this.ws.onclose = () => {
      console.log('[KlineWS] disconnected');
      this._connected = false;
      this._stopPing();
      this._emitStatus();
      this._schedule();
    };

    this.ws.onerror = () => {
      // onclose follows, which triggers reconnect
    };
  }

  subscribe(symbol: string, tf: string, handler: CandleHandler): () => void {
    const key = `${symbol}|${tf}`;
    let entry = this.subs.get(key);
    if (!entry) {
      entry = { symbol, timeframe: tf, handlers: new Set() };
      this.subs.set(key, entry);
      if (this._connected && this.ws) this._sendSub(symbol, tf);
    }
    entry.handlers.add(handler);
    return () => {
      const e = this.subs.get(key);
      if (!e) return;
      e.handlers.delete(handler);
      if (e.handlers.size === 0) {
        this.subs.delete(key);
        if (this._connected && this.ws) this._sendUnsub(symbol, tf);
      }
    };
  }

  disconnect(): void {
    this._stopPing();
    if (this.rt) { clearTimeout(this.rt); this.rt = null; }
    if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null; }
    this._connected = false;
    this._emitStatus();
  }

  get connected(): boolean { return this._connected; }

  onStatusChange(cb: (connected: boolean) => void): () => void {
    this._statusListeners.add(cb);
    // 立即回调当前状态
    try { cb(this._connected); } catch { /* ignore */ }
    return () => { this._statusListeners.delete(cb); };
  }

  private _emitStatus(): void {
    for (const cb of this._statusListeners) {
      try { cb(this._connected); } catch { /* ignore */ }
    }
  }

  private _resubAll(): void {
    const subs = Array.from(this.subs.values()).map(s => ({
      symbol: s.symbol, timeframe: s.timeframe,
    }));
    if (subs.length && this.ws) {
      this.ws.send(JSON.stringify({ type: 'subscribe', subscriptions: subs }));
    }
  }

  private _sendSub(symbol: string, tf: string): void {
    this.ws?.send(JSON.stringify({
      type: 'subscribe',
      subscriptions: [{ symbol, timeframe: tf }],
    }));
  }

  private _sendUnsub(symbol: string, tf: string): void {
    this.ws?.send(JSON.stringify({
      type: 'unsubscribe',
      subscriptions: [{ symbol, timeframe: tf }],
    }));
  }

  private _handle(msg: Record<string, unknown>): void {
    if (msg.type === 'candle') {
      const symbol = msg.symbol as string;
      const timeframe = msg.timeframe as string;
      const candle = msg.candle as KlineCandle;
      if (symbol && timeframe && candle) {
        const entry = this.subs.get(`${symbol}|${timeframe}`);
        if (entry) {
          for (const h of entry.handlers) {
            try { h(candle); } catch { /* swallow */ }
          }
        }
      }
    } else if (msg.type === 'error') {
      console.warn('[KlineWS] server:', msg.message);
    }
  }

  private _schedule(): void {
    if (this.rt) return;
    console.log(`[KlineWS] reconnect in ${this.rd}ms`);
    this.rt = setTimeout(() => {
      this.rt = null;
      this.connect();
      this.rd = Math.min(this.rd * 2, RECONNECT_MAX);
    }, this.rd);
  }

  private _startPing(): void {
    this._stopPing();
    this.pt = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, PING_INTERVAL);
  }

  private _stopPing(): void {
    if (this.pt) { clearInterval(this.pt); this.pt = null; }
  }
}

// ── 全局单例 ──

let _inst: KlineStreamManager | null = null;

export function getKlineStream(): KlineStreamManager {
  if (!_inst) { _inst = new KlineStreamManager(); _inst.connect(); }
  return _inst;
}

export function disconnectKlineStream(): void {
  _inst?.disconnect();
  _inst = null;
}

// ── 增量合并工具 ──

/**
 * 将实时 candle 增量合并到 K 线数组。
 * 返回新数组引用以触发 React 更新。
 */
export function mergeCandle(
  klines: Array<{
    time: number; open: number; high: number; low: number; close: number; volume: number;
  }>,
  candle: KlineCandle,
): Array<{
  time: number; open: number; high: number; low: number; close: number; volume: number;
}> {
  const last = klines[klines.length - 1];

  if (!last || candle.time > last.time) {
    // 新 bar: 追加
    return [...klines, {
      time: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    }];
  } else if (candle.time === last.time) {
    // 同一 bar: 更新 OHLCV
    const rest = klines.slice(0, -1);
    return [...rest, {
      time: candle.time,
      open: candle.open,
      high: Math.max(last.high, candle.high),
      low: Math.min(last.low, candle.low),
      close: candle.close,
      volume: Math.max(last.volume, candle.volume),
    }];
  }
  // candle.time < last.time: 历史 bar，忽略
  return klines;
}

// ── React Hook ──

/**
 * 订阅实时 K 线流。
 *
 * @example
 *   const { isConnected, lastCandle } = useKlineStream(symbol, timeframe);
 */
export function useKlineStream(
  symbol: string,
  timeframe: Timeframe,
): { isConnected: boolean; lastCandle: KlineCandle | null } {
  const [connected, setConnected] = useState(() => getKlineStream().connected);
  const [lastCandle, setLastCandle] = useState<KlineCandle | null>(null);
  const handlerRef = useRef<CandleHandler | null>(null);

  // 连接状态监听（事件驱动，无轮询）
  useEffect(() => {
    const manager = getKlineStream();
    return manager.onStatusChange(setConnected);
  }, []);

  // 订阅/取消订阅
  useEffect(() => {
    const manager = getKlineStream();
    const handler: CandleHandler = (candle) => setLastCandle(candle);
    handlerRef.current = handler;

    const unsub = manager.subscribe(symbol, timeframe, handler);
    return unsub;
  }, [symbol, timeframe]);

  return { isConnected: connected, lastCandle };
}
