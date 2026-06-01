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

/** 兜底 mock 新闻数据 —— 当 API 不可用时展示 */
export const MOCK_NEWS: NewsItem[] = [
  {
    id: "mock-1",
    title: "Bitcoin ETF Sees Record Inflows as Institutional Adoption Accelerates",
    titleZh: "比特币ETF创纪录流入，机构采用加速",
    source: "CryptoDaily",
    timestamp: Math.floor(Date.now() / 1000) - 3600,
    date_str: new Date().toISOString().slice(0, 10),
    category: "Regulation",
    sentiment: "bullish",
    sentimentScore: 0.75,
    summary: "Major institutional investors continue to pour capital into Bitcoin ETFs, with daily inflows reaching new all-time highs.",
    summaryZh: "主要机构投资者持续向比特币ETF注入资金，日流入量创下历史新高。",
    relatedAssets: ["BTC"],
    impactLevel: "high",
    keywords: ["ETF", "institutional", "inflows", "Bitcoin"],
  },
  {
    id: "mock-2",
    title: "Federal Reserve Signals Potential Rate Cuts in Q3",
    titleZh: "美联储暗示Q3可能降息",
    source: "MacroWatch",
    timestamp: Math.floor(Date.now() / 1000) - 7200,
    date_str: new Date().toISOString().slice(0, 10),
    category: "Monetary",
    sentiment: "bullish",
    sentimentScore: 0.6,
    summary: "Fed Chair hints at dovish pivot as inflation data shows cooling trends, markets price in 75bps of cuts.",
    summaryZh: "美联储主席暗示鸽派转向，通胀数据显示降温趋势，市场计价75个基点降息。",
    relatedAssets: ["BTC", "ETH"],
    impactLevel: "high",
    keywords: ["Fed", "rate cuts", "inflation", "dovish"],
  },
  {
    id: "mock-3",
    title: "Ethereum Network Upgrade Reduces Gas Fees by 40%",
    titleZh: "以太坊网络升级降低Gas费40%",
    source: "ETHHub",
    timestamp: Math.floor(Date.now() / 1000) - 10800,
    date_str: new Date().toISOString().slice(0, 10),
    category: "CryptoNative",
    sentiment: "bullish",
    sentimentScore: 0.55,
    summary: "Latest Dencun upgrade implementation shows significant reduction in Layer 2 transaction costs.",
    summaryZh: "最新Dencun升级实施显示Layer 2交易成本显著降低。",
    relatedAssets: ["ETH"],
    impactLevel: "medium",
    keywords: ["Ethereum", "gas fees", "Dencun", "L2"],
  },
  {
    id: "mock-4",
    title: "SEC Delays Decision on Spot Ethereum ETF Applications",
    titleZh: "SEC推迟现货以太坊ETF申请决定",
    source: "RegulationWatch",
    timestamp: Math.floor(Date.now() / 1000) - 14400,
    date_str: new Date().toISOString().slice(0, 10),
    category: "Regulation",
    sentiment: "bearish",
    sentimentScore: -0.35,
    summary: "Regulatory uncertainty continues as SEC extends review period for multiple Ethereum ETF filings.",
    summaryZh: "监管不确定性持续，SEC延长多个以太坊ETF申请的审查期。",
    relatedAssets: ["ETH"],
    impactLevel: "medium",
    keywords: ["SEC", "ETF", "Ethereum", "regulation"],
  },
  {
    id: "mock-5",
    title: "Global Crypto Mining Difficulty Reaches New Peak",
    titleZh: "全球加密货币挖矿难度创新高",
    source: "MiningInsider",
    timestamp: Math.floor(Date.now() / 1000) - 18000,
    date_str: new Date().toISOString().slice(0, 10),
    category: "CryptoNative",
    sentiment: "neutral",
    sentimentScore: 0.1,
    summary: "Bitcoin mining difficulty adjusts upward by 5.5% as hashrate continues to grow despite price volatility.",
    summaryZh: "尽管价格波动，比特币挖矿难度上调5.5%，算力持续增长。",
    relatedAssets: ["BTC"],
    impactLevel: "low",
    keywords: ["mining", "difficulty", "hashrate", "Bitcoin"],
  },
  {
    id: "mock-6",
    title: "Geopolitical Tensions Rise in Middle East, Oil Prices Spike",
    titleZh: "中东地缘政治紧张局势升级，油价飙升",
    source: "GlobalNews",
    timestamp: Math.floor(Date.now() / 1000) - 21600,
    date_str: new Date().toISOString().slice(0, 10),
    category: "Geopolitics",
    sentiment: "bearish",
    sentimentScore: -0.45,
    summary: "Escalating conflicts in key regions drive risk-off sentiment across global markets including crypto.",
    summaryZh: "关键地区冲突升级推动包括加密货币在内的全球市场避险情绪。",
    relatedAssets: ["BTC", "ETH"],
    impactLevel: "high",
    keywords: ["geopolitics", "Middle East", "oil", "risk-off"],
  },
  {
    id: "mock-7",
    title: "Crypto Fear & Greed Index Drops to 'Fear' Territory",
    titleZh: "加密货币恐惧贪婪指数跌至'恐惧'区间",
    source: "SentimentTracker",
    timestamp: Math.floor(Date.now() / 1000) - 25200,
    date_str: new Date().toISOString().slice(0, 10),
    category: "Sentiment",
    sentiment: "bearish",
    sentimentScore: -0.5,
    summary: "Retail sentiment turns cautious as key indicator falls below 30 for the first time in three months.",
    summaryZh: "关键指标三个月来首次跌破30，散户情绪转向谨慎。",
    relatedAssets: ["BTC", "ETH", "SOL"],
    impactLevel: "medium",
    keywords: ["fear", "greed", "sentiment", "retail"],
  },
  {
    id: "mock-8",
    title: "Solana DeFi Ecosystem TVL Surpasses $5 Billion",
    titleZh: "Solana DeFi生态TVL突破50亿美元",
    source: "DeFiPulse",
    timestamp: Math.floor(Date.now() / 1000) - 28800,
    date_str: new Date().toISOString().slice(0, 10),
    category: "CryptoNative",
    sentiment: "bullish",
    sentimentScore: 0.65,
    summary: "Solana's decentralized finance protocols see massive growth as network stability improves.",
    summaryZh: "随着网络稳定性提升，Solana去中心化金融协议实现大幅增长。",
    relatedAssets: ["SOL"],
    impactLevel: "medium",
    keywords: ["Solana", "DeFi", "TVL", "ecosystem"],
  },
];

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
