import { useState, useMemo, useEffect } from "react";
import { useI18n } from "@/i18n/context";
import { useAppStore } from "@/store/appStore";
import { MOCK_NEWS, type NewsItem, type Sentiment } from "@/data/mockNews";
import { fetchRealNews } from "@/services/newsApi";
import type { FactorItem } from "@/services/factorEngine";

const SENTIMENT_COLOR: Record<Sentiment, string> = {
  bullish: "#22c55e",
  bearish: "#ef4444",
  neutral: "#94a3b8",
};

const SENTIMENT_BG: Record<Sentiment, string> = {
  bullish: "#22c55e15",
  bearish: "#ef444415",
  neutral: "#94a3b815",
};

const CAT_COLOR: Record<string, string> = {
  Monetary: "#3b82f6", Inflation: "#f59e0b", Geopolitics: "#8b5cf6",
  Regulation: "#ec4899", CryptoNative: "#f7931a", Sentiment: "#06b6d4", Political: "#ef4444",
};

interface Props {
  onAddAsFactor: (f: FactorItem) => void;
}

export default function NewsFeed({ onAddAsFactor }: Props) {
  const { t, locale } = useI18n();
  const isZh = locale === "zh";
  const setHoverTimestamp = useAppStore(s => s.setHoverTimestamp);
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [filterSent, setFilterSent] = useState<Sentiment | null>(null);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newsItems, setNewsItems] = useState<NewsItem[]>(MOCK_NEWS);
  const [newsLoading, setNewsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    fetchRealNews().then(items => {
      if (!mounted) return;
      setNewsItems(items);
      setNewsLoading(false);
    });
    return () => { mounted = false; };
  }, []);

  const filtered = useMemo(() => {
    let list = [...newsItems];
    if (filterCat) list = list.filter(n => n.category === filterCat);
    if (filterSent) list = list.filter(n => n.sentiment === filterSent);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        n =>
          n.title.toLowerCase().includes(q) ||
          n.summary.toLowerCase().includes(q) ||
          n.source.toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => b.timestamp - a.timestamp);
  }, [filterCat, filterSent, newsItems, search]);

  // 情感统计
  const stats = useMemo(() => {
    const s = { bullish: 0, bearish: 0, neutral: 0 };
    for (const n of filtered) s[n.sentiment]++;
    return s;
  }, [filtered]);

  const isFromApi = newsItems.length > MOCK_NEWS.length;

  const total = filtered.length || 1;

  return (
    <div className="h-full flex flex-col bg-[#111827] overflow-hidden">
      {/* 头部：情感分析条 */}
      <div className="p-2.5 border-b border-[#1e293b]">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] font-bold text-[#e2e8f0] tracking-wider">{t("news.title") || "新闻信息流"}</h3>
            {newsLoading && <span className="text-[10px] text-[#3b82f6] animate-pulse">加载中...</span>}
            {isFromApi && !newsLoading && <span className="text-[9px] px-1 py-0.5 rounded bg-[#22c55e20] text-[#22c55e] border border-[#22c55e40]">实时</span>}
            {!isFromApi && !newsLoading && <span className="text-[9px] px-1 py-0.5 rounded bg-[#47556920] text-[#475569] border border-[#47556940]">演示</span>}
          </div>
          <span className="text-[11px] text-[#475569]">{filtered.length} 条</span>
        </div>

        {/* 情感分析条 */}
        <div className="flex h-2 rounded-full overflow-hidden mb-1.5">
          <div style={{ width: `${(stats.bullish / total) * 100}%`, background: "#22c55e" }} />
          <div style={{ width: `${(stats.neutral / total) * 100}%`, background: "#334155" }} />
          <div style={{ width: `${(stats.bearish / total) * 100}%`, background: "#ef4444" }} />
        </div>
        <div className="flex justify-between text-[11px] font-mono">
          <span style={{ color: "#22c55e" }}>▲ {stats.bullish} 看涨</span>
          <span style={{ color: "#475569" }}>◆ {stats.neutral} 中性</span>
          <span style={{ color: "#ef4444" }}>▼ {stats.bearish} 看跌</span>
        </div>
      </div>

      {/* 搜索 + 筛选 */}
      <div className="px-2.5 py-1.5 border-b border-[#1e293b] space-y-1.5">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={isZh ? "搜索新闻..." : "Search news..."}
          className="w-full bg-[#0a0e1a] border border-[#1e293b] rounded px-2 py-1.5 text-[12px] text-[#e2e8f0] placeholder-[#475569] outline-none focus:border-[#3b82f6]"
        />
        <div className="flex gap-1 overflow-x-auto">
          <button
            onClick={() => setFilterSent(filterSent === "bullish" ? null : "bullish")}
            className="text-[11px] px-2 py-0.5 rounded font-bold whitespace-nowrap transition-colors"
            style={{
              background: filterSent === "bullish" ? "#22c55e20" : "transparent",
              color: filterSent === "bullish" ? "#22c55e" : "#475569",
              border: filterSent === "bullish" ? "1px solid #22c55e40" : "1px solid transparent",
            }}
          >
            ▲ {isZh ? "看涨" : "Bullish"}
          </button>
          <button
            onClick={() => setFilterSent(filterSent === "bearish" ? null : "bearish")}
            className="text-[11px] px-2 py-0.5 rounded font-bold whitespace-nowrap transition-colors"
            style={{
              background: filterSent === "bearish" ? "#ef444420" : "transparent",
              color: filterSent === "bearish" ? "#ef4444" : "#475569",
              border: filterSent === "bearish" ? "1px solid #ef444440" : "1px solid transparent",
            }}
          >
            ▼ {isZh ? "看跌" : "Bearish"}
          </button>
          <button
            onClick={() => setFilterSent(filterSent === "neutral" ? null : "neutral")}
            className="text-[11px] px-2 py-0.5 rounded font-bold whitespace-nowrap transition-colors"
            style={{
              background: filterSent === "neutral" ? "#94a3b820" : "transparent",
              color: filterSent === "neutral" ? "#94a3b8" : "#475569",
              border: filterSent === "neutral" ? "1px solid #94a3b840" : "1px solid transparent",
            }}
          >
            ◆ {isZh ? "中性" : "Neutral"}
          </button>
          {Object.keys(CAT_COLOR).map(cat => (
            <button
              key={cat}
              onClick={() => setFilterCat(filterCat === cat ? null : cat)}
              className="text-[11px] px-2 py-0.5 rounded font-bold whitespace-nowrap transition-colors"
              style={{
                background: filterCat === cat ? `${CAT_COLOR[cat]}20` : "transparent",
                color: filterCat === cat ? CAT_COLOR[cat] : "#475569",
                border: filterCat === cat ? `1px solid ${CAT_COLOR[cat]}40` : "1px solid transparent",
              }}
            >
              {isZh ? {
                Monetary: "货币", Inflation: "通胀", Geopolitics: "地缘",
                Regulation: "监管", CryptoNative: "加密", Sentiment: "情绪", Political: "政治"
              }[cat] || cat : cat.slice(0, 4).toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* 新闻列表 */}
      <div className="flex-1 overflow-y-auto">
        {filtered.map(news => (
          <NewsCard
            key={news.id}
            news={news}
            expanded={expandedId === news.id}
            onToggle={() => setExpandedId(expandedId === news.id ? null : news.id)}
            onAddAsFactor={onAddAsFactor}
            onHover={setHoverTimestamp}
          />
        ))}
        {filtered.length === 0 && (
          <div className="p-4 text-center text-[12px] text-[#475569]">
            {isZh ? "没有匹配的新闻" : "No news matches filters"}
          </div>
        )}
      </div>
    </div>
  );
}

function NewsCard({
  news,
  expanded,
  onToggle,
  onAddAsFactor,
  onHover,
}: {
  news: NewsItem;
  expanded: boolean;
  onToggle: () => void;
  onAddAsFactor: (f: FactorItem) => void;
  onHover?: (ts: number | null) => void;
}) {
  const { locale } = useI18n();
  const isZh = locale === "zh";
  const displayTitle = isZh && news.titleZh ? news.titleZh : news.title;
  const displaySummary = isZh && news.summaryZh ? news.summaryZh : news.summary;

  const sentColor = SENTIMENT_COLOR[news.sentiment];
  const sentBg = SENTIMENT_BG[news.sentiment];
  const catColor = CAT_COLOR[news.category] || "#475569";
  const impactColor = news.impactLevel === "high" ? "#ef4444" : news.impactLevel === "medium" ? "#eab308" : "#3b82f6";
  const impactLabel = isZh
    ? (news.impactLevel === "high" ? "高" : news.impactLevel === "medium" ? "中" : "低")
    : news.impactLevel.toUpperCase();
  const sentLabel = isZh
    ? (news.sentiment === "bullish" ? "看涨" : news.sentiment === "bearish" ? "看跌" : "中性")
    : news.sentiment.toUpperCase();
  const catLabel = isZh ? {
    Monetary: "货币", Inflation: "通胀", Geopolitics: "地缘",
    Regulation: "监管", CryptoNative: "加密", Sentiment: "情绪", Political: "政治"
  }[news.category] || news.category : news.category.slice(0, 3).toUpperCase();

  const handleAdd = () => {
    const factor: FactorItem = {
      id: `news-${news.id}`,
      name: displayTitle.slice(0, 60) + (displayTitle.length > 60 ? "..." : ""),
      category: news.category,
      subcategory: "News",
      probability: Math.abs(news.sentimentScore),
      volume24h: 0,
      liquidity: 0,
      endDate: "",
      oneDayChange: 0,
      oneWeekChange: 0,
      relevance_score: 0.75,
      impact_description: displaySummary.slice(0, 100),
      source: "User" as const,
      enabled: true,
      userAdded: true,
      directionOverride: news.sentimentScore > 0.2 ? "bullish" : news.sentimentScore < -0.2 ? "bearish" : "neutral",
      weight: news.impactLevel === "high" ? 1.2 : news.impactLevel === "medium" ? 1.0 : 0.8,
    };
    onAddAsFactor(factor);
  };

  return (
    <div className="border-b border-[#1e293b]/40 hover:bg-[#161f2e] transition-colors"
      onMouseEnter={() => onHover?.(news.timestamp)}
      onMouseLeave={() => onHover?.(null)}
    >
      <div className="p-2.5 cursor-pointer" onClick={onToggle}>
        {/* 行1：来源 + 时间 + 情感标签 */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: `${catColor}20`, color: catColor }}>
            {catLabel}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: sentBg, color: sentColor }}>
            {sentLabel}
          </span>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded font-bold"
            style={{ background: `${impactColor}15`, color: impactColor }}
          >
            {impactLabel}
          </span>
          <span className="text-[10px] text-[#475569] ml-auto">{news.source}</span>
          <span className="text-[10px] text-[#475569] font-mono">{news.date_str}</span>
        </div>

        {/* 标题 */}
        <p className="text-[13px] text-[#e2e8f0] leading-snug mb-1.5 font-medium">{displayTitle}</p>

        {/* 情感得分条 */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-[#1e293b] rounded-full overflow-hidden relative">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.abs(news.sentimentScore) * 50}%`,
                background: sentColor,
                marginLeft: news.sentimentScore < 0 ? "auto" : "0",
                marginRight: news.sentimentScore < 0 ? "0" : "auto",
              }}
            />
          </div>
          <span className="text-[11px] font-mono" style={{ color: sentColor }}>
            {(news.sentimentScore * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div className="px-3 pb-2.5 space-y-1.5">
          <p className="text-[12px] text-[#94a3b8] leading-relaxed">{displaySummary}</p>
          <div className="flex items-center gap-2 flex-wrap">
            {news.keywords.map(k => (
              <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-[#1a2236] text-[#475569]">
                #{k}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[11px] text-[#475569]">{isZh ? "相关资产:" : "Related:"}</span>
            {news.relatedAssets.map(a => (
              <span key={a} className="text-[11px] font-mono text-[#3b82f6]">{a}</span>
            ))}
            <button
              onClick={handleAdd}
              className="ml-auto text-[11px] px-2.5 py-1 rounded bg-[#3b82f6] text-white hover:bg-[#3b82f6aa] font-bold transition-colors"
            >
              + {isZh ? "添加为因子" : "Add as Factor"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
