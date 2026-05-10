import { useEffect, useRef, useState, useCallback, lazy, Suspense } from "react";
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import { useAppStore, type MacroEvent } from "@/store/appStore";
import { fetchKlines, fetchRealtimePrice, getTimeframeIntervalSeconds } from "@/services/cryptoCompare";
import { fetchRealMacroEvents } from "@/services/macroApi";
import { MOCK_NEWS } from "@/data/mockNews";
import { strategyRegistry } from "@/strategies";
import type { StrategyDefinition, StrategyOutput, StrategySignal } from "@/services/strategyEngine";
import { getDefaultParams } from "@/services/strategyEngine";
import BacktestPanel from "./BacktestPanel";
const StrategyConsensusPanel = lazy(() => import("./StrategyConsensusPanel"));
const PineTranspilerPanel = lazy(() => import("./PineTranspilerPanel"));
import {
  getAlertConfig,
  saveAlertConfig,
  type AlertConfig,
  sendAlert,
  requestNotificationPermission,
  getNotificationPermission,
  clearAlertHistory,
  getTodayAlertCount,
} from "@/services/alertEngine";

let _factorCache: MacroEvent[] | null = null;
async function loadFactorData(): Promise<MacroEvent[]> {
  if (_factorCache) return _factorCache;
  try {
    const [resp, realEvents] = await Promise.all([
      fetch('/data/factors.json'),
      fetchRealMacroEvents().catch(() => [] as MacroEvent[]),
    ]);
    let localData: MacroEvent[] = [];
    if (resp.ok) {
      localData = await resp.json();
    }
    // 合并真实数据 + 本地数据，去重（按 ID）
    const seen = new Set<string>();
    const merged: MacroEvent[] = [];
    for (const ev of [...realEvents, ...localData]) {
      if (!seen.has(ev.id)) {
        seen.add(ev.id);
        merged.push(ev);
      }
    }
    merged.sort((a, b) => b.timestamp - a.timestamp);
    _factorCache = merged;
    console.log(`[ChartWidget] Loaded ${merged.length} factors (${realEvents.length} real + ${localData.length} local)`);
    return merged;
  } catch (err) {
    console.warn('[ChartWidget] Failed to load factors:', err);
    return [];
  }
}

interface KlineData { time: number; open: number; high: number; low: number; close: number; volume: number; }

const THEME = { bg: "#111827", text: "#94a3b8", grid: "#1e293b", up: "#22c55e", down: "#ef4444" };
const IMPACT_STYLE: Record<string, { color: string; position: "aboveBar" | "belowBar" | "inBar"; shape: string; size: number }> = {
  high:   { color: "#ef4444", position: "aboveBar", shape: "arrowDown", size: 2 },
  medium: { color: "#eab308", position: "belowBar", shape: "circle",    size: 1 },
  low:    { color: "#3b82f6", position: "inBar",    shape: "square",    size: 1 },
};

function buildMarkers(events: MacroEvent[], klines: KlineData[], cats: string[], imps: string[]) {
  if (!klines.length || !events.length) return [];
  const minTime = Math.min(...klines.map(k => k.time));
  const maxTime = Math.max(...klines.map(k => k.time));
  const m = events
    .filter(e => e.timestamp >= minTime && e.timestamp <= maxTime && (!cats.length || cats.includes(e.category)) && (!imps.length || imps.includes(e.impact_level)))
    .map(e => {
      const s = IMPACT_STYLE[e.impact_level] || IMPACT_STYLE.low;
      return { time: e.timestamp as Time, position: s.position, color: s.color, shape: s.shape as any, text: e.title.length > 22 ? e.title.slice(0, 20) + ".." : e.title, size: s.size };
    });
  m.sort((a, b) => (a.time as number) - (b.time as number));
  return m;
}

interface ActiveStrategy {
  id: string;
  params: Record<string, any>;
}

