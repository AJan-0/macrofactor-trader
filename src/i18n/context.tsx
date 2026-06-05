import { createContext, useContext } from "react";

export type Locale = "en" | "zh";

export interface I18nContextValue {
  locale: Locale;
  t: (key: string) => string;
  setLocale: (l: Locale) => void;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

export const STORAGE_KEY = "macrofactor_locale";

export function getStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "zh" || stored === "en") return stored;
  } catch {
    return "en";
  }
  // 检测浏览器语言
  const nav = navigator.language;
  if (nav.startsWith("zh")) return "zh";
  return "en";
}

// ──────────────────────────────
// 翻译文件
// ──────────────────────────────

export const translations: Record<Locale, Record<string, string>> = {
  en: {
    // Toolbar
    "app.name": "MACROFACTOR",
    "toolbar.price": "Price",
    "toolbar.change24h": "24h",
    "toolbar.loading": "Loading...",
    "toolbar.live": "LIVE",
    "toolbar.lastUpdate": "Updated",
    "toolbar.lang": "EN/中",

    // Timeframes
    "timeframe.1m": "1m",
    "timeframe.3m": "3m",
    "timeframe.5m": "5m",
    "timeframe.15m": "15m",
    "timeframe.1H": "1H",
    "timeframe.4H": "4H",
    "timeframe.1D": "1D",

    // Assets
    "asset.btc": "BTC",
    "asset.eth": "ETH",
    "asset.gold": "GOLD",
    "asset.sol": "SOL",

    // Narrative
    "narrative.title": "Macro Summary",
    "narrative.bullish": "Bullish bias",
    "narrative.bearish": "Bearish bias",
    "narrative.neutral": "Neutral",
    "narrative.drivenBy": "Driven by",
    "narrative.factor": "factors",
    "narrative.watch": "Watch",
    "narrative.thisWeek": "this week",
    "narrative.stayTuned": "Stay tuned",
    "narrative.dataStale": "Data stale",
    "narrative.dataFresh": "Just now",
    "narrative.minAgo": "min ago",

    // Upcoming
    "upcoming.title": "UPCOMING THIS WEEK",
    "upcoming.today": "Today",
    "upcoming.tomorrow": "Tomorrow",
    "upcoming.days": "days",
    "upcoming.impact": "Impact",
    "upcoming.ifHold": "If hold",
    "upcoming.ifCut": "If cut",
    "upcoming.ifHike": "If hike",

    // Factor Dashboard
    "factors.title": "FACTORS",
    "factors.manage": "Manage",
    "factors.all": "ALL",
    "factors.bullish": "BULL",
    "factors.bearish": "BEAR",
    "factors.noActive": "No active factors",
    "factors.openLibrary": "Open Factor Library",
    "factors.enabled": "enabled",
    "factors.total": "total",

    // Factor Library
    "library.title": "FACTOR LIBRARY",
    "library.add": "+ ADD",
    "library.reset": "RESET",
    "library.close": "Close",
    "library.search": "Search factors...",
    "library.addCustom": "ADD CUSTOM FACTOR",
    "library.namePlaceholder": "Factor name (e.g. Trump tweets about BTC)",
    "library.category": "Category",
    "library.direction": "Direction",
    "library.bullish": "Bullish",
    "library.bearish": "Bearish",
    "library.neutral": "Neutral",
    "library.probability": "Probability",
    "library.descPlaceholder": "Impact description (optional)",
    "library.addBtn": "ADD FACTOR",
    "library.noResults": "No factors found",
    "library.batchOps": "BATCH OPERATIONS",
    "library.enableAll": "Enable All",
    "library.disableAll": "Disable All",
    "library.thisWeek": "This Week Only",
    "library.nextWeek": "Next Week Only",
    "library.thisWeekShort": "This Week",
    "library.nextWeekShort": "Next Week",
    "library.recommended": "RECOMMENDED",
    "library.noRecommended": "No recommendations — all high-priority factors are enabled",
    "filter.timeAll": "All Time",
    "filter.thisWeek": "This Week",
    "filter.nextWeek": "Next Week",
    "filter.thisMonth": "This Month",
    "filter.longTerm": "Long Term",
    "filter.noDate": "No Date",
    "filter.dirAll": "All Dir",
    "filter.statusAll": "All",
    "filter.statusEnabled": "Enabled",
    "filter.statusDisabled": "Disabled",
    "filter.statusCustom": "Custom",

    // Backtest
    "backtest.title": "ENGINE ACCURACY",
    "backtest.accuracy1d": "1D Accuracy",
    "backtest.accuracy7d": "7D Accuracy",
    "backtest.historical": "HISTORICAL SIGNALS",
    "backtest.correct": "Correct",
    "backtest.wrong": "Wrong",

    // Scenarios
    "scenarios.title": "SAVED SCENARIOS",
    "scenarios.noSaved": "No saved scenarios yet",
    "scenarios.hint": "Adjust factor probabilities and click Save Scenario",
    "scenarios.compare": "Compare",
    "scenarios.load": "LOAD",
    "scenarios.current": "CURRENT",
    "scenarios.comparison": "SCENARIO COMPARISON",

    // Factor card
    "factor.quality": "Quality",
    "factor.horizon": "Horizon",
    "factor.strength": "Strength",
    "factor.historical": "Historical",
    "factor.prediction": "Prediction",
    "factor.short": "Short",
    "factor.medium": "Medium",
    "factor.long": "Long",
    "factor.editProb": "Edit probability",

    // News
    "news.title": "NEWS FEED",
    "news.search": "Search news...",
    "news.noResults": "No news matches filters",

    // Graph
    "graph.title": "CORRELATION GRAPH",

    // Common
    "common.save": "Save",
    "common.cancel": "Cancel",
    "common.refresh": "Refresh",
    "common.loading": "Loading...",

    // Chart
    "chart.dataError": "Data loading failed",
    "chart.reload": "Reload",
    "chart.strategy": "Strategy",
    "chart.strategyList": "Strategy List",
    "chart.consensus": "Consensus",
    "chart.pine": "Pine",
    "chart.addStrategy": "Add strategy...",
    "chart.params": "Params",
    "chart.backtest": "Backtest",
    "chart.clearAll": "Clear All",
    "chart.noStrategies": "No strategies. Select from above to add.",
    "chart.on": "ON",
    "chart.off": "OFF",
    "chart.signals": "signals",
    "chart.lines": "lines",

    // Toolbar
    "toolbar.selectAsset": "Select asset",
    "toolbar.assetList": "Asset list",

    // Alert
    "alert.enable": "Enable alerts",
    "alert.settings": "Alert Settings",
    "alert.desktopNotify": "Desktop Notification",
    "alert.sound": "Sound Alert",
    "alert.minStrength": "Min Strength",
    "alert.cooldown": "Cooldown(s)",
    "alert.clearHistory": "Clear History",
    "alert.authorize": "Authorize",
    "alert.buy": "BUY",
    "alert.sell": "SELL",
    "alert.neutral": "NEUTRAL",

    // Backtest
    "backtest.noData": "Insufficient data for backtest",
    "backtest.totalReturn": "Total Return",
    "backtest.winRate": "Win Rate",
    "backtest.trades": "Trades",
    "backtest.maxDrawdown": "Max DD",
    "backtest.sharpe": "Sharpe",
    "backtest.profitFactor": "Profit Factor",
    "backtest.equityCurve": "Equity Curve",
    "backtest.showTrades": "Show Trades",
    "backtest.hideTrades": "Hide Trades",
    "backtest.long": "LONG",
    "backtest.short": "SHORT",
  },
  zh: {
    // Toolbar
    "app.name": "宏观因子",
    "toolbar.price": "价格",
    "toolbar.change24h": "24小时",
    "toolbar.loading": "加载中...",
    "toolbar.live": "实时",
    "toolbar.lastUpdate": "更新于",
    "toolbar.lang": "中/EN",

    // Timeframes
    "timeframe.1m": "1分",
    "timeframe.3m": "3分",
    "timeframe.5m": "5分",
    "timeframe.15m": "15分",
    "timeframe.1H": "1小时",
    "timeframe.4H": "4小时",
    "timeframe.1D": "日线",

    // Assets
    "asset.btc": "BTC",
    "asset.eth": "ETH",
    "asset.gold": "黄金",

    // Narrative
    "narrative.title": "宏观摘要",
    "narrative.bullish": "偏多",
    "narrative.bearish": "偏空",
    "narrative.neutral": "中性",
    "narrative.drivenBy": "由",
    "narrative.factor": "个因子驱动",
    "narrative.watch": "关注",
    "narrative.thisWeek": "本周",
    "narrative.stayTuned": "保持关注",
    "narrative.dataStale": "数据过期",
    "narrative.dataFresh": "刚刚",
    "narrative.minAgo": "分钟前",

    // Upcoming
    "upcoming.title": "本周焦点事件",
    "upcoming.today": "今天",
    "upcoming.tomorrow": "明天",
    "upcoming.days": "天后",
    "upcoming.impact": "影响",
    "upcoming.ifHold": "若维持",
    "upcoming.ifCut": "若降息",
    "upcoming.ifHike": "若加息",

    // Factor Dashboard
    "factors.title": "因子",
    "factors.manage": "管理",
    "factors.all": "全部",
    "factors.bullish": "看多",
    "factors.bearish": "看空",
    "factors.noActive": "无活跃因子",
    "factors.openLibrary": "打开因子库",
    "factors.enabled": "已启用",
    "factors.total": "共",

    // Factor Library
    "library.title": "因子库",
    "library.add": "+ 添加",
    "library.reset": "重置",
    "library.close": "关闭",
    "library.search": "搜索因子...",
    "library.addCustom": "添加自定义因子",
    "library.namePlaceholder": "因子名称（如：特朗普发文挺BTC）",
    "library.category": "分类",
    "library.direction": "方向",
    "library.bullish": "看多",
    "library.bearish": "看空",
    "library.neutral": "中性",
    "library.probability": "概率",
    "library.descPlaceholder": "影响描述（可选）",
    "library.addBtn": "添加因子",
    "library.noResults": "未找到因子",
    "library.batchOps": "批量操作",
    "library.enableAll": "全部开启",
    "library.disableAll": "全部关闭",
    "library.thisWeek": "仅本周",
    "library.nextWeek": "仅下周",
    "library.thisWeekShort": "本周",
    "library.nextWeekShort": "下周",
    "library.recommended": "智能推荐",
    "library.noRecommended": "暂无推荐 — 所有高优先级因子已启用",
    "filter.timeAll": "全部时间",
    "filter.thisWeek": "本周",
    "filter.nextWeek": "下周",
    "filter.thisMonth": "本月",
    "filter.longTerm": "长期",
    "filter.noDate": "无期限",
    "filter.dirAll": "全部方向",
    "filter.statusAll": "全部",
    "filter.statusEnabled": "已启用",
    "filter.statusDisabled": "未启用",
    "filter.statusCustom": "自定义",

    // Backtest
    "backtest.title": "引擎准确率",
    "backtest.accuracy1d": "1日准确率",
    "backtest.accuracy7d": "7日准确率",
    "backtest.historical": "历史信号验证",
    "backtest.correct": "正确",
    "backtest.wrong": "错误",

    // Scenarios
    "scenarios.title": "已保存场景",
    "scenarios.noSaved": "尚未保存场景",
    "scenarios.hint": "调整因子概率后点击保存场景",
    "scenarios.compare": "对比",
    "scenarios.load": "加载",
    "scenarios.current": "当前",
    "scenarios.comparison": "场景对比",

    // Factor card
    "factor.quality": "质量",
    "factor.horizon": "周期",
    "factor.strength": "强度",
    "factor.historical": "历史",
    "factor.prediction": "预测",
    "factor.short": "短期",
    "factor.medium": "中期",
    "factor.long": "长期",
    "factor.editProb": "编辑概率",

    // News
    "news.title": "新闻信息流",
    "news.search": "搜索新闻...",
    "news.noResults": "无匹配新闻",

    // Graph
    "graph.title": "关联图谱",

    // Common
    "common.save": "保存",
    "common.cancel": "取消",
    "common.refresh": "刷新",
    "common.loading": "加载中...",

    // Chart
    "chart.dataError": "数据加载失败",
    "chart.reload": "重新加载",
    "chart.strategy": "策略",
    "chart.strategyList": "策略列表",
    "chart.consensus": "共识",
    "chart.pine": "Pine",
    "chart.addStrategy": "添加策略...",
    "chart.params": "参数",
    "chart.backtest": "回测",
    "chart.clearAll": "清空所有策略",
    "chart.noStrategies": "暂无策略，从上方选择添加",
    "chart.on": "ON",
    "chart.off": "OFF",
    "chart.signals": "signals",
    "chart.lines": "lines",

    // Toolbar
    "toolbar.selectAsset": "选择资产",
    "toolbar.assetList": "资产列表",

    // Alert
    "alert.enable": "启用预警",
    "alert.settings": "预警设置",
    "alert.desktopNotify": "桌面通知",
    "alert.sound": "声音提醒",
    "alert.minStrength": "最小强度",
    "alert.cooldown": "冷却(秒)",
    "alert.clearHistory": "清除通知历史",
    "alert.authorize": "授权",
    "alert.buy": "买入",
    "alert.sell": "卖出",
    "alert.neutral": "中性",

    // Backtest
    "backtest.noData": "数据不足，无法回测",
    "backtest.totalReturn": "总收益",
    "backtest.winRate": "胜率",
    "backtest.trades": "交易数",
    "backtest.maxDrawdown": "最大回撤",
    "backtest.sharpe": "夏普",
    "backtest.profitFactor": "盈亏比",
    "backtest.equityCurve": "权益曲线",
    "backtest.showTrades": "展开交易记录",
    "backtest.hideTrades": "收起交易记录",
    "backtest.long": "做多",
    "backtest.short": "做空",
  },
};
