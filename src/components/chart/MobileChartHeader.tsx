// TradingView 风格移动端图表头部
import { useState } from "react";

interface Props {
  symbol: string;
  price: number | null;
  changePct: number | null;
  timeframe: string;
  onTimeframeChange: (tf: string) => void;
  onSymbolChange: (symbol: string) => void;
}

const TIMEFRAMES = [
  { key: "1m", label: "1分" },
  { key: "5m", label: "5分" },
  { key: "15m", label: "15分" },
  { key: "1H", label: "1时" },
  { key: "4H", label: "4时" },
  { key: "1D", label: "日线" },
];

const SYMBOLS = [
  { key: "BTC", label: "BTC/USD" },
  { key: "ETH", label: "ETH/USD" },
  { key: "GC=F", label: "黄金" },
];

export default function MobileChartHeader({
  symbol,
  price,
  changePct,
  timeframe,
  onTimeframeChange,
  onSymbolChange,
}: Props) {
  const [showSymbolMenu, setShowSymbolMenu] = useState(false);
  const isUp = (changePct ?? 0) >= 0;

  return (
    <div className="lg:hidden bg-[#0a0e1a] border-b border-[#1e293b]">
      {/* 第一行：资产选择和价格 */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="relative">
          <button
            onClick={() => setShowSymbolMenu(!showSymbolMenu)}
            className="flex items-center gap-1 text-sm font-bold text-[#e2e8f0] active:opacity-70"
          >
            {SYMBOLS.find((s) => s.key === symbol)?.label || symbol}
            <svg className="w-4 h-4 text-[#475569]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* 资产下拉菜单 */}
          {showSymbolMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowSymbolMenu(false)} />
              <div className="absolute top-full left-0 mt-1 bg-[#1a2236] border border-[#2d3a52] rounded-lg shadow-xl z-50 min-w-[140px] overflow-hidden">
                {SYMBOLS.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => {
                      onSymbolChange(s.key);
                      setShowSymbolMenu(false);
                    }}
                    className={`w-full px-4 py-2.5 text-left text-sm transition-colors ${
                      symbol === s.key
                        ? "bg-[#3b82f6]/20 text-[#3b82f6] font-medium"
                        : "text-[#e2e8f0] hover:bg-[#2d3a52]"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {price !== null && (
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-[#e2e8f0]">
              ${price.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </span>
            {changePct !== null && (
              <span
                className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                  isUp ? "bg-[#22c55e]/20 text-[#22c55e]" : "bg-[#ef4444]/20 text-[#ef4444]"
                }`}
              >
                {isUp ? "+" : ""}
                {changePct.toFixed(2)}%
              </span>
            )}
          </div>
        )}
      </div>

      {/* 第二行：时间周期选择 */}
      <div className="flex items-center gap-0.5 px-2 pb-2 overflow-x-auto scrollbar-hide">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf.key}
            onClick={() => onTimeframeChange(tf.key)}
            className={`px-2.5 py-1 text-[11px] rounded whitespace-nowrap transition-colors ${
              timeframe === tf.key
                ? "bg-[#3b82f6]/20 text-[#3b82f6] font-medium"
                : "text-[#475569] hover:text-[#94a3b8]"
            }`}
          >
            {tf.label}
          </button>
        ))}
      </div>
    </div>
  );
}
