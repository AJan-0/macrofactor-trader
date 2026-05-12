/**
 * 动态因子引擎 v3 —— 用户可扩展的精准因子分析
 *
 * 核心升级：
 * 1. 用户可自定义添加/编辑/删除因子
 * 2. 每个因子有独立开关（enabled）
 * 3. 内置100+真实市场因子库
 * 4. 引擎只计算用户启用的因子
 */

export type FactorCategory = "Monetary" | "Inflation" | "Geopolitics" | "Regulation" | "CryptoNative" | "Sentiment" | "Political";

export interface FactorItem {
  id: string;
  name: string;
  category: FactorCategory;
  subcategory: string;
  probability: number;       // 0-1
  volume24h: number;
  liquidity: number;
  endDate: string;
  oneDayChange: number;
  oneWeekChange: number;
  relevance_score: number;   // 0-1 与BTC相关性
  impact_description: string;
  source: "Polymarket" | "MacroFactor" | "CME" | "User";
  enabled: boolean;          // 用户开关
  userAdded?: boolean;       // 是否用户自定义
  directionOverride?: "bullish" | "bearish" | "neutral"; // 用户可覆盖方向
  weight: number;            // 用户自定义权重 (0-2.0)
}

export interface FactorSignal {
  id: string;
  name: string;
  category: FactorCategory;
  subcategory: string;
  direction: "bullish" | "bearish" | "neutral";
  strength: number;
  probability: number;
  quality_score: number;
  timeHorizon: "short" | "medium" | "long";
  impact_description: string;
  enabled: boolean;
}

export interface FactorCombination {
  combinedDirection: "bullish" | "bearish" | "neutral";
  bullishProbability: number;
  bearishProbability: number;
  neutralProbability: number;
  expectedVolatility: number;
  overallConfidence: number;
  activeFactors: FactorSignal[];
  topBullish: FactorSignal[];
  topBearish: FactorSignal[];
  enabledCount: number;
  totalCount: number;
  timestamp: string;
}

// ──────────────────────────────
// 分类权重（BTC历史敏感度）
// ──────────────────────────────

const CAT_WEIGHT: Record<FactorCategory, number> = {
  Monetary:       0.30,
  Inflation:      0.18,
  Geopolitics:    0.20,
  Regulation:     0.15,
  CryptoNative:   0.10,
  Sentiment:      0.04,
  Political:      0.03,
};

// ──────────────────────────────
// 方向判定
// ──────────────────────────────

