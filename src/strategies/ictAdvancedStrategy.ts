/**
 * ICT Advanced (cd_indiCATor_Cx 完整版移植)
 *
 * 核心模块：
 * 1. 市场结构 (BOS / CHoCH) - 已完善
 * 2. 摆动点检测 (Swing Points)
 * 3. FVG (Fair Value Gap)
 * 4. Order Blocks (OB) -  bullish/bearish
 * 5. Liquidity Sweeps (内部/外部流动性掠夺)
 * 6. Killzones (时间交易区域: Asian / London / New York)
 * 7. SMT Divergence (Smart Money Technique - 简化版)
 */

import type { Strategy, StrategyOutput, StrategyDefinition, KlineData } from "@/services/strategyEngine";

const DEFINITION: StrategyDefinition = {
  id: "ict-advanced",
  name: "ICT Advanced (cd_indiCATor_Cx)",
  nameZh: "ICT高级版",
  description: "Full ICT toolkit: Market Structure, Order Blocks, Liquidity Sweeps, FVG, Killzones, and SMT Divergence.",
  descriptionZh: "完整ICT工具箱：市场结构、订单块、流动性掠夺、FVG、交易时间区域、SMT背离。",
  version: "2.0.0",
  author: "cdikici71 / Zeiierman (ported)",
  parameters: [
    {
      id: "swingLen", name: "Swing Length", nameZh: "摆动长度",
      type: "int", defaultValue: 10, min: 2, max: 100, step: 1,
      group: "Structure",
      tooltip: "Bars lookback for swing high/low detection.",
    },
    {
      id: "showOB", name: "Show Order Blocks", nameZh: "显示订单块",
      type: "bool", defaultValue: true,
      group: "Order Blocks",
    },
    {
      id: "obThreshold", name: "OB Min Bars", nameZh: "OB最少K线",
      type: "int", defaultValue: 3, min: 1, max: 10, step: 1,
      group: "Order Blocks",
      tooltip: "Minimum consecutive bars in one direction to qualify as Order Block.",
    },
    {
      id: "showFVG", name: "Show FVG", nameZh: "显示FVG",
      type: "bool", defaultValue: true,
      group: "FVG",
    },
    {
      id: "showSweep", name: "Show Liquidity Sweeps", nameZh: "显示流动性掠夺",
      type: "bool", defaultValue: true,
      group: "Liquidity",
    },
    {
      id: "sweepThreshold", name: "Sweep Wicks %", nameZh: "掠夺影线%",
      type: "float", defaultValue: 0.3, min: 0.05, max: 2.0, step: 0.05,
      group: "Liquidity",
      tooltip: "Min wick size as % of ATR to qualify as sweep.",
    },
    {
      id: "showKillzones", name: "Show Killzones", nameZh: "显示交易时段",
      type: "bool", defaultValue: true,
      group: "Time",
    },
    {
      id: "showSMT", name: "Show SMT Divergence", nameZh: "显示SMT背离",
      type: "bool", defaultValue: false,
      group: "SMT",
      tooltip: "SMT requires multi-asset data - simplified single-asset version.",
    },
    {
      id: "bullColor", name: "Bullish Color", nameZh: "看多颜色",
      type: "color", defaultValue: "#22c55e",
      group: "Style",
    },
    {
      id: "bearColor", name: "Bearish Color", nameZh: "看空颜色",
      type: "color", defaultValue: "#ef4444",
      group: "Style",
    },
  ],
};

// ──────────────────────────────
// 工具函数
// ──────────────────────────────

function calcATR(klines: KlineData[], period = 14): number[] {
  const atr: number[] = [];
  for (let i = 0; i < klines.length; i++) {
    const k = klines[i];
    const tr = Math.max(
      k.high - k.low,
      i > 0 ? Math.abs(k.high - klines[i - 1].close) : 0,
      i > 0 ? Math.abs(k.low - klines[i - 1].close) : 0
    );
    if (i === 0) atr.push(tr);
    else atr.push((atr[i - 1] * (period - 1) + tr) / period);
  }
  return atr;
}

