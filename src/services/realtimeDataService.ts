/**
 * 实时数据聚合服务
 * 统一接入多源实时数据，转换为内部事件
 */

import type { FactorItem } from "./factorEngine";

// ── 事件类型 ──
export interface ProbabilityUpdateEvent {
  type: "probability_delta";
  factorId: string;
  oldProbability: number;
  newProbability: number;
  delta: number;
  source: "polymarket" | "kalshi" | "manual";
  timestamp: number;
  confidence: number;
}

export interface NewsEvent {
  type: "news_breaking";
  id: string;
  title: string;
  source: string;
  timestamp: number;
  sentiment: "bullish" | "bearish" | "neutral";
  sentimentScore: number;
  category: string;
  relatedAssets: string[];
}

export interface OnchainEvent {
  type: "onchain_alert";
  metric: string;
  value: number;
  zScore: number;
  direction: "spike" | "drop" | "anomaly";
  timestamp: number;
}

export type RealtimeEvent = ProbabilityUpdateEvent | NewsEvent | OnchainEvent;

// ── 事件监听器 ──
type EventHandler = (event: RealtimeEvent) => void;

class RealtimeDataService {
  private handlers = new Set<EventHandler>();
  private intervals: ReturnType<typeof setInterval>[] = [];
  private wsConnections: WebSocket[] = [];
  private isRunning = false;

  // 轮询配置
  private POLL_CONFIG = {
    polymarket: 30000,    // 30秒
    news: 60000,          // 1分钟
    fearGreed: 300000,    // 5分钟
    fundingRate: 60000,   // 1分钟
  };

  // 缓存
  private probabilityCache = new Map<string, number>();
  private processedNews = new Set<string>();
  private metricHistory = new Map<string, number[]>();

  // 启动所有数据源
  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    this.startPolymarketPolling();
    this.startNewsPolling();
    this.startFearGreedPolling();
    this.startFundingRatePolling();