function determineDirection(f: FactorItem): { direction: "bullish" | "bearish" | "neutral"; strength: number; desc: string } {
  // 用户覆盖优先
  if (f.directionOverride && f.directionOverride !== "neutral") {
    return {
      direction: f.directionOverride,
      strength: 0.6,
      desc: "User-defined direction",
    };
  }

  const q = f.name.toLowerCase();
  const p = f.probability;
  const cat = f.category;

  // === 货币政策 ===
  if (cat === "Monetary" || cat === "Inflation") {
    if (q.includes("cut") || q.includes("降息") || q.includes("ease")) {
      return p > 0.5
        ? { direction: "bullish", strength: (p - 0.3) * 1.4, desc: "降息释放流动性→利好BTC" }
        : { direction: "bearish", strength: (0.5 - p) * 0.8, desc: "不降息→流动性收紧" };
    }
    if (q.includes("hike") || q.includes("加息")) {
      return p > 0.5
        ? { direction: "bearish", strength: (p - 0.3) * 1.4, desc: "加息收紧流动性→利空BTC" }
        : { direction: "bullish", strength: (0.5 - p) * 0.8, desc: "不加息→维持宽松" };
    }
    if (q.includes("hold") || q.includes("pause") || q.includes("维持")) {
      return { direction: "neutral", strength: 0.15, desc: "利率不变→中性" };
    }
    if (q.includes("cpi") || q.includes("inflation") || q.includes("通胀")) {
      return p > 0.6
        ? { direction: "bearish", strength: (p - 0.5) * 1.0, desc: "高通胀→加息预期" }
        : p < 0.4
        ? { direction: "bullish", strength: (0.4 - p) * 1.0, desc: "通胀降温→降息空间" }
        : { direction: "neutral", strength: 0.2, desc: "通胀符合预期" };
    }
  }

  // === 地缘政治 ===
  if (cat === "Geopolitics") {
    if (q.includes("ceasefire") || q.includes("peace") || q.includes("停火") || q.includes("缓和")) {
      return p > 0.5
        ? { direction: "bullish", strength: (p - 0.4) * 1.0, desc: "停火→风险偏好回升" }
        : { direction: "bearish", strength: (0.5 - p) * 0.5, desc: "冲突持续→风险溢价" };
    }
    if (q.includes("war") || q.includes("invade") || q.includes("strike") || q.includes("conflict") || q.includes("冲突") || q.includes("战争") || q.includes("袭击")) {
      return p > 0.5
        ? { direction: "bearish", strength: (p - 0.3) * 1.2, desc: "冲突升级→避险→BTC承压" }
        : { direction: "bullish", strength: (0.5 - p) * 0.6, desc: "冲突缓和→风险偏好" };
    }
    if (q.includes("sanction") || q.includes("制裁")) {
      return p > 0.5
        ? { direction: "bearish", strength: (p - 0.4) * 1.0, desc: "制裁→贸易受阻" }
        : { direction: "neutral", strength: 0.1, desc: "制裁概率低" };
    }
    if (q.includes("tariff") || q.includes("关税")) {
      return p > 0.5
        ? { direction: "bearish", strength: (p - 0.4) * 1.0, desc: "高关税→通胀+贸易风险" }
        : { direction: "bullish", strength: (0.5 - p) * 0.6, desc: "低关税→贸易通畅" };
    }
    if (q.includes("summit") || q.includes("meeting") || q.includes("visit") || q.includes("访华") || q.includes("峰会")) {
      return p > 0.5
        ? { direction: "bullish", strength: (p - 0.4) * 0.8, desc: "外交缓和→市场稳定" }
        : { direction: "neutral", strength: 0.1, desc: "外交进展不确定" };
    }
  }

  // === 监管 ===
  if (cat === "Regulation") {
    if (q.includes("etf") && (q.includes("approve") || q.includes("通过"))) {
      return p > 0.4
        ? { direction: "bullish", strength: (p - 0.2) * 1.2, desc: "ETF获批→机构资金流入" }
        : { direction: "neutral", strength: 0.1, desc: "ETF通过概率低" };
    }
    if (q.includes("ban") || q.includes("禁止") || q.includes("crackdown") || q.includes("打击")) {
      return p > 0.4
        ? { direction: "bearish", strength: (p - 0.3) * 1.2, desc: "禁令→退出压力" }
        : { direction: "neutral", strength: 0.1, desc: "禁令概率低" };
    }
    if (q.includes("gensler") || q.includes("sec chair") || q.includes("replacement") || q.includes("换人")) {
      return p > 0.5
        ? { direction: "bullish", strength: (p - 0.4) * 0.8, desc: "监管领导换人→政策可能缓和" }
        : { direction: "neutral", strength: 0.1, desc: "监管延续" };
    }
    if (q.includes("bill") || q.includes("legislation") || q.includes("法案")) {
      return p > 0.5
        ? { direction: "bullish", strength: (p - 0.4) * 0.8, desc: "友好立法→行业合法化" }
        : { direction: "neutral", strength: 0.1, desc: "立法进展不确定" };
    }
  }

  // === 加密原生 ===
  if (cat === "CryptoNative") {
    if (q.includes("bitcoin") || q.includes("btc") || q.includes("$1m") || q.includes("$100")) {
      return p > 0.3
        ? { direction: "bullish", strength: Math.min(1, p * 1.2), desc: "BTC目标→市场预期上涨" }
        : { direction: "neutral", strength: 0.1, desc: "目标概率低" };
    }
    if (q.includes("halving") || q.includes("减半")) {
      return { direction: "bullish", strength: 0.7, desc: "减半→供给收缩" };
    }
    if (q.includes("adoption") || q.includes("采用") || q.includes("integration")) {
      return p > 0.5
        ? { direction: "bullish", strength: (p - 0.3) * 1.0, desc: "采用增加→需求增长" }
        : { direction: "neutral", strength: 0.1, desc: "采用进展缓慢" };
    }
  }

  // === 政治人物言行 ===
  if (cat === "Political") {
    if (q.includes("trump") && (q.includes("tweet") || q.includes("twitter") || q.includes("x") || q.includes("post") || q.includes("推特") || q.includes("发文"))) {
      if (q.includes("crypto") || q.includes("bitcoin") || q.includes("btc")) {
        return p > 0.5
          ? { direction: "bullish", strength: (p - 0.3) * 1.0, desc: "特朗普挺加密→市场情绪提振" }
          : { direction: "bearish", strength: (0.5 - p) * 0.8, desc: "特朗普批评加密→情绪承压" };
      }
      return { direction: "neutral", strength: 0.2, desc: "特朗普言论→影响不确定" };
    }
    if (q.includes("midterm") || q.includes("election") || q.includes("选举") || q.includes("中期")) {
      return { direction: "neutral", strength: 0.3, desc: "选举→政策不确定性" };
    }
    if (q.includes("powell") || q.includes("speech") || q.includes("讲话") || q.includes("发言")) {
      if (q.includes("hawk") || q.includes("鹰派")) {
        return { direction: "bearish", strength: 0.6, desc: "鲍威尔鹰派→加息预期" };
      }
      if (q.includes("dove") || q.includes("鸽派")) {
        return { direction: "bullish", strength: 0.6, desc: "鲍威尔鸽派→降息预期" };
      }
      return { direction: "neutral", strength: 0.2, desc: "鲍威尔发言→影响待观察" };
    }
  }

  // === 市场情绪 ===
  if (cat === "Sentiment") {
    if (q.includes("recession") || q.includes("衰退")) {
      return p > 0.5
        ? { direction: "bearish", strength: (p - 0.4) * 1.0, desc: "衰退→风险资产抛售" }
        : { direction: "bullish", strength: (0.5 - p) * 0.6, desc: "软着陆→风险偏好" };
    }
    if (q.includes("default") || q.includes("debt ceiling") || q.includes("债务上限")) {
      return p > 0.5
        ? { direction: "bearish", strength: (p - 0.3) * 1.2, desc: "债务违约→系统性风险" }
        : { direction: "neutral", strength: 0.2, desc: "违约概率低" };
    }
  }

  return { direction: "neutral", strength: 0.1, desc: "相关性不明确" };
}

