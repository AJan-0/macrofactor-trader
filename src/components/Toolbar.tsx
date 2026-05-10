import { useI18n } from "@/i18n/context";
import { useChartConfig, useChartStatus, useAppStore } from "@/store/appStore";
import { useState, useRef, useEffect } from "react";
import { useRealtimePrice } from "@/services/priceStream";
import type { AssetSymbol, Timeframe } from "@/store/appStore";

const ASSETS: { key: AssetSymbol; label: string; color: string }[] = [
  { key: "BTC-USDT", label: "asset.btc", color: "#f7931a" },
  { key: "ETH-USDT", label: "asset.eth", color: "#627eea" },
  { key: "GC=F",       label: "asset.gold", color: "#ffd700" },
];

const TIMEFRAMES: { key: Timeframe; label: string }[] = [
  { key: "1m",  label: "timeframe.1m" },
  { key: "3m",  label: "timeframe.3m" },
  { key: "5m",  label: "timeframe.5m" },
  { key: "15m", label: "timeframe.15m" },
  { key: "1H",  label: "timeframe.1H" },
  { key: "4H",  label: "timeframe.4H" },
  { key: "1D",  label: "timeframe.1D" },
];

export default function Toolbar() {
  const { t, locale, setLocale } = useI18n();
  const { symbol, timeframe, setSymbol, setTimeframe } = useChartConfig();
  const { isLoading } = useChartStatus();
  const events = useAppStore((s) => s.events);
  const [open, setOpen] = useState(false);
  const { price, changePct, lastUpdate: lastUpdateTs } = useRealtimePrice(symbol);
  const lastUpdate = lastUpdateTs
    ? new Date(lastUpdateTs).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
    : "";
  const ref = useRef<HTMLDivElement>(null);

  // 点击外部关闭下拉
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const asset = ASSETS.find(a => a.key === symbol)!;
  const isUp = changePct !== null && changePct >= 0;

  return (
    <div className="flex items-center px-4 py-2 border-b border-[#1e293b] bg-[#0a0e1a]" style={{ height: 48, color: '#e2e8f0', fontSize: 12, flexShrink: 0 }}>
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
      </div>

      {/* 中间：资产选择 + 价格 + 时间周期 */}
      <div className="flex items-center gap-4 mx-auto">
        {/* Asset Dropdown */}
        <div className="relative" ref={ref}>
          <button onClick={() => setOpen(!open)} disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#111827] border border-[#2d3a52] hover:border-[#475569] transition-all font-semibold">
            <span style={{ color: asset.color }}>●</span>
            <span>{t(asset.label)}</span>
            <span className="text-[8px] text-[#475569]">▼</span>
          </button>
          {open && (
            <div className="absolute top-full left-0 mt-2 w-36 bg-[#111827] border border-[#2d3a52] rounded-lg shadow-xl z-50 overflow-hidden">
              {ASSETS.map(a => (
                <button key={a.key} onClick={() => { setSymbol(a.key); setOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#1a2236] transition-colors text-left"
                  style={{ color: symbol === a.key ? '#e2e8f0' : '#94a3b8' }}>
                  <span style={{ color: a.color }}>●</span> {t(a.label)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 实时价格 */}
        {price !== null && (
          <div className="flex items-center gap-2 font-mono">
            <span className="text-[14px] font-bold">${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            {changePct !== null && (
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${isUp ? 'bg-[#22c55e20] text-[#22c55e]' : 'bg-[#ef444420] text-[#ef4444]'}`}>
                {isUp ? '+' : ''}{changePct.toFixed(2)}%
              </span>
            )}
          </div>
        )}

        {/* Timeframe Toggle */}
        <div className="flex items-center bg-[#111827] rounded-lg border border-[#1e293b] p-0.5">
          {TIMEFRAMES.map(tf => (
            <button key={tf.key} onClick={() => setTimeframe(tf.key)} disabled={isLoading}
              className={`px-2.5 py-1 rounded-md text-[13px] font-semibold transition-all ${
                timeframe === tf.key ? 'bg-[#1a2236] text-[#e2e8f0]' : 'text-[#475569] hover:text-[#94a3b8]'
              }`}>
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
  );
}
