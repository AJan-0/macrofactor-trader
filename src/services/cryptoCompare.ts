// CryptoCompare API 服务层 —— 实时加密货币数据
// 文档: https://min-api.cryptocompare.com/documentation
// 备用数据源: Binance API (src/services/binanceApi.ts)

import type { AssetSymbol, Timeframe } from "@/store/appStore";
import { fetchKlinesFromBinance, fetchRealtimePriceFromBinance } from "./binanceApi";

const BASE = "https://min-api.cryptocompare.com/data";

export interface KlineData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface RealtimePrice {
  price: number;
  volume24h: number;
  change24hPct: number;
  high24h: number;
  low24h: number;
  lastUpdate: number;
}

// Asset 映射
const SYMBOL_MAP: Record<AssetSymbol, string> = {
  "BTC-USDT": "BTC",
  "ETH-USDT": "ETH",
  "GC=F": "PAXG",
};

// Timeframe -> CryptoCompare API 参数映射
// 根据时间周期调整默认请求天数，避免请求过多数据导致超时
const TIMEFRAME_MAP: Record<Timeframe, { 
  endpoint: string; 
  aggregate: number; 
  barsPerDay: number; 
  defaultDays: number;  // 根据周期自动调整
  maxRequests: number;  // 根据周期调整最大请求次数
}> = {
  "1m":  { endpoint: "histominute", aggregate: 1,  barsPerDay: 24 * 60, defaultDays: 7,   maxRequests: 10 },   // 7天 = 10,080 条
  "3m":  { endpoint: "histominute", aggregate: 3,  barsPerDay: 24 * 20, defaultDays: 30,  maxRequests: 15 },   // 30天 = 14,400 条
  "5m":  { endpoint: "histominute", aggregate: 5,  barsPerDay: 24 * 12, defaultDays: 30,  maxRequests: 10 },   // 30天 = 8,640 条
  "15m": { endpoint: "histominute", aggregate: 15, barsPerDay: 96,      defaultDays: 90,  maxRequests: 10 },   // 90天 = 8,640 条
  "1H":  { endpoint: "histohour",   aggregate: 1,  barsPerDay: 24,      defaultDays: 365, maxRequests: 10 },   // 1年 = 8,760 条
  "4H":  { endpoint: "histohour",   aggregate: 4,  barsPerDay: 6,       defaultDays: 365, maxRequests: 10 },   // 1年 = 2,190 条
  "1D":  { endpoint: "histoday",    aggregate: 1,  barsPerDay: 1,       defaultDays: 365 * 3, maxRequests: 20 }, // 3年 = 1,095 条
};

const API_MAX_LIMIT = 2000;
const MIN_BARS_REQUIRED = 100;

/* eslint-disable @typescript-eslint/no-explicit-any */
export function getTimeframeIntervalSeconds(tf: Timeframe): number {
  const cfg = TIMEFRAME_MAP[tf];
  if (!cfg) return 60;
  if (cfg.endpoint === "histominute") return cfg.aggregate * 60;
  if (cfg.endpoint === "histohour") return cfg.aggregate * 3600;
  return 86400;
}

let _lastCall = 0;
const MIN_INTERVAL = 250;

const _inFlight = new Map<string, Promise<KlineData[]>>();

