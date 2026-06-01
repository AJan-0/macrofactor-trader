// 新闻 API 服务层 —— CoinGecko News (免 key) + MOCK_NEWS 兜底

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NewsItem, Sentiment } from "@/data/mockNews";
import { MOCK_NEWS } from "@/data/mockNews";

const CG_NEWS_URL = "https://api.coingecko.com/api/v3/news";
const CACHE_TTL = 5 * 60 * 1000; // 5分钟

let _cache: NewsItem[] | null = null;
let _cacheTs = 0;

interface CGNewsEntry {
  title: string;
  description: string | null;
  url: string;
  thumb_2x: string | null;
  author: string | null;
  updated_at: string; // ISO 8601
}

function detectSentiment(title: string, desc: string): { sentiment: Sentiment; score: number } {
  const text = (title + " " + (desc || "")).toLowerCase();
  const bullish = ["surge", "rally", "boom", "bull", "rise", "gain", "soar", "jump", "rally", " ATH", "record", "breakout", "approval", "adopt", "rally"];
  const bearish = ["crash", "drop", "fall", "bear", "decline", "dump", "plunge", "tumble", "collapse", "sell-off", "correction", "ban", "reject", "crackdown", "fear"];

  let score = 0;
  for (const w of bullish) if (text.includes(w.toLowerCase())) score += 0.15;
  for (const w of bearish) if (text.includes(w.toLowerCase())) score -= 0.15;

  score = Math.max(-1, Math.min(1, score));
  if (score > 0.1) return { sentiment: "bullish", score };
  if (score < -0.1) return { sentiment: "bearish", score };
  return { sentiment: "neutral", score };
}

function detectCategory(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("etf") || t.includes("sec") || t.includes("regul") || t.includes("approve")) return "Regulation";
  if (t.includes("fed") || t.includes("rate") || t.includes("inflation") || t.includes("cpi")) return "Monetary";
  if (t.includes("war") || t.includes("conflict") || t.includes("tension") || t.includes("sanction")) return "Geopolitics";
  if (t.includes("halving") || t.includes("mining") || t.includes("blockchain") || t.includes("deFi")) return "CryptoNative";
  return "Sentiment";
}

function cgToNewsItem(item: CGNewsEntry, idx: number): NewsItem {
  const ts = Math.floor(new Date(item.updated_at).getTime() / 1000);
  const { sentiment, score } = detectSentiment(item.title, item.description || "");
  const cat = detectCategory(item.title);
  return {
    id: `cg-${idx}-${ts}`,
    title: item.title,
    titleZh: item.title, // 暂无翻译， fallback 到原文
    source: item.author || "CoinGecko",
    timestamp: ts,
    date_str: new Date(item.updated_at).toISOString().slice(0, 10),
    category: cat as any,
    sentiment,
    sentimentScore: score,
    summary: item.description || item.title,
    summaryZh: item.description || item.title,
    relatedAssets: ["BTC", "ETH"],
    impactLevel: Math.abs(score) > 0.4 ? "high" : Math.abs(score) > 0.15 ? "medium" : "low",
    keywords: item.title.split(" ").slice(0, 5),
  };
}

export async function fetchRealNews(): Promise<NewsItem[]> {
  // 内存缓存
  if (_cache && Date.now() - _cacheTs < CACHE_TTL) {
    console.log("[NewsAPI] Using cached news");
    return _cache;
  }

  try {
    const res = await fetch(CG_NEWS_URL, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const data: CGNewsEntry[] = json.data || [];
    if (!data.length) throw new Error("No news returned");

    const items = data.slice(0, 30).map(cgToNewsItem);
    console.log(`[NewsAPI] Fetched ${items.length} news items from CoinGecko`);

    _cache = items.sort((a, b) => b.timestamp - a.timestamp);
    _cacheTs = Date.now();
    return _cache;
  } catch (err) {
    console.warn("[NewsAPI] Failed to fetch real news, falling back to mock data:", err);
    // 降级到 mock 数据，保证用户界面总有内容展示
    return [...MOCK_NEWS];
  }
}

export function clearNewsCache() {
  _cache = null;
  _cacheTs = 0;
}
