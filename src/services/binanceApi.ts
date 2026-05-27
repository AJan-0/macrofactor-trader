// Binance API 服务层 —— 加密货币 K 线数据（备用数据源）
// 文档: https://binance-docs.github.io/apidocs/spot/en/#kline-candlestick-data
// 限制: 1200 request weight per minute (IP 限制)
// 优势: 免费，限制宽松，数据质量高

import type { AssetSymbol, Timeframe } from "@/store/appStore";
import type { KlineData } from "./cryptoCompare";

const BINANCE_BASE = "https://api.binance.com/api/v3";

// Asset 映射 (Binance 交易对格式)
const BINANCE_SYMBOL_MAP: Record<AssetSymbol, string> = {
  "BTC-USDT": "BTCUSDT",
  "ETH-USDT": "ETHUSDT",
  "SOL-USDT": "SOLUSDT",
  "GC=F": "PAXGUSDT", // PAXG = Paxos Gold
};

// Timeframe -> Binance interval 参数映射
const BINANCE_TIMEFRAME_MAP: Record<Timeframe, string> = {
  "1m": "1m",
  "3m": "3m",
  "5m": "5m",
  "15m": "15m",
  "1H": "1h",
  "4H": "4h",
  "1D": "1d",
};

// Binance 单次最大返回 1000 条
const BINANCE_MAX_LIMIT = 1000;
const BINANCE_MAX_REQUESTS = 100; // 足够获取 3 年数据

type BinanceKline = [
  number,
  string,
  string,
  string,
  string,
  string,
  ...unknown[]
];

interface BinanceTicker24h {
  lastPrice: string;
  volume: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
}

// 请求权重管理（Binance 使用 weight 限制而非请求数）
let _binanceWeightUsed = 0;
let _binanceWeightResetTime = Date.now() + 60000;

async function binanceRateLimitedFetch(url: string, signal?: AbortSignal): Promise<unknown> {
  const now = Date.now();
  
  // 检查是否需要重置权重计数
  if (now >= _binanceWeightResetTime) {
    _binanceWeightUsed = 0;
    _binanceWeightResetTime = now + 60000;
  }
  
  // 每个 K 线请求 weight = 1
  // 留 20% 余量
  if (_binanceWeightUsed >= 960) {
    const waitMs = _binanceWeightResetTime - now;
    console.log(`[Binance] Rate limit approaching, waiting ${waitMs}ms...`);
    await new Promise(r => setTimeout(r, waitMs + 100));
    _binanceWeightUsed = 0;
    _binanceWeightResetTime = Date.now() + 60000;
  }
  
  try {
    const res = await fetch(url, { signal });
    _binanceWeightUsed++;
    
    // 检查响应头中的剩余权重
    const remainingWeight = res.headers.get('x-mbx-used-weight-1m');
    if (remainingWeight) {
      const used = parseInt(remainingWeight, 10);
      if (used > 1000) {
        console.warn(`[Binance] Weight usage high: ${used}/1200`);
      }
    }
    
    if (!res.ok) {
      const errData = await res.json().catch(() => ({})) as { msg?: string };
      const errMsg = errData.msg || `HTTP ${res.status}`;
      throw new Error(errMsg);
    }
    
    return await res.json();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    throw err;
  }
}

/**
 * 从 Binance 获取历史 K 线数据
 * Binance API 返回数据按时间升序排列（最早在前）
 * [
 *   [
 *     1499040000000,      // Open time
 *     "0.01634790",       // Open
 *     "0.80000000",       // High
 *     "0.01575800",       // Low
 *     "0.01577100",       // Close
 *     "148976.11427815",  // Volume
 *     1499644799999,      // Close time
 *     "2434.19055334",    // Quote asset volume
 *     308,                // Number of trades
 *     "1756.87402397",    // Taker buy base asset volume
 *     "28.46694368",      // Taker buy quote asset volume
 *     "17928899.62484339" // Ignore
 *   ]
 * ]
 */
