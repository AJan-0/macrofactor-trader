import { useState, useCallback, useRef, useEffect, lazy, Suspense, memo } from "react";
import { useAppStore } from "@/store/appStore";
import { useI18n } from "@/i18n/context";
import { useKlineData } from "@/hooks/useKlineData";
import { useKlineStream, mergeCandle } from "@/services/klineStream";
import { fetchRealMacroEvents } from "@/services/macroApi";
import type { MacroEvent } from "@/store/appStore";
import type { StrategySignal } from "@/services/strategyEngine";
import type { ChartCanvasRef } from "./chart/ChartCanvas";
import ChartCanvas from "./chart/ChartCanvas";
import StrategyOverlay from "./chart/StrategyOverlay";
import StrategyControlPanel from "./chart/StrategyControlPanel";

let _factorCache: { data: MacroEvent[]; ts: number } | null = null;
const FACTOR_CACHE_MS = 300_000; // 5-minute TTL

// @ts-expect-error - will be used in future
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
  const { klinesRef, dataVersion, isLoading: klineLoading, error, bumpVersion } = useKlineData(symbol, timeframe);

  const [loadedFactors, setLoadedFactors] = useState<MacroEvent[]>([]);
  const [alertToasts, setAlertToasts] = useState<AlertToast[]>([]);

  const setLoading = useAppStore((s) => s.setLoading);
  const setError = useAppStore((s) => s.setError);
  const selectEvent = useAppStore((s) => s.selectEvent);

  // WebSocket 实时 K 线增量合并
  const { lastCandle } = useKlineStream(symbol, timeframe);

  useEffect(() => {
    if (!lastCandle) return;
    const merged = mergeCandle(klinesRef.current, lastCandle);
    if (merged === klinesRef.current) return;
    klinesRef.current = merged;
    bumpVersion();
  }, [lastCandle, bumpVersion]);

  // Sync store isLoading with kline loading state
  useEffect(() => {
    if (!klineLoading) {
      setLoading(false);
    }
  }, [klineLoading]);

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

  const {
    activeStrategies,
    strategyOutputs,
    allStrategies,
    addStrategy,
    removeStrategy,
    updateStrategyParam,
    resetStrategyParams,
    clearAllStrategies,
  } = StrategyOverlay({
    chart: chartAPI?.chart ?? null,
    candleSeries: chartAPI?.candleSeries ?? null,
    klines: klinesRef.current,
    symbol,
    chartReady: isChartReady,
    onAlert: useCallback((toast: AlertToast) => {
      setAlertToasts((prev) => {
        if (prev.some((t) => t.id === toast.id)) return prev;
        return [...prev.slice(-4), toast];
      });
    }, []),
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
      className="w-full h-full min-h-[200px] lg:min-h-[400px] relative"
      style={{ background: "#111827" }}
    >
      {/* Chart Canvas */}
      <ChartCanvas
        ref={chartCanvasRef}
        klines={klinesRef.current}
        events={loadedFactors}
        strategyOutputs={strategyOutputs}
        onEventClick={handleEventClick}
        timeframe={timeframe}
        dataVersion={dataVersion}
      />

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
    </div>
  );
});

export default ChartWidget;
