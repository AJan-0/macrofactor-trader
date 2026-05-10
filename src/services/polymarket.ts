import type { FactorItem } from "./factorEngine";

const GAMMA_API = "https://gamma-api.polymarket.com";

// 精选静态因子数据（当API不可用时使用）
const STATIC_FACTORS: FactorItem[] = [
  { id: "btc-1m", name: "Bitcoin hits $1M before 2027?", category: "CryptoNative", subcategory: "PriceTarget", probability: 0.49, volume24h: 3974, liquidity: 125092, endDate: "2026-12-31", oneDayChange: 0.003, oneWeekChange: 0.003, source: "Polymarket", relevance_score: 0.95, impact_description: "BTC $1M implies massive institutional adoption", enabled: true, weight: 1.0 },
  { id: "ukraine-ceasefire", name: "Russia-Ukraine ceasefire before July 2026?", category: "Geopolitics", subcategory: "War", probability: 0.56, volume24h: 945, liquidity: 51518, endDate: "2026-07-31", oneDayChange: 0, oneWeekChange: -0.015, source: "Polymarket", relevance_score: 0.75, impact_description: "Ceasefire reduces energy uncertainty", enabled: true, weight: 1.0 },
  { id: "taiwan-conflict", name: "China military action against Taiwan before 2027?", category: "Geopolitics", subcategory: "War", probability: 0.18, volume24h: 116, liquidity: 47059, endDate: "2026-12-31", oneDayChange: 0, oneWeekChange: 0.01, source: "Polymarket", relevance_score: 0.85, impact_description: "Taiwan conflict threatens semiconductor supply chain", enabled: true, weight: 1.0 },
  { id: "trump-tariff", name: "Trump implements new China tariffs >50% in 2026?", category: "Geopolitics", subcategory: "TradeWar", probability: 0.35, volume24h: 2200, liquidity: 42000, endDate: "2026-12-31", oneDayChange: 0.01, oneWeekChange: -0.02, source: "Polymarket", relevance_score: 0.80, impact_description: "High tariffs boost inflation pressure", enabled: true, weight: 1.0 },
  { id: "fed-cut-jun", name: "Fed cuts rates at June 2026 meeting?", category: "Monetary", subcategory: "RateDecision", probability: 0.04, volume24h: 5600, liquidity: 98000, endDate: "2026-06-17", oneDayChange: -0.01, oneWeekChange: -0.03, source: "Polymarket", relevance_score: 0.98, impact_description: "Rate cuts inject liquidity, bullish for BTC", enabled: true, weight: 1.0 },
  { id: "us-recession", name: "US recession declared by NBER in 2026?", category: "Sentiment", subcategory: "Recession", probability: 0.28, volume24h: 1800, liquidity: 76000, endDate: "2026-12-31", oneDayChange: 0.005, oneWeekChange: 0.01, source: "Polymarket", relevance_score: 0.88, impact_description: "Recession triggers flight to safety", enabled: true, weight: 1.0 },
  { id: "eth-etf", name: "ETH spot ETF approved with staking by end 2026?", category: "Regulation", subcategory: "ETF", probability: 0.42, volume24h: 1200, liquidity: 35000, endDate: "2026-12-31", oneDayChange: 0.02, oneWeekChange: 0.05, source: "Polymarket", relevance_score: 0.90, impact_description: "ETH ETF unlocks institutional demand", enabled: true, weight: 1.0 },
  { id: "sec-gensler", name: "SEC Chair Gensler replaced before end 2026?", category: "Regulation", subcategory: "Leadership", probability: 0.55, volume24h: 800, liquidity: 28000, endDate: "2026-12-31", oneDayChange: 0.005, oneWeekChange: 0.01, source: "Polymarket", relevance_score: 0.82, impact_description: "Gensler departure could ease SEC stance", enabled: true, weight: 1.0 },
];

let _lastFetch = 0;
const MIN_INTERVAL = 1000;

async function rateLimitedFetch(url: string): Promise<any> {
  const now = Date.now();
  const wait = Math.max(0, MIN_INTERVAL - (now - _lastFetch));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastFetch = Date.now();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function parseMarket(m: any): FactorItem | null {
  try {
    let prices: number[];
    try { prices = JSON.parse(m.outcomePrices || "[0.5,0.5]"); }
    catch { prices = [0.5, 0.5]; }
    const prob = parseFloat(String(prices[0])) || 0.5;
    const q = (m.question || "").toLowerCase();
    let cat: any = "Sentiment";
    if (q.includes("bitcoin") || q.includes("btc") || q.includes("eth") || q.includes("crypto")) cat = "CryptoNative";
    else if (q.includes("fed") || q.includes("rate")) cat = "Monetary";
    else if (q.includes("ukraine") || q.includes("russia") || q.includes("iran") || q.includes("israel") || q.includes("taiwan") || q.includes("china") || q.includes("war")) cat = "Geopolitics";
    else if (q.includes("etf") || q.includes("gensler") || q.includes("sec")) cat = "Regulation";
    else if (q.includes("inflation") || q.includes("cpi")) cat = "Inflation";
    return {
      id: String(m.id || Math.random()), name: String(m.question || "Unknown"),
      category: cat, subcategory: "Polymarket", probability: prob,
      volume24h: m.volume24hr || 0, liquidity: m.liquidityNum || 0,
      endDate: m.endDate || "", oneDayChange: m.oneDayPriceChange || 0,
      oneWeekChange: m.oneWeekPriceChange || 0, relevance_score: 0.6,
      impact_description: "", source: "Polymarket" as const,
      enabled: true, weight: 1.0,
    };
  } catch { return null; }
}

export async function fetchKeyMarkets(): Promise<FactorItem[]> {
  const merged = [...STATIC_FACTORS];
  const existingIds = new Set(merged.map(m => m.id));

  try {
    const all = await rateLimitedFetch(`${GAMMA_API}/markets?active=true&limit=50&sort=volume&order=desc`);
    if (Array.isArray(all)) {
      const kw = ["bitcoin","btc","ethereum","eth","crypto","fed","rate","recession","inflation","cpi","ukraine","russia","iran","israel","china","taiwan","tariff","war","etf","gensler","sec","halving"];
      for (const m of all) {
        const q = (m.question || "").toLowerCase();
        if (!kw.some(k => q.includes(k))) continue;
        const parsed = parseMarket(m);
        if (parsed && !existingIds.has(parsed.id) && parsed.volume24h > 100) {
          merged.push(parsed);
          existingIds.add(parsed.id);
        }
      }
    }
  } catch (err) {
    console.warn("[Polymarket] Live API failed, using static data only");
  }

  return merged;
}
