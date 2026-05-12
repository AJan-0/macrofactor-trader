import type { FactorItem, FactorCategory } from "@/services/factorEngine";

// ──────────────────────────────
// 内置扩展因子库 —— 50+ 真实影响市场的因子
// 每个因子有：name/category/probability/weight/relevance_score
// ──────────────────────────────

// ──────────────────────────────
// 多维过滤类型定义
// ──────────────────────────────

export interface FactorFilters {
  search: string;
  category: string | null;
  timeRange: "all" | "thisWeek" | "nextWeek" | "thisMonth" | "longTerm" | "noDate";
  direction: "all" | "bullish" | "bearish" | "neutral";
  status: "all" | "enabled" | "disabled" | "custom";
}

export interface RecommendedFactor {
  factor: FactorItem;
  reason: string;
  reasonType: "thisWeek" | "nextWeek" | "highRelevance" | "categoryGap";
  priority: number;
}

function getDaysUntil(endDate: string): number | null {
  if (!endDate) return null;
  const days = Math.ceil((new Date(endDate).getTime() - Date.now()) / 86400000);
  return days;
}

export function getFactorDirection(f: FactorItem): "bullish" | "bearish" | "neutral" {
  if (f.directionOverride) return f.directionOverride;
  const p = f.probability;
  const q = f.name.toLowerCase();
  if (q.includes("cut") || q.includes("降息") || q.includes("ease")) return p > 0.5 ? "bullish" : "bearish";
  if (q.includes("hike") || q.includes("加息")) return p > 0.5 ? "bearish" : "bullish";
  if (q.includes("etf") && (q.includes("approve") || q.includes("通过"))) return p > 0.4 ? "bullish" : "neutral";
  if (q.includes("ban") || q.includes("禁止") || q.includes("war") || q.includes("战争")) return p > 0.4 ? "bearish" : "neutral";
  return p > 0.55 ? "bullish" : p < 0.45 ? "bearish" : "neutral";
}

// ──────────────────────────────
// 批量操作工具函数
// ──────────────────────────────

export function enableAll(factors: FactorItem[]): FactorItem[] {
  return factors.map(f => ({ ...f, enabled: true }));
}

export function disableAll(factors: FactorItem[]): FactorItem[] {
  return factors.map(f => ({ ...f, enabled: false }));
}

export function enableThisWeek(factors: FactorItem[]): FactorItem[] {
  return factors.map(f => {
    const days = getDaysUntil(f.endDate);
    const shouldEnable = days !== null && days <= 7 && days >= 0;
    return { ...f, enabled: shouldEnable };
  });
}

export function enableNextWeek(factors: FactorItem[]): FactorItem[] {
  return factors.map(f => {
    const days = getDaysUntil(f.endDate);
    const shouldEnable = days !== null && days > 7 && days <= 14;
    return { ...f, enabled: shouldEnable };
  });
}

// ──────────────────────────────
// 智能因子推荐
// ──────────────────────────────

export function getRecommendedFactors(factors: FactorItem[]): RecommendedFactor[] {
  const recommendations: RecommendedFactor[] = [];
  const enabledCats = new Set(factors.filter(f => f.enabled).map(f => f.category));

  for (const f of factors) {
    if (f.enabled) continue;
    const days = getDaysUntil(f.endDate);

    // 本周热门
    if (days !== null && days <= 7 && days >= 0 && f.relevance_score >= 0.7) {
      recommendations.push({
        factor: f,
        reason: `Ends in ${days} days — high relevance to BTC`,
        reasonType: "thisWeek",
        priority: 1,
      });
      continue;
    }

    // 下周焦点
    if (days !== null && days > 7 && days <= 14 && f.relevance_score >= 0.7) {
      recommendations.push({
        factor: f,
        reason: `Coming up next week (${days} days)`,
        reasonType: "nextWeek",
        priority: 2,
      });
      continue;
    }

    // 高相关因子
    if (f.relevance_score >= 0.95) {
      recommendations.push({
        factor: f,
        reason: `Very high BTC relevance (${(f.relevance_score * 100).toFixed(0)}%)`,
        reasonType: "highRelevance",
        priority: 3,
      });
      continue;
    }

    // 分类缺口（当前活跃分类中占比最高的分类，推荐同类未启用因子）
    if (enabledCats.has(f.category) && f.relevance_score >= 0.75) {
      recommendations.push({
        factor: f,
        reason: `Same category as your active factors`,
        reasonType: "categoryGap",
        priority: 4,
      });
    }
  }

  // 去重并按优先级排序，最多返回 5 条
  const seen = new Set<string>();
  return recommendations
    .sort((a, b) => a.priority - b.priority)
    .filter(r => {
      if (seen.has(r.factor.id)) return false;
      seen.add(r.factor.id);
      return true;
    })
    .slice(0, 5);
}

