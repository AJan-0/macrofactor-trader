// 多源数据聚合服务 - P0 核心稳定性
// 支持 CryptoCompare + CoinGecko + Binance 多源备份

import type { AssetSymbol, Timeframe } from "@/store/appStore";
import type { KlineData, RealtimePrice } from "./cryptoCompare";

export type DataSource = "cryptocompare" | "coingecko" | "binance";

interface SourceConfig {
  name: DataSource;
  weight: number; // 权重，用于优先级排序
  enabled: boolean;
}

const SOURCES: SourceConfig[] = [
  { name: "cryptocompare", weight: 1.0, enabled: true },
  { name: "coingecko", weight: 0.8, enabled: true },
  { name: "binance", weight: 0.9, enabled: true },
];

// 错误追踪
interface SourceError {
  source: DataSource;
  error: string;
  timestamp: number;
  count: number;
}

type CoinGeckoPoint = [number, number];
interface CoinGeckoMarketChart {
  prices?: CoinGeckoPoint[];
  total_volumes?: CoinGeckoPoint[];
}

type BinanceKline = [
  number,
  string,
  string,
  string,
  string,
  string,
  ...unknown[]
];

const _errorLog = new Map<DataSource, SourceError>();
const ERROR_THRESHOLD = 3; // 连续错误3次后降级
const ERROR_WINDOW = 5 * 60 * 1000; // 5分钟窗口

function recordError(source: DataSource, error: string) {
  const now = Date.now();
  const existing = _errorLog.get(source);
  if (existing && now - existing.timestamp < ERROR_WINDOW) {
    existing.count++;
    existing.error = error;
    existing.timestamp = now;
  } else {
    _errorLog.set(source, { source, error, timestamp: now, count: 1 });
  }

  // 超过阈值则自动禁用
  if (_errorLog.get(source)!.count >= ERROR_THRESHOLD) {
    console.warn(`[DataProvider] ${source} disabled due to ${ERROR_THRESHOLD} consecutive errors`);
    const cfg = SOURCES.find(s => s.name === source);
    if (cfg) cfg.enabled = false;
  }
}

function recordSuccess(source: DataSource) {
  _errorLog.delete(source);
  const cfg = SOURCES.find(s => s.name === source);
  if (cfg && !cfg.enabled) {
    console.log(`[DataProvider] ${source} re-enabled after success`);
    cfg.enabled = true;
  }
}

// ── CoinGecko API ──
const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

const CG_SYMBOL_MAP: Record<AssetSymbol, string> = {
  "BTC-USDT": "bitcoin",
  "ETH-USDT": "ethereum",
  "SOL-USDT": "solana",
  "GC=F": "pax-gold",
};

const CG_TIMEFRAME_MAP: Record<Timeframe, { days: number; interval: string }> = {
  "1m": { days: 1, interval: "hourly" },
  "3m": { days: 1, interval: "hourly" },
  "5m": { days: 3, interval: "hourly" },
  "15m": { days: 7, interval: "hourly" },
  "1H": { days: 30, interval: "daily" },
  "4H": { days: 90, interval: "daily" },
  "1D": { days: 365 * 3, interval: "daily" },
};

async function fetchFromCoinGecko(
  symbol: AssetSymbol,
  tf: Timeframe,
  signal?: AbortSignal
): Promise<KlineData[]> {
  const id = CG_SYMBOL_MAP[symbol];
  const cfg = CG_TIMEFRAME_MAP[tf];
  if (!id || !cfg) throw new Error(`Unsupported: ${symbol} ${tf}`);

  const url = `${COINGECKO_BASE}/coins/${id}/market_chart?vs_currency=usd&days=${cfg.days}&interval=${cfg.interval}`;

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const json = await res.json() as CoinGeckoMarketChart;

  // CoinGecko 返回 prices: [timestamp, price][]
  const prices = json.prices || [];
  const volumes = json.total_volumes || [];

  // 转换为 KlineData（CoinGecko 不提供 OHLC，用价格近似）
  return prices.map((p, i) => {
    const time = Math.floor(p[0] / 1000);
    const price = p[1];
    const volume = volumes[i]?.[1] || 0;
    // 用前后价格模拟 OHLC
    const prevPrice = i > 0 ? prices[i - 1][1] : price;
    const nextPrice = i < prices.length - 1 ? prices[i + 1][1] : price;

    return {
      time,
      open: prevPrice,
      high: Math.max(price, prevPrice, nextPrice),
      low: Math.min(price, prevPrice, nextPrice),
      close: price,
      volume,
    };
  });
}

// ── Binance API ──
const BINANCE_BASE = "https://api.binance.com/api/v3";

const BN_SYMBOL_MAP: Record<AssetSymbol, string> = {
  "BTC-USDT": "BTCUSDT",
  "ETH-USDT": "ETHUSDT",
  "SOL-USDT": "SOLUSDT",
  "GC=F": "PAXGUSDT",
};

const BN_TIMEFRAME_MAP: Record<Timeframe, string> = {
  "1m": "1m",
  "3m": "3m",
  "5m": "5m",
  "15m": "15m",
  "1H": "1h",
  "4H": "4h",
  "1D": "1d",
};