interface SwingPoint { index: number; time: number; price: number; type: "high" | "low"; }

function findSwingPoints(klines: KlineData[], len: number): SwingPoint[] {
  const n = klines.length;
  const swings: SwingPoint[] = [];
  for (let i = len; i < n - len; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= len; j++) {
      if (klines[i].high <= klines[i - j].high || klines[i].high <= klines[i + j].high) isHigh = false;
      if (klines[i].low >= klines[i - j].low || klines[i].low >= klines[i + j].low) isLow = false;
    }
    if (isHigh) swings.push({ index: i, time: klines[i].time, price: klines[i].high, type: "high" });
    if (isLow) swings.push({ index: i, time: klines[i].time, price: klines[i].low, type: "low" });
  }
  return swings.sort((a, b) => a.index - b.index);
}

// ──────────────────────────────
// 1. 市场结构 (BOS / CHoCH)
// ──────────────────────────────

interface StructureShift { index: number; time: number; type: "BOS" | "CHoCH"; direction: "bullish" | "bearish"; price: number; }

function detectStructure(sh: SwingPoint[], sl: SwingPoint[]): StructureShift[] {
  const shifts: StructureShift[] = [];
  const highs = sh.sort((a, b) => a.index - b.index);
  const lows = sl.sort((a, b) => a.index - b.index);
  let lastHigh = highs[0], lastLow = lows[0];
  let trend: "up" | "down" | "neutral" = "neutral";

  for (let i = 1; i < Math.max(highs.length, lows.length); i++) {
    const h = highs[i], l = lows[i];
    if (h && lastHigh && h.price > lastHigh.price) {
      if (trend === "down") shifts.push({ index: h.index, time: h.time, type: "CHoCH", direction: "bullish", price: h.price });
      else if (trend === "up") shifts.push({ index: h.index, time: h.time, type: "BOS", direction: "bullish", price: h.price });
      trend = "up"; lastHigh = h;
    }
    if (l && lastLow && l.price < lastLow.price) {
      if (trend === "up") shifts.push({ index: l.index, time: l.time, type: "CHoCH", direction: "bearish", price: l.price });
      else if (trend === "down") shifts.push({ index: l.index, time: l.time, type: "BOS", direction: "bearish", price: l.price });
      trend = "down"; lastLow = l;
    }
  }
  return shifts;
}

// ──────────────────────────────
// 2. FVG
// ──────────────────────────────

interface FVG { startIndex: number; endIndex: number; startTime: number; endTime: number; top: number; bottom: number; type: "bullish" | "bearish"; }

function detectFVG(klines: KlineData[]): FVG[] {
  const fvgs: FVG[] = [];
  for (let i = 2; i < klines.length; i++) {
    const prev = klines[i - 2], curr = klines[i];
    if (curr.low > prev.high) fvgs.push({ startIndex: i - 2, endIndex: i, startTime: prev.time, endTime: curr.time, top: curr.low, bottom: prev.high, type: "bullish" });
    if (curr.high < prev.low) fvgs.push({ startIndex: i - 2, endIndex: i, startTime: prev.time, endTime: curr.time, top: prev.low, bottom: curr.high, type: "bearish" });
  }
  return fvgs;
}

// ──────────────────────────────
// 3. Order Blocks (OB)
// ──────────────────────────────

interface OrderBlock { index: number; time: number; top: number; bottom: number; type: "bullish" | "bearish"; }

