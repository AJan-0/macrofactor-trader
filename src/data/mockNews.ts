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

function makeDate(daysAgo: number, hour = 0): number {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

function fmt(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const MOCK_NEWS: NewsItem[] = [
  {
    id: "news-1",
    title: "Fed Chair Powell Signals Patience on Rate Cuts Amid Inflation Concerns",
    titleZh: "美联储主席鲍威尔暗示对降息保持耐心，通胀担忧仍存",
    source: "Bloomberg",
    timestamp: makeDate(0, 9),
    date_str: fmt(makeDate(0, 9)),
    category: "Monetary",
    sentiment: "bearish",
    sentimentScore: -0.72,
    summary: "Powell emphasized the need for more evidence that inflation is sustainably moving toward 2% before considering rate cuts. Markets interpreted this as a hawkish signal.",
    summaryZh: "鲍威尔强调需要更多证据表明通胀正在可持续地向2%靠拢，才会考虑降息。市场将此解读为鹰派信号。",
    relatedAssets: ["BTC", "ETH"],
    impactLevel: "high",
    keywords: ["Fed", "rate cuts", "inflation", "Powell"],
  },
  {
    id: "news-2",
    title: "SEC Approves Spot Ethereum ETF Staking for Major Providers",
    titleZh: "SEC批准以太坊现货ETF质押功能",
    source: "CoinDesk",
    timestamp: makeDate(0, 14),
    date_str: fmt(makeDate(0, 14)),
    category: "Regulation",
    sentiment: "bullish",
    sentimentScore: 0.85,
    summary: "The SEC has granted approval for spot Ethereum ETFs to include staking capabilities, opening the door for institutional yield generation on ETH positions.",
    summaryZh: "SEC已批准以太坊现货ETF包含质押功能，为机构投资者在ETH仓位上获得收益打开了大门。",
    relatedAssets: ["ETH", "BTC"],
    impactLevel: "high",
    keywords: ["SEC", "ETF", "Ethereum", "staking"],
  },
  {
    id: "news-3",
    title: "Trump Administration Considers Strategic Bitcoin Reserve Proposal",
    titleZh: "特朗普政府考虑建立战略性比特币储备",
    source: "Reuters",
    timestamp: makeDate(1, 10),
    date_str: fmt(makeDate(1, 10)),
    category: "Political",
    sentiment: "bullish",
    sentimentScore: 0.78,
    summary: "White House officials are reportedly evaluating a proposal to establish a strategic Bitcoin reserve, potentially purchasing up to 1M BTC over five years.",
    summaryZh: "白宫官员 reportedly 正在评估建立战略性比特币储备的提案，可能在五年内购买多达100万枚BTC。",
    relatedAssets: ["BTC"],
    impactLevel: "high",
    keywords: ["Trump", "Bitcoin", "reserve", "White House"],
  },
  {
    id: "news-4",
    title: "Middle East Tensions Escalate as Iran Conducts Military Drills Near Strait",
    titleZh: "伊朗在海峡附近举行军事演习，中东紧张局势升级",
    source: "Al Jazeera",
    timestamp: makeDate(1, 16),
    date_str: fmt(makeDate(1, 16)),
    category: "Geopolitics",
    sentiment: "bearish",
    sentimentScore: -0.55,
    summary: "Iran's large-scale military exercises near the Strait of Hormuz have raised concerns about potential disruptions to global oil shipments and increased risk-off sentiment.",
    summaryZh: "伊朗在霍尔木兹海峡附近举行大规模军事演习，引发对全球石油运输可能中断的担忧，避险情绪升温。",
    relatedAssets: ["BTC", "ETH", "GOLD"],
    impactLevel: "medium",
    keywords: ["Iran", "Middle East", "oil", "Hormuz"],
  },
  {
    id: "news-5",
    title: "CME Bitcoin Futures Open Interest Hits All-Time High",
    titleZh: "CME比特币期货持仓量创历史新高",
    source: "The Block",
    timestamp: makeDate(2, 11),
    date_str: fmt(makeDate(2, 11)),
    category: "CryptoNative",
    sentiment: "bullish",
    sentimentScore: 0.62,
    summary: "Institutional participation in Bitcoin derivatives continues to grow, with CME open interest surpassing $15 billion for the first time in history.",
    summaryZh: "机构投资者参与比特币衍生品交易持续增长，CME持仓量历史上首次突破150亿美元。",
    relatedAssets: ["BTC"],
    impactLevel: "medium",
    keywords: ["CME", "futures", "open interest", "institutional"],
  },
  {
    id: "news-6",
    title: "US April CPI Comes in Hot at 3.8% YoY, Above Consensus",
    titleZh: "美国4月CPI同比上涨3.8%，超出预期",
    source: "WSJ",
    timestamp: makeDate(3, 8),
    date_str: fmt(makeDate(3, 8)),
    category: "Inflation",
    sentiment: "bearish",
    sentimentScore: -0.68,
    summary: "April CPI exceeded market expectations of 3.5%, printing at 3.8% year-over-year. Core CPI also surprised to the upside at 3.7%, reducing rate cut probabilities.",
    summaryZh: "4月CPI超出市场3.5%的预期，录得3.8%的同比涨幅。核心CPI也意外上行至3.7%，降低了降息概率。",
    relatedAssets: ["BTC", "ETH"],
    impactLevel: "high",
    keywords: ["CPI", "inflation", "rate cuts", "Fed"],
  },
  {
    id: "news-7",
    title: "Russian-Ukrainian Peace Talks Stall Over Territory Disputes",
    titleZh: "俄乌和谈因领土争端陷入僵局",
    source: "FT",
    timestamp: makeDate(3, 15),
    date_str: fmt(makeDate(3, 15)),
    category: "Geopolitics",
    sentiment: "bearish",
    sentimentScore: -0.42,
    summary: "Latest round of peace negotiations ended without breakthrough as both sides remain far apart on territorial boundaries. Energy markets show muted reaction.",
    summaryZh: "最新一轮和谈未取得突破，双方在领土边界问题上分歧仍然很大。能源市场反应平淡。",
    relatedAssets: ["BTC", "GOLD"],
    impactLevel: "low",
    keywords: ["Russia", "Ukraine", "peace talks", "war"],
  },
  {
    id: "news-8",
    title: "Crypto Market Structure Bill Gains Bipartisan Support in Senate",
    titleZh: "加密市场结构法案在参议院获得两党支持",
    source: "Politico",
    timestamp: makeDate(4, 12),
    date_str: fmt(makeDate(4, 12)),
    category: "Regulation",
    sentiment: "bullish",
    sentimentScore: 0.58,
    summary: "The long-awaited market structure legislation now has 15 Senate co-sponsors from both parties, increasing the probability of passage before the August recess.",
    summaryZh: "期待已久的市场结构立法现已获得两党15位参议员的共同提案，增加了在8月休会前通过的概率。",
    relatedAssets: ["BTC", "ETH"],
    impactLevel: "medium",
    keywords: ["regulation", "Senate", "bill", "bipartisan"],
  },
  {
    id: "news-9",
    title: "US Jobless Claims Rise to 8-Month High, Recession Fears Mount",
    titleZh: "美国初请失业金人数升至8个月高点，衰退担忧加剧",
    source: "CNBC",
    timestamp: makeDate(5, 8),
    date_str: fmt(makeDate(5, 8)),
    category: "Sentiment",
    sentiment: "neutral",
    sentimentScore: -0.15,
    summary: "Weekly initial jobless claims jumped to 285k, the highest level since September 2025. While concerning, some analysts view this as a normalization rather than recession signal.",
    summaryZh: "每周初请失业金人数跃升至28.5万，为2025年9月以来最高水平。虽然令人担忧，但部分分析师认为这只是正常化而非衰退信号。",
    relatedAssets: ["BTC", "ETH"],
    impactLevel: "medium",
    keywords: ["jobless claims", "recession", "labor market"],
  },
  {
    id: "news-10",
    title: "MicroStrategy Announces $2B Convertible Note Offering to Buy Bitcoin",
    titleZh: "MicroStrategy宣布发行20亿美元可转债用于购买比特币",
    source: "CoinTelegraph",
    timestamp: makeDate(5, 13),
    date_str: fmt(makeDate(5, 13)),
    category: "CryptoNative",
    sentiment: "bullish",
    sentimentScore: 0.70,
    summary: "Michael Saylor's firm plans to raise $2 billion through convertible senior notes, with proceeds earmarked exclusively for additional Bitcoin acquisitions.",
    summaryZh: "Michael Saylor的公司计划通过可转换优先票据筹集20亿美元，所得款项专门用于追加购买比特币。",
    relatedAssets: ["BTC"],
    impactLevel: "medium",
    keywords: ["MicroStrategy", "Bitcoin", "Saylor", "convertible"],
  },
  {
    id: "news-11",
    title: "China Expands Digital Yuan Pilot to Cross-Border Trade Settlement",
    titleZh: "中国将数字人民币试点扩展至跨境贸易结算",
    source: "SCMP",
    timestamp: makeDate(6, 9),
    date_str: fmt(makeDate(6, 9)),
    category: "Regulation",
    sentiment: "neutral",
    sentimentScore: 0.10,
    summary: "The PBOC announced expansion of digital yuan testing to include cross-border B2B transactions with ASEAN partners, a move seen as competing with dollar settlement systems.",
    summaryZh: "央行宣布扩大数字人民币测试范围，包括与东盟合作伙伴的跨境B2B交易，此举被视为与美元结算体系竞争。",
    relatedAssets: ["BTC", "ETH"],
    impactLevel: "low",
    keywords: ["China", "digital yuan", "CBDC", "ASEAN"],
  },
  {
    id: "news-12",
    title: "Gold Breaks Above $3,400 as Safe Haven Demand Surges",
    titleZh: "黄金价格突破3400美元，避险需求激增",
    source: "Kitco",
    timestamp: makeDate(6, 14),
    date_str: fmt(makeDate(6, 14)),
    category: "Geopolitics",
    sentiment: "bullish",
    sentimentScore: 0.45,
    summary: "Spot gold prices reached new all-time highs above $3,400/oz as geopolitical tensions and de-dollarization narratives drive institutional allocation to precious metals.",
    summaryZh: "现货黄金价格创下3400美元/盎司以上的历史新高，地缘政治紧张局势和去美元化叙事推动机构投资者配置贵金属。",
    relatedAssets: ["GOLD", "BTC"],
    impactLevel: "medium",
    keywords: ["gold", "safe haven", "all-time high"],
  },
];

export function getNewsByCategory(category: string): NewsItem[] {
  return MOCK_NEWS.filter(n => n.category === category);
}

export function getNewsBySentiment(sentiment: Sentiment): NewsItem[] {
  return MOCK_NEWS.filter(n => n.sentiment === sentiment);
}

export function searchNews(query: string): NewsItem[] {
  const q = query.toLowerCase();
  return MOCK_NEWS.filter(
    n =>
      n.title.toLowerCase().includes(q) ||
      n.summary.toLowerCase().includes(q) ||
      n.source.toLowerCase().includes(q) ||
      n.keywords.some(k => k.toLowerCase().includes(q))
  );
}
