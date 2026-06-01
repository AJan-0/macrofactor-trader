import { useEffect, useRef, forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { useTouchGestures } from "@/hooks/useTouchGestures";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { useAppStore, type MacroEvent } from "@/store/appStore";
import type { StrategyOutput } from "@/services/strategyEngine";
import MobileChartControls from "./MobileChartControls";

const THEME = {
  bg: "#111827",
  text: "#94a3b8",
  grid: "#1e293b",
  up: "#22c55e",
  down: "#ef4444",
};

const IMPACT_STYLE: Record<
  string,
  {
    color: string;
    position: "aboveBar" | "belowBar" | "inBar";
    shape: string;
    size: number;
  }
> = {
  high: { color: "#ef4444", position: "aboveBar", shape: "arrowDown", size: 2 },
  medium: { color: "#eab308", position: "belowBar", shape: "circle", size: 1 },
  low: { color: "#3b82f6", position: "inBar", shape: "square", size: 1 },
};

export interface KlineData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ChartCanvasRef {
  chart: IChartApi | null;
  candleSeries: ISeriesApi<"Candlestick"> | null;
  volumeSeries: ISeriesApi<"Histogram"> | null;
  highlightSeries: ISeriesApi<"Histogram"> | null;
  container: HTMLDivElement | null;
}

interface ChartCanvasProps {
  klines: KlineData[];
  events: MacroEvent[];
  strategyOutputs: Map<string, StrategyOutput>;
  onEventClick: (eventId: string, timestamp: number) => void;
  timeframe: string;
  dataVersion: number;
}

const ChartCanvas = forwardRef<ChartCanvasRef, ChartCanvasProps>(function ChartCanvas({
  klines,
  events,
  strategyOutputs,
  onEventClick,
  timeframe,
  dataVersion,
}, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const highlightRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const onEventClickRef = useRef(onEventClick);
  const strategyOutputsRef = useRef(strategyOutputs);
  const eventsRef = useRef(events);
  const klinesRef = useRef(klines);
  const prevTimeframeRef = useRef(timeframe);

  // Keep refs in sync
  useEffect(() => {
    strategyOutputsRef.current = strategyOutputs;
    eventsRef.current = events;
    klinesRef.current = klines;
    onEventClickRef.current = onEventClick;
  }, [strategyOutputs, events, klines, onEventClick]);

  // Initialize chart (runs once)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || chartRef.current) return;

    const t = THEME;
    const chart = createChart(container, {
      layout: {
        background: { color: t.bg },
        textColor: t.text,
      },
      grid: {
        vertLines: { color: t.grid },
        horzLines: { color: t.grid },
      },
      crosshair: { mode: 1 },
      rightPriceScale: {
        borderColor: t.grid,
      },
      timeScale: {
        borderColor: t.grid,
        timeVisible: false,
        barSpacing: 12,
      },
      autoSize: true,
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: t.up,
      downColor: t.down,
      borderUpColor: t.up,
      borderDownColor: t.down,
      wickUpColor: t.up,
      wickDownColor: t.down,
    });
    candleRef.current = candleSeries;

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeRef.current = volumeSeries;

    const highlightSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    highlightSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    highlightRef.current = highlightSeries;

    // Tooltip
    const tooltip = document.createElement("div");
    tooltip.style.cssText =
      "position:absolute;display:none;z-index:100;background:#1a2236;border:1px solid #2d3a52;border-radius:6px;padding:8px 12px;font-size:11px;color:#e2e8f0;pointer-events:none;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.5);";
    container.appendChild(tooltip);
    tooltipRef.current = tooltip;

    chart.subscribeCrosshairMove((param) => {
      if (!param.point || !param.time || param.point.x < 0 || param.point.y < 0) {
        tooltip.style.display = "none";
        return;
      }
      const data = param.seriesData.get(candleSeries) as {
        open: number; high: number; low: number; close: number;
      } | undefined;
      if (!data) {
        tooltip.style.display = "none";
        return;
      }
      tooltip.innerHTML = `
        <div style="font-weight:bold;margin-bottom:4px;">${new Date(
          (param.time as number) * 1000
        ).toLocaleString()}</div>
        <div>O: ${data.open.toFixed(2)} H: ${data.high.toFixed(2)}</div>
        <div>L: ${data.low.toFixed(2)} C: ${data.close.toFixed(2)}</div>
      `;
      tooltip.style.display = "block";
      tooltip.style.left =
        Math.min(param.point.x + 12, container.clientWidth - 280) + "px";
      tooltip.style.top =
        Math.min(param.point.y + 12, container.clientHeight - 260) + "px";
    });

    chart.subscribeClick((param) => {
      if (!param.time) return;
      const evts = eventsRef.current || [];
      const clicked = evts.find(
        (e) => Math.abs(e.timestamp - (param.time as number)) < 86400
      );
      if (clicked) onEventClickRef.current(clicked.id, clicked.timestamp);
    });

    // chart initialized once; onEventClick consumed via ref for stable handler identity
    return () => {
      tooltip.remove();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      highlightRef.current = null;
      tooltipRef.current = null;
    };
  }, []);

  // Expose chart API via ref to parent
  // Use getters so the ref dynamically reads current values
  // (chartRef etc. are set in useEffect after mount, so static values would be null)
  useImperativeHandle(ref, () => ({
    get chart() { return chartRef.current; },
    get candleSeries() { return candleRef.current; },
    get volumeSeries() { return volumeRef.current; },
    get highlightSeries() { return highlightRef.current; },
    get container() { return containerRef.current; },
  }), []);

  // Memoized data transformations
  const candleData = useMemo(() => klines.map((k) => ({
    time: k.time as Time,
    open: k.open,
    high: k.high,
    low: k.low,
    close: k.close,
  })), [klines, dataVersion]);

  const volumeData = useMemo(() => {
    const t = THEME;
    return klines.map((k) => ({
      time: k.time as Time,
      value: k.volume,
      color: k.close >= k.open ? `${t.up}30` : `${t.down}30`,
    }));
  }, [klines, dataVersion]);

  const markers = useMemo(() => {
    const histFactors = events.filter((f) => !f.is_forecast);
    return buildMarkers(histFactors, klines, [], []);
  }, [events, klines, dataVersion]);

  // Update data when klines/events change
  // 使用 ref 防止无限循环
  const isUpdatingRef = useRef(false);
  useEffect(() => {
    if (!chartRef.current || !candleRef.current || !volumeRef.current) return;
    if (isUpdatingRef.current) return;
    
    isUpdatingRef.current = true;
    
    candleRef.current.setData(candleData);
    volumeRef.current.setData(volumeData);
    chartRef.current.priceScale("right").applyOptions({ autoScale: true });

    // 始终设置markers，空数组时清除旧标记
    // lightweight-charts v4.2 type defs omit setMarkers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (candleRef.current as any).setMarkers?.(markers || []);

    // Update timeframe settings
    const isIntraday = ["1m", "3m", "5m", "15m", "1H"].includes(timeframe);
    chartRef.current.timeScale().applyOptions({
      timeVisible: isIntraday,
      barSpacing: timeframe === "1D" ? 12 : timeframe === "4H" ? 8 : 6,
    });

    // 只在首次加载或timeframe切换时fitContent，避免实时更新重置用户缩放
    if (prevTimeframeRef.current !== timeframe) {
      prevTimeframeRef.current = timeframe;
      requestAnimationFrame(() => {
        chartRef.current?.timeScale().fitContent();
        isUpdatingRef.current = false;
      });
    } else {
      isUpdatingRef.current = false;
    }
  }, [candleData, volumeData, markers, timeframe, dataVersion]);

  // 移动端触摸手势支持 - TradingView 风格
  const [longPressInfo, setLongPressInfo] = useState<{ time: number; price: number } | null>(null);
  
  // 使用 state 存储 chart 和 container 引用，确保手势 hook 能正确初始化
  const [chartInstance, setChartInstance] = useState<IChartApi | null>(null);
  const [containerInstance, setContainerInstance] = useState<HTMLDivElement | null>(null);
  
  // 当 chart 初始化完成后更新 state，依赖 dataVersion 确保数据加载后也能绑定
  useEffect(() => {
    if (chartRef.current && containerRef.current) {
      setChartInstance(chartRef.current);
      setContainerInstance(containerRef.current);
    }
  }, [dataVersion]);
  
  useTouchGestures({
    chart: chartInstance,
    container: containerInstance,
    enabled: true,
    onLongPress: (time, price) => {
      setLongPressInfo({ time, price });
      setTimeout(() => setLongPressInfo(null), 3000);
    },
    onDoubleTap: () => {
      chartRef.current?.timeScale().fitContent();
    },
  });

  // 长按信息浮层
  const longPressOverlay = longPressInfo && (
    <div 
      className="absolute z-50 pointer-events-none bg-[#1a2236] border border-[#2d3a52] rounded-lg px-3 py-2 shadow-xl left-1/2 top-1/5 -translate-x-1/2"
    >
      <div className="text-[11px] text-[#94a3b8]">
        {new Date(longPressInfo.time * 1000).toLocaleString()}
      </div>
    </div>
  );

  const hoverTimestamp = useAppStore((s) => s.hoverTimestamp);
  useEffect(() => {
    if (!chartRef.current || !highlightRef.current || !klines.length) return;
    const hlSeries = highlightRef.current;
    if (!hoverTimestamp) {
      hlSeries.setData([]);
      return;
    }
    // 高亮对应时间戳的K线
    const highlightData = klines.map((k) => ({
      time: k.time as Time,
      value: k.time === hoverTimestamp ? k.volume * 2 : 0,
      color: k.time === hoverTimestamp ? "#3b82f680" : "#00000000",
    }));
    hlSeries.setData(highlightData);
  }, [hoverTimestamp, klines]);

  // Strategy overlay rendering
  useEffect(() => {
    if (!chartRef.current || !candleRef.current) return;
    
    // 为每个策略输出添加标记
    strategyOutputs.forEach((output, strategyId) => {
      if (!output.signals || output.signals.length === 0) return;
      
      const signalMarkers = output.signals.map((signal) => ({
        time: signal.time as Time,
        position: signal.direction === 'buy' ? 'belowBar' : 'aboveBar' as const,
        color: signal.direction === 'buy' ? '#22c55e' : '#ef4444',
        shape: signal.direction === 'buy' ? 'arrowUp' : 'arrowDown' as const,
        text: `${strategyId}: ${signal.direction.toUpperCase()}`,
        size: 1,
      }));
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (candleRef.current as any).setMarkers?.(signalMarkers);
    });
  }, [strategyOutputs]);

  return (
    <div className="w-full h-full relative">
      <div ref={containerRef} className="w-full h-full" />
      {longPressOverlay}
      <MobileChartControls
        onZoomIn={() => {}}
        onZoomOut={() => {}}
        onReset={() => chartRef.current?.timeScale().fitContent()}
        onToggleCrosshair={() => {}}
        isCrosshairEnabled={false}
        timeframe={timeframe}
      />
    </div>
  );
});

// Helper: build markers from events
function buildMarkers(
  events: MacroEvent[],
  klines: KlineData[],
  _futureEvents: MacroEvent[],
  _upcomingFactors: MacroEvent[]
) {
  if (!klines.length) return [];
  const minTime = klines[0].time;
  const maxTime = klines[klines.length - 1].time;
  return events
    .filter((e) => e.timestamp >= minTime && e.timestamp <= maxTime)
    .map((e) => {
      const style = IMPACT_STYLE[e.impact_level] || IMPACT_STYLE.low;
      return {
        time: e.timestamp as Time,
        position: style.position,
        color: style.color,
        shape: style.shape,
        text: e.title.slice(0, 20),
        size: style.size,
      };
    });
}

export default ChartCanvas;
