import { useState, useCallback, useRef, useEffect, lazy, Suspense } from "react";
import { useAppStore } from "@/store/appStore";
import { useKlineData } from "@/hooks/useKlineData";
import { useKlineStream, mergeCandle } from "@/services/klineStream";
import { fetchRealMacroEvents } from "@/services/macroApi";
import type { MacroEvent } from "@/store/appStore";
import type { StrategySignal } from "@/services/strategyEngine";
import type { ChartCanvasRef } from "./chart/ChartCanvas";
import ChartCanvas from "./chart/ChartCanvas";
import StrategyOverlay from "./chart/StrategyOverlay";
import AlertPanel from "./chart/AlertPanel";
import BacktestPanel from "./BacktestPanel";

const StrategyConsensusPanel = lazy(() => import("./StrategyConsensusPanel"));
const PineTranspilerPanel = lazy(() => import("./PineTranspilerPanel"));

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

export default function ChartWidget() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartCanvasRef = useRef<ChartCanvasRef | null>(null);

  const symbol = useAppStore((s) => s.currentSymbol);
  const timeframe = useAppStore((s) => s.currentTimeframe);
  const { klinesRef, dataVersion, isLoading: klineLoading, error, bumpVersion } = useKlineData(symbol, timeframe);

  const [loadedFactors, setLoadedFactors] = useState<MacroEvent[]>([]);
  const [alertToasts, setAlertToasts] = useState<AlertToast[]>([]);
  const [showStrategyPanel, setShowStrategyPanel] = useState(false);
  const [panelTab, setPanelTab] = useState<"list" | "consensus" | "pine">("list");

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
  // 修复：无论 klines 是否为空，只要 kline 加载完成就清除 store loading
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
  // chartCanvasRef populated by ChartCanvas via forwardRef + useImperativeHandle with getters
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

  // Strategy panel tabs state
  const [strategyTabs, setStrategyTabs] = useState<Record<string, "params" | "backtest">>({});

  // Show skeleton when kline data is loading (independent of storeLoading)
  const showSkeleton = klineLoading;

  // Error state: kline finished loading but no data and has error
  const hasError = !klineLoading && klinesRef.current.length === 0;
  const errorMsg = error;
  // Show error UI when there's an error and no data
  const showError = hasError && !!errorMsg;

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
            <div className="text-[#ef4444] text-sm font-bold mb-2">⚠️ 数据加载失败</div>
            <div className="text-[#94a3b8] text-xs mb-3">{errorMsg}</div>
            <button
              onClick={() => window.location.reload()}
              className="text-[11px] px-3 py-1.5 rounded bg-[#3b82f6] text-white hover:bg-[#2563eb] transition-colors"
            >
              重新加载
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
      <div className="absolute top-2 left-2 z-20 flex flex-col gap-1">
        <button
          onClick={() => setShowStrategyPanel(!showStrategyPanel)}
          className="text-[11px] px-2.5 py-1 rounded bg-[#1a2236] text-[#94a3b8] hover:text-[#e2e8f0] border border-[#1e293b] font-bold transition-colors"
        >
          📈 策略 ({activeStrategies.length})
        </button>

        {showStrategyPanel && (
          <div className="bg-[#1a2236] border border-[#1e293b] rounded-lg p-2.5 shadow-xl w-[280px] max-h-[420px] overflow-y-auto">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[11px] font-bold text-[#e2e8f0] tracking-wider">
                STRATEGIES
              </div>
              <AlertPanel toasts={alertToasts} onToastsChange={setAlertToasts} />
            </div>

            {/* Panel Tabs */}
            <div className="flex gap-1 mb-2">
              <button
                onClick={() => setPanelTab("list")}
                className={`flex-1 text-[10px] py-1 rounded ${
                  panelTab === "list"
                    ? "bg-[#3b82f620] text-[#3b82f6]"
                    : "text-[#475569] hover:text-[#94a3b8]"
                }`}
              >
                策略列表
              </button>
              <button
                onClick={() => setPanelTab("consensus")}
                className={`flex-1 text-[10px] py-1 rounded ${
                  panelTab === "consensus"
                    ? "bg-[#8b5cf620] text-[#8b5cf6]"
                    : "text-[#475569] hover:text-[#94a3b8]"
                }`}
              >
                ⚡ 共识
              </button>
              <button
                onClick={() => setPanelTab("pine")}
                className={`flex-1 text-[10px] py-1 rounded ${
                  panelTab === "pine"
                    ? "bg-[#10b98120] text-[#10b981]"
                    : "text-[#475569] hover:text-[#94a3b8]"
                }`}
              >
                🌲 Pine
              </button>
            </div>

            {panelTab === "consensus" ? (
              <Suspense
                fallback={
                  <div className="text-[10px] text-[#475569] py-4 text-center">
                    Loading...
                  </div>
                }
              >
                <StrategyConsensusPanel strategyOutputs={strategyOutputs} />
              </Suspense>
            ) : panelTab === "pine" ? (
              <Suspense
                fallback={
                  <div className="text-[10px] text-[#475569] py-4 text-center">
                    Loading...
                  </div>
                }
              >
                <PineTranspilerPanel />
              </Suspense>
            ) : (
              <>
                {/* Add Strategy */}
                <div className="mb-2">
                  <select
                    className="w-full bg-[#111827] border border-[#1e293b] rounded px-2 py-1.5 text-[11px] text-[#e2e8f0] outline-none"
                    onChange={(e) => {
                      const def = allStrategies.find((d) => d.id === e.target.value);
                      if (def) addStrategy(def);
                      e.target.value = "";
                    }}
                    value=""
                  >
                    <option value="">+ 添加策略...</option>
                    {allStrategies.map((def) => (
                      <option key={def.id} value={def.id}>
                        {def.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Active Strategies List */}
                {activeStrategies.map((as) => {
                  const def = allStrategies.find((d) => d.id === as.id);
                  if (!def) return null;
                  const output = strategyOutputs.get(as.id);
                  return (
                    <div
                      key={as.id}
                      className="mb-2 p-2 rounded bg-[#111827] border border-[#1e293b]/50"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] font-bold text-[#e2e8f0]">
                          {def.name}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => resetStrategyParams(as.id)}
                            className="text-[10px] text-[#475569] hover:text-[#3b82f6]"
                            title="重置参数"
                          >
                            ↺
                          </button>
                          <button
                            onClick={() => removeStrategy(as.id)}
                            className="text-[10px] text-[#475569] hover:text-[#ef4444]"
                          >
                            ✕
                          </button>
                        </div>
                      </div>

                      {output && (
                        <div className="text-[9px] text-[#475569] mb-1">
                          {output.signals.length} signals | {output.lines.length} lines
                        </div>
                      )}

                      {/* Params / Backtest Tabs */}
                      <div className="flex gap-1 mb-1.5">
                        <button
                          onClick={() =>
                            setStrategyTabs((prev) => ({ ...prev, [as.id]: "params" }))
                          }
                          className={`text-[9px] px-2 py-0.5 rounded ${
                            strategyTabs[as.id] !== "backtest"
                              ? "bg-[#3b82f620] text-[#3b82f6]"
                              : "text-[#475569] hover:text-[#94a3b8]"
                          }`}
                        >
                          参数
                        </button>
                        <button
                          onClick={() =>
                            setStrategyTabs((prev) => ({ ...prev, [as.id]: "backtest" }))
                          }
                          className={`text-[9px] px-2 py-0.5 rounded ${
                            strategyTabs[as.id] === "backtest"
                              ? "bg-[#eab30820] text-[#eab308]"
                              : "text-[#475569] hover:text-[#94a3b8]"
                          }`}
                        >
                          📊 回测
                        </button>
                      </div>

                      {strategyTabs[as.id] === "backtest" ? (
                        <BacktestPanel
                          strategyName={def.name}
                          signals={output?.signals ?? []}
                          klines={klinesRef.current}
                        />
                      ) : (
                        <div className="space-y-1.5">
                          {def.parameters.map((param) => (
                            <div key={param.id} className="flex items-center gap-1.5">
                              <span className="text-[10px] text-[#94a3b8] w-20 truncate">
                                {param.name}
                              </span>
                              {param.type === "bool" ? (
                                <button
                                  onClick={() => {
                                    const current = as.params[param.id];
                                    const next = typeof current === 'boolean' ? !current : current === 'true' ? false : true;
                                    (updateStrategyParam as (id: string, pid: string, v: unknown) => void)(as.id, param.id, next);
                                  }}
                                  className={`text-[9px] px-2 py-0.5 rounded font-bold ${
                                    as.params[param.id]
                                      ? "bg-[#22c55e20] text-[#22c55e]"
                                      : "bg-[#1e293b] text-[#475569]"
                                  }`}
                                >
                                  {as.params[param.id] ? "ON" : "OFF"}
                                </button>
                              ) : param.type === "int" || param.type === "float" ? (
                                <div className="flex items-center gap-1 flex-1">
                                  <input
                                    type="range"
                                    min={param.min}
                                    max={param.max}
                                    step={param.step || 1}
                                    value={as.params[param.id] as number}
                                    onChange={(e) => {
                                      const val = param.type === "int" ? parseInt(e.target.value) : parseFloat(e.target.value);
                                      (updateStrategyParam as (id: string, pid: string, v: unknown) => void)(as.id, param.id, val);
                                    }}
                                    className="flex-1 h-1.5 accent-[#3b82f6]"
                                  />
                                  <span className="text-[9px] font-mono text-[#e2e8f0] w-6">
                                    {as.params[param.id]}
                                  </span>
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {activeStrategies.length > 0 && (
                  <button
                    onClick={clearAllStrategies}
                    className="w-full text-[10px] py-1.5 rounded border border-[#ef444430] text-[#ef4444] hover:bg-[#ef444410] transition-colors"
                  >
                    清空所有策略
                  </button>
                )}
                {activeStrategies.length === 0 && (
                  <div className="text-[10px] text-[#475569] text-center py-2">
                    暂无策略，从上方选择添加
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}