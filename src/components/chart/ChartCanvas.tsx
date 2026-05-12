/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { useAppStore, type MacroEvent } from "@/store/appStore";
import { MOCK_NEWS } from "@/data/mockNews";
import type { StrategyOutput, StrategySignal } from "@/services/strategyEngine";

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
}

const ChartCanvas = forwardRef<ChartCanvasRef, ChartCanvasProps>(function ChartCanvas({
  klines,
  events,
  strategyOutputs,
  onEventClick,
  timeframe,
}, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const highlightRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const strategyOutputsRef = useRef(strategyOutputs);
  const eventsRef = useRef(events);
  const klinesRef = useRef(klines);

  // Keep refs in sync
  useEffect(() => {
    strategyOutputsRef.current = strategyOutputs;
    eventsRef.current = events;
    klinesRef.current = klines;
  }, [strategyOutputs, events, klines]);

  // Initialize chart (runs once)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || chartRef.current) return;

    const t = THEME;
    const chart = createChart(container, {
      layout: {
        background: { color: t.bg },
        textColor: t.text,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: t.grid, style: 2 },
        horzLines: { color: t.grid, style: 2 },
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: "#3b82f6",
          width: 1,
          style: 3,
          labelBackgroundColor: "#3b82f6",
        },
        horzLine: {
          color: "#3b82f6",
          width: 1,
          style: 3,
          labelBackgroundColor: "#3b82f6",
        },
      },
      rightPriceScale: {
        borderColor: t.grid,
        scaleMargins: { top: 0.08, bottom: 0.1 },
      },
      timeScale: {
        borderColor: t.grid,
        timeVisible: false,
        barSpacing: 6,
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
      color: "#3b82f6",
      priceScaleId: "",
      priceFormat: { type: "volume" },
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });
    volumeRef.current = volumeSeries;

    const hlSeries = chart.addSeries(HistogramSeries, {
      color: "#3b82f640",
      priceScaleId: "right",
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
      lastValueVisible: false,
    });
    hlSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.02, bottom: 0.02 },
    });
    highlightRef.current = hlSeries;

    // Tooltip
    const tooltip = document.createElement("div");
    tooltip.style.cssText = `
      position: absolute;
      display: none;
      padding: 10px;
      font-size: 13px;
      font-family: 'JetBrains Mono', monospace;
      color: #e2e8f0;
      background: #1a2236;
      border: 1px solid #2d3a52;
      border-radius: 6px;
      pointer-events: none;
      z-index: 1000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      max-width: 320px;
    `;
    container.appendChild(tooltip);
    tooltipRef.current = tooltip;

    // Crosshair move handler
    chart.subscribeCrosshairMove((param) => {
      if (!param.point || !param.time || !tooltip) {
        tooltip.style.display = "none";
        return;
      }
      const dp = param.seriesData.get(candleSeries);
      if (!dp) {
        tooltip.style.display = "none";
        return;
      }
      const c = dp as {
        open?: number;
        high?: number;
        low?: number;
        close?: number;
      };
      const d = new Date((param.time as number) * 1000).toLocaleDateString(
        "en-US",
        { month: "short", day: "numeric", year: "numeric" }
      );

      const dayEvents = (eventsRef.current || []).filter(
        (e: MacroEvent) =>
          Math.abs(e.timestamp - (param.time as number)) < 43200
      );
      const eh = dayEvents.length
        ? dayEvents
            .map((e: MacroEvent) => {
              const s = IMPACT_STYLE[e.impact_level];
              return `<div style="color:${s.color};margin-top:3px;font-size:10px;">${e.title}${e.actual_value ? ` (${e.actual_value}${e.unit})` : ""}</div>`;
            })
            .join("")
        : "";

      const dayNews = MOCK_NEWS.filter(
        (n) => Math.abs(n.timestamp - (param.time as number)) < 86400
      );
      const nh = dayNews.length
        ? `<div style="margin-top:6px;border-top:1px solid #2d3a52;padding-top:4px;"><div style="font-size:9px;color:#8b5cf6;font-weight:700;margin-bottom:2px;">📰 NEWS</div>${dayNews
            .map(
              (n) =>
                `<div style="color:${n.sentiment === "bullish" ? "#22c55e" : n.sentiment === "bearish" ? "#ef4444" : "#94a3b8"};font-size:10px;margin-top:2px;">${n.title}</div>`
            )
            .join("")}</div>`
        : "";

      const activeSignals = Array.from(
        strategyOutputsRef.current?.values() || []
      )
        .flatMap((o) => o.signals)
        .filter(
          (s: StrategySignal) =>
            Math.abs(s.time - (param.time as number)) < 86400
        );
      const sh = activeSignals.length
        ? `<div style="margin-top:6px;border-top:1px solid #2d3a52;padding-top:4px;"><div style="font-size:9px;color:#eab308;font-weight:700;margin-bottom:2px;">📈 STRATEGY</div>${activeSignals
            .map(
              (s: StrategySignal) =>
                `<div style="color:${s.direction === "buy" ? "#22c55e" : "#ef4444"};font-size:10px;">${s.label} (${s.direction.toUpperCase()})</div>`
            )
            .join("")}</div>`
        : "";

      tooltip.innerHTML = `
        <div style="font-weight:700;margin-bottom:3px;color:#3b82f6;">${d}</div>
        <div>O: $${c.open?.toLocaleString()}</div>
        <div>H: <span style="color:${t.up}">$${c.high?.toLocaleString()}</span></div>
        <div>L: <span style="color:${t.down}">$${c.low?.toLocaleString()}</span></div>
        <div>C: <span style="color:${c.close! >= c.open! ? t.up : t.down};font-weight:700">$${c.close?.toLocaleString()}</span></div>
        ${eh}${nh}${sh}
      `;
      tooltip.style.display = "block";
      tooltip.style.left =
        Math.min(param.point.x + 12, container.clientWidth - 280) + "px";
      tooltip.style.top =
        Math.min(param.point.y + 12, container.clientHeight - 260) + "px";
    });

    // Click handler
    chart.subscribeClick((param) => {
      if (!param.time) return;
      const evts = eventsRef.current || [];
      const clicked = evts.find(
        (e) => Math.abs(e.timestamp - (param.time as number)) < 86400
      );
      if (clicked) onEventClick(clicked.id, clicked.timestamp);
    });

    return () => {
      tooltip.remove();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      highlightRef.current = null;
      tooltipRef.current = null;
    };
  }, [onEventClick]);

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

  // Update data when klines/events change
  useEffect(() => {
    if (!chartRef.current || !candleRef.current || !volumeRef.current) return;

    const t = THEME;
    const candleData = klines.map((k) => ({
      time: k.time as Time,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
    }));
    const volumeData = klines.map((k) => ({
      time: k.time as Time,
      value: k.volume,
      color: k.close >= k.open ? `${t.up}30` : `${t.down}30`,
    }));

    candleRef.current.setData(candleData);
    volumeRef.current.setData(volumeData);
    chartRef.current.priceScale("right").applyOptions({ autoScale: true });

    // Update markers
    const histFactors = events.filter((f) => !f.is_forecast);
    const markers = buildMarkers(histFactors, klines, [], []);
    if (markers.length && candleRef.current) {
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
  }, [klines, events, timeframe]);

  // Update highlight on hover
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