// ──────────────────────────────
// 多维过滤
// ──────────────────────────────

export function filterFactors(factors: FactorItem[], filters: FactorFilters): FactorItem[] {
  let list = [...factors];

  // 搜索
  if (filters.search.trim()) {
    const q = filters.search.toLowerCase();
    list = list.filter(f =>
      f.name.toLowerCase().includes(q) ||
      f.subcategory.toLowerCase().includes(q) ||
      f.category.toLowerCase().includes(q) ||
      f.impact_description.toLowerCase().includes(q)
    );
  }

  // 分类
  if (filters.category) {
    list = list.filter(f => f.category === filters.category);
  }

  // 时间范围
  if (filters.timeRange !== "all") {
    list = list.filter(f => {
      const days = getDaysUntil(f.endDate);
      switch (filters.timeRange) {
        case "thisWeek": return days !== null && days <= 7 && days >= 0;
        case "nextWeek": return days !== null && days > 7 && days <= 14;
        case "thisMonth": return days !== null && days > 14 && days <= 30;
        case "longTerm": return days !== null && days > 30;
        case "noDate": return days === null;
        default: return true;
      }
    });
  }

  // 方向
  if (filters.direction !== "all") {
    list = list.filter(f => getFactorDirection(f) === filters.direction);
  }

  // 状态
  if (filters.status !== "all") {
    switch (filters.status) {
      case "enabled": list = list.filter(f => f.enabled); break;
      case "disabled": list = list.filter(f => !f.enabled); break;
      case "custom": list = list.filter(f => f.userAdded); break;
    }
  }

  return list;
}

// ──────────────────────────────
// EndDate 标签工具
// ──────────────────────────────

export type EndDateLabel = "expired" | "thisWeek" | "nextWeek" | "longTerm" | "noDate";

export function getEndDateLabel(endDate: string): { label: EndDateLabel; text: string; color: string } {
  const days = getDaysUntil(endDate);
  if (days === null) return { label: "noDate", text: "∞", color: "#475569" };
  if (days < 0) return { label: "expired", text: "Expired", color: "#ef4444" };
  if (days <= 7) return { label: "thisWeek", text: `${days}d`, color: "#f97316" };
  if (days <= 14) return { label: "nextWeek", text: `${days}d`, color: "#eab308" };
  return { label: "longTerm", text: `${days}d`, color: "#22c55e" };
}

