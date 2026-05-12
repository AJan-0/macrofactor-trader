import { useState, useMemo } from "react";
import { useI18n } from "@/i18n/context";
import { useAppStore } from "@/store/appStore";
import type { FactorCombination, FactorSignal, FactorItem } from "@/services/factorEngine";
import type { BacktestRecord, BacktestSummary } from "@/services/backtestEngine";
import { getFactorBacktest } from "@/services/backtestEngine";
import type { WeightTemplate } from "@/data/factorLibrary";
import { getEndDateLabel } from "@/data/factorLibrary";
import FactorLibrary from "./FactorLibrary";
import NewsFeed from "./NewsFeed";
import CorrelationGraph from "./CorrelationGraph";

const CAT_COLOR: Record<string, string> = {
  Monetary: "#3b82f6", Inflation: "#f59e0b", Geopolitics: "#8b5cf6",
  Regulation: "#ec4899", CryptoNative: "#f7931a", Sentiment: "#06b6d4", Political: "#ef4444",
};

type Tab = "all" | "bullish" | "bearish";
type View = "factors" | "backtest" | "news" | "graph";

interface Props {
  combo: FactorCombination | null;
  factors: FactorItem[];
  backtestRecords: BacktestRecord[];
  backtestSummary: BacktestSummary | null;
  onToggleFactor: (id: string) => void;
  onAdjustProb: (id: string, prob: number) => void;
  onAdjustWeight: (id: string, weight: number) => void;
  onAddCustom: (f: FactorItem) => void;
  onReset: () => void;
  onApplyTemplate?: (template: WeightTemplate) => void;
  onEnableAll?: () => void;
  onDisableAll?: () => void;
  onEnableThisWeek?: () => void;
  onEnableNextWeek?: () => void;
}