// ──────────────────────────────
// 质量评分
// ──────────────────────────────

function calcQuality(f: FactorItem): number {
  const volScore = Math.min(40, Math.log10(f.volume24h + 1) * 7);
  let timeScore = 15;
  if (f.endDate) {
    const days = (new Date(f.endDate).getTime() - Date.now()) / 86400000;
    if (days <= 7) timeScore = 30;
    else if (days <= 30) timeScore = 25;
    else if (days <= 90) timeScore = 20;
    else if (days <= 180) timeScore = 15;
    else timeScore = 10;
  }
  const relScore = f.relevance_score * 30;
  const bonus = f.userAdded ? 10 : 0; // 用户因子加10分信任
  return Math.round(Math.min(100, volScore + timeScore + relScore + bonus));
}

function getHorizon(endDate: string): "short" | "medium" | "long" {
  if (!endDate) return "medium";
  const days = (new Date(endDate).getTime() - Date.now()) / 86400000;
  if (days <= 14) return "short";
  if (days <= 90) return "medium";
  return "long";
}

// ──────────────────────────────
// 主引擎
// ──────────────────────────────

export function analyzeFactors(factors: FactorItem[]): FactorCombination {
  // 只处理启用的因子
  const enabled = factors.filter(f => f.enabled);

  if (enabled.length === 0) {
    return {
      combinedDirection: "neutral",
      bullishProbability: 0.33,
      bearishProbability: 0.33,
      neutralProbability: 0.34,
      expectedVolatility: 0.3,
      overallConfidence: 0,
      activeFactors: [],
      topBullish: [],
      topBearish: [],
      enabledCount: 0,
      totalCount: factors.length,
      timestamp: new Date().toISOString(),
    };
  }

  const signals: FactorSignal[] = enabled.map(f => {
    const { direction, strength, desc } = determineDirection(f);
    const quality = calcQuality(f);
    const cat = f.category;
    const catWeight = CAT_WEIGHT[cat] || 0.1;
    const userWeight = f.weight ?? 1.0;

    return {
      id: f.id,
      name: f.name,
      category: cat,
      subcategory: f.subcategory,
      direction,
      strength: Math.round(Math.min(1, strength * userWeight * (1 + catWeight) * 0.5) * 100) / 100,
      probability: f.probability,
      quality_score: quality,
      timeHorizon: getHorizon(f.endDate),
      impact_description: desc,
      enabled: true,
    };
  }).filter(s => s.direction !== "neutral" || s.strength > 0.2);

  let bullishW = 0, bearishW = 0;
  for (const s of signals) {
    const w = s.strength * (s.quality_score / 100);
    if (s.direction === "bullish") bullishW += w;
    else if (s.direction === "bearish") bearishW += w;
  }

  const totalS = bullishW + bearishW;
  const bullP = totalS > 0 ? bullishW / totalS : 0.33;
  const bearP = totalS > 0 ? bearishW / totalS : 0.33;

  const conflict = 1 - Math.abs(bullP - bearP);
  const vol = Math.min(1, conflict * 1.1 + 0.05);

  let dir: "bullish" | "bearish" | "neutral" = "neutral";
  if (bullP > bearP + 0.2) dir = "bullish";
  else if (bearP > bullP + 0.2) dir = "bearish";

  const avgQ = signals.reduce((sum, s) => sum + s.quality_score, 0) / signals.length;
  const factorBonus = Math.min(15, signals.length * 2);

  return {
    combinedDirection: dir,
    bullishProbability: Math.round(bullP * 100) / 100,
    bearishProbability: Math.round(bearP * 100) / 100,
    neutralProbability: Math.round(Math.max(0, 1 - bullP - bearP) * 100) / 100,
    expectedVolatility: Math.round(vol * 100) / 100,
    overallConfidence: Math.min(100, Math.round(avgQ + factorBonus)),
    activeFactors: signals.sort((a, b) => b.strength - a.strength),
    topBullish: signals.filter(s => s.direction === "bullish").sort((a, b) => b.strength - a.strength).slice(0, 5),
    topBearish: signals.filter(s => s.direction === "bearish").sort((a, b) => b.strength - a.strength).slice(0, 5),
    enabledCount: enabled.length,
    totalCount: factors.length,
    timestamp: new Date().toISOString(),
  };
}
