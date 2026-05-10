import { useState, useMemo } from "react";
import { useAppStore } from "@/store/appStore";
import type { MacroEvent } from "@/store/appStore";

const CAT_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  Macro:        { label: "Macro",  color: "#22c55e", bg: "#14532d" },
  GeoPolitics:  { label: "Geo",    color: "#8b5cf6", bg: "#3b1670" },
  CryptoNative: { label: "Crypto", color: "#f7931a", bg: "#5c3a00" },
};

const IMPACT_STYLE: Record<string, { color: string; bg: string }> = {
  high:   { color: "#ef4444", bg: "#ef444415" },
  medium: { color: "#eab308", bg: "#eab30815" },
  low:    { color: "#3b82f6", bg: "#3b82f615" },
};

const ALL_CATS    = ["Macro", "GeoPolitics", "CryptoNative"] as const;
const ALL_IMPACTS = ["high", "medium", "low"] as const;

export default function EventSidebar() {
  const events             = useAppStore((s) => s.events);
  const selectedCategories = useAppStore((s) => s.selectedCategories);
  const selectedImpacts    = useAppStore((s) => s.selectedImpacts);
  const selectedEventId    = useAppStore((s) => s.selectedEventId);
  const toggleCategory     = useAppStore((s) => s.toggleCategory);
  const toggleImpact       = useAppStore((s) => s.toggleImpact);
  const selectEvent        = useAppStore((s) => s.selectEvent);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (selectedCategories.length > 0 && !selectedCategories.includes(e.category)) return false;
      if (selectedImpacts.length    > 0 && !selectedImpacts.includes(e.impact_level))  return false;
      return true;
    });
  }, [events, selectedCategories, selectedImpacts]);

  return (
    <div className="h-full flex flex-col bg-[#111827]">
      {/* Header */}
      <div className="p-3 border-b border-[#1e293b] space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-[#e2e8f0] tracking-wider">MACRO FACTORS</h3>
          <span className="text-[10px] text-[#475569]">{filtered.length} / {events.length}</span>
        </div>

        {/* Category filters */}
        <div className="flex items-center gap-1">
          {ALL_CATS.map((cat) => {
            const active = selectedCategories.includes(cat);
            const style = CAT_STYLE[cat];
            return (
              <button key={cat} onClick={() => toggleCategory(cat)}
                className="px-2 py-0.5 rounded text-[9px] font-medium transition-all border"
                style={{ backgroundColor: active ? style.bg : "transparent", color: active ? style.color : "#475569", borderColor: active ? `${style.color}40` : "transparent" }}>
                {style.label} <span className="ml-0.5 opacity-60">{events.filter((e) => e.category === cat).length}</span>
              </button>
            );
          })}
        </div>

        {/* Impact filters */}
        <div className="flex items-center gap-1">
          {ALL_IMPACTS.map((imp) => {
            const active = selectedImpacts.includes(imp);
            const style = IMPACT_STYLE[imp];
            return (
              <button key={imp} onClick={() => toggleImpact(imp)}
                className="px-2 py-0.5 rounded text-[9px] font-medium transition-all border"
                style={{ backgroundColor: active ? style.bg : "transparent", color: active ? style.color : "#475569", borderColor: active ? `${style.color}40` : "transparent" }}>
                {imp.charAt(0).toUpperCase() + imp.slice(1)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Event List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin divide-y divide-[#1e293b]/50">
        {filtered.map((event) => (
          <EventCard key={event.id} event={event} isSelected={selectedEventId === event.id} onClick={() => { selectEvent(event.id, event.timestamp); setExpandedId(expandedId === event.id ? null : event.id); }} isExpanded={expandedId === event.id} />
        ))}
        {filtered.length === 0 && (
          <div className="p-4 text-center text-[10px] text-[#475569]">No factors match filters</div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────
// 单个事件卡片
// ──────────────────────────────

function EventCard({ event, isSelected, onClick, isExpanded }: { event: MacroEvent; isSelected: boolean; onClick: () => void; isExpanded: boolean }) {
  const catStyle = CAT_STYLE[event.category] || CAT_STYLE.Macro;
  const impStyle = IMPACT_STYLE[event.impact_level] || IMPACT_STYLE.low;
  const isForecast = event.is_forecast;

  // BTC影响颜色
  const hasImpact = event.btc_impact_1d !== null;
  const impactColor = hasImpact ? (event.btc_impact_1d! > 0 ? "#22c55e" : "#ef4444") : "#475569";

  return (
    <div onClick={onClick}
      className={`p-2.5 cursor-pointer transition-all ${isSelected ? "bg-[#1a2236] border-l-2 border-l-[#3b82f6]" : "hover:bg-[#161f2e] border-l-2 border-l-transparent"}`}>

      {/* 顶部标签行 */}
      <div className="flex items-center gap-1.5 mb-1">
        <span className="px-1 py-0 rounded text-[7px] font-bold" style={{ backgroundColor: catStyle.bg, color: catStyle.color }}>{catStyle.label}</span>
        <span className="px-1 py-0 rounded text-[7px] font-bold" style={{ backgroundColor: impStyle.bg, color: impStyle.color }}>{event.impact_level.toUpperCase()}</span>
        {isForecast && <span className="px-1 py-0 rounded text-[7px] font-bold bg-[#3b82f620] text-[#3b82f6]">FORECAST</span>}
        <span className="text-[9px] text-[#475569] font-mono ml-auto">{event.date_str}</span>
      </div>

      {/* 标题 */}
      <p className={`text-[11px] leading-snug ${isSelected ? "text-[#3b82f6] font-semibold" : "text-[#e2e8f0]"}`}>{event.title}</p>

      {/* 预期/实际/偏差 迷你行 */}
      {(event.expected !== null || event.actual_value !== null) && (
        <div className="flex items-center gap-2 mt-1 text-[9px]">
          {event.previous !== null && <span className="text-[#475569]">Prev: {event.previous}{event.unit}</span>}
          {event.expected !== null && <span className="text-[#94a3b8]">Exp: {event.expected}{event.unit}</span>}
          {event.actual_value !== null && <span className="text-[#e2e8f0] font-semibold">Act: {event.actual_value}{event.unit}</span>}
          {event.deviation !== null && event.deviation !== 0 && (
            <span style={{ color: event.deviation > 0 ? "#22c55e" : "#ef4444" }}>
              {event.deviation > 0 ? "+" : ""}{event.deviation}{event.unit}
            </span>
          )}
        </div>
      )}

      {/* BTC影响 */}
      {hasImpact && (
        <div className="flex items-center gap-2 mt-1 text-[9px] font-mono" style={{ color: impactColor }}>
          <span>BTC {event.btc_impact_1d! > 0 ? "+" : ""}{event.btc_impact_1d}%</span>
          {event.btc_impact_7d !== null && <span className="text-[#475569]">7d: {event.btc_impact_7d! > 0 ? "+" : ""}{event.btc_impact_7d}%</span>}
        </div>
      )}

      {/* 预测概率 */}
      {isForecast && event.forecast_prob_hold !== undefined && (
        <div className="mt-1 flex items-center gap-1">
          <div className="flex-1 h-1.5 bg-[#1e293b] rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${event.forecast_prob_hold! * 100}%`, background: "#3b82f6" }} />
          </div>
          <span className="text-[8px] text-[#3b82f6] font-mono">{(event.forecast_prob_hold! * 100).toFixed(0)}% Hold</span>
        </div>
      )}

      {/* 展开详情 */}
      {isExpanded && <p className="text-[10px] text-[#94a3b8] mt-1.5 leading-relaxed border-t border-[#1e293b] pt-1.5">{event.description}</p>}
    </div>
  );
}
