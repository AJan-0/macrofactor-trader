// CryptoCompare API 服务层 —— 实时加密货币数据
// 文档: https://min-api.cryptocompare.com/documentation

import type { AssetSymbol, Timeframe } from "@/store/appStore";

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
  "GC=F": "PAXG", // PAXG = Paxos Gold, 1:1 锚定实物黄金
};

// Timeframe -> CryptoCompare API 参数映射
// barsPerDay: 每天有多少根K线，用于计算目标天数需要请求多少数据
// defaultDays: 默认回溯天数（全部统一为3年，确保策略有足够数据）
const TIMEFRAME_MAP: Record<Timeframe, { endpoint: string; aggregate: number; barsPerDay: number; defaultDays: number }> = {
  "1m":  { endpoint: "histominute", aggregate: 1,  barsPerDay: 24 * 60, defaultDays: 365 * 3 },
  "3m":  { endpoint: "histominute", aggregate: 3,  barsPerDay: 24 * 20, defaultDays: 365 * 3 },
  "5m":  { endpoint: "histominute", aggregate: 5,  barsPerDay: 24 * 12, defaultDays: 365 * 3 },
  "15m": { endpoint: "histominute", aggregate: 15, barsPerDay: 96,      defaultDays: 365 * 3 },
  "1H":  { endpoint: "histohour",   aggregate: 1,  barsPerDay: 24,      defaultDays: 365 * 3 },
  "4H":  { endpoint: "histohour",   aggregate: 4,  barsPerDay: 6,       defaultDays: 365 * 3 },
  "1D":  { endpoint: "histoday",    aggregate: 1,  barsPerDay: 1,       defaultDays: 365 * 3 },
};

const API_MAX_LIMIT = 2000;      // CryptoCompare 单次最大返回条数
const MAX_REQUESTS = 50;         // 最多分页请求次数（3年数据需要更多分页）
const MIN_BARS_REQUIRED = 1000;  // 最少需要的K线数量（低于此数警告）

/** 获取 timeframe 的间隔秒数（用于实时更新判断新 bar） */
/* eslint-disable @typescript-eslint/no-explicit-any */
export function getTimeframeIntervalSeconds(tf: Timeframe): number {
  const cfg = TIMEFRAME_MAP[tf];
  if (!cfg) return 60;
  if (cfg.endpoint === "histominute") return cfg.aggregate * 60;
  if (cfg.endpoint === "histohour") return cfg.aggregate * 3600;
  return 86400;
}

let _lastCall = 0;
const MIN_INTERVAL = 250; // ms, 避免触发rate limit

// ── 飞行中请求去重 ──
const _inFlight = new Map<string, Promise<KlineData[]>>();