export const BUILTIN_LIBRARY: FactorItem[] = [
  // === 货币政策 (Monetary) ===
  { id: "lib-fed-cut-jun", name: "Fed cuts rates at June 2026 meeting?", category: "Monetary", subcategory: "FOMC", probability: 0.04, volume24h: 5600, liquidity: 98000, endDate: "2026-06-17", oneDayChange: -0.01, oneWeekChange: -0.03, relevance_score: 0.98, impact_description: "Rate cuts inject liquidity, historically bullish for BTC", source: "Polymarket", enabled: true, weight: 1.0 },
  { id: "lib-fed-cut-jul", name: "Fed cuts rates at July 2026 meeting?", category: "Monetary", subcategory: "FOMC", probability: 0.13, volume24h: 4200, liquidity: 87000, endDate: "2026-07-29", oneDayChange: 0.01, oneWeekChange: 0.02, relevance_score: 0.98, impact_description: "Summer rate cut would surprise markets", source: "Polymarket", enabled: false, weight: 1.0 },
  { id: "lib-fed-cut-sep", name: "Fed cuts rates at September 2026 meeting?", category: "Monetary", subcategory: "FOMC", probability: 0.27, volume24h: 3800, liquidity: 82000, endDate: "2026-09-16", oneDayChange: 0.01, oneWeekChange: 0.03, relevance_score: 0.97, impact_description: "Autumn cut with new dot plot projections", source: "Polymarket", enabled: false, weight: 1.0 },
  { id: "lib-qe", name: "Fed resumes quantitative easing in 2026?", category: "Monetary", subcategory: "QE", probability: 0.08, volume24h: 1500, liquidity: 45000, endDate: "2026-12-31", oneDayChange: 0.002, oneWeekChange: 0.01, relevance_score: 0.96, impact_description: "QE restart = massive liquidity injection → extremely bullish", source: "Polymarket", enabled: false, weight: 1.5 },

  // === 通胀 (Inflation) ===
  { id: "lib-cpi-apr", name: "April 2026 CPI YoY > 3.5%?", category: "Inflation", subcategory: "CPI", probability: 0.30, volume24h: 1800, liquidity: 52000, endDate: "2026-05-12", oneDayChange: -0.01, oneWeekChange: 0.02, relevance_score: 0.92, impact_description: "High CPI = reduced rate cut probability", source: "Polymarket", enabled: true, weight: 1.0 },

  // === 地缘政治 (Geopolitics) ===
  { id: "lib-ukraine", name: "Russia-Ukraine ceasefire before July 2026?", category: "Geopolitics", subcategory: "War", probability: 0.56, volume24h: 945, liquidity: 51518, endDate: "2026-07-31", oneDayChange: 0, oneWeekChange: -0.015, relevance_score: 0.75, impact_description: "Ceasefire reduces energy uncertainty", source: "Polymarket", enabled: true, weight: 0.8 },
  { id: "lib-taiwan", name: "China military action against Taiwan before 2027?", category: "Geopolitics", subcategory: "War", probability: 0.18, volume24h: 116, liquidity: 47059, endDate: "2026-12-31", oneDayChange: 0, oneWeekChange: 0.01, relevance_score: 0.85, impact_description: "Taiwan conflict threatens semiconductor supply chain", source: "Polymarket", enabled: true, weight: 0.8 },
  { id: "lib-iran-israel", name: "Israel strikes Iran nuclear facilities in 2026?", category: "Geopolitics", subcategory: "War", probability: 0.22, volume24h: 2100, liquidity: 58000, endDate: "2026-12-31", oneDayChange: 0.005, oneWeekChange: 0.02, relevance_score: 0.88, impact_description: "Iran strike = oil spike + risk-off", source: "Polymarket", enabled: true, weight: 0.8 },
  { id: "lib-trump-tariff", name: "Trump implements new China tariffs >50% in 2026?", category: "Geopolitics", subcategory: "TradeWar", probability: 0.35, volume24h: 2200, liquidity: 42000, endDate: "2026-12-31", oneDayChange: 0.01, oneWeekChange: -0.02, relevance_score: 0.80, impact_description: "High tariffs boost inflation pressure", source: "Polymarket", enabled: true, weight: 0.8 },
  { id: "lib-dollar-weak", name: "US Dollar Index falls below 95 in 2026?", category: "Geopolitics", subcategory: "Currency", probability: 0.12, volume24h: 2800, liquidity: 55000, endDate: "2026-12-31", oneDayChange: -0.005, oneWeekChange: -0.01, relevance_score: 0.82, impact_description: "Dollar weakness = BTC as alternative store of value", source: "Polymarket", enabled: true, weight: 1.0 },

  // === 监管 (Regulation) ===
  { id: "lib-eth-etf", name: "ETH spot ETF approved with staking by end 2026?", category: "Regulation", subcategory: "ETF", probability: 0.42, volume24h: 1200, liquidity: 35000, endDate: "2026-12-31", oneDayChange: 0.02, oneWeekChange: 0.05, relevance_score: 0.90, impact_description: "ETH ETF unlocks institutional demand", source: "Polymarket", enabled: true, weight: 1.2 },
  { id: "lib-gensler-out", name: "SEC Chair Gensler replaced before end 2026?", category: "Regulation", subcategory: "Leadership", probability: 0.55, volume24h: 800, liquidity: 28000, endDate: "2026-12-31", oneDayChange: 0.005, oneWeekChange: 0.01, relevance_score: 0.82, impact_description: "Gensler departure could ease SEC stance", source: "Polymarket", enabled: true, weight: 1.0 },
  { id: "lib-crypto-bill", name: "US crypto market structure bill passes in 2026?", category: "Regulation", subcategory: "Legislation", probability: 0.38, volume24h: 700, liquidity: 22000, endDate: "2026-12-31", oneDayChange: 0.01, oneWeekChange: 0.02, relevance_score: 0.88, impact_description: "Clear regulation = institutional confidence", source: "Polymarket", enabled: true, weight: 1.2 },

  // === 加密原生 (CryptoNative) ===
  { id: "lib-btc-1m", name: "Bitcoin hits $1M before 2027?", category: "CryptoNative", subcategory: "PriceTarget", probability: 0.49, volume24h: 3974, liquidity: 125092, endDate: "2026-12-31", oneDayChange: 0.003, oneWeekChange: 0.003, relevance_score: 0.95, impact_description: "BTC $1M = massive institutional adoption", source: "Polymarket", enabled: true, weight: 1.0 },
  { id: "lib-btc-ath", name: "Bitcoin new all-time high in 2026?", category: "CryptoNative", subcategory: "PriceTarget", probability: 0.62, volume24h: 4500, liquidity: 98000, endDate: "2026-12-31", oneDayChange: -0.01, oneWeekChange: -0.02, relevance_score: 0.93, impact_description: "New ATH = momentum + media attention", source: "Polymarket", enabled: true, weight: 1.0 },
  { id: "lib-halving-after", name: "Post-halving supply squeeze accelerates?", category: "CryptoNative", subcategory: "Supply", probability: 0.55, volume24h: 300, liquidity: 15000, endDate: "2026-12-31", oneDayChange: 0.005, oneWeekChange: 0.01, relevance_score: 0.85, impact_description: "2024 halving supply shock compounds", source: "Polymarket", enabled: true, weight: 1.0 },

  // === 市场情绪 (Sentiment) ===
  { id: "lib-recession", name: "US recession declared by NBER in 2026?", category: "Sentiment", subcategory: "Recession", probability: 0.28, volume24h: 1800, liquidity: 76000, endDate: "2026-12-31", oneDayChange: 0.005, oneWeekChange: 0.01, relevance_score: 0.88, impact_description: "Recession triggers flight to safety", source: "Polymarket", enabled: true, weight: 0.6 },
  { id: "lib-debt-ceiling", name: "US debt ceiling crisis in 2026?", category: "Sentiment", subcategory: "Fiscal", probability: 0.20, volume24h: 1400, liquidity: 48000, endDate: "2026-12-31", oneDayChange: 0.002, oneWeekChange: 0.005, relevance_score: 0.85, impact_description: "Debt ceiling = USD credibility risk = BTC hedge", source: "Polymarket", enabled: false, weight: 0.6 },

  // === 政治人物言行 (Political) ===
  { id: "lib-trump-crypto", name: "Trump tweets positively about crypto?", category: "Political", subcategory: "Trump", probability: 0.65, volume24h: 200, liquidity: 10000, endDate: "2026-06-30", oneDayChange: 0.02, oneWeekChange: 0.05, relevance_score: 0.85, impact_description: "Trump pro-crypto = retail FOMO + institutional confidence", source: "Polymarket", enabled: true, weight: 0.7 },
  { id: "lib-powell-hawk", name: "Powell delivers hawkish speech?", category: "Political", subcategory: "FedChair", probability: 0.30, volume24h: 1000, liquidity: 35000, endDate: "2026-06-30", oneDayChange: -0.01, oneWeekChange: -0.02, relevance_score: 0.90, impact_description: "Hawkish Powell = rate hike fears", source: "Polymarket", enabled: true, weight: 0.9 },
  { id: "lib-powell-dove", name: "Powell delivers dovish speech?", category: "Political", subcategory: "FedChair", probability: 0.25, volume24h: 1000, liquidity: 35000, endDate: "2026-06-30", oneDayChange: 0.01, oneWeekChange: 0.02, relevance_score: 0.90, impact_description: "Dovish Powell = rate cut hopes", source: "Polymarket", enabled: true, weight: 0.9 },
  { id: "lib-trump-executive", name: "Trump signs crypto executive order?", category: "Political", subcategory: "Trump", probability: 0.45, volume24h: 700, liquidity: 25000, endDate: "2026-12-31", oneDayChange: 0.01, oneWeekChange: 0.03, relevance_score: 0.88, impact_description: "Executive order = federal crypto strategy", source: "Polymarket", enabled: true, weight: 0.8 },
  { id: "lib-midterm-crypto", name: "Midterm elections produce pro-crypto Congress?", category: "Political", subcategory: "Election", probability: 0.40, volume24h: 500, liquidity: 18000, endDate: "2026-11-03", oneDayChange: 0.005, oneWeekChange: 0.01, relevance_score: 0.82, impact_description: "Pro-crypto Congress = favorable legislation", source: "Polymarket", enabled: false, weight: 0.6 },
];