export async function fetchKlinesFromBinance(
  symbol: AssetSymbol,
  tf: Timeframe,
  targetDays?: number,
  signal?: AbortSignal
): Promise<KlineData[]> {
  const binanceSymbol = BINANCE_SYMBOL_MAP[symbol];
  const interval = BINANCE_TIMEFRAME_MAP[tf];
  
  if (!binanceSymbol || !interval) {
    throw new Error(`Unsupported symbol ${symbol} or timeframe ${tf} for Binance`);
  }
  
  const days = targetDays ?? 365 * 3;
  const cfg = getBarsPerDay(tf);
  const targetBars = Math.ceil(days * cfg);
  
  const allKlines: KlineData[] = [];
  let endTime: number | undefined = undefined;
  let requests = 0;
  
  while (allKlines.length < targetBars && requests < BINANCE_MAX_REQUESTS) {
    if (signal?.aborted) throw new Error("Aborted");
    
    const limit = Math.min(BINANCE_MAX_LIMIT, targetBars - allKlines.length);
    let url = `${BINANCE_BASE}/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${limit}`;
    if (endTime) url += `&endTime=${endTime}`;
    
    const raw = await binanceRateLimitedFetch(url, signal) as BinanceKline[];
    
    if (!raw.length) break;
    
    const batch: KlineData[] = raw.map(d => ({
      time: Math.floor(d[0] / 1000), // Binance 返回毫秒时间戳
      open: parseFloat(d[1]),
      high: parseFloat(d[2]),
      low: parseFloat(d[3]),
      close: parseFloat(d[4]),
      volume: parseFloat(d[5]),
    }));
    
    allKlines.unshift(...batch); // Binance 返回升序，新数据追加到前面
    
    // 下一页：获取比当前最早数据更早的数据
    const oldestTime = raw[0][0]; // 最早数据的时间戳（毫秒）
    endTime = oldestTime - 1;
    
    requests++;
    
    // 如果返回数据少于请求数量，说明已到最早数据
    if (raw.length < limit) break;
  }
  
  // 去重
  const seen = new Set<number>();
  const unique = allKlines.filter(k => {
    if (seen.has(k.time)) return false;
    seen.add(k.time);
    return true;
  });
  
  console.log(
    `[Binance] ${symbol} ${tf}: ${unique.length} bars ` +
    `(target ~${targetBars}, ${requests} requests, ` +
    `latest $${unique.at(-1)?.close?.toFixed(2) ?? 'N/A'})`
  );
  
  return unique;
}

function getBarsPerDay(tf: Timeframe): number {
  switch (tf) {
    case "1m": return 24 * 60;
    case "3m": return 24 * 20;
    case "5m": return 24 * 12;
    case "15m": return 24 * 4;
    case "1H": return 24;
    case "4H": return 6;
    case "1D": return 1;
    default: return 24;
  }
}

/**
 * 获取实时价格（Binance）
 */
export async function fetchRealtimePriceFromBinance(
  symbol: AssetSymbol,
  signal?: AbortSignal
): Promise<{ price: number; volume24h: number; change24hPct: number; high24h: number; low24h: number }> {
  const binanceSymbol = BINANCE_SYMBOL_MAP[symbol];
  if (!binanceSymbol) throw new Error(`Unsupported symbol ${symbol}`);
  
  const url = `${BINANCE_BASE}/ticker/24hr?symbol=${binanceSymbol}`;
  const data = await binanceRateLimitedFetch(url, signal) as BinanceTicker24h;
  
  return {
    price: parseFloat(data.lastPrice),
    volume24h: parseFloat(data.volume),
    change24hPct: parseFloat(data.priceChangePercent),
    high24h: parseFloat(data.highPrice),
    low24h: parseFloat(data.lowPrice),
  };
}

/**
 * 检查 Binance 是否支持某个交易对
 */
export async function checkBinanceSymbol(symbol: AssetSymbol): Promise<boolean> {
  const binanceSymbol = BINANCE_SYMBOL_MAP[symbol];
  if (!binanceSymbol) return false;
  
  try {
    const url = `${BINANCE_BASE}/exchangeInfo?symbol=${binanceSymbol}`;
    const res = await fetch(url);
    const data = await res.json();
    return data.symbols && data.symbols.length > 0;
  } catch {
    return false;
  }
}
