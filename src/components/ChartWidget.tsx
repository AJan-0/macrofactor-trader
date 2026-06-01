import { useState, useCallback, useRef, useEffect, memo } from "react";
import { useAppStore } from "@/store/appStore";
import { useI18n } from "@/i18n/context";
import { useKlineData } from "@/hooks/useKlineData";
import { useKlineStream, mergeCandle } from "@/services/klineStream";
import { useChartPerformance } from "@/hooks/useChartPerformance";
import { useRealtimePrice } from "@/services/priceStream";
import { fetchRealMacroEvents } from "@/services/macroApi";
import type { MacroEvent } from "@/store/appStore";
import type { StrategySignal } from "@/services/strategyEngine";
import type { ChartCanvasRef } from "./chart/ChartCanvas";
import ChartCanvas from "./chart/ChartCanvas";
import { useStrategyOverlay } from "@/hooks/useStrategyOverlay";
import StrategyControlPanel from "./chart/StrategyControlPanel";
import MobileChartHeader from "./chart/MobileChartHeader";
// import MobileTradingPanel from "./chart/MobileTradingPanel";

let _factorCache: { data: MacroEvent[]; ts: number } | null = null;
const FACTOR_CACHE_MS = 300_000; // 5-minute TTL

// TODO: will be used in future
async function loadFactorData(): Promise<MacroEvent[]> {
  if (_factorCache && Date.now() - _factorCache.ts < FACTOR_CACHE_MS) return _factorCache.data;
  try {
    const [resp, realEvents] = await Promise.all([
      fetch("/data/factors.json"),
      fetchRealMacroEvents().catch(() => [] as MacroEvent[]),
    ]);
    let localData: MacroEvent[] = [];
    if (resp.ok) {
      localData = await resp.json();
    }
    const seen = new Set<string>();
    const merged: MacroEvent[] = [];
    for (const ev of [...realEvents, ...localData]) {
      if (!seen.has(ev.id)) {
        seen.add(ev.id);
        merged.push(ev);
      }
    }
    merged.sort((a, b) => b.timestamp - a.timestamp);
    _factorCache = { data: merged, ts: Date.now() };
    console.log(
      `[ChartWidget] Loaded ${merged.length} factors (${realEvents.length} real + ${localData.length} local)`
    );
    return merged;
  } catch (err) {
    console.warn("[ChartWidget] Failed to load factors:", err);
    return [];
  }
}

interface AlertToast {
  id: string;
  strategyName: string;
  signal: StrategySignal;
  symbol: string;
}

