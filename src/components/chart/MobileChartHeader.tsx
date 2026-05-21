// TradingView 风格移动端图表头部 - Sheet弹窗版
import { useState, memo } from "react";
import { ChevronDownIcon, TrendingUpIcon, TrendingDownIcon, MinusIcon, FullscreenIcon, FullscreenExitIcon } from "@/components/icons";
import MobileSheet from "@/components/MobileSheet";

interface Props {
  symbol: string;
  price: number | null;
  changePct: number | null;
  timeframe: string;
  onTimeframeChange: (tf: string) => void;
  onSymbolChange: (symbol: string) => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

const TIMEFRAMES = [
  { key: "1m", label: "1分", labelEn: "1m" },
  { key: "5m", label: "5分", labelEn: "5m" },
  { key: "15m", label: "15分", labelEn: "15m" },
  { key: "1H", label: "1时", labelEn: "1H" },
  { key: "4H", label: "4时", labelEn: "4H" },
  { key: "1D", label: "日线", labelEn: "1D" },
];

const SYMBOLS = [
  { key: "BTC-USDT", label: "BTC", labelEn: "BTC/USD", color: "#f59e0b" },
  { key: "ETH-USDT", label: "ETH", labelEn: "ETH/USD", color: "#6366f1" },
  { key: "GC=F", label: "黄金", labelEn: "Gold", color: "#eab308" },
];

const MobileChartHeader = memo(function MobileChartHeader({
  symbol,
  price,
  changePct,
  timeframe,
  onTimeframeChange,
  onSymbolChange,
  isFullscreen,
  onToggleFullscreen,
}: Props) {
  const [showSymbolSheet, setShowSymbolSheet] = useState(false);
  const isUp = (changePct ?? 0) > 0;
  const isDown = (changePct ?? 0) < 0;
  const currentSymbol = SYMBOLS.find(s => s.key === symbol) || SYMBOLS[0];

  return (
    <div className="lg:hidden bg-[#0a0e1a] border-b border-[#1e293b]/60">
      {/* 资产选择 Sheet 弹窗 */}
      <MobileSheet
        open={showSymbolSheet}
        onClose={() => setShowSymbolSheet(false)}
        title="选择资产"
      >
        <div className="p-2">
          {SYMBOLS.map(s => (
            <button
              key={s.key}
              onClick={() => {
                onSymbolChange(s.key);
                setShowSymbolSheet(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3.5 text-sm rounded-lg transition-colors mb-1 ${
                symbol === s.key
                  ? "bg-[#3b82f6]/10 text-[#3b82f6] font-medium"
                  : "text-[#e2e8f0] hover:bg-[#1a2236]"
              }`}
            >
              <span 
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <div className="flex flex-col items-start">
                <span className="font-semibold">{s.label}</span>
                <span className="text-xs text-[#475569]">{s.labelEn}</span>
              </div>
            </button>
          ))}
        </div>
      </MobileSheet>

      {/* 第一行：资产选择和价格 */}
      <div className="flex items-center justify-between px-3 py-2">
        {/* 资产选择 */}
        <button
          onClick={() => setShowSymbolSheet(true)}
          className="flex items-center gap-1.5 text-sm font-bold text-[#e2e8f0] active:opacity-70 transition-opacity"
        >
          <span 
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: currentSymbol.color }}
          />
          <span>{currentSymbol.label}</span>
          <ChevronDownIcon size={14} className="text-[#475569]" />
        </button>

        {/* 价格和涨跌幅 */}
        {price !== null && (
          <div className="flex items-center gap-2.5">
            <span className="text-lg font-bold text-[#e2e8f0] tracking-tight">
              ${price.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </span>
            {changePct !== null && (
              <span
                className={`flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-md ${
                  isUp 
                    ? "bg-[#22c55e]/10 text-[#22c55e]" 
                    : isDown 
                      ? "bg-[#ef4444]/10 text-[#ef4444]" 
                      : "bg-[#475569]/10 text-[#94a3b8]"
                }`}
              >
                {isUp ? <TrendingUpIcon size={12} /> : isDown ? <TrendingDownIcon size={12} /> : <MinusIcon size={12} />}
                {isUp ? "+" : ""}
                {changePct.toFixed(2)}%
              </span>
            )}
          </div>
        )}

        {/* 全屏按钮 */}
        {onToggleFullscreen && (
          <button
            onClick={onToggleFullscreen}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-[#1a2236] border border-[#2d3a52] text-[#475569] active:scale-90 transition-transform"
          >
            {isFullscreen ? <FullscreenExitIcon size={16} /> : <FullscreenIcon size={16} />}
          </button>
        )}
      </div>

      {/* 第二行：时间周期选择 */}
      <div className="flex items-center gap-0.5 px-2 pb-2 overflow-x-auto scrollbar-hide">
        {TIMEFRAMES.map(tf => (
          <button
            key={tf.key}
            onClick={() => onTimeframeChange(tf.key)}
            className={`px-3 py-1.5 text-[11px] font-semibold rounded-lg whitespace-nowrap transition-all active:scale-95 ${
              timeframe === tf.key
                ? "bg-[#3b82f6]/15 text-[#3b82f6]"
                : "text-[#475569] hover:text-[#94a3b8]"
            }`}
          >
            {tf.label}
          </button>
        ))}
      </div>
    </div>
  );
});

export default MobileChartHeader;