async function fetchWithRetry(
  url: string,
  signal?: AbortSignal,
  retries = 3,
  baseDelay = 250
): Promise<Response> {
  let lastErr: Error | undefined;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) {
        const errMsg = `HTTP ${res.status} ${res.statusText}`;
        console.warn(`[CryptoCompare] HTTP error (attempt ${i + 1}/${retries}): ${errMsg}`);
        throw new Error(errMsg);
      }
      return res;
    } catch (err: any) {
      if (err?.name === "AbortError") throw err;
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (i < retries - 1) {
        const delay = baseDelay * Math.pow(2, i);
        console.log(`[CryptoCompare] Retrying in ${delay}ms... (attempt ${i + 1}/${retries})`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr || new Error("Fetch failed after retries");
}

// ── 内存缓存 ──
const _cache = new Map<string, { data: KlineData[]; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;

function cacheKey(symbol: AssetSymbol, tf: Timeframe): string {
  return `${symbol}::${tf}`;
}

function getCached(symbol: AssetSymbol, tf: Timeframe): KlineData[] | null {
  const key = cacheKey(symbol, tf);
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    _cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(symbol: AssetSymbol, tf: Timeframe, data: KlineData[]) {
  _cache.set(cacheKey(symbol, tf), { data, ts: Date.now() });
}

// ── localStorage 持久缓存 ──
const LS_CACHE_KEY = "klineCache_v1";
const LS_CACHE_TTL = 30 * 60 * 1000;

interface LSCacheEntry { data: KlineData[]; ts: number; symbol: string; tf: Timeframe; }

function getLSCache(): Record<string, LSCacheEntry> {
  try {
    const raw = localStorage.getItem(LS_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const now = Date.now();
    const cleaned: Record<string, LSCacheEntry> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const entry = v as LSCacheEntry;
      if (now - entry.ts < LS_CACHE_TTL) cleaned[k] = entry;
    }
    return cleaned;
  } catch { return {}; }
}

function saveLSCache(cache: Record<string, LSCacheEntry>) {
  try { localStorage.setItem(LS_CACHE_KEY, JSON.stringify(cache)); } catch { /* ignore */ }
}

export function getLSCached(symbol: AssetSymbol, tf: Timeframe): KlineData[] | null {
  const cache = getLSCache();
  const entry = cache[cacheKey(symbol, tf)];
  if (!entry) return null;
  return entry.data;
}

export function setLSCached(symbol: AssetSymbol, tf: Timeframe, data: KlineData[]) {
  const cache = getLSCache();
  cache[cacheKey(symbol, tf)] = { data, ts: Date.now(), symbol, tf };
  saveLSCache(cache);
}

async function rateLimitedFetch(url: string, signal?: AbortSignal): Promise<Record<string, any>> {
  const now = Date.now();
  const wait = Math.max(0, MIN_INTERVAL - (now - _lastCall));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastCall = Date.now();

  try {
    const res = await fetchWithRetry(url, signal);
    const json = await res.json();
    if (json.Response === "Error") {
      const errMsg = json.Message || "CryptoCompare error";
      console.error(`[CryptoCompare] API Error: ${errMsg}`, { url: url.split('?')[0], params: url.split('?')[1] });
      throw new Error(errMsg);
    }
    return json;
  } catch (err) {
    if (err instanceof Error && err.name !== 'AbortError') {
      console.error(`[CryptoCompare] Fetch failed:`, err.message, { url: url.split('?')[0] });
    }
    throw err;
  }
}

/**
 * 获取历史K线数据（支持多数据源自动切换）
 * 优先级: 内存缓存 → localStorage → CryptoCompare API → Binance API (备用)
 */
export async function fetchKlines(
  symbol: AssetSymbol,
  tf: Timeframe,
  targetDays?: number,
  signal?: AbortSignal
): Promise<KlineData[]> {
  // 1. 内存缓存
  const cached = getCached(symbol, tf);
  if (cached) {
    console.log(`[Klines] ${symbol} ${tf}: ${cached.length} bars (from memory cache)`);
    return cached;
  }

  // 2. localStorage 持久缓存
  const lsCached = getLSCached(symbol, tf);
  if (lsCached) {
    console.log(`[Klines] ${symbol} ${tf}: ${lsCached.length} bars (from localStorage cache)`);
    setCached(symbol, tf, lsCached);
    return lsCached;
  }

  // 3. 飞行中请求去重
  const key = cacheKey(symbol, tf);
  const existing = _inFlight.get(key);
  if (existing) {
    console.log(`[Klines] ${symbol} ${tf}: dedup — reusing in-flight request`);
    return existing;
  }

  const promise = _fetchKlinesWithFallback(symbol, tf, targetDays, signal).catch(err => {
    // 4. 全部失败后，尝试返回过期缓存
    const stale = _getStaleLSCache(symbol, tf);
    if (stale) {
      console.warn(`[Klines] ${symbol} ${tf}: All APIs failed, using stale cache (${stale.length} bars)`);
      setCached(symbol, tf, stale);
      return stale;
    }
    throw err;
  }).finally(() => {
    _inFlight.delete(key);
  });

  _inFlight.set(key, promise);
  return promise;
}

/** 内部：带自动切换的 K 线获取 */
async function _fetchKlinesWithFallback(
  symbol: AssetSymbol,
  tf: Timeframe,
  targetDays?: number,
  signal?: AbortSignal
): Promise<KlineData[]> {
  // 优先尝试 CryptoCompare
  try {
    const data = await _fetchKlinesFromCryptoCompare(symbol, tf, targetDays, signal);
    console.log(`[Klines] ${symbol} ${tf}: using CryptoCompare data (${data.length} bars)`);
    return data;
  } catch (ccErr) {
    console.warn(`[Klines] CryptoCompare failed: ${(ccErr as Error).message}, trying Binance...`);
    
    // CryptoCompare 失败，切换到 Binance
    try {
      const data = await fetchKlinesFromBinance(symbol, tf, targetDays, signal);
      console.log(`[Klines] ${symbol} ${tf}: using Binance data (${data.length} bars)`);
      // 缓存 Binance 数据
      setCached(symbol, tf, data);
      setLSCached(symbol, tf, data);
      return data;
    } catch (binanceErr) {
      console.error(`[Klines] Binance also failed: ${(binanceErr as Error).message}`);
      throw new Error(`All data sources failed. CryptoCompare: ${(ccErr as Error).message}, Binance: ${(binanceErr as Error).message}`);
    }
  }
}

/** 内部：从 CryptoCompare 获取 */
async function _fetchKlinesFromCryptoCompare(
  symbol: AssetSymbol,
  tf: Timeframe,
  targetDays?: number,
  signal?: AbortSignal
): Promise<KlineData[]> {
  const fsym = SYMBOL_MAP[symbol];
  const cfg = TIMEFRAME_MAP[tf];
  if (!fsym || !cfg) throw new Error(`Unsupported symbol ${symbol} or timeframe ${tf}`);

  const days = targetDays ?? cfg.defaultDays;
  const targetBars = Math.ceil(days * cfg.barsPerDay);
  const maxRequests = cfg.maxRequests;
  const allKlines: KlineData[] = [];
  let toTs: number | undefined = undefined;
  let requests = 0;
  let emptyResponseCount = 0;
  let isFirstRequest = true;
  let isDescending = true; // 假设降序排列（最新在前）

  while (allKlines.length < targetBars && requests < maxRequests && emptyResponseCount < 3) {
    if (signal?.aborted) throw new Error("Aborted");

    const limit = Math.min(API_MAX_LIMIT, targetBars - allKlines.length);
    let url = `${BASE}/v2/${cfg.endpoint}?fsym=${fsym}&tsym=USD&aggregate=${cfg.aggregate}&limit=${limit}&tryConversion=true`;
    if (toTs) url += `&toTs=${toTs}`;

    const json = await rateLimitedFetch(url, signal) as Record<string, any>;
    const raw: any[] = json.Data?.Data || [];

    if (!raw.length) {
      emptyResponseCount++;
      break;
    }

    // 首次请求：检测数据排序方向
    if (isFirstRequest && raw.length >= 2) {
      const time1 = raw[0].time as number;
      const time2 = raw[raw.length - 1].time as number;
      isDescending = time1 > time2; // true = 降序（最新在前）
      console.log(`[CryptoCompare] ${symbol} ${tf}: data order detected: ${isDescending ? 'descending' : 'ascending'} (first=${time1}, last=${time2})`);
      isFirstRequest = false;
    }

    const batch: KlineData[] = raw.map((d: Record<string, any>) => ({
      time: d.time as number,
      open: d.open as number,
      high: d.high as number,
      low: d.low as number,
      close: d.close as number,
      volume: (d.volumefrom as number) + (d.volumeto as number) * 0.0001,
    }));

    allKlines.push(...batch);
    
    // 根据排序方向确定下一页的 toTs
    // 降序（最新在前）：取最后一条（最早的），减 1 获取更早数据
    // 升序（最早在前）：取第一条（最早的），减 1 获取更早数据
    const pivotBar = isDescending ? raw[raw.length - 1] : raw[0];
    const nextToTs = (pivotBar.time as number) - 1;
    
    // 安全检查：确保时间向前推进
    if (toTs !== undefined && nextToTs >= toTs) {
      console.log(`[CryptoCompare] ${symbol} ${tf}: no older data available (nextToTs=${nextToTs} >= toTs=${toTs})`);
      break;
    }
    
    toTs = nextToTs;
    requests++;
    
    if (raw.length < limit) {
      console.log(`[CryptoCompare] ${symbol} ${tf}: partial response (${raw.length}/${limit})`);
      break;
    }
  }

  // 去重并排序（按时间升序）
  const seen = new Set<number>();
  const unique = allKlines.filter(k => {
    if (seen.has(k.time)) return false;
    seen.add(k.time);
    return true;
  });
  unique.sort((a, b) => a.time - b.time);

  console.log(`[CryptoCompare] ${symbol} ${tf}: fetched ${unique.length} bars (${requests} requests, target=${targetBars})`);

  if (unique.length < MIN_BARS_REQUIRED) {
    console.warn(`[CryptoCompare] ⚠️ ${symbol} ${tf}: only ${unique.length} bars returned (min=${MIN_BARS_REQUIRED})`);
  }
  
  setCached(symbol, tf, unique);
  setLSCached(symbol, tf, unique);
  
  return unique;
}

function _getStaleLSCache(symbol: AssetSymbol, tf: Timeframe): KlineData[] | null {
  try {
    const raw = localStorage.getItem(LS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const entry = parsed[cacheKey(symbol, tf)];
    return entry?.data || null;
  } catch { return null; }
}

/**
 * 获取实时价格（带自动切换）
 */
export async function fetchRealtimePrice(symbol: AssetSymbol, signal?: AbortSignal): Promise<RealtimePrice> {
  // 优先尝试 CryptoCompare
  try {
    const fsym = SYMBOL_MAP[symbol];
    if (!fsym) throw new Error(`Unsupported symbol ${symbol}`);
    
    const url = `${BASE}/pricemultifull?fsyms=${fsym}&tsyms=USD`;
    const json = await rateLimitedFetch(url, signal);
    const info = json.RAW?.[fsym]?.USD;
    if (!info) throw new Error("No price data");
    
    return {
      price: info.PRICE as number,
      volume24h: info.VOLUME24HOURTO as number,
      change24hPct: info.CHANGEPCT24HOUR as number,
      high24h: info.HIGH24HOUR as number,
      low24h: info.LOW24HOUR as number,
      lastUpdate: info.LASTUPDATE as number,
    };
  } catch (ccErr) {
    console.warn(`[CryptoCompare] Price fetch failed: ${(ccErr as Error).message}, trying Binance...`);
    
    // 切换到 Binance
    try {
      const data = await fetchRealtimePriceFromBinance(symbol, signal);
      return {
        ...data,
        lastUpdate: Date.now(),
      };
    } catch (binanceErr) {
      throw new Error(`All price sources failed`);
    }
  }
}

/**
 * 批量获取实时价格
 */
export async function fetchAllRealtimePrices(symbols: AssetSymbol[], signal?: AbortSignal): Promise<Record<AssetSymbol, RealtimePrice>> {
  const result = {} as Record<AssetSymbol, RealtimePrice>;
  await Promise.all(
    symbols.map(async (sym) => {
      try {
        result[sym] = await fetchRealtimePrice(sym, signal);
      } catch (err) {
        console.warn(`[Price] Failed to fetch ${sym}:`, err);
      }
    })
  );
  return result;
}