function detectOrderBlocks(klines: KlineData[], threshold: number): OrderBlock[] {
  const obs: OrderBlock[] = [];
  const n = klines.length;

  for (let i = threshold + 1; i < n - 1; i++) {
    // Bearish OB: 连续上涨后一根大阴线 (机构卖出)
    let bullishRun = true;
    for (let j = 0; j < threshold; j++) {
      if (klines[i - j].close < klines[i - j].open) { bullishRun = false; break; }
    }
    const bearishCandle = klines[i + 1].close < klines[i + 1].open && (klines[i + 1].open - klines[i + 1].close) > (klines[i + 1].high - klines[i + 1].low) * 0.5;
    if (bullishRun && bearishCandle) {
      obs.push({
        index: i,
        time: klines[i].time,
        top: Math.max(...klines.slice(i - threshold + 1, i + 1).map(k => k.high)),
        bottom: Math.min(...klines.slice(i - threshold + 1, i + 1).map(k => k.low)),
        type: "bearish",
      });
    }

    // Bullish OB: 连续下跌后一根大阳线 (机构买入)
    let bearishRun = true;
    for (let j = 0; j < threshold; j++) {
      if (klines[i - j].close > klines[i - j].open) { bearishRun = false; break; }
    }
    const bullishCandle = klines[i + 1].close > klines[i + 1].open && (klines[i + 1].close - klines[i + 1].open) > (klines[i + 1].high - klines[i + 1].low) * 0.5;
    if (bearishRun && bullishCandle) {
      obs.push({
        index: i,
        time: klines[i].time,
        top: Math.max(...klines.slice(i - threshold + 1, i + 1).map(k => k.high)),
        bottom: Math.min(...klines.slice(i - threshold + 1, i + 1).map(k => k.low)),
        type: "bullish",
      });
    }
  }

  return obs;
}

// ──────────────────────────────
// 4. Liquidity Sweeps
// ──────────────────────────────

interface Sweep { index: number; time: number; price: number; type: "high" | "low"; strength: number; }

function detectSweeps(klines: KlineData[], swings: SwingPoint[], atr: number[], thresholdPct: number): Sweep[] {
  const sweeps: Sweep[] = [];
  if (!swings.length) return sweeps;

  const highs = swings.filter(s => s.type === "high");
  const lows = swings.filter(s => s.type === "low");

  for (let i = 1; i < klines.length; i++) {
    const k = klines[i];
    const atrVal = atr[i] || k.high - k.low;
    const minWick = atrVal * (thresholdPct / 100);

    // High sweep: wick above previous swing high, close below
    const prevHigh = highs.filter(h => h.index < i).pop();
    if (prevHigh) {
      const upperWick = k.high - Math.max(k.open, k.close);
      if (k.high > prevHigh.price && upperWick > minWick && k.close < prevHigh.price) {
        sweeps.push({ index: i, time: k.time, price: prevHigh.price, type: "high", strength: Math.min(1, upperWick / atrVal) });
      }
    }

    // Low sweep: wick below previous swing low, close above
    const prevLow = lows.filter(l => l.index < i).pop();
    if (prevLow) {
      const lowerWick = Math.min(k.open, k.close) - k.low;
      if (k.low < prevLow.price && lowerWick > minWick && k.close > prevLow.price) {
        sweeps.push({ index: i, time: k.time, price: prevLow.price, type: "low", strength: Math.min(1, lowerWick / atrVal) });
      }
    }
  }

  return sweeps;
}

// ──────────────────────────────
// 5. Killzones (时间区域)
// ──────────────────────────────

interface Killzone { startHour: number; endHour: number; name: string; color: string; priority: number; }

const KILLZONES: Killzone[] = [
  { startHour: 0, endHour: 4, name: "Asian", color: "#3b82f620", priority: 1 },
  { startHour: 7, endHour: 10, name: "London Open", color: "#eab30820", priority: 3 },
  { startHour: 13, endHour: 16, name: "NY Open", color: "#ef444420", priority: 3 },
  { startHour: 19, endHour: 21, name: "NY Close", color: "#8b5cf620", priority: 2 },
];