export default function ChartWidget() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const highlightRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const klinesRef = useRef<KlineData[]>([]);

  // 策略图层管理
  const strategyLineRefs = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const workerRef = useRef<Worker | null>(null);
  const skipNextZoomRef = useRef(false);

  const symbol = useAppStore(s => s.currentSymbol);
  const timeframe = useAppStore(s => s.currentTimeframe);
  const activeCategories = useAppStore(s => s.selectedCategories);
  const activeImpacts = useAppStore(s => s.selectedImpacts);
  const activeTimestamp = useAppStore(s => s.activeTimestamp);
  const hoverTimestamp = useAppStore(s => s.hoverTimestamp);
  const setEvents = useAppStore(s => s.setEvents);
  const isLoading = useAppStore(s => s.isLoading);
  const setLoading = useAppStore(s => s.setLoading);
  const setError = useAppStore(s => s.setError);
  const selectEvent = useAppStore(s => s.selectEvent);

  const interactRef = useRef({ activeCategories, activeImpacts });
  interactRef.current = { activeCategories, activeImpacts };

  // 策略状态
  const [showStrategyPanel, setShowStrategyPanel] = useState(false);
  const [activeStrategies, setActiveStrategies] = useState<ActiveStrategy[]>([]);
  const [strategyOutputs, setStrategyOutputs] = useState<Map<string, StrategyOutput>>(new Map());
  const [chartReady, setChartReady] = useState(false);

  // 预警状态
  const [alertConfig, setAlertConfig] = useState<AlertConfig>(getAlertConfig);
  const [alertToasts, setAlertToasts] = useState<Array<{
    id: string;
    strategyName: string;
    signal: StrategySignal;
    symbol: string;
  }>>([]);
  const [showAlertSettings, setShowAlertSettings] = useState(false);

  // 策略面板标签状态: params | backtest
  const [strategyTabs, setStrategyTabs] = useState<Record<string, "params" | "backtest">>({});
  // 策略面板主标签: list | consensus | pine
  const [panelTab, setPanelTab] = useState<"list" | "consensus" | "pine">("list");

  const allStrategies = strategyRegistry.getDefinitions();

  // ── 策略持久化: 从 localStorage 加载 ──
  useEffect(() => {
    try {
      const raw = localStorage.getItem("chartStrategies");
      if (raw) {
        const saved: ActiveStrategy[] = JSON.parse(raw);
        // 只保留注册表中仍然存在的策略
        const valid = saved.filter(s => strategyRegistry.get(s.id));
        if (valid.length) {
          setActiveStrategies(valid);
          console.log(`[ChartWidget] 已从 localStorage 恢复 ${valid.length} 个策略`);
        }
      }
    } catch (e) {
      console.warn("[ChartWidget] 恢复策略设置失败:", e);
    }
  }, []);

  // ── 初始化策略计算 Worker ──
  useEffect(() => {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL("../workers/strategy.worker.ts", import.meta.url), { type: "module" });
      // Ping-pong 握手确认 Worker 就绪（最多等 2s）
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
      pongPromise.then(ok => {
        if (ok) {
          workerRef.current = worker;
          console.log("[ChartWidget] Strategy worker ready");
        } else {
          console.warn("[ChartWidget] Worker ping timeout, using main thread");
          worker?.terminate();
        }
      });
    } catch (err) {
      console.warn("[ChartWidget] Failed to init strategy worker, falling back to main thread:", err);
      worker?.terminate();
    }
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // ── 策略持久化: 保存到 localStorage ──
  useEffect(() => {
    if (activeStrategies.length > 0) {
      localStorage.setItem("chartStrategies", JSON.stringify(activeStrategies));
    } else {
      localStorage.removeItem("chartStrategies");
    }
  }, [activeStrategies]);

  // 添加策略
  const addStrategy = useCallback((def: StrategyDefinition) => {
    setActiveStrategies(prev => {
      if (prev.some(s => s.id === def.id)) return prev;
      return [...prev, { id: def.id, params: getDefaultParams(def) }];
    });
  }, []);

  // 移除策略
  const removeStrategy = useCallback((id: string) => {
    setActiveStrategies(prev => prev.filter(s => s.id !== id));
    setStrategyOutputs(prev => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    // 清理图表上的线条
    for (const [lineId, series] of strategyLineRefs.current) {
      if (lineId.startsWith(`${id}-`)) {
        if (chartRef.current) {
          chartRef.current.removeSeries(series);
        }
        strategyLineRefs.current.delete(lineId);
      }
    }
  }, []);

  // 更新策略参数
  const updateStrategyParam = useCallback((strategyId: string, paramId: string, value: any) => {
    setActiveStrategies(prev =>
      prev.map(s =>
        s.id === strategyId
          ? { ...s, params: { ...s.params, [paramId]: value } }
          : s
      )
    );
  }, []);

  // 重置策略参数为默认值
  const resetStrategyParams = useCallback((strategyId: string) => {
    const def = strategyRegistry.get(strategyId);
    if (!def) return;
    setActiveStrategies(prev =>
      prev.map(s =>
        s.id === strategyId
          ? { ...s, params: getDefaultParams(def.definition) }
          : s
      )
    );
  }, []);

  // ── 悬停高亮联动 ──
  useEffect(() => {
    if (!chartRef.current || !highlightRef.current || !klinesRef.current.length) return;
    const hlSeries = highlightRef.current;
    const klines = klinesRef.current;
    if (!hoverTimestamp) {
      hlSeries.setData([]);
      return;
    }
    const minKlineTime = Math.min(...klines.map(k => k.time));
    const maxKlineTime = Math.max(...klines.map(k => k.time));
    const window = 5 * 86400;
    if (hoverTimestamp < minKlineTime - window || hoverTimestamp > maxKlineTime + window) {
      hlSeries.setData([]);
      return;
    }
    const highlightMin = hoverTimestamp - window;
    const highlightMax = hoverTimestamp + window;
    const rangeKlines = klines.filter(k => k.time >= highlightMin && k.time <= highlightMax);
    const rangeHigh = rangeKlines.length > 0 ? Math.max(...rangeKlines.map(k => k.high)) : 0;
    if (rangeHigh === 0) {
      hlSeries.setData([]);
      return;
    }
    const highlightData = klines
      .filter(k => k.time >= highlightMin && k.time <= highlightMax)
      .map(k => ({
        time: k.time as Time,
        value: rangeHigh * 1.02,
        color: "#3b82f635",
      }));
    hlSeries.setData(highlightData);
  }, [hoverTimestamp]);

  // ── 点击事件联动 ──
  useEffect(() => {
    if (!activeTimestamp || !chartRef.current || !chartReady) return;
    if (skipNextZoomRef.current) {
      skipNextZoomRef.current = false;
      return;
    }
    // 检查 activeTimestamp 是否在 K线数据范围内
    const klines = klinesRef.current;
    if (klines.length) {
      const minTime = klines[0].time;
      const maxTime = klines[klines.length - 1].time;
      if (activeTimestamp < minTime - 86400 || activeTimestamp > maxTime + 86400) {
        console.log("[ChartWidget] activeTimestamp out of range, skipping zoom");
        return;
      }
    }
    try { chartRef.current.timeScale().setVisibleRange({ from: (activeTimestamp - 5 * 86400) as Time, to: (activeTimestamp + 5 * 86400) as Time }); }
    catch { chartRef.current.timeScale().scrollToRealTime(); }
  }, [activeTimestamp, chartReady]);

  // ── 策略重算与绘制 ──
  useEffect(() => {
    if (!klinesRef.current.length || !chartRef.current || !candleRef.current || !chartReady) return;
    const klines = klinesRef.current;
    const chart = chartRef.current;

    let cancelled = false;

    async function run() {
      // 1. 计算策略（Worker 优先）
      const newOutputs = await calculateStrategies(
        activeStrategies,
        klines,
        workerRef.current
      );
      if (cancelled) return;

      setStrategyOutputs(newOutputs);

      // 2. 策略预警触发（只关注最近信号）
      const latestKlineTime = klines.at(-1)?.time ?? 0;
      const recentWindow = latestKlineTime - (klines.length > 3 ? klines[klines.length - 3].time : latestKlineTime);
      for (const [id, output] of newOutputs) {
        const strategy = strategyRegistry.get(id);
        if (!strategy) continue;
        for (const signal of output.signals) {
          if (latestKlineTime - signal.time > Math.max(recentWindow, 86400)) continue;
          sendAlert(id, strategy.definition.name, signal, symbol);
          setAlertToasts(prev => {
            const toastId = `${id}-${signal.time}-${signal.direction}`;
            if (prev.some(t => t.id === toastId)) return prev;
            return [...prev.slice(-4), { id: toastId, strategyName: strategy.definition.name, signal, symbol }];
          });
        }
      }

      // 3. 清理旧策略线条
      for (const [lineId, series] of strategyLineRefs.current) {
        const strategyId = lineId.split('-')[0];
        if (!activeStrategies.some(s => s.id === strategyId)) {
          chart.removeSeries(series);
          strategyLineRefs.current.delete(lineId);
        }
      }

      // 4. 绘制策略线条
      for (const [id, output] of newOutputs) {
        for (const line of output.lines) {
          const lineId = `${id}-${line.id}`;
          let series = strategyLineRefs.current.get(lineId);
          if (!series) {
            series = chart.addSeries(LineSeries, {
              color: line.color,
              lineWidth: Math.min(4, Math.max(1, line.lineWidth)) as 1 | 2 | 3 | 4,
              lastValueVisible: false,
              title: line.name,
            });
            strategyLineRefs.current.set(lineId, series);
          }
          const cleanData = line.data
            .filter((d: any) => d.value !== null && !isNaN(d.value))
            .map((d: any) => ({ time: d.time as Time, value: d.value as number }));
          series.setData(cleanData);
        }
      }

      // 5. 绘制策略信号 markers
      const allSignals = Array.from(newOutputs.values()).flatMap((o: StrategyOutput) => o.signals);
      const signalMarkers = allSignals.map(s => ({
        time: s.time as Time,
        position: s.direction === "buy" ? "belowBar" : "aboveBar" as any,
        color: s.direction === "buy" ? "#22c55e" : "#ef4444",
        shape: s.direction === "buy" ? "arrowUp" : "arrowDown" as any,
        text: s.label.length > 10 ? s.label.slice(0, 8) + ".." : s.label,
        size: 1 + Math.round(s.strength * 2),
      }));
      signalMarkers.sort((a, b) => (a.time as number) - (b.time as number));
      if (signalMarkers.length > 0 && candleRef.current) {
        (candleRef.current as any).setMarkers?.(signalMarkers);
      }
    }

    run();
    return () => { cancelled = true; };
  }, [activeStrategies, chartReady]);

  // ── 初始化图表（只执行一次）──
  useEffect(() => {
    const container = containerRef.current;
    if (!container || chartRef.current) return;

    const t = THEME;
    const chart = createChart(container, {
      layout: { background: { color: t.bg }, textColor: t.text, attributionLogo: false },
      grid: { vertLines: { color: t.grid, style: 2 }, horzLines: { color: t.grid, style: 2 } },
      crosshair: { mode: 1, vertLine: { color: "#3b82f6", width: 1, style: 3, labelBackgroundColor: "#3b82f6" }, horzLine: { color: "#3b82f6", width: 1, style: 3, labelBackgroundColor: "#3b82f6" } },
      rightPriceScale: { borderColor: t.grid, scaleMargins: { top: 0.08, bottom: 0.1 } },
      timeScale: { borderColor: t.grid, timeVisible: false, barSpacing: 6 },
      autoSize: true,
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, { upColor: t.up, downColor: t.down, borderUpColor: t.up, borderDownColor: t.down, wickUpColor: t.up, wickDownColor: t.down });
    candleRef.current = candleSeries;

    const volumeSeries = chart.addSeries(HistogramSeries, { color: "#3b82f6", priceScaleId: "", priceFormat: { type: "volume" } });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    volumeRef.current = volumeSeries;

    const hlSeries = chart.addSeries(HistogramSeries, {
      color: "#3b82f640",
      priceScaleId: "right",
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
      lastValueVisible: false,
    });
    hlSeries.priceScale().applyOptions({ scaleMargins: { top: 0.02, bottom: 0.02 } });
    highlightRef.current = hlSeries;

    // ── Tooltip ──
    const tooltip = document.createElement("div");
    tooltip.style.cssText = `position:absolute;display:none;padding:10px;font-size:13px;font-family:'JetBrains Mono',monospace;color:#e2e8f0;background:#1a2236;border:1px solid #2d3a52;border-radius:6px;pointer-events:none;z-index:1000;box-shadow:0 4px 12px rgba(0,0,0,0.3);max-width:320px;`;
    container.appendChild(tooltip);

    chart.subscribeCrosshairMove(param => {
      if (!param.point || !param.time) { tooltip.style.display = "none"; return; }
      const dp = param.seriesData.get(candleSeries);
      if (!dp) { tooltip.style.display = "none"; return; }
      const c = dp as any;
      const d = new Date((param.time as number) * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const dayEvents: MacroEvent[] = ((container as any).__events || []).filter((e: MacroEvent) => Math.abs(e.timestamp - (param.time as number)) < 43200);
      const eh = dayEvents.length ? dayEvents.map((e: MacroEvent) => { const s = IMPACT_STYLE[e.impact_level]; return `<div style="color:${s.color};margin-top:3px;font-size:10px;">${e.title}${e.actual_value ? ` (${e.actual_value}${e.unit})` : ""}</div>`; }).join("") : "";
      const dayNews = MOCK_NEWS.filter(n => Math.abs(n.timestamp - (param.time as number)) < 86400);
      const nh = dayNews.length ? `<div style="margin-top:6px;border-top:1px solid #2d3a52;padding-top:4px;"><div style="font-size:9px;color:#8b5cf6;font-weight:700;margin-bottom:2px;">📰 NEWS</div>${dayNews.map(n => `<div style="color:${n.sentiment === 'bullish' ? '#22c55e' : n.sentiment === 'bearish' ? '#ef4444' : '#94a3b8'};font-size:10px;margin-top:2px;">${n.title}</div>`).join("")}</div>` : "";
      const activeSignals = Array.from(strategyOutputsRef.current?.values() || []).flatMap(o => o.signals).filter(s => Math.abs(s.time - (param.time as number)) < 86400);
      const sh = activeSignals.length ? `<div style="margin-top:6px;border-top:1px solid #2d3a52;padding-top:4px;"><div style="font-size:9px;color:#eab308;font-weight:700;margin-bottom:2px;">📈 STRATEGY</div>${activeSignals.map(s => `<div style="color:${s.direction === 'buy' ? '#22c55e' : '#ef4444'};font-size:10px;">${s.label} (${s.direction.toUpperCase()})</div>`).join("")}</div>` : "";
      tooltip.innerHTML = `<div style="font-weight:700;margin-bottom:3px;color:#3b82f6;">${d}</div><div>O: $${c.open?.toLocaleString()}</div><div>H: <span style="color:${t.up}">$${c.high?.toLocaleString()}</span></div><div>L: <span style="color:${t.down}">$${c.low?.toLocaleString()}</span></div><div>C: <span style="color:${(c.close >= c.open ? t.up : t.down)};font-weight:700">$${c.close?.toLocaleString()}</span></div>${eh}${nh}${sh}`;
      tooltip.style.display = "block";
      tooltip.style.left = Math.min(param.point.x + 12, container.clientWidth - 280) + "px";
      tooltip.style.top = Math.min(param.point.y + 12, container.clientHeight - 260) + "px";
    });

    chart.subscribeClick(param => {
      if (!param.time) return;
      const evts: MacroEvent[] = (container as any).__events || [];
      const clicked = evts.find(e => Math.abs(e.timestamp - (param.time as number)) < 86400);
      if (clicked) selectEvent(clicked.id, clicked.timestamp);
    });

    return () => {
      tooltip.remove();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      highlightRef.current = null;
      strategyLineRefs.current.clear();
    };
  }, []);

  // ── 数据加载与渲染（symbol/timeframe 变化时触发）──
  useEffect(() => {
    if (!chartRef.current || !candleRef.current || !volumeRef.current || !containerRef.current) return;

    const chart = chartRef.current;
    const candleSeries = candleRef.current;
    const volumeSeries = volumeRef.current;
    const container = containerRef.current;

    // 1. 清理旧策略线条
    for (const [, series] of strategyLineRefs.current) {
      try { chart.removeSeries(series); } catch {}
    }
    strategyLineRefs.current.clear();
    setStrategyOutputs(new Map());

    // 2. 显示骨架屏
    setLoading(true);
    setChartReady(false);

    // 3. 更新时间轴配置
    const isIntraday = ["1m", "3m", "5m", "15m", "1H"].includes(timeframe);
    chart.timeScale().applyOptions({
      timeVisible: isIntraday,
      barSpacing: timeframe === "1D" ? 12 : timeframe === "4H" ? 8 : 6,
    });

    // 4. 并行加载 K线 + 因子
    console.log(`[ChartWidget] Loading ${symbol} ${timeframe}`);
    const start = performance.now();
    const abortCtrl = new AbortController();

    Promise.all([
      fetchKlines(symbol as any, timeframe, undefined, abortCtrl.signal),
      loadFactorData(),
    ]).then(([klines, factors]) => {
      const elapsed = (performance.now() - start).toFixed(0);
      console.log(`[ChartWidget] Loaded ${klines.length} klines + ${factors.length} factors in ${elapsed}ms`);

      (container as any).__klines = klines;
      (container as any).__events = factors;

      if (!klines.length) {
        setError("No data available.");
        setLoading(false);
        return;
      }
      setError(null);

      const t = THEME;
      const candleData = klines.map(k => ({ time: k.time as Time, open: k.open, high: k.high, low: k.low, close: k.close }));
      const volumeData = klines.map(k => ({ time: k.time as Time, value: k.volume, color: k.close >= k.open ? `${t.up}30` : `${t.down}30` }));

      candleSeries.setData(candleData);
      volumeSeries.setData(volumeData);
      candleSeries.applyOptions({});
      chart.priceScale("right").applyOptions({ autoScale: true });

      const histFactors = factors.filter((f: MacroEvent) => !f.is_forecast);
      const markers = buildMarkers(histFactors, klines, [], []);
      if (markers.length) (candleSeries as any).setMarkers?.(markers);

      setEvents(factors);
      klinesRef.current = klines;

      requestAnimationFrame(() => {
        chart.timeScale().fitContent();
        skipNextZoomRef.current = true;
      });
      setChartReady(true);
      setLoading(false);
    }).catch(err => {
      console.error("[Chart] Load failed:", err);
      setError("Failed to load data: " + (err.message || ""));
      setLoading(false);
    });

    // cleanup: 只清理策略线条，不销毁 chart，取消飞行中请求
    return () => {
      abortCtrl.abort();
      for (const [, series] of strategyLineRefs.current) {
        try { chart.removeSeries(series); } catch {}
      }
      strategyLineRefs.current.clear();
      setChartReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe]);

  // 用ref保存strategyOutputs供tooltip使用
  const strategyOutputsRef = useRef(strategyOutputs);
  strategyOutputsRef.current = strategyOutputs;

  // ── 实时更新定时器 ──
  // 使用实时价格更新最后一根 K线的 close，而非请求历史 API（有延迟）
  useEffect(() => {
    const interval = setInterval(async () => {
      if (!candleRef.current || !volumeRef.current) return;
      try {
        const priceData = await fetchRealtimePrice(symbol);
        const lastKline = klinesRef.current.at(-1);
        if (!lastKline) return;

        const intervalSec = getTimeframeIntervalSeconds(timeframe);
        const nowSec = Math.floor(Date.now() / 1000);
        const currentBarTime = Math.floor(nowSec / intervalSec) * intervalSec;

        if (currentBarTime > lastKline.time) {
          // 新 bar 开始：以当前价格作为 open/high/low/close，volume 为 0
          const newBar = {
            time: currentBarTime,
            open: priceData.price,
            high: priceData.price,
            low: priceData.price,
            close: priceData.price,
            volume: 0,
          };
          candleRef.current.update({ time: newBar.time as Time, open: newBar.open, high: newBar.high, low: newBar.low, close: newBar.close });
          volumeRef.current.update({ time: newBar.time as Time, value: 0, color: `${THEME.up}30` });
          klinesRef.current.push(newBar);
        } else {
          // 更新当前 bar 的 close、high、low
          const updated = { ...lastKline };
          updated.close = priceData.price;
          updated.high = Math.max(updated.high, priceData.price);
          updated.low = Math.min(updated.low, priceData.price);
          // volume 无法从实时价格获取，保持原值或轻微递增
          updated.volume = lastKline.volume;
          candleRef.current.update({ time: updated.time as Time, open: updated.open, high: updated.high, low: updated.low, close: updated.close });
          volumeRef.current.update({ time: updated.time as Time, value: updated.volume, color: updated.close >= updated.open ? `${THEME.up}30` : `${THEME.down}30` });
          klinesRef.current[klinesRef.current.length - 1] = updated;
        }
      } catch (e) {}
    }, 30000);

    return () => clearInterval(interval);
  }, [symbol, timeframe]);

  return (
    <div ref={containerRef} className="w-full h-full min-h-[200px] lg:min-h-[400px] relative" style={{ background: THEME.bg }}>
      {/* 骨架屏 Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-10 flex flex-col gap-2 p-4 pointer-events-none">
          <div className="h-5 w-32 bg-[#1e293b] rounded animate-pulse" />
          <div className="flex-1 flex gap-2">
            <div className="flex-1 bg-[#1e293b80] rounded animate-pulse" />
            <div className="w-14 bg-[#1e293b80] rounded animate-pulse" />
          </div>
          <div className="h-4 w-full bg-[#1e293b] rounded animate-pulse" />
        </div>
      )}
      {/* 策略控制面板 */}
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
              <div className="text-[11px] font-bold text-[#e2e8f0] tracking-wider">STRATEGIES</div>
              <button
                onClick={() => setShowAlertSettings(!showAlertSettings)}
                className={`text-[10px] px-2 py-0.5 rounded border ${showAlertSettings ? 'bg-[#3b82f620] border-[#3b82f6] text-[#3b82f6]' : 'border-[#1e293b] text-[#475569] hover:text-[#e2e8f0]'} transition-colors`}
              >
                🔔 {getTodayAlertCount()}
              </button>
            </div>

            {/* 面板主标签切换 */}
            <div className="flex gap-1 mb-2">
              <button
                onClick={() => setPanelTab("list")}
                className={`flex-1 text-[10px] py-1 rounded ${panelTab === "list" ? "bg-[#3b82f620] text-[#3b82f6]" : "text-[#475569] hover:text-[#94a3b8]"}`}
              >
                策略列表
              </button>
              <button
                onClick={() => setPanelTab("consensus")}
                className={`flex-1 text-[10px] py-1 rounded ${panelTab === "consensus" ? "bg-[#8b5cf620] text-[#8b5cf6]" : "text-[#475569] hover:text-[#94a3b8]"}`}
              >
                ⚡ 共识
              </button>
              <button
                onClick={() => setPanelTab("pine")}
                className={`flex-1 text-[10px] py-1 rounded ${panelTab === "pine" ? "bg-[#10b98120] text-[#10b981]" : "text-[#475569] hover:text-[#94a3b8]"}`}
              >
                🌲 Pine
              </button>
            </div>

            {/* 预警设置面板 */}
            {showAlertSettings && (
              <div className="mb-2 p-2 rounded bg-[#111827] border border-[#1e293b]/50 space-y-1.5">
                <div className="text-[10px] font-bold text-[#94a3b8] mb-1">预警设置</div>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-[10px] text-[#94a3b8]">启用预警</span>
                  <input
                    type="checkbox"
                    checked={alertConfig.enabled}
                    onChange={e => {
                      const next = { ...alertConfig, enabled: e.target.checked };
                      setAlertConfig(next);
                      saveAlertConfig(next);
                    }}
                    className="accent-[#3b82f6] w-3 h-3"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-[10px] text-[#94a3b8]">桌面通知</span>
                  <div className="flex items-center gap-1">
                    {getNotificationPermission() === "default" && (
                      <button
                        onClick={() => requestNotificationPermission()}
                        className="text-[9px] px-1.5 py-0.5 rounded bg-[#3b82f620] text-[#3b82f6]"
                      >
                        授权
                      </button>
                    )}
                    <input
                      type="checkbox"
                      checked={alertConfig.browserNotify}
                      disabled={getNotificationPermission() !== "granted"}
                      onChange={e => {
                        const next = { ...alertConfig, browserNotify: e.target.checked };
                        setAlertConfig(next);
                        saveAlertConfig(next);
                      }}
                      className="accent-[#3b82f6] w-3 h-3"
                    />
                  </div>
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-[10px] text-[#94a3b8]">声音提醒</span>
                  <input
                    type="checkbox"
                    checked={alertConfig.soundAlert}
                    onChange={e => {
                      const next = { ...alertConfig, soundAlert: e.target.checked };
                      setAlertConfig(next);
                      saveAlertConfig(next);
                    }}
                    className="accent-[#3b82f6] w-3 h-3"
                  />
                </label>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-[#94a3b8]">最小强度</span>
                  <div className="flex items-center gap-1 flex-1 ml-2">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.1}
                      value={alertConfig.minStrength}
                      onChange={e => {
                        const next = { ...alertConfig, minStrength: parseFloat(e.target.value) };
                        setAlertConfig(next);
                        saveAlertConfig(next);
                      }}
                      className="flex-1 h-1 accent-[#3b82f6]"
                    />
                    <span className="text-[9px] font-mono text-[#e2e8f0] w-5">{alertConfig.minStrength}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-[#94a3b8]">冷却(秒)</span>
                  <div className="flex items-center gap-1 flex-1 ml-2">
                    <input
                      type="range"
                      min={0}
                      max={1800}
                      step={60}
                      value={alertConfig.cooldownSeconds}
                      onChange={e => {
                        const next = { ...alertConfig, cooldownSeconds: parseInt(e.target.value) };
                        setAlertConfig(next);
                        saveAlertConfig(next);
                      }}
                      className="flex-1 h-1 accent-[#3b82f6]"
                    />
                    <span className="text-[9px] font-mono text-[#e2e8f0] w-8">{alertConfig.cooldownSeconds}s</span>
                  </div>
                </div>
                <button
                  onClick={() => clearAlertHistory()}
                  className="w-full text-[9px] py-0.5 rounded border border-[#47556930] text-[#475569] hover:text-[#e2e8f0] hover:border-[#475569] transition-colors"
                >
                  清除通知历史
                </button>
              </div>
            )}

            {panelTab === "consensus" ? (
              <Suspense fallback={<div className="text-[10px] text-[#475569] py-4 text-center">Loading...</div>}>
                <StrategyConsensusPanel strategyOutputs={strategyOutputs} />
              </Suspense>
            ) : panelTab === "pine" ? (
              <Suspense fallback={<div className="text-[10px] text-[#475569] py-4 text-center">Loading...</div>}>
                <PineTranspilerPanel />
              </Suspense>
            ) : (
              <>
            {/* 添加策略 */}
            <div className="mb-2">
              <select
                className="w-full bg-[#111827] border border-[#1e293b] rounded px-2 py-1.5 text-[11px] text-[#e2e8f0] outline-none"
                onChange={e => {
                  const def = strategyRegistry.get(e.target.value);
                  if (def) addStrategy(def.definition);
                  e.target.value = "";
                }}
                value=""
              >
                <option value="">+ 添加策略...</option>
                {allStrategies.map(def => (
                  <option key={def.id} value={def.id}>{def.name}</option>
                ))}
              </select>
            </div>
            {/* 活跃策略列表 */}
            {activeStrategies.map(as => {
              const def = strategyRegistry.get(as.id);
              if (!def) return null;
              const output = strategyOutputs.get(as.id);
              return (
                <div key={as.id} className="mb-2 p-2 rounded bg-[#111827] border border-[#1e293b]/50">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-bold text-[#e2e8f0]">{def.definition.name}</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => resetStrategyParams(as.id)}
                        className="text-[10px] text-[#475569] hover:text-[#3b82f6]"
                        title="重置参数"
                      >
                        ↺
                      </button>
                      <button onClick={() => removeStrategy(as.id)} className="text-[10px] text-[#475569] hover:text-[#ef4444]">✕</button>
                    </div>
                  </div>
                  {output && (
                    <div className="text-[9px] text-[#475569] mb-1">
                      {output.signals.length} signals | {output.lines.length} lines
                    </div>
                  )}
                  {/* 参数 / 回测 标签切换 */}
                  <div className="flex gap-1 mb-1.5">
                    <button
                      onClick={() => setStrategyTabs(prev => ({ ...prev, [as.id]: "params" }))}
                      className={`text-[9px] px-2 py-0.5 rounded ${strategyTabs[as.id] !== "backtest" ? "bg-[#3b82f620] text-[#3b82f6]" : "text-[#475569] hover:text-[#94a3b8]"}`}
                    >
                      参数
                    </button>
                    <button
                      onClick={() => setStrategyTabs(prev => ({ ...prev, [as.id]: "backtest" }))}
                      className={`text-[9px] px-2 py-0.5 rounded ${strategyTabs[as.id] === "backtest" ? "bg-[#eab30820] text-[#eab308]" : "text-[#475569] hover:text-[#94a3b8]"}`}
                    >
                      📊 回测
                    </button>
                  </div>

                  {strategyTabs[as.id] === "backtest" ? (
                    <BacktestPanel
                      strategyName={def.definition.name}
                      signals={output?.signals ?? []}
                      klines={klinesRef.current}
                    />
                  ) : (
                    <div className="space-y-1.5">
                      {def.definition.parameters.map(param => (
                        <div key={param.id} className="flex items-center gap-1.5">
                          <span className="text-[10px] text-[#94a3b8] w-20 truncate">{param.name}</span>
                          {param.type === "bool" ? (
                            <button
                              onClick={() => updateStrategyParam(as.id, param.id, !as.params[param.id])}
                              className={`text-[9px] px-2 py-0.5 rounded font-bold ${as.params[param.id] ? "bg-[#22c55e20] text-[#22c55e]" : "bg-[#1e293b] text-[#475569]"}`}
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
                                value={as.params[param.id]}
                                onChange={e => updateStrategyParam(as.id, param.id, param.type === "int" ? parseInt(e.target.value) : parseFloat(e.target.value))}
                                className="flex-1 h-1.5 accent-[#3b82f6]"
                              />
                              <span className="text-[9px] font-mono text-[#e2e8f0] w-6">{as.params[param.id]}</span>
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
                onClick={() => {
                  setActiveStrategies([]);
                  setStrategyOutputs(new Map());
                  for (const [, series] of strategyLineRefs.current) {
                    if (chartRef.current) chartRef.current.removeSeries(series);
                  }
                  strategyLineRefs.current.clear();
                }}
                className="w-full text-[10px] py-1.5 rounded border border-[#ef444430] text-[#ef4444] hover:bg-[#ef444410] transition-colors"
              >
                清空所有策略
              </button>
            )}
            {activeStrategies.length === 0 && (
              <div className="text-[10px] text-[#475569] text-center py-2">暂无策略，从上方选择添加</div>
            )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Alert Toast 弹窗 */}
      <div className="absolute top-2 right-2 z-30 flex flex-col gap-1.5 pointer-events-none">
        {alertToasts.map(toast => {
          const isBuy = toast.signal.direction === "buy";
          const isSell = toast.signal.direction === "sell";
          const bg = isBuy ? "bg-[#22c55e15] border-[#22c55e40]" : isSell ? "bg-[#ef444415] border-[#ef444440]" : "bg-[#64748b15] border-[#64748b40]";
          const text = isBuy ? "text-[#22c55e]" : isSell ? "text-[#ef4444]" : "text-[#94a3b8]";
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto w-[200px] p-2 rounded-lg border ${bg} backdrop-blur-sm shadow-lg animate-in fade-in slide-in-from-right-2 duration-300`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className={`text-[9px] font-bold ${text}`}>
                  {isBuy ? "🟢 买入" : isSell ? "🔴 卖出" : "⚪ 中性"}
                </span>
                <button
                  onClick={() => setAlertToasts(prev => prev.filter(t => t.id !== toast.id))}
                  className="text-[8px] text-[#475569] hover:text-[#e2e8f0]"
                >
                  ✕
                </button>
              </div>
              <div className="text-[8px] text-[#e2e8f0] font-bold truncate">{toast.strategyName}</div>
              <div className="text-[8px] text-[#94a3b8] truncate">{toast.signal.label}</div>
              <div className="text-[9px] font-mono text-[#e2e8f0] mt-0.5">
                ${toast.signal.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                <span className="text-[7px] text-[#475569] ml-1">{toast.symbol}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Toast 自动消失 */}
      {alertToasts.length > 0 && (
        <AutoDismissToasts toasts={alertToasts} onDismiss={setAlertToasts} />
      )}
    </div>
  );
}

// ── 策略计算辅助：Worker 优先，主线程兜底 ──
async function calculateStrategies(
  activeStrategies: { id: string; params: Record<string, any> }[],
  klines: KlineData[],
  worker: Worker | null
): Promise<Map<string, StrategyOutput>> {
  const outputs = new Map<string, StrategyOutput>();

  if (worker) {
    // Worker 异步批量计算（1s 超时，快速降级）
    const promises = activeStrategies.map(as =>
      new Promise<{ id: string; output: StrategyOutput | null; error?: string }>((resolve) => {
        const reqId = `${as.id}-${Date.now()}-${Math.random()}`;
        const handler = (e: MessageEvent) => {
          const data = e.data as { id: string; strategyId: string; output: StrategyOutput | null; error?: string };
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
        }, 1500);
      })
    );
    const results = await Promise.all(promises);
    for (const r of results) {
      if (r.output) outputs.set(r.id, r.output);
    }
    // Worker 未全部成功 → 主线程兜底计算剩余策略
    const failedIds = new Set(activeStrategies.map(s => s.id).filter(id => !outputs.has(id)));
    if (failedIds.size > 0) {
      console.warn(`[Strategy] Worker missed ${failedIds.size} strategies, falling back to main thread`);
      for (const as of activeStrategies) {
        if (!failedIds.has(as.id)) continue;
        const strategy = strategyRegistry.get(as.id);
        if (!strategy) continue;
        try {
          const output = strategy.calculate({ klines, params: as.params });
          outputs.set(as.id, output);
        } catch (err) {
          console.warn(`[Strategy] ${as.id} main-thread calc failed:`, err);
        }
      }
    }
  } else {
    // 主线程同步计算
    for (const as of activeStrategies) {
      const strategy = strategyRegistry.get(as.id);
      if (!strategy) continue;
      try {
        const output = strategy.calculate({ klines, params: as.params });
        outputs.set(as.id, output);
      } catch (err) {
        console.warn(`[Strategy] ${as.id} calculation failed:`, err);
      }
    }
  }

  return outputs;
}

// Toast 自动消失组件
function AutoDismissToasts<T extends { id: string }>({
  toasts,
  onDismiss,
}: {
  toasts: T[];
  onDismiss: React.Dispatch<React.SetStateAction<T[]>>;
}) {
  useEffect(() => {
    const timers = toasts.map(t =>
      setTimeout(() => {
        onDismiss(prev => prev.filter(p => p.id !== t.id));
      }, 5000)
    );
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toasts.map(t => t.id).join(","), onDismiss]);
  return null;
}


