import type { FactorCategory } from "@/services/factorEngine";

export type Sentiment = "bullish" | "bearish" | "neutral";

export interface NewsItem {
  id: string;
  title: string;
  titleZh: string;
  source: string;
  timestamp: number;
  date_str: string;
  category: FactorCategory;
  sentiment: Sentiment;
  sentimentScore: number; // -1 to 1
  summary: string;
  summaryZh: string;
  relatedAssets: string[]; // e.g. ["BTC", "ETH"]
  impactLevel: "high" | "medium" | "low";
  keywords: string[];
}

/** @deprecated 新闻已改为从 API 实时获取，MOCK_NEWS 已清空 */
export const MOCK_NEWS: NewsItem[] = [];

export function searchNews(items: NewsItem[], q: string): NewsItem[] {
  const query = q.toLowerCase();
  return items.filter(
    n =>
      n.title.toLowerCase().includes(query) ||
      n.summary.toLowerCase().includes(query) ||
      n.source.toLowerCase().includes(query) ||
      n.keywords.some(k => k.toLowerCase().includes(query))
  );
}