// ── 带重试和取消的 fetch ──
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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err: any) {
      if (err?.name === "AbortError") throw err;
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (i < retries - 1) {
        const delay = baseDelay * Math.pow(2, i);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr || new Error("Fetch failed after retries");
}

// ── 内存缓存 ──
const _cache = new Map<string, { data: KlineData[]; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5分钟

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
const LS_CACHE_TTL = 30 * 60 * 1000; // 30分钟

interface LSCacheEntry { data: KlineData[]; ts: number; symbol: string; tf: Timeframe; }

function getLSCache(): Record<string, LSCacheEntry> {
  try {
    const raw = localStorage.getItem(LS_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // 清理过期条目
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

  const res = await fetchWithRetry(url, signal);
  const json = await res.json();
  if (json.Response === "Error") throw new Error(json.Message || "CryptoCompare error");
  return json;
}

/**
 * 获取历史K线数据（支持分页，默认回溯3年）
 * 支持：内存缓存 → localStorage → API（带重试+去重）→ 过期缓存兜底
 */
export async function fetchKlines(
  symbol: AssetSymbol,
  tf: Timeframe,
  targetDays?: number,
  signal?: AbortSignal
): Promise<KlineData[]> {
  const fsym = SYMBOL_MAP[symbol];
  const cfg = TIMEFRAME_MAP[tf];
  if (!fsym || !cfg) throw new Error(`Unsupported symbol ${symbol} or timeframe ${tf}`);

  const key = cacheKey(symbol, tf);

  // 1. 内存缓存
  const cached = getCached(symbol, tf);
  if (cached) {
    console.log(`[CryptoCompare] ${symbol} ${tf}: ${cached.length} bars (from memory cache)`);
    return cached;
  }

  // 2. localStorage 持久缓存
  const lsCached = getLSCached(symbol, tf);
  if (lsCached) {
    console.log(`[CryptoCompare] ${symbol} ${tf}: ${lsCached.length} bars (from localStorage cache)`);
    setCached(symbol, tf, lsCached);
    return lsCached;
  }

  // 3. 飞行中请求去重
  const existing = _inFlight.get(key);
  if (existing) {
    console.log(`[CryptoCompare] ${symbol} ${tf}: dedup — reusing in-flight request`);
    return existing;
  }

  const promise = _fetchKlinesFromAPI(symbol, tf, fsym, cfg, targetDays, signal).catch(err => {
    // 4. 全部失败后，尝试返回过期缓存（stale-while-revalidate 兜底）
    const stale = _getStaleLSCache(symbol, tf);
    if (stale) {
      console.warn(`[CryptoCompare] ${symbol} ${tf}: API failed, using stale cache (${stale.length} bars)`);
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

/** 内部：真正发起 API 请求 */
async function _fetchKlinesFromAPI(
  symbol: AssetSymbol,
  tf: Timeframe,
  fsym: string,
  cfg: (typeof TIMEFRAME_MAP)[Timeframe],
  targetDays?: number,
  signal?: AbortSignal
): Promise<KlineData[]> {
  const days = targetDays ?? cfg.defaultDays;
  const targetBars = Math.ceil(days * cfg.barsPerDay);
  const allKlines: KlineData[] = [];
  let toTs: number | undefined = undefined;
  let requests = 0;
  let emptyResponseCount = 0;

  while (allKlines.length < targetBars && requests < MAX_REQUESTS && emptyResponseCount < 3) {
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

    const batch: KlineData[] = raw.map((d: Record<string, any>) => ({
      time: d.time as number,
      open: d.open as number,
      high: d.high as number,
      low: d.low as number,
      close: d.close as number,
      volume: (d.volumefrom as number) + (d.volumeto as number) * 0.0001,
    }));

    allKlines.push(...batch);
    toTs = raw[0].time - 1;
    requests++;
    
    // 如果返回数据少于请求数量，说明已到最早数据
    if (raw.length < limit) {
      console.log(`[CryptoCompare] ${symbol} ${tf}: reached earliest data at ${new Date(toTs * 1000).toISOString()}`);
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

  // 数据完整性检查
  const earliestDate = new Date(unique[0]?.time * 1000 || 0);
  const latestDate = new Date(unique[unique.length - 1]?.time * 1000 || 0);
  const daysCovered = (unique[unique.length - 1]?.time - unique[0]?.time) / 86400 || 0;
  
  console.log(
    `[CryptoCompare] ${symbol} ${tf}: ${unique.length} bars ` +
    `(target ~${targetBars}, ${requests} requests, ` +
    `covers ${daysCovered.toFixed(0)} days from ${earliestDate.toISOString().split('T')[0]} to ${latestDate.toISOString().split('T')[0]}, ` +
    `latest $${unique.at(-1)?.close?.toFixed(2) ?? 'N/A'})`
  );
  
  // 警告：如果数据量不足
  if (unique.length < MIN_BARS_REQUIRED) {
    console.warn(`[CryptoCompare] ⚠️ ${symbol} ${tf}: only ${unique.length} bars returned, minimum recommended is ${MIN_BARS_REQUIRED} for accurate strategy calculation`);
  }
  
  setCached(symbol, tf, unique);
  setLSCached(symbol, tf, unique);
  return unique;
}

/** 读取过期缓存（stale-while-revalidate fallback） */
function _getStaleLSCache(symbol: AssetSymbol, tf: Timeframe): KlineData[] | null {
  try {
    const raw = localStorage.getItem(LS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const entry = parsed[cacheKey(symbol, tf)] as LSCacheEntry | undefined;
    return entry?.data ?? null;
  } catch { return null; }
}

/**
 * 获取实时价格
 */
export async function fetchRealtimePrice(symbol: AssetSymbol): Promise<RealtimePrice> {
  const fsym = SYMBOL_MAP[symbol];
  if (!fsym) throw new Error(`Unsupported symbol ${symbol}`);

  const url = `${BASE}/pricemultifull?fsyms=${fsym}&tsyms=USD`;
  const json = await rateLimitedFetch(url) as Record<string, any>;
  const raw = json.RAW?.[fsym]?.USD;

  if (!raw) throw new Error("No price data returned");

  return {
    price: raw.PRICE,
    volume24h: raw.VOLUME24HOURTO,
    change24hPct: raw.CHANGEPCT24HOUR,
    high24h: raw.HIGH24HOUR,
    low24h: raw.LOW24HOUR,
    lastUpdate: raw.LASTUPDATE,
  };
}

/**
 * 批量获取多个资产的实时价格
 */
export async function fetchAllRealtimePrices(): Promise<Record<AssetSymbol, RealtimePrice>> {
  const symbols: AssetSymbol[] = ["BTC-USDT", "ETH-USDT", "GC=F"];
  const fsyms = symbols.map(s => SYMBOL_MAP[s]).join(",");

  const url = `${BASE}/pricemultifull?fsyms=${fsyms}&tsyms=USD`;
  const json = await rateLimitedFetch(url) as Record<string, any>;

  const result = {} as Record<AssetSymbol, RealtimePrice>;
  for (const sym of symbols) {
    const fsym = SYMBOL_MAP[sym];
    const raw = json.RAW?.[fsym]?.USD;
    if (raw) {
      result[sym] = {
        price: raw.PRICE,
        volume24h: raw.VOLUME24HOURTO,
        change24hPct: raw.CHANGEPCT24HOUR,
        high24h: raw.HIGH24HOUR,
        low24h: raw.LOW24HOUR,
        lastUpdate: raw.LASTUPDATE,
      };
    }
  }
  return result;
}

/**
 * 获取单条最新K线（用于追加到图表）
 * 只请求最近少量数据，避免触发大量分页
 */
export async function fetchLatestBar(symbol: AssetSymbol, tf: Timeframe): Promise<KlineData | null> {
  try {
    const klines = await fetchKlines(symbol, tf, 2); // 只取最近2天数据，取最后一条
    return klines.at(-1) ?? null;
  } catch {
    return null;
  }
}