const ChartWidget = memo(function ChartWidget() {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartCanvasRef = useRef<ChartCanvasRef | null>(null);

  const symbol = useAppStore((s) => s.currentSymbol);
  const timeframe = useAppStore((s) => s.currentTimeframe);
  const setSymbol = useAppStore((s) => s.setSymbol);
  const setTimeframe = useAppStore((s) => s.setTimeframe);
  const { klinesRef, dataVersion, isLoading: klineLoading, error, bumpVersion } = useKlineData(symbol, timeframe);
  const { price, changePct } = useRealtimePrice(symbol);

  // 强制重新渲染 key，确保 symbol 切换时 ChartCanvas 完全重新挂载
  const chartKey = `${symbol}-${timeframe}-${dataVersion}`;

  // 移动端性能优化 - K 线数据降采样
  const { klines: optimizedKlines, isOptimized } = useChartPerformance({
    klines: klinesRef.current,
    maxPoints: 400, // 移动端最多显示 400 个点
    enabled: true,
  });

  const [loadedFactors, setLoadedFactors] = useState<MacroEvent[]>([]);
  const [alertToasts, setAlertToasts] = useState<AlertToast[]>([]);

  const setLoading = useAppStore((s) => s.setLoading);
  // setError reserved for future error handling
  // const setError = useAppStore((s) => s.setError);
  const selectEvent = useAppStore((s) => s.selectEvent);

  // WebSocket 实时 K 线增量合并
  const { lastCandle } = useKlineStream(symbol, timeframe);

  useEffect(() => {
    if (!lastCandle) return;
    const merged = mergeCandle(klinesRef.current, lastCandle);
    if (merged === klinesRef.current) return;
    klinesRef.current = merged;
    bumpVersion();
  }, [lastCandle, bumpVersion, klinesRef]);

  // Sync store isLoading with kline loading state
  useEffect(() => {
    if (!klineLoading) {
      setLoading(false);
    }
  }, [klineLoading, setLoading]);

  // Load factor data when symbol/timeframe changes
  useEffect(() => {
    let cancelled = false;
    loadFactorData().then((data) => {
      if (!cancelled) setLoadedFactors(data);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [symbol, timeframe]);

  // Strategy overlay hook
  const chartAPI = chartCanvasRef.current;
  const isChartReady = chartAPI !== null && chartAPI.chart !== null;

  const handleAlert = useCallback((toast: AlertToast) => {
    setAlertToasts((prev) => {
      if (prev.some((t) => t.id === toast.id)) return prev;
      return [...prev.slice(-4), toast];
    });
  }, []);

  // 使用实际 K 线数据（不是 ref），确保策略能响应数据变化
  const currentKlines = isOptimized ? optimizedKlines : klinesRef.current;
  
  const {
    activeStrategies,
    strategyOutputs,
    allStrategies,
    addStrategy,
    removeStrategy,
    updateStrategyParam,
    resetStrategyParams,
    clearAllStrategies,
  } = useStrategyOverlay({
    chart: chartAPI?.chart ?? null,
    candleSeries: chartAPI?.candleSeries ?? null,
    klines: currentKlines,
    symbol,
    chartReady: isChartReady,
    onAlert: handleAlert,
  });

  // Handle event click from chart
  const handleEventClick = useCallback(
    (eventId: string, timestamp: number) => {
      selectEvent(eventId, timestamp);
    },
    [selectEvent]
  );

  // UI states
  const showSkeleton = klineLoading;
  const hasError = !klineLoading && klinesRef.current.length === 0;
  const showError = hasError && !!error;

  return (
    <div
      ref={containerRef}
      className="w-full h-full min-h-[200px] lg:min-h-[400px] relative flex flex-col"
      style={{ background: "#111827" }}
    >
      {/* 移动端 TradingView 风格头部 */}
      <MobileChartHeader
        symbol={symbol}
        price={price}
        changePct={changePct}
        timeframe={timeframe}
        onTimeframeChange={(tf) => setTimeframe(tf as typeof timeframe)}
        onSymbolChange={(s) => setSymbol(s as typeof symbol)}
      />

      {/* Chart Canvas */}
      <div className="flex-1 min-h-0 relative">
        <ChartCanvas
          key={chartKey}
          ref={chartCanvasRef}
          klines={isOptimized ? optimizedKlines : klinesRef.current}
          events={loadedFactors}
          strategyOutputs={strategyOutputs}
          onEventClick={handleEventClick}
          timeframe={timeframe}
          dataVersion={dataVersion}
        />
      </div>

      {/* 移动端性能优化指示器 */}
      {isOptimized && (
        <div className="lg:hidden absolute top-2 left-2 z-20 px-1.5 py-0.5 rounded bg-[#1a2236]/80 border border-[#2d3a52] text-[8px] text-[#475569] font-mono">
          {optimizedKlines.length}/{klinesRef.current.length}
        </div>
      )}

      {/* Skeleton Loading Overlay */}
      {showSkeleton && (
        <div className="absolute inset-0 z-10 flex flex-col gap-2 p-4 pointer-events-none">
          <div className="h-5 w-32 bg-[#1e293b] rounded animate-pulse" />
          <div className="flex-1 flex gap-2">
            <div className="flex-1 bg-[#1e293b80] rounded animate-pulse" />
            <div className="w-14 bg-[#1e293b80] rounded animate-pulse" />
          </div>
          <div className="h-4 w-full bg-[#1e293b] rounded animate-pulse" />
        </div>
      )}

      {/* Error State */}
      {showError && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <div className="bg-[#1a2236] border border-[#ef4444]/30 rounded-lg p-4 max-w-xs text-center">
            <div className="text-[#ef4444] text-sm font-bold mb-2">⚠️ {t("chart.dataError")}</div>
            <div className="text-[#94a3b8] text-xs mb-3">{error}</div>
            <button
              onClick={() => window.location.reload()}
              className="text-[11px] px-3 py-1.5 rounded bg-[#3b82f6] text-white hover:bg-[#2563eb] transition-colors"
            >
              {t("chart.reload")}
            </button>
          </div>
        </div>
      )}

      {/* Debug Status Badge (dev only) */}
      {import.meta.env.DEV && (
        <div className="absolute bottom-2 right-2 z-30 text-[9px] font-mono bg-[#1a2236]/90 border border-[#1e293b] rounded px-2 py-1 text-[#94a3b8] pointer-events-none">
          <span className={klineLoading ? "text-[#eab308]" : "text-[#22c55e]"}>
            {klineLoading ? "⏳" : "✓"} klines:{klinesRef.current.length}
          </span>
          <span className="mx-1">|</span>
          <span className={isChartReady ? "text-[#22c55e]" : "text-[#ef4444]"}>
            chart:{isChartReady ? "ready" : "wait"}
          </span>
          {error && <span className="text-[#ef4444] ml-1">err</span>}
        </div>
      )}

      {/* Strategy Control Panel */}
      <StrategyControlPanel
        activeStrategies={activeStrategies}
        strategyOutputs={strategyOutputs}
        allStrategies={allStrategies}
        addStrategy={addStrategy}
        removeStrategy={removeStrategy}
        updateStrategyParam={updateStrategyParam}
        resetStrategyParams={resetStrategyParams}
        clearAllStrategies={clearAllStrategies}
        alertToasts={alertToasts}
        onAlertToastsChange={setAlertToasts}
        klines={klinesRef.current}
      />

      {/* 移动端 TradingView 风格交易面板 - 已禁用（无效组件） */}
      {/* <MobileTradingPanel price={price} symbol={symbol} /> */}
    </div>
  );
});

export default ChartWidget;