// 预设权重模板
export interface WeightTemplate {
  name: string;
  nameZh: string;
  weights: Record<FactorCategory, number>;
}

export const WEIGHT_TEMPLATES: WeightTemplate[] = [
  { name: "Balanced", nameZh: "均衡", weights: { Monetary: 1.0, Inflation: 1.0, Geopolitics: 1.0, Regulation: 1.0, CryptoNative: 1.0, Sentiment: 1.0, Political: 1.0 } },
  { name: "Aggressive", nameZh: "激进", weights: { Monetary: 1.5, Inflation: 0.8, Geopolitics: 0.8, Regulation: 1.2, CryptoNative: 1.3, Sentiment: 0.7, Political: 0.7 } },
  { name: "Conservative", nameZh: "保守", weights: { Monetary: 1.3, Inflation: 1.2, Geopolitics: 1.2, Regulation: 0.9, CryptoNative: 0.8, Sentiment: 1.1, Political: 0.5 } },
  { name: "Macro Focus", nameZh: "宏观聚焦", weights: { Monetary: 2.0, Inflation: 1.8, Geopolitics: 1.0, Regulation: 0.6, CryptoNative: 0.5, Sentiment: 1.2, Political: 0.4 } },
  { name: "Crypto First", nameZh: "加密优先", weights: { Monetary: 1.0, Inflation: 0.6, Geopolitics: 0.6, Regulation: 1.5, CryptoNative: 1.8, Sentiment: 0.5, Political: 0.8 } },
];

