import { useState, useMemo } from "react";
import { useI18n } from "@/i18n/context";
import {
  BUILTIN_LIBRARY,
  getFactorsByCategory,
  WEIGHT_TEMPLATES,
  getRecommendedFactors,
  filterFactors,
  getEndDateLabel,
  getFactorDirection,
} from "@/data/factorLibrary";
import type { FactorItem } from "@/services/factorEngine";
import type { WeightTemplate, FactorFilters, RecommendedFactor } from "@/data/factorLibrary";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const CAT_COLOR: Record<string, string> = {
  Monetary: "#3b82f6", Inflation: "#f59e0b", Geopolitics: "#8b5cf6",
  Regulation: "#ec4899", CryptoNative: "#f7931a", Sentiment: "#06b6d4", Political: "#ef4444",
};

const DIR_ICON: Record<string, string> = {
  bullish: "▲", bearish: "▼", neutral: "◆",
};

const DIR_COLOR: Record<string, string> = {
  bullish: "#22c55e", bearish: "#ef4444", neutral: "#94a3b8",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  factors: FactorItem[];
  onToggle: (id: string) => void;
  onAddCustom: (f: FactorItem) => void;
  onReset: () => void;
  onApplyTemplate?: (template: WeightTemplate) => void;
  onEnableAll?: () => void;
  onDisableAll?: () => void;
  onEnableThisWeek?: () => void;
  onEnableNextWeek?: () => void;
}