function detectKillzones(klines: KlineData[]): Array<{ startTime: number; endTime: number; name: string; color: string }> {
  const zones: Array<{ startTime: number; endTime: number; name: string; color: string }> = [];
  const seen = new Set<string>();

  for (const kz of KILLZONES) {
    for (let i = 0; i < klines.length; i++) {
      const date = new Date(klines[i].time * 1000);
      const hour = date.getUTCHours();
      if (hour === kz.startHour) {
        const key = `${klines[i].time}-${kz.name}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // 找到这个 killzone 的结束时间
        let endIndex = i;
        for (let j = i; j < klines.length; j++) {
          const h = new Date(klines[j].time * 1000).getUTCHours();
          if (h >= kz.endHour) { endIndex = j; break; }
          if (j === klines.length - 1) endIndex = j;
        }

        zones.push({
          startTime: klines[i].time,
          endTime: klines[endIndex].time,
          name: kz.name,
          color: kz.color,
        });
      }
    }
  }

  return zones;
}

// ──────────────────────────────
// 6. SMT Divergence (简化版 - 单品种内部)
// ──────────────────────────────

interface SMTSignal { index: number; time: number; type: "bullish" | "bearish"; strength: number; }

function detectSMT(klines: KlineData[], swings: SwingPoint[]): SMTSignal[] {
  const smts: SMTSignal[] = [];
  const highs = swings.filter(s => s.type === "high").sort((a, b) => a.index - b.index);
  const lows = swings.filter(s => s.type === "low").sort((a, b) => a.index - b.index);

  // Bullish SMT: 价格创新低但 momentum 不创新低 (简化：用 RSI 近似)
  for (let i = 2; i < lows.length; i++) {
    const l0 = lows[i - 2], l2 = lows[i];
    if (l2.price < l0.price) {
      // 价格创新低
      const mom0 = klines[l0.index].close - klines[l0.index].open;
      const mom2 = klines[l2.index].close - klines[l2.index].open;
      if (mom2 > mom0) {
        smts.push({ index: l2.index, time: l2.time, type: "bullish", strength: 0.6 });
      }
    }
  }

  // Bearish SMT: 价格创新高但 momentum 不创新高
  for (let i = 2; i < highs.length; i++) {
    const h0 = highs[i - 2], h2 = highs[i];
    if (h2.price > h0.price) {
      const mom0 = klines[h0.index].close - klines[h0.index].open;
      const mom2 = klines[h2.index].close - klines[h2.index].open;
      if (mom2 < mom0) {
        smts.push({ index: h2.index, time: h2.time, type: "bearish", strength: 0.6 });
      }
    }
  }

  return smts;
}

// ──────────────────────────────
// 主计算函数
// ──────────────────────────────

export function calculateICTAdvanced(klines: KlineData[], params: Record<string, any>): StrategyOutput {
  const swingLen = params.swingLen as number;
  const showOB = params.showOB as boolean;
  const obThreshold = params.obThreshold as number;
  const showFVG = params.showFVG as boolean;
  const showSweep = params.showSweep as boolean;
  const sweepThreshold = params.sweepThreshold as number;
  const showKillzones = params.showKillzones as boolean;
  const showSMT = params.showSMT as boolean;
  const bullColor = params.bullColor as string;
  const bearColor = params.bearColor as string;

  const n = klines.length;
  if (n < swingLen * 3) return { lines: [], labels: [], signals: [], zones: [] };

  const atr = calcATR(klines, 14);
  const swings = findSwingPoints(klines, swingLen);
  const swingHighs = swings.filter(s => s.type === "high");
  const swingLows = swings.filter(s => s.type === "low");

  const shifts = detectStructure(swingHighs, swingLows);
  const fvgs = showFVG ? detectFVG(klines) : [];
  const obs = showOB ? detectOrderBlocks(klines, obThreshold) : [];
  const sweeps = showSweep ? detectSweeps(klines, swings, atr, sweepThreshold) : [];
  const killzones = showKillzones ? detectKillzones(klines) : [];
  const smts = showSMT ? detectSMT(klines, swings) : [];

  const lines: any[] = [];
  const labels: any[] = [];
  const signals: any[] = [];
  const zones: any[] = [];

  // 市场结构
  for (const s of shifts) {
    labels.push({
      time: s.time, price: s.price, text: s.type,
      color: s.direction === "bullish" ? bullColor : bearColor,
      textColor: "#ffffff", direction: s.direction === "bullish" ? "below" : "above", size: 10,
    });
    signals.push({
      time: s.time, price: s.price,
      direction: s.direction === "bullish" ? "buy" : "sell",
      label: s.type, strength: s.type === "CHoCH" ? 0.85 : 0.7,
    });
  }

  // 摆动点
  for (const s of swings) {
    labels.push({
      time: s.time, price: s.price, text: s.type === "high" ? "SH" : "SL",
      color: s.type === "high" ? bearColor : bullColor,
      textColor: "#ffffff", direction: s.type === "high" ? "above" : "below", size: 7,
    });
  }

  // FVG 区域
  for (const fvg of fvgs) {
    zones.push({
      id: `fvg-${fvg.startIndex}`, startTime: fvg.startTime, endTime: fvg.endTime,
      topPrice: fvg.top, bottomPrice: fvg.bottom,
      color: `${fvg.type === "bullish" ? bullColor : bearColor}18`,
      borderColor: fvg.type === "bullish" ? bullColor : bearColor,
      label: `FVG ${fvg.type === "bullish" ? "Bull" : "Bear"}`,
    });
  }

  // Order Blocks 区域
  for (const ob of obs) {
    zones.push({
      id: `ob-${ob.index}`, startTime: ob.time,
      endTime: klines[Math.min(ob.index + 20, klines.length - 1)].time,
      topPrice: ob.top, bottomPrice: ob.bottom,
      color: `${ob.type === "bullish" ? bullColor : bearColor}15`,
      borderColor: ob.type === "bullish" ? bullColor : bearColor,
      label: `OB ${ob.type === "bullish" ? "Bull" : "Bear"}`,
    });
  }

  // Liquidity Sweeps
  for (const sw of sweeps) {
    labels.push({
      time: sw.time, price: sw.price,
      text: sw.type === "high" ? "Sweep▲" : "Sweep▼",
      color: sw.type === "high" ? bearColor : bullColor,
      textColor: "#ffffff", direction: sw.type === "high" ? "above" : "below", size: 9,
    });
    signals.push({
      time: sw.time, price: sw.price,
      direction: sw.type === "high" ? "sell" : "buy",
      label: `Liquidity Sweep ${sw.type === "high" ? "High" : "Low"}`,
      strength: sw.strength,
    });
  }

  // Killzones
  for (const kz of killzones) {
    zones.push({
      id: `kz-${kz.startTime}`, startTime: kz.startTime, endTime: kz.endTime,
      topPrice: Math.max(...klines.map(k => k.high)) * 1.01,
      bottomPrice: Math.min(...klines.map(k => k.low)) * 0.99,
      color: kz.color, borderColor: "transparent",
      label: kz.name,
    });
  }

  // SMT
  for (const smt of smts) {
    labels.push({
      time: smt.time, price: klines[smt.index].high * 1.005,
      text: "SMT", color: "#8b5cf6", textColor: "#ffffff",
      direction: "above", size: 8,
    });
    signals.push({
      time: smt.time, price: klines[smt.index].close,
      direction: smt.type === "bullish" ? "buy" : "sell",
      label: `SMT Divergence`, strength: smt.strength,
    });
  }

  // BSL/SSL 线
  if (swingHighs.length > 0) {
    const lastSH = swingHighs[swingHighs.length - 1];
    lines.push({
      id: "bsl", name: "BSL", lineWidth: 1, color: bearColor, style: "dashed",
      data: klines.slice(lastSH.index).map(k => ({ time: k.time, value: lastSH.price })),
    });
  }
  if (swingLows.length > 0) {
    const lastSL = swingLows[swingLows.length - 1];
    lines.push({
      id: "ssl", name: "SSL", lineWidth: 1, color: bullColor, style: "dashed",
      data: klines.slice(lastSL.index).map(k => ({ time: k.time, value: lastSL.price })),
    });
  }

  return { lines, labels, signals, zones };
}

export const ictAdvancedStrategy: Strategy = {
  definition: DEFINITION,
  calculate(ctx) {
    return calculateICTAdvanced(ctx.klines, ctx.params);
  },
};