async function fetchFromBinance(
  symbol: AssetSymbol,
  tf: Timeframe,
  signal?: AbortSignal
): Promise<KlineData[]> {
  const sym = BN_SYMBOL_MAP[symbol];
  const interval = BN_TIMEFRAME_MAP[tf];
  if (!sym || !interval) throw new Error(`Unsupported: ${symbol} ${tf}`);

  // Binance 限制 1000 条/请求，需要分页
  const allKlines: KlineData[] = [];
  let endTime: number | undefined = undefined;
  const MAX_REQUESTS = 10;

  for (let i = 0; i < MAX_REQUESTS; i++) {
    if (signal?.aborted) throw new Error("Aborted");

    let url = `${BINANCE_BASE}/klines?symbol=${sym}&interval=${interval}&limit=1000`;
    if (endTime) url += `&endTime=${endTime}`;

    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
    const data = await res.json() as BinanceKline[];

    if (!data.length) break;

    const batch: KlineData[] = data.map(d => ({
      time: Math.floor(d[0] / 1000),
      open: parseFloat(d[1]),
      high: parseFloat(d[2]),
      low: parseFloat(d[3]),
      close: parseFloat(d[4]),
      volume: parseFloat(d[5]),
    }));

    allKlines.unshift(...batch);
    endTime = data[0][0] - 1;

    if (data.length < 1000) break; // 已到最早数据
  }

  return allKlines;
}

// ── 主入口：多源聚合 ──

export interface FetchOptions {
  signal?: AbortSignal;
  preferredSource?: DataSource;
  timeout?: number;
}

/**
 * 获取 K 线数据（自动故障转移）
 * 优先级: preferredSource > CryptoCompare > Binance > CoinGecko
 */
export async function fetchKlinesMulti(
  symbol: AssetSymbol,
  tf: Timeframe,
  options: FetchOptions = {}
): Promise<{ data: KlineData[]; source: DataSource }> {
  const { signal, preferredSource, timeout = 30000 } = options;

  // 按优先级排序
  const ordered = [...SOURCES]
    .filter(s => s.enabled)
    .sort((a, b) => {
      if (a.name === preferredSource) return -1;
      if (b.name === preferredSource) return 1;
      return b.weight - a.weight;
    });

  const errors: string[] = [];

  for (const source of ordered) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      // 合并外部 signal
      if (signal) {
        signal.addEventListener("abort", () => controller.abort());
      }

      let data: KlineData[];
      switch (source.name) {
        case "cryptocompare": {
          const { fetchKlines } = await import("./cryptoCompare");
          data = await fetchKlines(symbol, tf, undefined, controller.signal);
          break;
        }
        case "coingecko":
          data = await fetchFromCoinGecko(symbol, tf, controller.signal);
          break;
        case "binance":
          data = await fetchFromBinance(symbol, tf, controller.signal);
          break;
        default:
          continue;
      }

      clearTimeout(timer);
      recordSuccess(source.name);

      console.log(`[DataProvider] ✓ ${symbol} ${tf} from ${source.name}: ${data.length} bars`);
      return { data, source: source.name };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${source.name}: ${msg}`);
      recordError(source.name, msg);
      console.warn(`[DataProvider] ✗ ${source.name} failed: ${msg}`);
    }
  }

  throw new Error(`All data sources failed for ${symbol} ${tf}:\n${errors.join("\n")}`);
}

/**
 * 获取实时价格（多源备份）
 */
export async function fetchRealtimePriceMulti(
  symbol: AssetSymbol,
  options: FetchOptions = {}
): Promise<{ data: RealtimePrice; source: DataSource }> {
  const { signal, timeout = 10000 } = options;

  const ordered = [...SOURCES].filter(s => s.enabled).sort((a, b) => b.weight - a.weight);
  const errors: string[] = [];

  for (const source of ordered) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      if (signal) {
        signal.addEventListener("abort", () => controller.abort());
      }

      let data: RealtimePrice;
      switch (source.name) {
        case "cryptocompare": {
          const { fetchRealtimePrice } = await import("./cryptoCompare");
          data = await fetchRealtimePrice(symbol);
          break;
        }
        default:
          // 其他源暂不实现实时价格，跳过
          throw new Error("Realtime price not implemented for this source");
      }

      clearTimeout(timer);
      recordSuccess(source.name);
      return { data, source: source.name };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${source.name}: ${msg}`);
      recordError(source.name, msg);
    }
  }

  throw new Error(`All price sources failed for ${symbol}:\n${errors.join("\n")}`);
}

/**
 * 获取各源健康状态
 */
export function getSourceHealth(): { source: DataSource; enabled: boolean; errorCount: number; lastError?: string }[] {
  return SOURCES.map(s => {
    const err = _errorLog.get(s.name);
    return {
      source: s.name,
      enabled: s.enabled,
      errorCount: err?.count || 0,
      lastError: err?.error,
    };
  });
}

/**
 * 手动重置源状态（用于恢复）
 */
export function resetSource(source: DataSource) {
  _errorLog.delete(source);
  const cfg = SOURCES.find(s => s.name === source);
  if (cfg) cfg.enabled = true;
  console.log(`[DataProvider] ${source} manually reset`);
}
