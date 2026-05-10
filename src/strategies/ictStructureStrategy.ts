/**
 * ICT Market Structure (简化版 cd_indiCATor_Cx)
 *
 * 核心模块：
 * 1. 摆动点检测 (Swing Points)
 * 2. 市场结构标记 (BOS / CHoCH)
 * 3. 公允价值缺口 FVG (Fair Value Gap)
 * 4. 买卖流动性区域 BSL/SSL
 */

import type { Strategy, StrategyOutput, StrategyDefinition, KlineData } from "@/services/strategyEngine";

const DEFINITION: StrategyDefinition = {
  id: "ict-market-structure",
  name: "ICT Market Structure",
  nameZh: "ICT市场结构",
  description: "Identifies market structure shifts, Fair Value Gaps, and liquidity sweeps using ICT concepts.",
  descriptionZh: "使用ICT概念识别市场结构转换、公允价值缺口和流动性掠夺。",
  version: "1.0.0",
  author: "cdikici71 (ported)",
  parameters: [
    {
      id: "swingLen", name: "Swing Length", nameZh: "摆动长度",
      type: "int", defaultValue: 10, min: 2, max: 100, step: 1,
      group: "Structure",
      tooltip: "Bars lookback for swing high/low detection.",
    },
    {
      id: "showFVG", name: "Show FVG", nameZh: "显示FVG",
      type: "bool", defaultValue: true,
      group: "FVG",
    },
    {
      id: "showBSL", name: "Show BSL/SSL", nameZh: "显示流动性",
      type: "bool", defaultValue: true,
      group: "Liquidity",
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

interface SwingPoint {
  index: number;
  time: number;
  price: number;
  type: "high" | "low";
}

interface StructureShift {
  index: number;
  time: number;
  type: "BOS" | "CHoCH";
  direction: "bullish" | "bearish";
  price: number;
}

interface FVG {
  startIndex: number;
  endIndex: number;
  startTime: number;
  endTime: number;
  top: number;
  bottom: number;
  type: "bullish" | "bearish";
}

function findSwingPoints(klines: KlineData[], len: number): SwingPoint[] {
  const n = klines.length;
  const swings: SwingPoint[] = [];

  for (let i = len; i < n - len; i++) {
    // Swing High
    let isSwingHigh = true;
    for (let j = 1; j <= len; j++) {
      if (klines[i].high <= klines[i - j].high || klines[i].high <= klines[i + j].high) {
        isSwingHigh = false;
        break;
      }
    }
    if (isSwingHigh) {
      swings.push({ index: i, time: klines[i].time, price: klines[i].high, type: "high" });
    }

    // Swing Low
    let isSwingLow = true;
    for (let j = 1; j <= len; j++) {
      if (klines[i].low >= klines[i - j].low || klines[i].low >= klines[i + j].low) {
        isSwingLow = false;
        break;
      }
    }
    if (isSwingLow) {
      swings.push({ index: i, time: klines[i].time, price: klines[i].low, type: "low" });
    }
  }

  return swings.sort((a, b) => a.index - b.index);
}

function detectStructure(sh: SwingPoint[], sl: SwingPoint[]): StructureShift[] {
  const shifts: StructureShift[] = [];
  const highs = sh.sort((a, b) => a.index - b.index);
  const lows = sl.sort((a, b) => a.index - b.index);

  let lastHigh = highs[0];
  let lastLow = lows[0];
  let trend: "up" | "down" | "neutral" = "neutral";

  for (let i = 1; i < Math.max(highs.length, lows.length); i++) {
    const h = highs[i];
    const l = lows[i];

    if (h && lastHigh && h.price > lastHigh.price) {
      if (trend === "down") {
        shifts.push({
          index: h.index,
          time: h.time,
          type: "CHoCH",
          direction: "bullish",
          price: h.price,
        });
      } else if (trend === "up") {
        shifts.push({
          index: h.index,
          time: h.time,
          type: "BOS",
          direction: "bullish",
          price: h.price,
        });
      }
      trend = "up";
      lastHigh = h;
    }

    if (l && lastLow && l.price < lastLow.price) {
      if (trend === "up") {
        shifts.push({
          index: l.index,
          time: l.time,
          type: "CHoCH",
          direction: "bearish",
          price: l.price,
        });
      } else if (trend === "down") {
        shifts.push({
          index: l.index,
          time: l.time,
          type: "BOS",
          direction: "bearish",
          price: l.price,
        });
      }
      trend = "down";
      lastLow = l;
    }
  }

  return shifts;
}

function detectFVG(klines: KlineData[]): FVG[] {
  const fvgs: FVG[] = [];
  const n = klines.length;

  for (let i = 2; i < n; i++) {
    const prev = klines[i - 2];
    const curr = klines[i];

    // Bullish FVG: low[i] > high[i-2]
    if (curr.low > prev.high) {
      fvgs.push({
        startIndex: i - 2,
        endIndex: i,
        startTime: prev.time,
        endTime: curr.time,
        top: curr.low,
        bottom: prev.high,
        type: "bullish",
      });
    }

    // Bearish FVG: high[i] < low[i-2]
    if (curr.high < prev.low) {
      fvgs.push({
        startIndex: i - 2,
        endIndex: i,
        startTime: prev.time,
        endTime: curr.time,
        top: prev.low,
        bottom: curr.high,
        type: "bearish",
      });
    }
  }

  return fvgs;
}

export function calculateICTStructure(klines: KlineData[], params: Record<string, any>): StrategyOutput {
  const swingLen = params.swingLen as number;
  const showFVG = params.showFVG as boolean;
  const showBSL = params.showBSL as boolean;
  const bullColor = params.bullColor as string;
  const bearColor = params.bearColor as string;

  const n = klines.length;
  if (n < swingLen * 3) return { lines: [], labels: [], signals: [], zones: [] };

  const swings = findSwingPoints(klines, swingLen);
  const swingHighs = swings.filter(s => s.type === "high");
  const swingLows = swings.filter(s => s.type === "low");

  const shifts = detectStructure(swingHighs, swingLows);
  const fvgs = showFVG ? detectFVG(klines) : [];

  // 构建输出
  const lines: any[] = [];
  const labels: any[] = [];
  const signals: any[] = [];
  const zones: any[] = [];

  // 市场结构标签
  for (const s of shifts) {
    labels.push({
      time: s.time,
      price: s.price,
      text: s.type,
      color: s.direction === "bullish" ? bullColor : bearColor,
      textColor: "#ffffff",
      direction: s.direction === "bullish" ? "below" : "above",
      size: 10,
    });

    signals.push({
      time: s.time,
      price: s.price,
      direction: s.direction === "bullish" ? "buy" : "sell",
      label: s.type,
      strength: s.type === "CHoCH" ? 0.85 : 0.7,
    });
  }

  // 摆动点标签
  for (const s of swings) {
    labels.push({
      time: s.time,
      price: s.price,
      text: s.type === "high" ? "SH" : "SL",
      color: s.type === "high" ? bearColor : bullColor,
      textColor: "#ffffff",
      direction: s.type === "high" ? "above" : "below",
      size: 7,
    });
  }

  // FVG 区域
  for (const fvg of fvgs) {
    zones.push({
      id: `fvg-${fvg.startIndex}`,
      startTime: fvg.startTime,
      endTime: fvg.endTime,
      topPrice: fvg.top,
      bottomPrice: fvg.bottom,
      color: fvg.type === "bullish"
        ? `${bullColor}20`
        : `${bearColor}20`,
      borderColor: fvg.type === "bullish" ? bullColor : bearColor,
      label: fvg.type === "bullish" ? "Bullish FVG" : "Bearish FVG",
    });
  }

  // BSL/SSL 线 (Swing Highs / Swing Lows 的延伸)
  if (showBSL && swingHighs.length > 0) {
    const lastSH = swingHighs[swingHighs.length - 1];
    lines.push({
      id: "bsl-line",
      name: "BSL (Sell Side Liquidity)",
      data: klines.slice(lastSH.index).map(k => ({
        time: k.time,
        value: lastSH.price,
      })),
      color: bearColor,
      lineWidth: 1,
      style: "dashed",
    });
  }

  if (showBSL && swingLows.length > 0) {
    const lastSL = swingLows[swingLows.length - 1];
    lines.push({
      id: "ssl-line",
      name: "SSL (Buy Side Liquidity)",
      data: klines.slice(lastSL.index).map(k => ({
        time: k.time,
        value: lastSL.price,
      })),
      color: bullColor,
      lineWidth: 1,
      style: "dashed",
    });
  }

  return { lines, labels, signals, zones };
}

export const ictStructureStrategy: Strategy = {
  definition: DEFINITION,
  calculate(ctx) {
    return calculateICTStructure(ctx.klines, ctx.params);
  },
};
