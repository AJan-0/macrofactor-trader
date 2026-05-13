import { useState, useRef, useEffect, memo } from "react";
import { useTheme } from "next-themes";
import { useAppStore } from "@/store/appStore";
import { useI18n } from "@/i18n/context";
import { useRealtimePrice } from "@/services/priceStream";
import { useIsMobile } from "@/hooks/use-mobile";

const Toolbar = memo(function Toolbar() {
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const { symbol, setSymbol, timeframe, setTimeframe, events, isLoading } = useAppStore(s => ({
    symbol: s.currentSymbol,
    setSymbol: s.setSymbol,
    timeframe: s.currentTimeframe,
    setTimeframe: s.setTimeframe,
    events: s.events,
    isLoading: s.isLoading,
  }));
  const { price, changePct } = useRealtimePrice(symbol);
  const isUp = (changePct ?? 0) >= 0;
  const lastUpdate = price ? new Date().toLocaleTimeString() : "";
  const isMobile = useIsMobile();

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const asset = ASSETS.find(a => a.key === symbol) || ASSETS[0];
  const changeDisplay = changePct !== null ? `${isUp ? '+' : ''}${changePct.toFixed(2)}%` : '';

  return (
    <div
      className="flex items-center border-b border-[#1e293b] bg-[#0a0e1a] md:h-12 h-14"
      style={{ color: '#e2e8f0', fontSize: 12, flexShrink: 0 }}
    >
      {isMobile ? (
        /* === 移动端 Toolbar === */
        <>
          {/* 左侧：品牌 + 当前资产 + 语言 */}
          <div className="flex items-center gap-2 md:gap-3 px-2 md:px-3 flex-shrink-0">
            <span className="text-base md:text-lg">⚡</span>
            <span className="font-bold text-sm md:text-base tracking-wide hidden sm:inline">{t("app.name")}</span>
            <span
              className="text-xs md:text-sm font-bold px-2 md:px-2.5 py-1 md:py-1.5 rounded min-w-touch min-h-touch"
              style={{ backgroundColor: asset.color + '22', color: asset.color }}
            >
              {t(asset.label)}
            </span>
          </div>

          {/* 中间：价格 */}
          {price !== null && (
            <div className="flex items-center gap-1 md:gap-2 font-mono flex-shrink-0">
              <span className="text-sm md:text-base font-bold">${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              {changePct !== null && (
                <span className={`text-xs md:text-sm font-semibold ${isUp ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
                  {changeDisplay}
                </span>
              )}
            </div>
          )}

          {/* 右侧：时间周期滚动条 + 语言 + 状态 */}
          <div className="flex items-center gap-1.5 md:gap-2 ml-auto pr-2 md:pr-3">
            {/* 横向滚动时间周期 */}
            <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-hide">
              {TIMEFRAMES.map(tf => (
                <button
                  key={tf.key}
                  onClick={() => setTimeframe(tf.key)}
                  disabled={isLoading}
                  className={`flex-shrink-0 px-2 md:px-3 py-1 md:py-1.5 rounded-md text-xs md:text-sm font-semibold transition-all whitespace-nowrap min-h-touch active:opacity-80 ${
                    timeframe === tf.key
                      ? 'bg-[#1a2236] text-[#e2e8f0]'
                      : 'text-[#475569] hover:text-[#94a3b8]'
                  }`}
                >
                  {t(tf.label)}
                </button>
              ))}
            </div>

            {/* 资产下拉（移动端精简版） */}
            <div className="relative" ref={ref}>
              <button
                onClick={() => setOpen(!open)}
                disabled={isLoading}
                className="flex items-center gap-0.5 px-2 md:px-2.5 py-1 md:py-1.5 rounded bg-[#111827] border border-[#2d3a52] text-xs md:text-sm min-w-touch min-h-touch active:opacity-80"
              >
                <span style={{ color: asset.color }}>●</span>
                <span className="text-[#94a3b8]">▼</span>
              </button>
              {open && (
                <div className="absolute top-full right-0 mt-2 w-32 md:w-40 bg-[#111827] border border-[#2d3a52] rounded-lg shadow-xl z-50 overflow-hidden">
                  {ASSETS.map(a => (
                    <button
                      key={a.key}
                      onClick={() => { setSymbol(a.key); setOpen(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 md:py-3 hover:bg-[#1a2236] transition-colors text-left text-sm md:text-base min-h-touch"
                      style={{ color: symbol === a.key ? '#e2e8f0' : '#94a3b8' }}
                    >
                      <span style={{ color: a.color }}>●</span> {t(a.label)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 语言切换 */}
            <button
              onClick={() => setLocale(locale === "en" ? "zh" : "en")}
              className="text-xs md:text-sm px-1.5 md:px-2 py-1 md:py-1.5 rounded bg-[#1a2236] text-[#94a3b8] border border-[#1e293b] transition-colors flex-shrink-0 min-w-touch min-h-touch active:opacity-80"
            >
              {t("toolbar.lang")}
            </button>

            {/* 主题切换 */}
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="text-xs md:text-sm px-1.5 md:px-2 py-1 md:py-1.5 rounded bg-[#1a2236] text-[#94a3b8] border border-[#1e293b] transition-colors flex-shrink-0 min-w-touch min-h-touch active:opacity-80"
              title="Toggle theme"
            >
              {theme === "dark" ? "🌙" : "☀️"}
            </button>

            {/* 实时指示 */}
            <span className="flex items-center gap-1 flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" />
            </span>
          </div>
        </>
      ) : (
        /* === 桌面端 Toolbar === */
        <div className="flex items-center px-4 py-2 w-full">
          {/* 左侧：品牌 + 语言切换 */}
          <div className="flex items-center gap-3">
            <span className="text-[16px]">⚡</span>
            <span className="font-bold text-[13px] tracking-wide">{t("app.name")}</span>
            <button
              onClick={() => setLocale(locale === "en" ? "zh" : "en")}
              className="text-[11px] px-2 py-0.5 rounded bg-[#1a2236] text-[#94a3b8] hover:text-white border border-[#1e293b] transition-colors"
            >
              {t("toolbar.lang")}
            </button>
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="text-[11px] px-2 py-0.5 rounded bg-[#1a2236] text-[#94a3b8] hover:text-white border border-[#1e293b] transition-colors"
              title="Toggle theme"
            >
              {theme === "dark" ? "🌙" : "☀️"}
            </button>
          </div>

          {/* 中间：资产选择 + 价格 + 时间周期 */}
          <div className="flex items-center gap-4 mx-auto">
            {/* Asset Dropdown */}
            <div className="relative" ref={ref}>
              <button
                onClick={() => setOpen(!open)}
                disabled={isLoading}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#111827] border border-[#2d3a52] hover:border-[#475569] transition-all font-semibold"
              >
                <span style={{ color: asset.color }}>●</span>
                <span>{t(asset.label)}</span>
                <span className="text-[8px] text-[#475569]">▼</span>
              </button>
              {open && (
                <div className="absolute top-full left-0 mt-2 w-36 bg-[#111827] border border-[#2d3a52] rounded-lg shadow-xl z-50 overflow-hidden">
                  {ASSETS.map(a => (
                    <button
                      key={a.key}
                      onClick={() => { setSymbol(a.key); setOpen(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#1a2236] transition-colors text-left"
                      style={{ color: symbol === a.key ? '#e2e8f0' : '#94a3b8' }}
                    >
                      <span style={{ color: a.color }}>●</span> {t(a.label)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 实时价格 */}
            {price !== null && (
              <div className="flex items-center gap-2 font-mono">
                <span className="text-[14px] font-bold">
                  ${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                {changePct !== null && (
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${isUp ? 'bg-[#22c55e20] text-[#22c55e]' : 'bg-[#ef444420] text-[#ef4444]'}`}>
                    {changeDisplay}
                  </span>
                )}
              </div>
            )}

            {/* Timeframe Toggle */}
            <div className="flex items-center bg-[#111827] rounded-lg border border-[#1e293b] p-0.5">
              {TIMEFRAMES.map(tf => (
                <button
                  key={tf.key}
                  onClick={() => setTimeframe(tf.key)}
                  disabled={isLoading}
                  className={`px-2.5 py-1 rounded-md text-[13px] font-semibold transition-all ${
                    timeframe === tf.key ? 'bg-[#1a2236] text-[#e2e8f0]' : 'text-[#475569] hover:text-[#94a3b8]'
                  }`}
                >
                  {t(tf.label)}
                </button>
              ))}
            </div>
          </div>

          {/* 右侧：状态 */}
          <div className="flex items-center gap-3 text-[12px] text-[#475569]">
            {isLoading && <span className="text-[#3b82f6]">{t("toolbar.loading")}</span>}
            <span>{events.length} {t("factors.factor")}</span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#22c55e] animate-pulse" />
              <span className="text-[#22c55e] font-semibold text-[11px]">{t("toolbar.live")}</span>
            </span>
            {lastUpdate && <span className="font-mono text-[10px]">{t("toolbar.lastUpdate")} {lastUpdate}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

const ASSETS = [
  { key: "BTC-USDT", label: "asset.btc", color: "#f59e0b" },
  { key: "ETH-USDT", label: "asset.eth", color: "#3b82f6" },
  { key: "GC=F", label: "asset.gold", color: "#fbbf24" },
] as const;

export default Toolbar;

const TIMEFRAMES = [
  { key: "1D", label: "tf.1D" },
  { key: "4H", label: "tf.4H" },
  { key: "1H", label: "tf.1H" },
  { key: "15m", label: "tf.15m" },
  { key: "5m", label: "tf.5m" },
  { key: "1m", label: "tf.1m" },
] as const;
