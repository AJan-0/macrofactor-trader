import { useEffect, useRef, forwardRef, useImperativeHandle, useMemo } from "react";
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [klines, dataVersion]);

  const volumeData = useMemo(() => {
    const t = THEME;
    return klines.map((k) => ({
      time: k.time as Time,
      value: k.volume,
      color: k.close >= k.open ? `${t.up}30` : `${t.down}30`,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [klines, dataVersion]);

  const markers = useMemo(() => {
    const histFactors = events.filter((f) => !f.is_forecast);
    return buildMarkers(histFactors, klines, [], []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, klines, dataVersion]);

  // Update data when klines/events change
  useEffect(() => {
    if (!chartRef.current || !candleRef.current || !volumeRef.current) return;

    candleRef.current.setData(candleData);
    volumeRef.current.setData(volumeData);
    chartRef.current.priceScale("right").applyOptions({ autoScale: true });

    if (markers.length) {
      // lightweight-charts v4.2 type defs omit setMarkers
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (candleRef.current as any).setMarkers?.(markers);
    }

    // Update timeframe settings
    const isIntraday = ["1m", "3m", "5m", "15m", "1H"].includes(timeframe);
    chartRef.current.timeScale().applyOptions({
      timeVisible: isIntraday,
      barSpacing: timeframe === "1D" ? 12 : timeframe === "4H" ? 8 : 6,
    });

    requestAnimationFrame(() => {
      chartRef.current?.timeScale().fitContent();
    });
  }, [candleData, volumeData, markers, timeframe]);

  // Update highlight on hover
  // 移动端触摸手势支持
  useTouchGestures({ chart: chartRef.current, container: containerRef.current });

  const hoverTimestamp = useAppStore((s) => s.hoverTimestamp);
  useEffect(() => {
    if (!chartRef.current || !highlightRef.current || !klines.length) return;
    const hlSeries = highlightRef.current;
    if (!hoverTimestamp) {
      hlSeries.setData([]);
      return;
    }
    const minKlineTime = Math.min(...klines.map((k) => k.time));
    const maxKlineTime = Math.max(...klines.map((k) => k.time));
    const window = 5 * 86400;
    if (
      hoverTimestamp < minKlineTime - window ||
      hoverTimestamp > maxKlineTime + window
    ) {
      hlSeries.setData([]);
      return;
    }
    const highlightMin = hoverTimestamp - window;
    const highlightMax = hoverTimestamp + window;
    const rangeKlines = klines.filter(
      (k) => k.time >= highlightMin && k.time <= highlightMax
    );
    const rangeHigh =
      rangeKlines.length > 0
        ? Math.max(...rangeKlines.map((k) => k.high))
        : 0;
    if (rangeHigh === 0) {
      hlSeries.setData([]);
      return;
    }
    const highlightData = klines
      .filter((k) => k.time >= highlightMin && k.time <= highlightMax)
      .map((k) => ({
        time: k.time as Time,
        value: rangeHigh * 1.02,
        color: "#3b82f635",
      }));
    hlSeries.setData(highlightData);
  }, [hoverTimestamp, klines]);

  // Zoom to active timestamp
  const activeTimestamp = useAppStore((s) => s.activeTimestamp);
  const skipNextZoomRef = useRef(false);
  useEffect(() => {
    if (!activeTimestamp || !chartRef.current) return;
    if (skipNextZoomRef.current) {
      skipNextZoomRef.current = false;
      return;
    }
    if (klines.length) {
      const minTime = klines[0].time;
      const maxTime = klines[klines.length - 1].time;
      if (
        activeTimestamp < minTime - 86400 ||
        activeTimestamp > maxTime + 86400
      ) {
        return;
      }
    }
    try {
      chartRef.current.timeScale().setVisibleRange({
        from: (activeTimestamp - 5 * 86400) as Time,
        to: (activeTimestamp + 5 * 86400) as Time,
      });
    } catch {
      chartRef.current.timeScale().scrollToRealTime();
    }
  }, [activeTimestamp, klines]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full min-h-[200px] lg:min-h-[400px] relative"
      style={{ background: THEME.bg }}
    />
  );
});

export default ChartCanvas;

// Helper: build markers from events
function buildMarkers(
  events: MacroEvent[],
  klines: KlineData[],
  cats: string[],
  imps: string[]
) {
  if (!klines.length || !events.length) return [];
  const minTime = Math.min(...klines.map((k) => k.time));
  const maxTime = Math.max(...klines.map((k) => k.time));
  const m = events
    .filter(
      (e) =>
        e.timestamp >= minTime &&
        e.timestamp <= maxTime &&
        (!cats.length || cats.includes(e.category)) &&
        (!imps.length || imps.includes(e.impact_level))
    )
    .map((e) => {
      const s = IMPACT_STYLE[e.impact_level] || IMPACT_STYLE.low;
      return {
        time: e.timestamp as Time,
        position: s.position,
        color: s.color,
        shape: s.shape as "arrowDown" | "arrowUp" | "circle" | "square",
        text: e.title.length > 22 ? e.title.slice(0, 20) + ".." : e.title,
        size: s.size,
      };
    });
  m.sort((a, b) => (a.time as number) - (b.time as number));
  return m;
}
