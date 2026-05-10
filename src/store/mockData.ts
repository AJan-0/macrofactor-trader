// K线数据生成工具 —— 当实时API不可用时回退使用
// 宏观因子数据现在从 /data/factors.json 加载

import type { AssetSymbol, Timeframe } from "./appStore";

export interface KlineData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const REAL_DATA_CACHE: Record<string, KlineData[]> = {};

async function loadRealData(symbol: AssetSymbol): Promise<KlineData[]> {
  const key = symbol === "ETH-USDT" ? "eth" : symbol === "GC=F" ? "gold" : "btc";
  if (REAL_DATA_CACHE[key]) return REAL_DATA_CACHE[key];

  try {
    const resp = await fetch(`/data/${key}_1d.json`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data: KlineData[] = await resp.json();
    data.sort((a, b) => a.time - b.time);
    REAL_DATA_CACHE[key] = data;
    return data;
  } catch (err) {
    console.error(`[MockData] Failed to load ${key}_1d.json:`, err);
    return [];
  }
}

function downsample(klines: KlineData[], barsPerDay: number): KlineData[] {
  if (barsPerDay <= 1) return klines;
  const result: KlineData[] = [];
  for (let i = 0; i < klines.length; i += barsPerDay) {
    const chunk = klines.slice(i, i + barsPerDay);
    if (chunk.length === 0) continue;
    const baseTime = chunk[0].time;
    const barSeconds = 86400 / barsPerDay;
    chunk.forEach((k, idx) => {
      const t = baseTime + idx * barSeconds;
      const jitter = (Math.random() - 0.5) * 0.003;
      const o = k.open * (1 + jitter);
      const c = k.close * (1 + jitter * 0.5);
      result.push({
        time: Math.floor(t), open: o,
        high: Math.max(o, c) * 1.0015,
        low: Math.min(o, c) * 0.9985,
        close: c, volume: Math.floor(k.volume / barsPerDay),
      });
    });
  }
  return result;
}

export async function generateMockKlines(symbol: AssetSymbol, timeframe: Timeframe): Promise<KlineData[]> {
  const raw1D = await loadRealData(symbol);
  if (!raw1D.length) return [];

  const barsPerDay =
    timeframe === "15m" ? 96 :
    timeframe === "1H"  ? 24 :
    timeframe === "4H"  ? 6 : 1;

  return downsample(raw1D, barsPerDay);
}
