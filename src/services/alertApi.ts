/**
 * 预警 API 服务层 (v0.4.0)
 * 对应后端 /api/alerts REST 端点
 */

export interface AlertConfig {
  id: string;
  symbol: string;
  alert_type: "price_cross" | "reversal" | "multi_tf";
  enabled: boolean;
  params: Record<string, any>;
  cooldown_minutes: number;
  created_at: string;
  updated_at: string;
  last_triggered?: string | null;
  trigger_count?: number;
}

export interface AlertCreatePayload {
  symbol: string;
  alert_type: "price_cross" | "reversal" | "multi_tf";
  params: Record<string, any>;
  cooldown_minutes: number;
}

const API = "/api/alerts";

async function _fetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`[AlertApi] ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

export async function fetchAlerts(symbol?: string): Promise<AlertConfig[]> {
  const url = symbol ? `${API}?symbol=${encodeURIComponent(symbol)}` : API;
  const data = await _fetch<{ count: number; alerts: AlertConfig[] }>(url);
  return data.alerts ?? [];
}

export async function fetchAlertById(id: string): Promise<AlertConfig> {
  return _fetch<AlertConfig>(`${API}/${encodeURIComponent(id)}`);
}

export async function createAlert(payload: AlertCreatePayload): Promise<AlertConfig> {
  return _fetch<AlertConfig>(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function updateAlert(
  id: string,
  updates: Partial<Pick<AlertConfig, "enabled" | "params" | "cooldown_minutes">>,
): Promise<AlertConfig> {
  return _fetch<AlertConfig>(`${API}/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
}

export async function deleteAlert(id: string): Promise<{ deleted: boolean }> {
  return _fetch<{ deleted: boolean }>(`${API}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function testAlert(
  id: string,
  candle?: Record<string, any>,
): Promise<{ alert_id: string; alert_type: string; would_trigger: boolean; details: any }> {
  const body: Record<string, any> = {};
  if (candle) body.candle = candle;
  return _fetch(`${API}/${encodeURIComponent(id)}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}