// 按分类分组
export function getFactorsByCategory(): Record<string, FactorItem[]> {
  const map: Record<string, FactorItem[]> = {};
  for (const f of BUILTIN_LIBRARY) {
    if (!map[f.category]) map[f.category] = [];
    map[f.category].push(f);
  }
  return map;
}

// 搜索
export function searchFactors(query: string): FactorItem[] {
  const q = query.toLowerCase();
  return BUILTIN_LIBRARY.filter(f =>
    f.name.toLowerCase().includes(q) ||
    f.subcategory.toLowerCase().includes(q) ||
    f.category.toLowerCase().includes(q) ||
    f.impact_description.toLowerCase().includes(q)
  );
}

// localStorage keys
const STORAGE_ENABLED = "macrofactor_enabled_ids";
const STORAGE_WEIGHTS = "macrofactor_weights";
const STORAGE_PROBABILITIES = "macrofactor_probabilities";
const STORAGE_DIRECTIONS = "macrofactor_directions";
const STORAGE_CUSTOM_FACTORS = "macrofactor_custom_factors";

// 加载用户配置
export function loadUserFactors(): FactorItem[] {
  try {
    const enabledStr = localStorage.getItem(STORAGE_ENABLED);
    const hasSavedEnabled = enabledStr !== null;
    const enabledIds: Set<string> = enabledStr ? new Set(JSON.parse(enabledStr)) : new Set();
    
    const weightsStr = localStorage.getItem(STORAGE_WEIGHTS);
    const weightsMap: Record<string, number> = weightsStr ? JSON.parse(weightsStr) : {};

    const probabilitiesStr = localStorage.getItem(STORAGE_PROBABILITIES);
    const probabilitiesMap: Record<string, number> = probabilitiesStr ? JSON.parse(probabilitiesStr) : {};

    const directionsStr = localStorage.getItem(STORAGE_DIRECTIONS);
    const directionsMap: Record<string, FactorItem["directionOverride"]> = directionsStr ? JSON.parse(directionsStr) : {};

    const customStr = localStorage.getItem(STORAGE_CUSTOM_FACTORS);
    const customFactors: FactorItem[] = customStr ? JSON.parse(customStr) : [];

    const builtins = BUILTIN_LIBRARY.map(f => ({
      ...f,
      enabled: hasSavedEnabled ? enabledIds.has(f.id) : f.enabled,
      weight: weightsMap[f.id] ?? f.weight ?? 1.0,
      probability: probabilitiesMap[f.id] ?? f.probability,
      directionOverride: directionsMap[f.id] ?? f.directionOverride,
    }));

    const custom = customFactors.map(f => ({
      ...f,
      enabled: hasSavedEnabled ? enabledIds.has(f.id) : f.enabled,
      weight: weightsMap[f.id] ?? f.weight ?? 1.0,
      probability: probabilitiesMap[f.id] ?? f.probability,
      directionOverride: directionsMap[f.id] ?? f.directionOverride,
      userAdded: true,
    }));

    return [...builtins, ...custom];
  } catch {
    return BUILTIN_LIBRARY.map(f => ({ ...f }));
  }
}