export default function FactorDashboard({
  combo, factors, backtestRecords, backtestSummary,
  onToggleFactor, onAdjustProb, onAdjustWeight, onAddCustom, onReset, onApplyTemplate,
  onEnableAll, onDisableAll, onEnableThisWeek, onEnableNextWeek,
}: Props) {
  const { t } = useI18n();
  const setHoverTimestamp = useAppStore(s => s.setHoverTimestamp);
  const [tab, setTab] = useState<Tab>("all");
  const [view, setView] = useState<View>("factors");
  const [showLibrary, setShowLibrary] = useState(false);

  const signals = useMemo(() => {
    if (!combo) return [];
    if (tab === "bullish") return combo.topBullish;
    if (tab === "bearish") return combo.topBearish;
    return combo.activeFactors;
  }, [combo, tab]);

  if (!combo) {
    return <div className="h-full flex items-center justify-center bg-[#111827]">
      <span className="text-[#475569] text-xs">{t("common.loading")}</span>
    </div>;
  }

  return (
    <div className="h-full flex flex-col bg-[#111827] overflow-hidden relative">
      {/* 预测面板 */}
      <PredictionPanel combo={combo} backtestSummary={backtestSummary} onToggleView={setView} onOpenLibrary={() => setShowLibrary(true)} onEnableThisWeek={onEnableThisWeek} onEnableNextWeek={onEnableNextWeek} />

      {/* 分类统计 */}
      {view === "factors" && <CategorySummary signals={combo.activeFactors} />}

      {/* Tab */}
      {view === "factors" && (
        <div className="flex border-b border-[#1e293b] px-2">
          {(["all", "bullish", "bearish"] as const).map(ta => (
            <button key={ta} onClick={() => setTab(ta)}
              className={`px-3 py-1.5 text-[10px] font-bold tracking-wider transition-colors ${
                tab === ta
                  ? ta === "bullish" ? "text-[#22c55e] border-b-2 border-[#22c55e]"
                    : ta === "bearish" ? "text-[#ef4444] border-b-2 border-[#ef4444]"
                    : "text-[#e2e8f0] border-b-2 border-[#3b82f6]"
                  : "text-[#475569] hover:text-[#94a3b8]"
              }`}>
              {ta === "all" ? `${t("factors.all")} (${combo.activeFactors.length})`
                : ta === "bullish" ? `▲ ${t("factors.bullish")} (${combo.topBullish.length})`
                : `▼ ${t("factors.bearish")} (${combo.topBearish.length})`}
            </button>
          ))}
        </div>
      )}

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto">
        {view === "factors" ? (
          <>
            {signals.length === 0 && (
              <div className="p-4 text-center">
                <div className="text-[10px] text-[#475569] mb-2">{t("factors.noActive")}</div>
                <button onClick={() => setShowLibrary(true)}
                  className="text-[9px] px-3 py-1 rounded bg-[#3b82f6] text-white">{t("factors.openLibrary")}</button>
              </div>
            )}
            {signals.slice(0, 10).map(s => {
              const factorItem = factors.find(f => f.id === s.id);
              const bt = getFactorBacktest(backtestRecords, s.id, factorItem ?? s);
              const hoverTs = bt?.date ? new Date(bt.date).getTime() / 1000
                : factorItem?.endDate ? new Date(factorItem.endDate).getTime() / 1000 : undefined;
              return (
                <FactorCard key={s.id} signal={s} backtest={bt}
                  currentProb={factorItem?.probability ?? s.probability}
                  currentWeight={factorItem?.weight ?? 1.0}
                  onAdjustProb={(prob) => onAdjustProb(s.id, prob)}
                  onAdjustWeight={(w) => onAdjustWeight(s.id, w)}
                  hoverTimestamp={hoverTs}
                  setHoverTimestamp={setHoverTimestamp}
                  endDate={factorItem?.endDate}
                />
              );
            })},
          </>
        ) : view === "backtest" ? (
          <BacktestView summary={backtestSummary} records={backtestRecords} />
        ) : view === "news" ? (
          <NewsFeed onAddAsFactor={onAddCustom} />
        ) : (
          <CorrelationGraph factors={factors} onToggleFactor={(id) => {
            onToggleFactor(id);
            setView("factors");
          }} />
        )}
      </div>

      {/* 底部导航栏 */}
      <div className="p-2 border-t border-[#1e293b] bg-[#0d111e] flex justify-between items-center">
        <span className="text-[11px] text-[#94a3b8]">
          <span className="text-[#e2e8f0] font-bold">{combo.enabledCount}</span>
          <span className="text-[#475569]">/{combo.totalCount} {t("factors.enabled")}</span>
        </span>
        <div className="flex gap-1">
          {(["factors", "backtest", "news", "graph"] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-2 py-1 rounded text-[11px] font-bold transition-colors ${
                view === v
                  ? "bg-[#3b82f620] text-[#3b82f6]"
                  : "text-[#475569] hover:text-[#94a3b8]"
              }`}
            >
              {v === "factors" ? (t("factors.title")?.slice(0, 6) || "因子")
                : v === "backtest" ? (t("backtest.title")?.slice(0, 4) || "回测")
                : v === "news" ? (t("news.title")?.slice(0, 4) || "新闻")
                : (t("graph.title")?.slice(0, 4) || "关联")}
            </button>
          ))}
        </div>
      </div>

      {/* Factor Library Sheet */}
      <FactorLibrary
        open={showLibrary}
        onOpenChange={setShowLibrary}
        factors={factors}
        onToggle={onToggleFactor}
        onAddCustom={onAddCustom}
        onReset={onReset}
        onApplyTemplate={onApplyTemplate}
        onEnableAll={onEnableAll}
        onDisableAll={onDisableAll}
        onEnableThisWeek={onEnableThisWeek}
        onEnableNextWeek={onEnableNextWeek}
      />
    </div>
  );
}

// ====== 预测面板 ======

function PredictionPanel({ combo, backtestSummary, onToggleView, onOpenLibrary, onEnableThisWeek, onEnableNextWeek }: {
  combo: FactorCombination; backtestSummary: BacktestSummary | null;
  onToggleView: (v: View) => void; onOpenLibrary: () => void;
  onEnableThisWeek?: () => void; onEnableNextWeek?: () => void;
}) {
  const { t } = useI18n();
  const dColor = combo.combinedDirection === "bullish" ? "#22c55e" : combo.combinedDirection === "bearish" ? "#ef4444" : "#eab308";
  const dLabel = combo.combinedDirection === "bullish" ? t("narrative.bullish") : combo.combinedDirection === "bearish" ? t("narrative.bearish") : t("narrative.neutral");
  const dIcon = combo.combinedDirection === "bullish" ? "▲" : combo.combinedDirection === "bearish" ? "▼" : "◆";
  const bt = backtestSummary;

  return (
    <div className="p-3 border-b border-[#1e293b]" style={{ background: `${dColor}08` }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span style={{ color: dColor, fontSize: 14 }}>{dIcon}</span>
          <span style={{ color: dColor, fontSize: 13, fontWeight: 800 }}>{dLabel}</span>
          <span className="text-[11px] px-2 py-0.5 rounded font-bold" style={{ background: `${dColor}20`, color: dColor }}>
            {combo.overallConfidence}% 置信度
          </span>
          {bt && (
            <button onClick={() => onToggleView("backtest")}
              className="text-[10px] px-2 py-0.5 rounded bg-[#1a2236] text-[#94a3b8] hover:text-white">
              📊 {bt.accuracy_1d}% 1D
            </button>
          )}
        </div>
        <div className="flex gap-1.5">
          <button onClick={() => onEnableThisWeek?.()}
            className="text-[11px] px-2.5 py-1 rounded bg-[#f9731620] text-[#f97316] hover:bg-[#f9731630] border border-[#f9731640] font-bold transition-colors"
            title={t("library.thisWeek") || "Enable this week's factors"}>
            ⚡ 本周
          </button>
          <button onClick={() => onEnableNextWeek?.()}
            className="text-[11px] px-2.5 py-1 rounded bg-[#eab30820] text-[#eab308] hover:bg-[#eab30830] border border-[#eab30840] font-bold transition-colors"
            title={t("library.nextWeek") || "Enable next week's factors"}>
            🌙 下周
          </button>
          <button onClick={onOpenLibrary}
            className="text-[11px] px-2.5 py-1 rounded bg-[#3b82f6] text-white hover:bg-[#3b82f6aa] font-bold">
            {t("factors.manage") || "管理"}
          </button>
        </div>
      </div>
      <div className="flex h-2.5 rounded-full overflow-hidden mb-2">
        <div style={{ width: `${combo.bullishProbability * 100}%`, background: "#22c55e" }} />
        <div style={{ width: `${combo.neutralProbability * 100}%`, background: "#334155" }} />
        <div style={{ width: `${combo.bearishProbability * 100}%`, background: "#ef4444" }} />
      </div>
      <div className="flex justify-between text-[11px] font-mono">
        <span style={{ color: "#22c55e" }}>▲ {Math.round(combo.bullishProbability * 100)}%</span>
        <span style={{ color: "#475569" }}>波动 {Math.round(combo.expectedVolatility * 100)}%</span>
        <span style={{ color: "#ef4444" }}>▼ {Math.round(combo.bearishProbability * 100)}%</span>
      </div>
    </div>
  );
}

// ====== 因子卡片（含权重+概率编辑） ======

function FactorCard({ signal, backtest, currentProb, currentWeight, onAdjustProb, onAdjustWeight, hoverTimestamp, setHoverTimestamp, endDate }: {
  signal: FactorSignal; backtest?: BacktestRecord;
  currentProb: number; currentWeight: number;
  onAdjustProb: (prob: number) => void;
  onAdjustWeight: (weight: number) => void;
  hoverTimestamp?: number; setHoverTimestamp: (ts: number | null) => void;
  endDate?: string;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [editMode, setEditMode] = useState<"none" | "prob" | "weight">("none");
  const dirColor = signal.direction === "bullish" ? "#22c55e" : "#ef4444";
  const dirArrow = signal.direction === "bullish" ? "▲" : "▼";
  const cfg = CAT_COLOR[signal.category] || "#475569";
  const hasBt = !!backtest && backtest.actual_1d !== null;
  const btMatch = hasBt && backtest.actual_1d === backtest.engine_prediction;
  const edLabel = endDate ? getEndDateLabel(endDate) : null;

  return (
    <div className="border-b border-[#1e293b]/40"
      onMouseEnter={() => { if (hoverTimestamp) setHoverTimestamp(hoverTimestamp); }}
      onMouseLeave={() => setHoverTimestamp(null)}
    >
      <div className="p-2.5 hover:bg-[#161f2e] transition-colors">
        {/* 行1：标签 + 方向 + 名称 + EndDate徽章 + 回测 */}
        <div className="flex items-center gap-1.5 mb-1.5 cursor-pointer" onClick={() => setExpanded(!expanded)}>
          <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: `${cfg}20`, color: cfg }}>
            {signal.category.slice(0, 3).toUpperCase()}
          </span>
          <span className="text-[10px] font-mono" style={{ color: dirColor }}>{dirArrow}</span>
          <span className="flex-1 text-[12px] text-[#e2e8f0] truncate font-medium">{signal.name}</span>
          {edLabel && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded flex-shrink-0" style={{
              background: `${edLabel.color}15`, color: edLabel.color,
            }}>
              {edLabel.text}
            </span>
          )}
          {hasBt && <span className={`text-[10px] ${btMatch ? "text-[#22c55e]" : "text-[#ef4444]"}`}>{btMatch ? "✓" : "✗"}</span>}
        </div>
        {/* 行2：一句话影响 */}
        <div className="flex items-center gap-1 mb-1.5">
          <span className="text-[10px] text-[#94a3b8] truncate flex-1 italic">{signal.impact_description}</span>
        </div>
        {/* 行3：概率 + 权重控制 */}
        {editMode === "none" ? (
          <div className="flex items-center gap-3">
            <button onClick={() => setEditMode("prob")}
              className="text-[10px] font-mono text-[#94a3b8] hover:text-[#e2e8f0] flex items-center gap-0.5">
              📊 {Math.round(currentProb * 100)}% ✎
            </button>
            <button onClick={() => setEditMode("weight")}
              className="text-[10px] font-mono text-[#94a3b8] hover:text-[#e2e8f0] flex items-center gap-0.5"
              style={{ color: currentWeight !== 1.0 ? "#eab308" : undefined }}>
              ⚖️ {(currentWeight * 100).toFixed(0)}% ✎
            </button>
          </div>
        ) : editMode === "prob" ? (
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-[#475569]">📊</span>
            <input type="range" min={1} max={99} value={Math.round(currentProb * 100)}
              onChange={e => onAdjustProb(Number(e.target.value) / 100)}
              className="flex-1 h-1.5 accent-[#3b82f6]" />
            <span className="text-[10px] font-mono text-[#e2e8f0] w-8">{Math.round(currentProb * 100)}%</span>
            <button onClick={() => setEditMode("none")} className="text-[9px] text-[#475569]">✕</button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-[#475569]">⚖️</span>
            <input type="range" min={0} max={200} value={Math.round(currentWeight * 100)}
              onChange={e => onAdjustWeight(Number(e.target.value) / 100)}
              className="flex-1 h-1.5 accent-[#eab308]" />
            <span className="text-[10px] font-mono text-[#e2e8f0] w-10">{(currentWeight * 100).toFixed(0)}%</span>
            <button onClick={() => setEditMode("none")} className="text-[9px] text-[#475569]">✕</button>
          </div>
        )}
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div className="px-3 pb-2 text-[10px] text-[#94a3b8] space-y-1">
          <div className="flex gap-3">
            <span>质量: {signal.quality_score}/100</span>
            <span>时间: {t(`factor.${signal.timeHorizon}`)}</span>
            <span>强度: {(signal.strength * 100).toFixed(0)}%</span>
            <span style={{ color: "#eab308" }}>权重: {(currentWeight * 100).toFixed(0)}%</span>
          </div>
          {backtest && (
            <div className="pt-1 border-t border-[#1e293b] flex gap-2">
              <span className="text-[#475569]">{t("factor.historical")} ({backtest.date}):</span>
              {backtest.returns['1d'] !== null && (
                <span style={{ color: (backtest.returns['1d'] as number) > 0 ? "#22c55e" : "#ef4444" }}>
                  {(backtest.returns['1d'] as number) > 0 ? '+' : ''}{(backtest.returns['1d'] as number).toFixed(2)}% BTC
                </span>
              )}
              {hasBt && <span className={btMatch ? "text-[#22c55e]" : "text-[#ef4444]"}>{btMatch ? '✓' : '✗'}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ====== 分类统计 ======

function CategorySummary({ signals }: { signals: FactorSignal[] }) {
  const counts = useMemo(() => {
    const c: Record<string, { bullish: number; bearish: number }> = {};
    for (const s of signals) {
      if (!c[s.category]) c[s.category] = { bullish: 0, bearish: 0 };
      if (s.direction === "bullish") c[s.category].bullish++;
      if (s.direction === "bearish") c[s.category].bearish++;
    }
    return c;
  }, [signals]);

  return (
    <div className="flex gap-1 px-2 py-1.5 border-b border-[#1e293b] overflow-x-auto">
      {Object.entries(counts).map(([cat, cnt]) => {
        const color = CAT_COLOR[cat] || "#475569";
        return (
          <div key={cat} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px]"
            style={{ background: `${color}10` }}>
            <span style={{ color }} className="font-bold">{cat.slice(0, 6).toUpperCase()}</span>
            {cnt.bullish > 0 && <span className="text-[#22c55e]">+{cnt.bullish}</span>}
            {cnt.bearish > 0 && <span className="text-[#ef4444]">-{cnt.bearish}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ====== 回测视图 ======

function BacktestView({ summary, records }: { summary: BacktestSummary | null; records: BacktestRecord[] }) {
  const { t } = useI18n();
  if (!summary) return <div className="p-4 text-center text-[10px] text-[#475569]">{t("common.loading")}</div>;

  return (
    <div className="p-3 space-y-3">
      <div className="p-2.5 rounded-lg border border-[#1e293b] bg-[#0a0e1a]">
        <div className="text-[9px] font-bold text-[#e2e8f0] mb-2 tracking-wider">{t("backtest.title")}</div>
        <div className="flex gap-4">
          <AccuracyRing label={t("backtest.accuracy1d")} accuracy={summary.accuracy_1d} correct={summary.correct_1d} total={summary.total} />
          <AccuracyRing label={t("backtest.accuracy7d")} accuracy={summary.accuracy_7d} correct={summary.correct_7d} total={summary.total} />
        </div>
      </div>

      {Object.entries(summary.byCategory).map(([cat, stats]) => (
        <div key={cat} className="flex items-center justify-between p-2 rounded bg-[#0a0e1a]">
          <span className="text-[8px] px-1 rounded font-bold" style={{ background: `${CAT_COLOR[cat] || "#475569"}20`, color: CAT_COLOR[cat] || "#475569" }}>
            {cat.toUpperCase().slice(0, 6)}
          </span>
          <div className="flex gap-3 text-[9px] font-mono">
            <span className="text-[#94a3b8]">{stats.correct_1d}/{stats.total} 1D</span>
            <span style={{ color: stats.correct_1d >= stats.total / 2 ? "#22c55e" : "#ef4444" }}>
              {stats.total > 0 ? Math.round((stats.correct_1d / stats.total) * 100) : 0}%
            </span>
          </div>
        </div>
      ))}

      <div className="text-[9px] font-bold text-[#e2e8f0] tracking-wider mt-2">{t("backtest.historical")}</div>
      {records.filter(r => r.actual_1d !== null).slice(0, 20).map(r => {
        const match = r.actual_1d === r.engine_prediction;
        const ret = r.returns;
        return (
          <div key={r.factor_id} className="flex items-center gap-2 p-2 rounded bg-[#0a0e1a] border border-[#1e293b]/30">
            <span className={`text-[10px] font-bold ${match ? "text-[#22c55e]" : "text-[#ef4444]"}`}>{match ? "✓" : "✗"}</span>
            <div className="flex-1 min-w-0">
              <div className="text-[9px] text-[#e2e8f0] truncate">{r.title}</div>
              <div className="text-[7px] text-[#475569]">{r.date} | {t("factor.prediction")}: {r.engine_prediction}</div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-[9px] font-mono" style={{ color: (ret['1d'] || 0) > 0 ? "#22c55e" : "#ef4444" }}>
                {ret['1d'] !== null ? `${(ret['1d'] as number) > 0 ? '+' : ''}${(ret['1d'] as number).toFixed(2)}%` : 'N/A'}
              </div>
              <div className="text-[7px] text-[#475569]">1D BTC</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AccuracyRing({ label, accuracy, correct, total }: { label: string; accuracy: number; correct: number; total: number }) {
  const color = accuracy >= 60 ? "#22c55e" : accuracy >= 40 ? "#eab308" : "#ef4444";
  return (
    <div className="flex-1 text-center">
      <div className="relative w-12 h-12 mx-auto mb-1">
        <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
          <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#1e293b" strokeWidth="3" />
          <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke={color} strokeWidth="3" strokeDasharray={`${accuracy}, 100`} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[10px] font-bold" style={{ color }}>{accuracy}%</span>
        </div>
      </div>
      <div className="text-[8px] text-[#475569]">{label} ({correct}/{total})</div>
    </div>
  );
}
