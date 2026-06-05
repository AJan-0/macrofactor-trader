import { useState, useRef, useEffect, memo } from "react";
import { useTheme } from "next-themes";
import { useAppStore } from "@/store/appStore";
import { useI18n } from "@/i18n/context";
import { useRealtimePrice } from "@/services/priceStream";
import { useIsMobile } from "@/hooks/use-mobile";
import { LightningIcon, MoonIcon, SunIcon, ChevronDownIcon, ActivityIcon } from "@/components/icons";

const Toolbar = memo(function Toolbar() {
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const symbol = useAppStore(s => s.currentSymbol);
  const setSymbol = useAppStore(s => s.setSymbol);
  const timeframe = useAppStore(s => s.currentTimeframe);
  const setTimeframe = useAppStore(s => s.setTimeframe);
  const events = useAppStore(s => s.events);
  const isLoading = useAppStore(s => s.isLoading);
  const { price, changePct } = useRealtimePrice(symbol);
  const isUp = (changePct ?? 0) >= 0;
  const lastUpdate = price ? new Date().toLocaleTimeString() : "";
  const isMobile = useIsMobile();

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const assetBtnRef = useRef<HTMLButtonElement>(null);
  const assetMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Escape 关闭下拉菜单
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        assetBtnRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const asset = ASSETS.find(a => a.key === symbol) || ASSETS[0];
  const changeDisplay = changePct !== null ? `${isUp ? '+' : ''}${changePct.toFixed(2)}%` : '';

  return (
    <div
      className="flex items-center border-b border-[#1e293b]/60 bg-[#0a0e1a] md:h-12 h-14"
      style={{ color: '#e2e8f0', fontSize: 12, flexShrink: 0 }}
    >
      {isMobile ? (
        /* === 移动端 Toolbar - 精简版 === */
        <div className="flex items-center justify-between w-full px-3">
          {/* 左侧：品牌 */}
          <div className="flex items-center gap-2">
            <LightningIcon size={18} className="text-[#3b82f6]" />
            <span className="font-bold text-sm tracking-wide">{t("app.name")}</span>
          </div>

          {/* 右侧：语言 + 主题 + 状态 */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setLocale(locale === "en" ? "zh" : "en")}
              className="text-[11px] px-2 py-1 rounded-md bg-[#1a2236] text-[#94a3b8] border border-[#1e293b] transition-colors min-h-touch"
            >
              {t("toolbar.lang")}
            </button>
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="w-8 h-8 flex items-center justify-center rounded-md bg-[#1a2236] text-[#94a3b8] border border-[#1e293b] transition-colors"
              title="Toggle theme"
            >
              {theme === "dark" ? <MoonIcon size={14} /> : <SunIcon size={14} />}
            </button>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" />
            </span>
          </div>
        </div>
      ) : (
        /* === 桌面端 Toolbar === */
        <div className="flex items-center px-4 py-2 w-full">
          {/* 左侧：品牌 + 语言切换 */}
          <div className="flex items-center gap-3">
            <LightningIcon size={18} className="text-[#3b82f6]" />
            <span className="font-bold text-[13px] tracking-wide">{t("app.name")}</span>
            <button
              onClick={() => setLocale(locale === "en" ? "zh" : "en")}
              className="text-[11px] px-2 py-0.5 rounded bg-[#1a2236] text-[#94a3b8] hover:text-white border border-[#1e293b] transition-colors"
            >
              {t("toolbar.lang")}
            </button>
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="w-7 h-7 flex items-center justify-center rounded bg-[#1a2236] text-[#94a3b8] hover:text-white border border-[#1e293b] transition-colors"
              title="Toggle theme"
            >
              {theme === "dark" ? <MoonIcon size={14} /> : <SunIcon size={14} />}
            </button>
          </div>

          {/* 中间：资产选择 + 价格 + 时间周期 */}
          <div className="flex items-center gap-4 mx-auto">
            {/* Asset Dropdown */}
            <div className="relative" ref={ref}>
              <button
                ref={assetBtnRef}
                onClick={() => setOpen(!open)}
                disabled={isLoading}
                aria-expanded={open}
                aria-haspopup="listbox"
                aria-controls={open ? "asset-menu" : undefined}
                aria-label={t("toolbar.selectAsset")}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#111827] border border-[#2d3a52] hover:border-[#475569] transition-all font-semibold"
              >
                <span 
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: asset.color }}
                />
                <span>{t(asset.label)}</span>
                <ChevronDownIcon size={12} className="text-[#475569]" />
              </button>
              {open && (
                <div
                  ref={assetMenuRef}
                  id="asset-menu"
                  role="listbox"
                  aria-label={t("toolbar.assetList")}
                  className="absolute top-full left-0 mt-2 w-36 bg-[#111827] border border-[#2d3a52] rounded-lg shadow-xl z-50 overflow-hidden"
                >
                  {ASSETS.map(a => (
                    <button
                      key={a.key}
                      role="option"
                      aria-selected={symbol === a.key}
                      onClick={() => { setSymbol(a.key); setOpen(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#1a2236] transition-colors text-left"
                      style={{ color: symbol === a.key ? '#e2e8f0' : '#94a3b8' }}
                    >
                      <span 
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: a.color }}
                      />
                      {t(a.label)}
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
              <ActivityIcon size={12} className="text-[#22c55e]" />
              <span className="text-[#22c55e] font-semibold text-[11px]">{t("toolbar.live")}</span>
            </span>
            {lastUpdate && <span className="font-mono text-[10px]">{t("toolbar.lastUpdate")} {lastUpdate}</span>}
          </div>
        </div>
      )}
    </div>
  );
});

const ASSETS = [
  { key: "BTC-USDT", label: "asset.btc", color: "#f59e0b" },
  { key: "ETH-USDT", label: "asset.eth", color: "#3b82f6" },
  { key: "SOL-USDT", label: "asset.sol", color: "#14f195" },
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