// 保存用户配置
export function saveUserFactors(factors: FactorItem[]) {
  const enabledIds = factors.filter(f => f.enabled).map(f => f.id);
  const weightsMap: Record<string, number> = {};
  const probabilitiesMap: Record<string, number> = {};
  const directionsMap: Record<string, FactorItem["directionOverride"]> = {};
  for (const f of factors) {
    weightsMap[f.id] = f.weight ?? 1.0;
    probabilitiesMap[f.id] = f.probability;
    if (f.directionOverride) directionsMap[f.id] = f.directionOverride;
  }
  const customFactors = factors.filter(f => f.userAdded);
  localStorage.setItem(STORAGE_ENABLED, JSON.stringify(enabledIds));
  localStorage.setItem(STORAGE_WEIGHTS, JSON.stringify(weightsMap));
  localStorage.setItem(STORAGE_PROBABILITIES, JSON.stringify(probabilitiesMap));
  localStorage.setItem(STORAGE_DIRECTIONS, JSON.stringify(directionsMap));
  localStorage.setItem(STORAGE_CUSTOM_FACTORS, JSON.stringify(customFactors));
}

// 应用权重模板
export function applyWeightTemplate(factors: FactorItem[], template: WeightTemplate): FactorItem[] {
  return factors.map(f => ({
    ...f,
    weight: template.weights[f.category] ?? 1.0,
  }));
}

// 重置为默认
export function resetToDefault(): FactorItem[] {
  localStorage.removeItem(STORAGE_ENABLED);
  localStorage.removeItem(STORAGE_WEIGHTS);
  localStorage.removeItem(STORAGE_PROBABILITIES);
  localStorage.removeItem(STORAGE_DIRECTIONS);
  localStorage.removeItem(STORAGE_CUSTOM_FACTORS);
  return BUILTIN_LIBRARY.map(f => ({ ...f }));
}