    console.log("[Realtime] Service started");
  }

  // 停止所有数据源
  stop() {
    this.isRunning = false;
    this.intervals.forEach(clearInterval);
    this.intervals = [];
    this.wsConnections.forEach(ws => ws.close());
    this.wsConnections = [];
    console.log("[Realtime] Service stopped");
  }

  get running() {
    return this.isRunning;
  }

  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private emit(event: RealtimeEvent) {
    this.handlers.forEach(h => {
      try { h(event); } catch (e) { console.error(e); }
    });
  }

  // ── Polymarket 轮询 ──
  private async startPolymarketPolling() {
    const poll = async () => {
      try {
        const response = await fetch(
          "https://gamma-api.polymarket.com/markets?active=true&limit=20&sort=volume&order=desc"
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const markets = await response.json();

        if (!Array.isArray(markets)) return;

        for (const market of markets) {
          const marketId = String(market.id || "");
          if (!marketId) continue;

          const oldProb = this.getCachedProbability(marketId);
          let newProb: number;

          try {
            const prices = JSON.parse(market.outcomePrices || "[0.5,0.5]");
            newProb = parseFloat(String(prices[0])) || 0.5;
          } catch {
            newProb = 0.5;
          }

          if (oldProb !== null && Math.abs(newProb - oldProb) > 0.01) {
            this.emit({
              type: "probability_delta",
              factorId: `poly-${marketId}`,
              oldProbability: oldProb,
              newProbability: newProb,
              delta: newProb - oldProb,
              source: "polymarket",
              timestamp: Date.now(),
              confidence: 0.9,
            });
          }

          this.setCachedProbability(marketId, newProb);
        }
      } catch (err) {
        console.warn("[Realtime] Polymarket poll failed:", err);
      }
    };

    poll();
    this.intervals.push(setInterval(poll, this.POLL_CONFIG.polymarket));
  }

  // ── 新闻轮询 (多源) ──
  private async startNewsPolling() {
    const poll = async () => {
      // CoinGecko News
      try {
        const response = await fetch("https://api.coingecko.com/api/v3/news");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const items = data.data || [];

        for (const item of items.slice(0, 5)) {
          const newsId = `cg-${item.id || item.slug || Math.random()}`;
          if (this.isNewsProcessed(newsId)) continue;

          const sentiment = this.analyzeSentiment(item.title || "");
          this.emit({
            type: "news_breaking",
            id: newsId,
            title: item.title || "",
            source: item.author || "CoinGecko",
            timestamp: new Date(item.updated_at || Date.now()).getTime(),
            sentiment: sentiment.direction,
            sentimentScore: sentiment.score,
            category: this.categorizeNews(item.title || ""),
            relatedAssets: this.extractAssets(item.title || ""),
          });

          this.markNewsProcessed(newsId);
        }
      } catch (err) {
        console.warn("[Realtime] CoinGecko news poll failed:", err);
      }
    };

    poll();
    this.intervals.push(setInterval(poll, this.POLL_CONFIG.news));
  }

  // ── 恐惧贪婪指数 ──
  private async startFearGreedPolling() {
    const poll = async () => {
      try {
        const response = await fetch("https://api.alternative.me/fng/?limit=1");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const item = data.data?.[0];

        if (item) {
          const value = parseInt(item.value);
          const sentiment = value > 75 ? "bullish" : value < 25 ? "bearish" : "neutral";

          this.emit({
            type: "news_breaking",
            id: `fng-${item.timestamp}`,
            title: `Fear & Greed Index: ${value} (${item.value_classification})`,
            source: "alternative.me",
            timestamp: parseInt(item.timestamp) * 1000,
            sentiment,
            sentimentScore: (value - 50) / 50,
            category: "Sentiment",
            relatedAssets: ["BTC", "ETH"],
          });
        }
      } catch (err) {
        console.warn("[Realtime] FearGreed poll failed:", err);
      }
    };

    poll();
    this.intervals.push(setInterval(poll, this.POLL_CONFIG.fearGreed));
  }

  // ── 资金费率 ──
  private async startFundingRatePolling() {
    const poll = async () => {
      try {
        const response = await fetch(
          "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT"
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        const rate = parseFloat(data.lastFundingRate || "0");

        this.emit({
          type: "onchain_alert",
          metric: "funding_rate",
          value: rate,
          zScore: this.calculateZScore("funding_rate", rate),
          direction: rate > 0.001 ? "spike" : rate < -0.001 ? "drop" : "anomaly",
          timestamp: Date.now(),
        });
      } catch (err) {
        console.warn("[Realtime] Funding rate poll failed:", err);
      }
    };

    poll();
    this.intervals.push(setInterval(poll, this.POLL_CONFIG.fundingRate));
  }

  // ── 辅助方法 ──
  private getCachedProbability(id: string): number | null {
    return this.probabilityCache.get(id) ?? null;
  }

  private setCachedProbability(id: string, prob: number) {
    this.probabilityCache.set(id, prob);
  }

  private isNewsProcessed(id: string): boolean {
    return this.processedNews.has(id);
  }

  private markNewsProcessed(id: string) {
    this.processedNews.add(id);
    if (this.processedNews.size > 1000) {
      const first = this.processedNews.values().next().value;
      if (first) this.processedNews.delete(first);
    }
  }

  private analyzeSentiment(title: string): { direction: "bullish" | "bearish" | "neutral"; score: number } {
    const text = title.toLowerCase();
    const bullish = ["surge", "rally", "boom", "bull", "rise", "gain", "soar", "jump", "ath", "breakout", "approval", "adopt"];
    const bearish = ["crash", "drop", "fall", "bear", "decline", "dump", "plunge", "tumble", "collapse", "sell-off", "ban", "reject"];

    let score = 0;
    for (const w of bullish) if (text.includes(w)) score += 0.2;
    for (const w of bearish) if (text.includes(w)) score -= 0.2;

    score = Math.max(-1, Math.min(1, score));
    return {
      direction: score > 0.1 ? "bullish" : score < -0.1 ? "bearish" : "neutral",
      score,
    };
  }

  private categorizeNews(title: string): string {
    const t = title.toLowerCase();
    if (t.includes("etf") || t.includes("sec") || t.includes("regul")) return "Regulation";
    if (t.includes("fed") || t.includes("rate") || t.includes("inflation") || t.includes("cpi")) return "Monetary";
    if (t.includes("war") || t.includes("conflict") || t.includes("sanction")) return "Geopolitics";
    if (t.includes("halving") || t.includes("mining") || t.includes("blockchain")) return "CryptoNative";
    return "Sentiment";
  }

  private extractAssets(title: string): string[] {
    const assets: string[] = [];
    const t = title.toLowerCase();
    if (t.includes("bitcoin") || t.includes("btc")) assets.push("BTC");
    if (t.includes("ethereum") || t.includes("eth")) assets.push("ETH");
    if (t.includes("solana") || t.includes("sol")) assets.push("SOL");
    return assets;
  }

  private calculateZScore(metric: string, value: number): number {
    const history = this.metricHistory.get(metric) || [];
    history.push(value);
    if (history.length > 100) history.shift();
    this.metricHistory.set(metric, history);

    if (history.length < 10) return 0;

    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    const variance = history.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / history.length;
    const std = Math.sqrt(variance);

    return std > 0 ? (value - mean) / std : 0;
  }
}

// 单例导出
let _service: RealtimeDataService | null = null;

export function getRealtimeService(): RealtimeDataService {
  if (!_service) {
    _service = new RealtimeDataService();
  }
  return _service;
}
