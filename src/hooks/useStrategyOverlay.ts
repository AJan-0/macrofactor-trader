import { useEffect, useRef, useCallback, useState } from "react";
import { LineSeries, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import { strategyRegistry } from "@/strategies";
import type { StrategyDefinition, StrategyOutput, StrategySignal } from "@/services/strategyEngine";
import { getDefaultParams } from "@/services/strategyEngine";
import { safeParseActiveStrategies, safeSerializeStrategies } from "@/lib/validation";
import { sendAlert } from "@/services/alertEngine";
import type { KlineData } from "@/components/chart/ChartCanvas";

export interface ActiveStrategy {
  id: string;
  params: Record<string, import("@/services/strategyEngine").ParamValue>;
}

interface UseStrategyOverlayOptions {
  chart: IChartApi | null;
  candleSeries: ISeriesApi<"Candlestick"> | null;
  klines: KlineData[];
  symbol: string;
  chartReady: boolean;
  onAlert: (toast: {
    id: string;
    strategyName: string;
    signal: StrategySignal;
    symbol: string;
  }) => void;
}

export function useStrategyOverlay({
  chart,
  candleSeries,
  klines,
  symbol,
  chartReady,
  onAlert,
}: UseStrategyOverlayOptions) {
  const strategyLineRefs = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const workerRef = useRef<Worker | null>(null);
  const dataGenRef = useRef(0);
  const onAlertRef = useRef(onAlert);

  const [activeStrategies, setActiveStrategies] = useState<ActiveStrategy[]>([]);
  const [strategyOutputs, setStrategyOutputs] = useState<Map<string, StrategyOutput>>(new Map());

  const allStrategies = strategyRegistry.getDefinitions();

  // Keep onAlert ref in sync
  useEffect(() => {
    onAlertRef.current = onAlert;
  }, [onAlert]);

  // Load from localStorage (once)
  useEffect(() => {
    const raw = localStorage.getItem("chartStrategies");
    if (raw) {
      const saved = safeParseActiveStrategies(raw);
      const valid = saved.filter((s) => strategyRegistry.get(s.id));
      if (valid.length) {
        setActiveStrategies(valid);
        console.log(`[useStrategyOverlay] Restored ${valid.length} strategies from localStorage`);
      }
    }
  }, []);

  // Save to localStorage
  useEffect(() => {
    if (activeStrategies.length > 0) {
      localStorage.setItem("chartStrategies", safeSerializeStrategies(activeStrategies));
    } else {
      localStorage.removeItem("chartStrategies");
    }
  }, [activeStrategies]);

  // Init Worker (once)
  useEffect(() => {
    let worker: Worker | null = null;
    try {
      worker = new Worker(
        new URL("../workers/strategy.worker.ts", import.meta.url),
        { type: "module" }
      );
      const pingId = `ping-${Date.now()}`;
      const pongPromise = new Promise<boolean>((resolve) => {
        const handler = (e: MessageEvent) => {
          if (e.data?.type === "pong" && e.data?.id === pingId) {
            worker!.removeEventListener("message", handler);
            resolve(true);
          }
        };
        worker!.addEventListener("message", handler);
        worker!.postMessage({ type: "ping", id: pingId });
        setTimeout(() => {
          worker!.removeEventListener("message", handler);
          resolve(false);
        }, 2000);
      });
      pongPromise.then((ok) => {
        if (ok) {
          workerRef.current = worker;
          console.log("[useStrategyOverlay] Strategy worker ready");
        } else {
          console.warn("[useStrategyOverlay] Worker ping timeout, using main thread");
          worker?.terminate();
        }
      });
    } catch (err) {
      console.warn("[useStrategyOverlay] Failed to init strategy worker:", err);
      worker?.terminate();
    }
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    const map = strategyLineRefs.current;
    return () => {
      if (chart) {
        for (const [, series] of map) {
          try { chart.removeSeries(series); } catch { /* ignore */ }
        }
      }
      map.clear();
    };
  }, [chart]);

  // Calculate and draw strategies (with proper guards)
  // 使用 ref 存储 klines 避免数组引用变化导致无限循环
  const klinesRef = useRef(klines);
  klinesRef.current = klines;
  
  // 使用 ref 存储 chart 和 candleSeries，避免引用变化导致无限循环
  const chartRef = useRef(chart);
  chartRef.current = chart;
  const candleSeriesRef = useRef(candleSeries);
  candleSeriesRef.current = candleSeries;

  useEffect(() => {
    if (!klines.length || !chartReady) return;
    const currentChart = chartRef.current;
    const currentCandleSeries = candleSeriesRef.current;
    if (!currentChart || !currentCandleSeries) return;

    let cancelled = false;
    const currentGen = ++dataGenRef.current;

    async function run() {
      const currentKlines = klinesRef.current;
      const newOutputs = await calculateStrategies(
        activeStrategies,
        currentKlines,
        workerRef.current
      );
      if (cancelled || currentGen !== dataGenRef.current) return;

      setStrategyOutputs(newOutputs);

      // Alert triggers
      const latestKlineTime = currentKlines.at(-1)?.time ?? 0;
      const recentWindow =
        latestKlineTime - (currentKlines.length > 3 ? currentKlines[currentKlines.length - 3].time : latestKlineTime);
      for (const [id, output] of newOutputs) {
        const strategy = strategyRegistry.get(id);
        if (!strategy) continue;
        for (const signal of output.signals) {
          if (latestKlineTime - signal.time > Math.max(recentWindow, 86400)) continue;
          sendAlert(id, strategy.definition.name, signal, symbol);
          const toastId = `${id}-${signal.time}-${signal.direction}`;
          onAlertRef.current({
            id: toastId,
            strategyName: strategy.definition.name,
            signal,
            symbol,
          });
        }
      }

      // Cleanup old lines
      const chartInstance = chartRef.current;
      if (!chartInstance) return;
      const linesToRemove = Array.from(strategyLineRefs.current.entries());
      for (const [lineId, series] of linesToRemove) {
        const strategyId = lineId.split("-")[0];
        if (!activeStrategies.some((s) => s.id === strategyId)) {
          try { chartInstance.removeSeries(series); } catch { /* ignore */ }
          strategyLineRefs.current.delete(lineId);
        }
      }

      // Draw strategy lines
      for (const [id, output] of newOutputs) {
        for (const line of output.lines) {
          const lineId = `${id}-${line.id}`;
          let series = strategyLineRefs.current.get(lineId);
          if (!series) {
            series = chartInstance.addSeries(LineSeries, {
              color: line.color,
              lineWidth: Math.min(4, Math.max(1, line.lineWidth)) as 1 | 2 | 3 | 4,
              lastValueVisible: false,
              title: line.name,
            });
            strategyLineRefs.current.set(lineId, series);
          }
          const cleanData = line.data
            .filter((d: { value: number | null }): d is { time: number; value: number } => d.value !== null && !isNaN(d.value))
            .map((d: { time: number; value: number }) => ({
              time: d.time as Time,
              value: d.value,
            }));
          series.setData(cleanData);
        }
      }

      // Draw signal markers
      const allSignals = Array.from(newOutputs.values()).flatMap(
        (o: StrategyOutput) => o.signals
      );
      const signalMarkers = allSignals.map((s) => ({
        time: s.time as Time,
        position: (s.direction === "buy" ? "belowBar" : "aboveBar") as "belowBar" | "aboveBar",
        color: s.direction === "buy" ? "#22c55e" : "#ef4444",
        shape: (s.direction === "buy" ? "arrowUp" : "arrowDown") as "arrowUp" | "arrowDown",
        text: s.label.length > 10 ? s.label.slice(0, 8) + ".." : s.label,
        size: 1 + Math.round(s.strength * 2),
      }));
      signalMarkers.sort((a, b) => (a.time as number) - (b.time as number));
      if (signalMarkers.length > 0 && candleSeriesRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (candleSeriesRef.current as any).setMarkers?.(signalMarkers);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  // 注意：chart 和 candleSeries 使用 ref 存储，不在依赖数组中
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStrategies, chartReady, symbol]);

  // Cleanup when symbol/timeframe changes
  useEffect(() => {
    const currentChart = chartRef.current;
    if (!currentChart) return;
    for (const [, series] of strategyLineRefs.current) {
      try { currentChart.removeSeries(series); } catch { /* ignore */ }
    }
    strategyLineRefs.current.clear();
    setStrategyOutputs(new Map());
    dataGenRef.current += 1;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const addStrategy = useCallback((def: StrategyDefinition) => {
    setActiveStrategies((prev) => {
      if (prev.some((s) => s.id === def.id)) return prev;
      return [...prev, { id: def.id, params: getDefaultParams(def) }];
    });
  }, []);

  const removeStrategy = useCallback((id: string) => {
    setActiveStrategies((prev) => prev.filter((s) => s.id !== id));
    setStrategyOutputs((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    const c = chartRef.current;
    if (c) {
      for (const [lineId, series] of strategyLineRefs.current) {
        if (lineId.startsWith(`${id}-`)) {
          try { c.removeSeries(series); } catch { /* ignore */ }
          strategyLineRefs.current.delete(lineId);
        }
      }
    }
  }, []);

  const updateStrategyParam = useCallback(
    (strategyId: string, paramId: string, value: unknown) => {
      setActiveStrategies((prev) =>
        prev.map((s) =>
          s.id === strategyId
            ? { ...s, params: { ...s.params, [paramId]: value as import("@/services/strategyEngine").ParamValue } }
            : s
        )
      );
    },
    []
  );

  const resetStrategyParams = useCallback((strategyId: string) => {
    const def = strategyRegistry.get(strategyId);
    if (!def) return;
    setActiveStrategies((prev) =>
      prev.map((s) =>
        s.id === strategyId
          ? { ...s, params: getDefaultParams(def.definition) }
          : s
      )
    );
  }, []);

  const clearAllStrategies = useCallback(() => {
    setActiveStrategies([]);
    setStrategyOutputs(new Map());
    const c = chartRef.current;
    if (c) {
      for (const [, series] of strategyLineRefs.current) {
        try { c.removeSeries(series); } catch { /* ignore */ }
      }
    }
    strategyLineRefs.current.clear();
  }, []);

  return {
    activeStrategies,
    strategyOutputs,
    allStrategies,
    addStrategy,
    removeStrategy,
    updateStrategyParam,
    resetStrategyParams,
    clearAllStrategies,
  };
}

// Strategy calculation helper
async function calculateStrategies(
  activeStrategies: ActiveStrategy[],
  klines: KlineData[],
  worker: Worker | null
): Promise<Map<string, StrategyOutput>> {
  const outputs = new Map<string, StrategyOutput>();

  if (worker) {
    const promises = activeStrategies.map((as) =>
      new Promise<{ id: string; output: StrategyOutput | null; error?: string }>((resolve) => {
        const reqId = `${as.id}-${Date.now()}-${Math.random()}`;
        const handler = (e: MessageEvent) => {
          const data = e.data as {
            id: string;
            strategyId: string;
            output: StrategyOutput | null;
            error?: string;
          };
          if (data.id === reqId) {
            worker.removeEventListener("message", handler);
            resolve({ id: data.strategyId, output: data.output, error: data.error });
          }
        };
        worker.addEventListener("message", handler);
        worker.postMessage({
          id: reqId,
          strategyId: as.id,
          klines,
          params: as.params,
        });
        setTimeout(() => {
          worker.removeEventListener("message", handler);
          resolve({ id: as.id, output: null, error: "Worker timeout" });
        }, 5000);
      })
    );
    const results = await Promise.all(promises);
    for (const r of results) {
      if (r.output) outputs.set(r.id, r.output);
    }
    const failedIds = new Set(
      activeStrategies.map((s) => s.id).filter((id) => !outputs.has(id))
    );
    if (failedIds.size > 0) {
      console.warn(`[useStrategyOverlay] Worker missed ${failedIds.size} strategies, falling back to main thread`);
      for (const as of activeStrategies) {
        if (!failedIds.has(as.id)) continue;
        const strategy = strategyRegistry.get(as.id);
        if (!strategy) continue;
        try {
          const output = strategy.calculate({ klines, params: as.params });
          outputs.set(as.id, output);
        } catch (err) {
          console.warn(`[useStrategyOverlay] ${as.id} main-thread calc failed:`, err);
        }
      }
    }
  } else {
    for (const as of activeStrategies) {
      const strategy = strategyRegistry.get(as.id);
      if (!strategy) continue;
      try {
        const output = strategy.calculate({ klines, params: as.params });
        outputs.set(as.id, output);
      } catch (err) {
        console.warn(`[useStrategyOverlay] ${as.id} calculation failed:`, err);
      }
    }
  }

  return outputs;
}
