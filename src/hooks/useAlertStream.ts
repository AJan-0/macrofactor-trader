/**
 * 预警 WebSocket 流 (v0.4.0)
 *
 * 连接 /ws/alerts，推送实时预警事件。
 * 协议 (服务端 → 客户端):
 *   {"type":"connected","message":"Alert stream active","active_alerts":N}
 *   {"type":"alert","alert_id":"...","alert_type":"price_cross","symbol":"...",
 *    "timeframe":"15m","time":1716000000,"price":65000.5,"message":"...","params":{...}}
 */

import { useEffect, useRef } from "react";

// ── 类型 ──

export interface AlertEvent {
  type: "alert";
  alert_id: string;
  alert_type: string;
  symbol: string;
  timeframe: string | null;
  time: number;
  price: number;
  message: string;
  params: Record<string, any>;
}

export type AlertHandler = (event: AlertEvent) => void;

// ── 单例管理器 ──

class AlertStreamManager {
  private ws: WebSocket | null = null;
  private handlers = new Set<AlertHandler>();
  private reconnectDelay = 2000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private _connected = false;

  connect(): void {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    try { this.ws = new WebSocket(`${proto}//${location.host}/ws/alerts`); }
    catch { this._scheduleReconnect(); return; }

    this.ws.onopen = () => {
      this._connected = true;
      this.reconnectDelay = 2000;
      this._startPing();
    };
    this.ws.onmessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data as string);
        if (msg.type === "alert") {
          for (const h of this.handlers) { try { h(msg as AlertEvent); } catch {} }
        }
      } catch {}
    };
    this.ws.onclose = () => {
      this._connected = false;
      this._stopPing();
      this._scheduleReconnect();
    };
  }

  addHandler(h: AlertHandler): () => void {
    if (this.handlers.size === 0) this.connect();
    this.handlers.add(h);
    return () => {
      this.handlers.delete(h);
      if (this.handlers.size === 0) this.disconnect();
    };
  }

  disconnect(): void {
    this._stopPing();
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null; }
    this._connected = false;
  }

  get connected(): boolean { return this._connected; }

  private _scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
    }, this.reconnectDelay);
  }

  private _startPing(): void {
    this._stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 30_000);
  }
  private _stopPing(): void {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }
}

let _inst: AlertStreamManager | null = null;
function getAlertStream(): AlertStreamManager {
  if (!_inst) _inst = new AlertStreamManager();
  return _inst;
}

// ── React Hook ──

export function useAlertStream(handler: AlertHandler): void {
  const handlerRef = useRef<AlertHandler>(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    const stream = getAlertStream();
    const wrapped: AlertHandler = (event) => handlerRef.current(event);
    return stream.addHandler(wrapped);
  }, []);
}