export default function FactorLibrary({
  open,
  onOpenChange,
  factors,
  onToggle,
  onAddCustom,
  onReset,
  onApplyTemplate,
  onEnableAll,
  onDisableAll,
  onEnableThisWeek,
  onEnableNextWeek,
}: Props) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [showEditor, setShowEditor] = useState(false);
  const [activeCat, setActiveCat] = useState<string | null>(null);

  // 多维过滤状态
  const [filters, setFilters] = useState<FactorFilters>({
    search: "",
    category: null,
    timeRange: "all",
    direction: "all",
    status: "all",
  });

  // 自定义因子表单
  const [customName, setCustomName] = useState("");
  const [customCat, setCustomCat] = useState<FactorItem["category"]>("Geopolitics");
  const [customProb, setCustomProb] = useState(50);
  const [customDir, setCustomDir] = useState<"bullish" | "bearish" | "neutral">("bullish");
  const [customDesc, setCustomDesc] = useState("");

  const byCat = useMemo(() => getFactorsByCategory(), []);
  const categories = Object.keys(byCat);

  // 推荐因子
  const recommendations = useMemo(() => getRecommendedFactors(factors), [factors]);

  // 过滤后的列表
  const filtered = useMemo(() => {
    const f: FactorFilters = {
      ...filters,
      search,
      category: activeCat,
    };
    return filterFactors(factors, f);
  }, [factors, filters, search, activeCat]);

  // 检查内置因子是否已启用
  const isEnabled = (id: string) => {
    const f = factors.find(x => x.id === id);
    return f ? f.enabled : false;
  };

  const handleAddCustom = () => {
    if (!customName.trim()) return;
    const newFactor: FactorItem = {
      id: `user-${Date.now()}`,
      name: customName.trim(),
      category: customCat,
      subcategory: "Custom",
      probability: customProb / 100,
      volume24h: 0,
      liquidity: 0,
      endDate: "",
      oneDayChange: 0,
      oneWeekChange: 0,
      relevance_score: 0.8,
      impact_description: customDesc || "User-defined factor",
      source: "User",
      enabled: true,
      userAdded: true,
      directionOverride: customDir,
      weight: 1.0,
    };
    onAddCustom(newFactor);
    setCustomName("");
    setCustomDesc("");
    setShowEditor(false);
  };

  const handleEnableRecommended = (id: string) => {
    onToggle(id);
  };

  const updateFilter = <K extends keyof FactorFilters>(key: K, value: FactorFilters[K]) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[420px] sm:max-w-[420px] p-0 bg-[#111827] border-l border-[#1e293b] flex flex-col overflow-hidden">
        <SheetHeader className="p-3 pb-0 border-b border-[#1e293b]">
          <SheetTitle className="text-[11px] font-bold text-[#e2e8f0] tracking-wider">
            {t("library.title")}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 批量操作工具栏 */}
          <BatchToolbar
            t={t}
            onEnableAll={onEnableAll}
            onDisableAll={onDisableAll}
            onEnableThisWeek={onEnableThisWeek}
            onEnableNextWeek={onEnableNextWeek}
            onReset={onReset}
          />

          {/* 智能推荐区域 */}
          {recommendations.length > 0 && (
            <RecommendationPanel
              recommendations={recommendations}
              t={t}
              onEnable={handleEnableRecommended}
            />
          )}

          {/* 搜索 */}
          <div className="px-3 py-1.5 border-b border-[#1e293b]">
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setActiveCat(null); }}
              placeholder={t("library.search")}
              className="w-full bg-[#0a0e1a] border border-[#1e293b] rounded px-2 py-1 text-[10px] text-[#e2e8f0] placeholder-[#475569] outline-none focus:border-[#3b82f6]"
            />
          </div>

          {/* 分类筛选 */}
          {!search && (
            <div className="flex gap-1 px-3 py-1 border-b border-[#1e293b] overflow-x-auto">
              <button onClick={() => setActiveCat(null)}
                className={`text-[8px] px-2 py-0.5 rounded font-bold whitespace-nowrap ${!activeCat ? "bg-[#1a2236] text-[#e2e8f0]" : "text-[#475569] hover:text-[#94a3b8]"}`}>
                ALL ({BUILTIN_LIBRARY.length})
              </button>
              {categories.map(cat => {
                const count = byCat[cat]?.length || 0;
                const color = CAT_COLOR[cat] || "#475569";
                return (
                  <button key={cat} onClick={() => setActiveCat(activeCat === cat ? null : cat)}
                    className="text-[8px] px-2 py-0.5 rounded font-bold whitespace-nowrap transition-colors"
                    style={{
                      background: activeCat === cat ? `${color}20` : "transparent",
                      color: activeCat === cat ? color : "#475569",
                      border: activeCat === cat ? `1px solid ${color}40` : "1px solid transparent",
                    }}>
                    {cat} ({count})
                  </button>
                );
              })}
            </div>
          )}

          {/* 多维过滤栏 */}
          <FilterBar filters={filters} onChange={updateFilter} t={t} />

          {/* 自定义因子编辑器 */}
          {showEditor && (
            <div className="px-3 py-2 border-b border-[#1e293b] bg-[#0a0e1a] space-y-1.5">
              <div className="text-[9px] font-bold text-[#22c55e]">{t("library.addCustom")}</div>
              <input value={customName} onChange={e => setCustomName(e.target.value)}
                placeholder={t("library.namePlaceholder")}
                className="w-full bg-[#111827] border border-[#1e293b] rounded px-2 py-1 text-[10px] text-[#e2e8f0] placeholder-[#475569] outline-none" />
              <div className="flex gap-2">
                <select value={customCat} onChange={e => setCustomCat(e.target.value as FactorItem["category"])}
                  className="bg-[#111827] border border-[#1e293b] rounded px-2 py-1 text-[9px] text-[#e2e8f0] outline-none flex-1">
                  {Object.keys(CAT_COLOR).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={customDir} onChange={e => setCustomDir(e.target.value as "bullish" | "bearish" | "neutral")}
                  className="bg-[#111827] border border-[#1e293b] rounded px-2 py-1 text-[9px] text-[#e2e8f0] outline-none">
                  <option value="bullish">▲ {t("library.bullish")}</option>
                  <option value="bearish">▼ {t("library.bearish")}</option>
                  <option value="neutral">◆ {t("library.neutral")}</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[8px] text-[#475569]">Prob:</span>
                <input type="range" min={1} max={99} value={customProb}
                  onChange={e => setCustomProb(Number(e.target.value))}
                  className="flex-1 h-1 accent-[#3b82f6]" />
                <span className="text-[9px] font-mono text-[#e2e8f0]">{customProb}%</span>
              </div>
              <input value={customDesc} onChange={e => setCustomDesc(e.target.value)}
                placeholder={t("library.descPlaceholder")}
                className="w-full bg-[#111827] border border-[#1e293b] rounded px-2 py-1 text-[10px] text-[#e2e8f0] placeholder-[#475569] outline-none" />
              <button onClick={handleAddCustom}
                className="w-full text-[9px] py-1 rounded bg-[#22c55e] text-white font-bold hover:bg-[#22c55e90] transition-colors">
                {t("library.addBtn")}
              </button>
            </div>
          )}

          {/* 因子列表 */}
          <div className="flex-1 overflow-y-auto">
            {filtered.map(f => (
              <FactorListItem
                key={f.id}
                factor={f}
                isEnabled={isEnabled(f.id)}
                onToggle={() => onToggle(f.id)}
              />
            ))}
            {filtered.length === 0 && (
              <div className="p-4 text-center text-[10px] text-[#475569]">{t("library.noResults")}</div>
            )}
          </div>

          {/* 预设权重模板 */}
          <div className="p-2 border-t border-[#1e293b] bg-[#0a0e1a]">
            <div className="text-[9px] font-bold text-[#e2e8f0] mb-1.5 tracking-wider">WEIGHT TEMPLATES</div>
            <div className="flex gap-1 flex-wrap">
              {WEIGHT_TEMPLATES.map(tpl => (
                <button
                  key={tpl.name}
                  onClick={() => onApplyTemplate?.(tpl)}
                  className="text-[8px] px-2 py-0.5 rounded bg-[#1a2236] text-[#94a3b8] hover:text-[#e2e8f0] hover:bg-[#1e293b] border border-[#1e293b] transition-colors font-bold"
                  title={Object.entries(tpl.weights).map(([k, v]) => `${k}: ${v}x`).join(", ")}
                >
                  {tpl.name}
                </button>
              ))}
            </div>
          </div>

          {/* 底部统计 */}
          <div className="p-2 border-t border-[#1e293b] text-[8px] text-[#475569] flex justify-between">
            <span>{factors.filter(f => f.enabled).length} enabled / {factors.length} total</span>
            <span>{factors.filter(f => f.userAdded).length} custom</span>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ====== 批量操作工具栏 ======

function BatchToolbar({ t, onEnableAll, onDisableAll, onEnableThisWeek, onEnableNextWeek, onReset }: {
  t: (key: string) => string;
  onEnableAll?: () => void;
  onDisableAll?: () => void;
  onEnableThisWeek?: () => void;
  onEnableNextWeek?: () => void;
  onReset: () => void;
}) {
  return (
    <div className="px-3 py-2 border-b border-[#1e293b] bg-[#0a0e1a]">
      <div className="text-[9px] font-bold text-[#e2e8f0] mb-1.5 tracking-wider">{t("library.batchOps") || "BATCH OPERATIONS"}</div>
      <div className="flex gap-1 flex-wrap">
        <button onClick={onDisableAll}
          className="text-[8px] px-2 py-0.5 rounded bg-[#1a2236] text-[#ef4444] hover:bg-[#ef444420] border border-[#1e293b] transition-colors font-bold"
          title={t("library.disableAll") || "Disable all factors"}>
          {t("library.disableAll") || "Disable All"}
        </button>
        <button onClick={onEnableAll}
          className="text-[8px] px-2 py-0.5 rounded bg-[#1a2236] text-[#22c55e] hover:bg-[#22c55e20] border border-[#1e293b] transition-colors font-bold"
          title={t("library.enableAll") || "Enable all factors"}>
          {t("library.enableAll") || "Enable All"}
        </button>
        <button onClick={onEnableThisWeek}
          className="text-[8px] px-2 py-0.5 rounded bg-[#1a2236] text-[#f97316] hover:bg-[#f9731620] border border-[#1e293b] transition-colors font-bold"
          title={t("library.thisWeek") || "Enable this week's factors only"}>
          ⚡ {t("library.thisWeek") || "This Week"}
        </button>
        <button onClick={onEnableNextWeek}
          className="text-[8px] px-2 py-0.5 rounded bg-[#1a2236] text-[#eab308] hover:bg-[#eab30820] border border-[#1e293b] transition-colors font-bold"
          title={t("library.nextWeek") || "Enable next week's factors only"}>
          🌙 {t("library.nextWeek") || "Next Week"}
        </button>
        <button onClick={onReset}
          className="text-[8px] px-2 py-0.5 rounded bg-[#1a2236] text-[#475569] hover:text-[#94a3b8] border border-[#1e293b] transition-colors font-bold">
          {t("library.reset") || "Reset"}
        </button>
      </div>
    </div>
  );
}

// ====== 智能推荐区域 ======

function RecommendationPanel({ recommendations, t, onEnable }: {
  recommendations: RecommendedFactor[];
  t: (key: string) => string;
  onEnable: (id: string) => void;
}) {
  const typeIcon: Record<string, string> = {
    thisWeek: "🔥", nextWeek: "📅", highRelevance: "⭐", categoryGap: "💎",
  };

  return (
    <div className="px-3 py-2 border-b border-[#1e293b] bg-[#0a0e1a]">
      <div className="text-[9px] font-bold text-[#e2e8f0] mb-1.5 tracking-wider flex items-center gap-1">
        <span>💡</span>
        <span>{t("library.recommended") || "RECOMMENDED"}</span>
      </div>
      <div className="space-y-1">
        {recommendations.map(r => {
          const color = CAT_COLOR[r.factor.category] || "#475569";
          const ed = getEndDateLabel(r.factor.endDate);
          return (
            <div key={r.factor.id} className="flex items-center gap-1.5 p-1.5 rounded bg-[#111827] border border-[#1e293b]/50">
              <span className="text-[8px]">{typeIcon[r.reasonType]}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-[7px] px-1 rounded font-bold" style={{ background: `${color}20`, color }}>
                    {r.factor.category.slice(0, 3).toUpperCase()}
                  </span>
                  <span className="text-[9px] text-[#e2e8f0] truncate">{r.factor.name}</span>
                </div>
                <div className="text-[7px] text-[#475569] truncate">{r.reason}</div>
              </div>
              <span className="text-[8px] font-mono px-1 rounded" style={{ background: `${ed.color}15`, color: ed.color }}>
                {ed.text}
              </span>
              <button onClick={() => onEnable(r.factor.id)}
                className="text-[8px] px-1.5 py-0.5 rounded bg-[#22c55e] text-white hover:bg-[#22c55eaa] font-bold transition-colors flex-shrink-0">
                + Enable
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ====== 多维过滤栏 ======

function FilterBar({ filters, onChange, t }: {
  filters: FactorFilters;
  onChange: <K extends keyof FactorFilters>(key: K, value: FactorFilters[K]) => void;
  t: (key: string) => string;
}) {
  const timeOptions: { key: FactorFilters["timeRange"]; label: string }[] = [
    { key: "all", label: t("filter.timeAll") || "All Time" },
    { key: "thisWeek", label: t("filter.thisWeek") || "This Week" },
    { key: "nextWeek", label: t("filter.nextWeek") || "Next Week" },
    { key: "thisMonth", label: t("filter.thisMonth") || "This Month" },
    { key: "longTerm", label: t("filter.longTerm") || "Long Term" },
    { key: "noDate", label: t("filter.noDate") || "No Date" },
  ];

  const dirOptions: { key: FactorFilters["direction"]; label: string; color: string }[] = [
    { key: "all", label: t("filter.dirAll") || "All Dir", color: "#475569" },
    { key: "bullish", label: "▲ Bullish", color: "#22c55e" },
    { key: "bearish", label: "▼ Bearish", color: "#ef4444" },
    { key: "neutral", label: "◆ Neutral", color: "#94a3b8" },
  ];

  const statusOptions: { key: FactorFilters["status"]; label: string }[] = [
    { key: "all", label: t("filter.statusAll") || "All" },
    { key: "enabled", label: t("filter.statusEnabled") || "Enabled" },
    { key: "disabled", label: t("filter.statusDisabled") || "Disabled" },
    { key: "custom", label: t("filter.statusCustom") || "Custom" },
  ];

  return (
    <div className="px-3 py-1.5 border-b border-[#1e293b] space-y-1 bg-[#111827]">
      {/* 时间过滤 */}
      <div className="flex gap-1 overflow-x-auto">
        {timeOptions.map(opt => (
          <button key={opt.key}
            onClick={() => onChange("timeRange", opt.key)}
            className="text-[7px] px-1.5 py-0.5 rounded font-bold whitespace-nowrap transition-colors"
            style={{
              background: filters.timeRange === opt.key ? "#1a2236" : "transparent",
              color: filters.timeRange === opt.key ? "#e2e8f0" : "#475569",
              border: filters.timeRange === opt.key ? "1px solid #3b82f640" : "1px solid transparent",
            }}>
            {opt.label}
          </button>
        ))}
      </div>
      {/* 方向过滤 */}
      <div className="flex gap-1 overflow-x-auto">
        {dirOptions.map(opt => (
          <button key={opt.key}
            onClick={() => onChange("direction", opt.key)}
            className="text-[7px] px-1.5 py-0.5 rounded font-bold whitespace-nowrap transition-colors"
            style={{
              background: filters.direction === opt.key ? `${opt.color}15` : "transparent",
              color: filters.direction === opt.key ? opt.color : "#475569",
              border: filters.direction === opt.key ? `1px solid ${opt.color}30` : "1px solid transparent",
            }}>
            {opt.label}
          </button>
        ))}
      </div>
      {/* 状态过滤 */}
      <div className="flex gap-1 overflow-x-auto">
        {statusOptions.map(opt => (
          <button key={opt.key}
            onClick={() => onChange("status", opt.key)}
            className="text-[7px] px-1.5 py-0.5 rounded font-bold whitespace-nowrap transition-colors"
            style={{
              background: filters.status === opt.key ? "#1a2236" : "transparent",
              color: filters.status === opt.key ? "#e2e8f0" : "#475569",
              border: filters.status === opt.key ? "1px solid #3b82f640" : "1px solid transparent",
            }}>
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ====== 增强因子列表项 ======

function FactorListItem({ factor, isEnabled, onToggle }: {
  factor: FactorItem;
  isEnabled: boolean;
  onToggle: () => void;
}) {
  const dir = getFactorDirection(factor);
  const dirIcon = DIR_ICON[dir];
  const dirColor = DIR_COLOR[dir];
  const catColor = CAT_COLOR[factor.category] || "#475569";
  const ed = getEndDateLabel(factor.endDate);

  return (
    <div className={`flex items-center gap-2 p-2 border-b border-[#1e293b]/30 hover:bg-[#161f2e] transition-colors ${isEnabled ? "" : "opacity-40"}`}>
      {/* 开关 */}
      <button onClick={onToggle}
        className={`w-7 h-4 rounded-full transition-colors relative flex-shrink-0 ${
          isEnabled ? "bg-[#22c55e]" : "bg-[#1e293b]"
        }`}>
        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
          isEnabled ? "translate-x-3.5" : "translate-x-0.5"
        }`} />
      </button>

      {/* 内容 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-[7px] px-1 rounded font-bold" style={{
            background: `${catColor}20`,
            color: catColor,
          }}>{factor.category.slice(0, 3).toUpperCase()}</span>
          <span className="text-[10px] text-[#e2e8f0] truncate">{factor.name}</span>
          {/* EndDate 标签 */}
          <span className="text-[7px] font-mono px-1 rounded flex-shrink-0" style={{
            background: `${ed.color}15`, color: ed.color,
          }}>
            {ed.text}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[8px] text-[#475569] truncate flex-1">{factor.impact_description}</span>
          <span className="text-[8px] font-mono" style={{ color: dirColor }}>{dirIcon} {dir}</span>
        </div>
      </div>

      {/* 概率 */}
      <span className="text-[9px] font-mono text-[#94a3b8] flex-shrink-0">
        {Math.round(factor.probability * 100)}%
      </span>
    </div>
  );
}
