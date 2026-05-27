/**
 * 概率重算引擎
 * 基于贝叶斯更新和冲击检测，实时调整因子概率
 */

import type { FactorItem } from "./factorEngine";
import type { RealtimeEvent } from "./realtimeDataService";

export interface ProbabilityUpdate {
  factorId: string;
  newProbability: number;
  confidence: number;
  reason: string;
  source: string;
  timestamp: number;
}

// 贝叶斯更新：P(H|E) = P(E|H) * P(H) / P(E)
export function bayesianUpdate(
  priorProbability: number,
  likelihoodRatio: number,
  evidenceStrength: number
): number {
  // 避免极端值
  const prior = Math.max(0.01, Math.min(0.99, priorProbability));
  const priorOdds = prior / (1 - prior);
  const posteriorOdds = priorOdds * Math.pow(likelihoodRatio, evidenceStrength);
  const result = posteriorOdds / (1 + posteriorOdds);
  return Math.max(0.01, Math.min(0.99, result));
}

// 时间衰减函数：旧概率随时间指数衰减
export function timeDecay(
  probability: number,
  hoursSinceUpdate: number,
  halfLifeHours: number = 24
): number {
  const decay = Math.pow(0.5, hoursSinceUpdate / halfLifeHours);
  return 0.5 + (probability - 0.5) * decay;
}

// 冲击检测：检测概率的异常变化
export function detectShock(
  currentProb: number,
  history: number[],
  threshold: number = 2.5
): { isShock: boolean; zScore: number; direction: "up" | "down" } {
  if (history.length < 5) return { isShock: false, zScore: 0, direction: "up" };

  const mean = history.reduce((a, b) => a + b, 0) / history.length;
  const variance = history.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / history.length;
  const std = Math.sqrt(variance);

  const zScore = std > 0 ? (currentProb - mean) / std : 0;

  return {
    isShock: Math.abs(zScore) > threshold,
    zScore,
    direction: currentProb > mean ? "up" : "down",
  };
}

// 主重算函数
export function recalculateProbability(
  factor: FactorItem,
  event: RealtimeEvent,
  history: number[]
): ProbabilityUpdate | null {
  switch (event.type) {
    case "probability_delta": {
      // 直接来自预测市场的概率更新
      const factorNameLower = factor.name.toLowerCase();
      const eventIdLower = event.factorId.toLowerCase();

      // 匹配逻辑：ID包含或名称包含
      const isMatch = eventIdLower.includes(factor.id.toLowerCase()) ||
        factorNameLower.includes(eventIdLower.replace("poly-", "")) ||
        eventIdLower.includes(factorNameLower.slice(0, 20));

      if (isMatch) {
        const shock = detectShock(event.newProbability, history);

        return {
          factorId: factor.id,
          newProbability: event.newProbability,
          confidence: Math.min(1, event.confidence * (shock.isShock ? 1.2 : 1.0)),
          reason: shock.isShock
            ? `概率冲击: ${event.delta > 0 ? "+" : ""}${(event.delta * 100).toFixed(1)}%`
            : `预测市场更新: ${event.delta > 0 ? "+" : ""}${(event.delta * 100).toFixed(1)}%`,
          source: event.source,
          timestamp: event.timestamp,
        };
      }
      break;
    }

    case "news_breaking": {
      // 新闻事件影响相关因子
      const relevance = calculateNewsRelevance(factor, event);
      if (relevance > 0.3) {
        const likelihoodRatio = event.sentiment === "bullish" ? 1.5 : event.sentiment === "bearish" ? 0.67 : 1.0;
        const newProb = bayesianUpdate(factor.probability, likelihoodRatio, relevance);

        return {
          factorId: factor.id,
          newProbability: newProb,
          confidence: Math.abs(event.sentimentScore) * relevance,
          reason: `新闻: ${event.title.slice(0, 40)}...`,
          source: event.source,
          timestamp: event.timestamp,
        };
      }
      break;
    }

    case "onchain_alert": {
      // 链上数据影响相关因子
      if (factor.category === "CryptoNative" || factor.category === "Sentiment") {
        const impact = Math.min(1, Math.abs(event.zScore) / 3);
        const direction = event.direction === "spike" ? 1.2 : event.direction === "drop" ? 0.8 : 1.0;
        const newProb = bayesianUpdate(factor.probability, direction, impact);

        return {
          factorId: factor.id,
          newProbability: newProb,
          confidence: impact,
          reason: `链上异动: ${event.metric} ${event.direction} (Z=${event.zScore.toFixed(2)})`,
          source: "onchain",
          timestamp: event.timestamp,
        };
      }
      break;
    }
  }

  return null;
}

// 计算新闻与因子的相关性
function calculateNewsRelevance(
  factor: FactorItem,
  news: RealtimeEvent & { type: "news_breaking" }
): number {
  let score = 0;
  const factorText = `${factor.name} ${factor.subcategory} ${factor.impact_description}`.toLowerCase();
  const newsText = news.title.toLowerCase();

  // 关键词匹配
  const factorWords = factorText.split(/\s+/).filter(w => w.length > 3);
  for (const word of factorWords) {
    if (newsText.includes(word)) score += 0.1;
  }

  // 分类匹配
  if (factor.category.toLowerCase() === news.category.toLowerCase()) score += 0.3;

  // 资产匹配
  if (news.relatedAssets.some(a => factorText.includes(a.toLowerCase()))) score += 0.2;

  return Math.min(1, score);
}
