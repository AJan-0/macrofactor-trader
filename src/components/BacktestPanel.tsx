/**
 * 策略深度回测面板 -- P2
 *
 * 为每个策略展示：
 * - 绩效指标卡片（胜率、最大回撤、夏普、盈亏比、总交易数）
 * - Equity Curve SVG 可视化
 * - 最近交易记录
 */

import { useMemo, useState } from "react";
import { useI18n } from "@/i18n/context";
import { backtestStrategy } from "@/services/strategyEngine";
import type { StrategySignal, KlineData } from "@/services/strategyEngine";

interface Props {
  strategyName: string;
  signals: StrategySignal[];
  klines: KlineData[];
}

export default function BacktestPanel({ signals, klines }: Props) {
  const { t } = useI18n();
  const [showTrades, setShowTrades] = useState(false);

  const result = useMemo(() => {
    if (!signals.length || !klines.length) return null;
    return backtestStrategy(signals, klines);
  }, [signals, klines]);

  if (!result) {
    return (
      <div className="text-[8px] text-[#475569] text-center py-2">{t("backtest.noData")}</div>
    );
  }

  const { totalTrades, winRate, maxDrawdown, sharpeRatio, profitFactor, equityCurve, trades } = result;
  const totalReturn = equityCurve.length > 1
    ? ((equityCurve[equityCurve.length - 1].equity - equityCurve[0].equity) / equityCurve[0].equity * 100)
    : 0;

  // Equity Curve SVG
  const svgWidth = 220;
  const svgHeight = 80;
  const padding = { top: 4, right: 4, bottom: 16, left: 36 };
  const chartW = svgWidth - padding.left - padding.right;
  const chartH = svgHeight - padding.top - padding.bottom;

  const minEq = Math.min(...equityCurve.map(e => e.equity));
  const maxEq = Math.max(...equityCurve.map(e => e.equity));
  const eqRange = maxEq - minEq || 1;

  const points = equityCurve.map((e, i) => {
    const x = padding.left + (i / (equityCurve.length - 1 || 1)) * chartW;
    const y = padding.top + chartH - ((e.equity - minEq) / eqRange) * chartH;
    return `${x},${y}`;
  }).join(" ");

  const yLabels = [maxEq, (maxEq + minEq) / 2, minEq].map(v =>
    v >= 10000 ? `$${(v / 1000).toFixed(1)}K` : `$${v.toFixed(0)}`
  );

  const tradeColor = (pnl: number) => pnl > 0 ? "text-[#22c55e]" : pnl < 0 ? "text-[#ef4444]" : "text-[#94a3b8]";
  const exitEmoji = (reason: string) => {
    if (reason === "stoploss") return "\u{1F6D1}";
    if (reason === "takeprofit") return "\u{1F3AF}";
    if (reason === "signal") return "\u{1F4E1}";
    return "\u{1F51A}";
  };

  return (
    <div className="mt-2 pt-2 border-t border-[#1e293b]/50">
      {/* 绩效指标 */}
      <div className="grid grid-cols-3 gap-1 mb-2">
        <MetricCard label={t("backtest.totalReturn")} value={`${totalReturn >= 0 ? "+" : ""}${totalReturn.toFixed(1)}%`} color={totalReturn >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"} />
        <MetricCard label={t("backtest.winRate")} value={`${winRate}%`} color={winRate >= 50 ? "text-[#22c55e]" : "text-[#ef4444]"} />
        <MetricCard label={t("backtest.trades")} value={`${totalTrades}`} color="text-[#e2e8f0]" />
        <MetricCard label={t("backtest.maxDrawdown")} value={`${maxDrawdown}%`} color="text-[#ef4444]"} />
        <MetricCard label={t("backtest.sharpe")} value={`${sharpeRatio}`} color={sharpeRatio >= 1 ? "text-[#22c55e]" : "text-[#eab308]"} />
        <MetricCard label={t("backtest.profitFactor")} value={`${profitFactor}`} color={profitFactor >= 1 ? "text-[#22c55e]" : "text-[#ef4444]"} />
      </div>

      {/* Equity Curve */}
      <div className="mb-2">
        <div className="text-[7px] text-[#475569] mb-0.5">{t("backtest.equityCurve")}</div>
        <svg width={svgWidth} height={svgHeight} className="block">
          {/* 背景网格线 */}
          {[0, 0.5, 1].map(t => {
            const y = padding.top + t * chartH;
            return (
              <line key={t} x1={padding.left} y1={y} x2={svgWidth - padding.right} y2={y} stroke="#1e293b" strokeWidth={0.5} strokeDasharray="2,2" />
            );
          })}
          {/* Y轴标签 */}
          {[0, 0.5, 1].map((t, i) => {
            const y = padding.top + t * chartH;
            return (
              <text key={i} x={padding.left - 2} y={y + 3} textAnchor="end" fill="#475569" fontSize="6" fontFamily="monospace">{yLabels[i]}</text>
            );
          })}
          {/* 基准线 */}
          <line
            x1={padding.left}
            y1={padding.top + chartH - ((equityCurve[0].equity - minEq) / eqRange) * chartH}
            x2={svgWidth - padding.right}
            y2={padding.top + chartH - ((equityCurve[0].equity - minEq) / eqRange) * chartH}
            stroke="#475569"
            strokeWidth={0.5}
            strokeDasharray="3,3"
          />
          {/* 曲线 */}
          <polyline
            points={points}
            fill="none"
            stroke={totalReturn >= 0 ? "#22c55e" : "#ef4444"}
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {/* 交易记录展开 */}
      <button
        onClick={() => setShowTrades(!showTrades)}
        className="w-full text-[8px] py-0.5 rounded border border-[#1e293b] text-[#475569] hover:text-[#e2e8f0] hover:border-[#475569] transition-colors"
      >
        {showTrades ? `\u25B2 ${t("backtest.hideTrades")}` : `\u25BC ${t("backtest.showTrades")} (${trades.length})`}
      </button>

      {showTrades && (
        <div className="mt-1 max-h-[150px] overflow-y-auto space-y-1">
          {trades.slice().reverse().map((t, i) => (
            <div key={i} className="text-[7px] p-1 rounded bg-[#111827] border border-[#1e293b]/30">
              <div className="flex items-center justify-between">
                <span className={`font-bold ${t.direction === "buy" ? "text-[#22c55e]" : "text-[#ef4444]"}`}>
                  {t.direction === "buy" ? t("backtest.long") : t("backtest.short")}
                </span>
                <span className={tradeColor(t.pnl)}>
                  {t.pnl >= 0 ? "+" : ""}${Math.abs(t.pnl).toFixed(0)} ({(t.pnlPct * 100).toFixed(1)}%)
                </span>
              </div>
              <div className="flex items-center justify-between text-[#475569]">
                <span>${t.entryPrice.toFixed(0)} &rarr; ${t.exitPrice.toFixed(0)}</span>
                <span>{exitEmoji(t.exitReason)} {t.exitReason}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="p-1 rounded bg-[#111827] border border-[#1e293b]/30 text-center">
      <div className={`text-[9px] font-bold font-mono ${color}`}>{value}</div>
      <div className="text-[6px] text-[#475569] uppercase tracking-wider">{label}</div>
    </div>
  );
}
