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

    // 诊断日志：首次请求记录数据排序方向
    if (requests === 0 && raw.length >= 2) {
      const firstTime = new Date(raw[0].time * 1000).toISOString();
      const lastTime = new Date(raw[raw.length - 1].time * 1000).toISOString();
      console.log(`[CryptoCompare] ${symbol} ${tf}: first batch sort check - raw[0]=${firstTime}, raw[${raw.length-1}]=${lastTime}, descending=${raw[0].time > raw[raw.length-1].time}`);
    }

    allKlines.push(...batch);
    
    // CryptoCompare API 返回数据按时间降序排列（最新数据在前，即 raw[0] 是最新的）
    // 下一页需要获取比当前最早数据更早的数据，所以用 raw[raw.length-1].time（最早的数据点）
    const oldestBar = raw[raw.length - 1];
    const nextToTs = oldestBar.time - 1;
    
    // 检查时间是否继续推进（获取更早的数据）
    // 如果 nextToTs 没有变化或反而变大了，说明没有更多历史数据
    if (toTs !== undefined && nextToTs >= toTs) {
      console.log(`[CryptoCompare] ${symbol} ${tf}: no older data available (time not progressing, nextToTs=${nextToTs}, current toTs=${toTs})`);
      break;
    }
    
    toTs = nextToTs;
    requests++;
    
    // 如果返回数据少于请求数量，可能已到最早数据，但继续检查时间是否推进
    if (raw.length < limit) {
      console.log(`[CryptoCompare] ${symbol} ${tf}: partial response (${raw.length}/${limit}), continuing if time progresses`);
      // 不 break，让上面的时间检查决定是否继续
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
  
  // Bug Fix: 数据完整性验证
  const isDataComplete = validateKlineData(unique, days, tf);
  
  // 警告：如果数据量不足
  if (unique.length < MIN_BARS_REQUIRED) {
    console.warn(`[CryptoCompare] ⚠️ ${symbol} ${tf}: only ${unique.length} bars returned, minimum recommended is ${MIN_BARS_REQUIRED} for accurate strategy calculation`);
  }
  
  // Bug Fix: 只有数据完整才缓存
  if (isDataComplete) {
    setCached(symbol, tf, unique);
    setLSCached(symbol, tf, unique);
  } else {
    console.warn(`[CryptoCompare] ⚠️ ${symbol} ${tf}: data incomplete, skipping cache`);
  }
  
  return unique;
}

/**
 * 验证 K 线数据完整性
 * 检查：数据点数量、时间跨度、时间连续性
 * 
 * 注意：对于小时间周期（1m/5m/15m），3年历史数据量巨大，API可能无法返回完整3年
 * 此时放宽验证，允许至少30天的数据即可
 */
function validateKlineData(data: KlineData[], targetDays: number, tf: Timeframe): boolean {
  if (data.length < 10) return false;

  const cfg = TIMEFRAME_MAP[tf];
  if (!cfg) return false;

  // 计算实际时间跨度（天数）
  const actualDays = (data[data.length - 1].time - data[0].time) / 86400;
  
  // 对于小时间周期，放宽验证标准
  // 1m/3m/5m/15m: 至少30天数据即可接受
  // 1H/4H: 至少90天
  // 1D: 至少目标80%
  const minAcceptableDays = tf === '1D' ? targetDays * 0.8 :
                            tf === '4H' ? 90 :
                            tf === '1H' ? 90 :
                            30; // 1m/3m/5m/15m
  
  if (actualDays < minAcceptableDays) {
    console.warn(`[CryptoCompare] validate: time span ${actualDays.toFixed(0)}d < minimum ${minAcceptableDays}d for ${tf}`);
    return false;
  }
  
  console.log(`[CryptoCompare] validate: ${data.length} bars, ${actualDays.toFixed(0)} days span for ${tf} (target ${targetDays}d, min ${minAcceptableDays}d) ✓`);

  // 检查时间是否单调递增（允许相等，因为已去重）
  for (let i = 1; i < data.length; i++) {
    if (data[i].time < data[i - 1].time) {
      console.warn(`[CryptoCompare] validate: time not monotonic at index ${i}`);
      return false;
    }
  }

  // 检查 OHLC 数据有效性（放宽：允许 high === low）
  const invalidBar = data.find(d =>
    d.high < d.low || d.high < d.open || d.high < d.close ||
    d.low > d.open || d.low > d.close ||
    d.open <= 0 || d.close <= 0 || d.high <= 0 || d.low <= 0
  );
  if (invalidBar) {
    console.warn(`[CryptoCompare] validate: invalid OHLC at time ${invalidBar.time}`);
    return false;
  }

  return true;
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
