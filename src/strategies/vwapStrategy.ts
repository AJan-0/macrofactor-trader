/**
 * Dynamic Swing Anchored VWAP (Zeiierman)
 * 将 Pine Script v6 策略移植为 TypeScript
 *
 * 核心逻辑：
 * 1. 检测摆动高点/低点 (Swing High/Low)
 * 2. 当方向改变时，以摆动点为锚点重置VWAP
 * 3. 使用自适应指数加权计算VWAP
 * 4. 上升趋势VWAP为绿色，下降趋势为红色
 */

import type { Strategy, StrategyOutput, StrategyDefinition, KlineData } from "@/services/strategyEngine";

const DEFINITION: StrategyDefinition = {
  id: "zeiierman-vwap",
  name: "Dynamic Swing Anchored VWAP",
  nameZh: "动态摆动锚定VWAP",
  description: "Anchored VWAP that resets at swing points with adaptive price tracking based on ATR volatility.",
  descriptionZh: "在摆动点重置的锚定VWAP，基于ATR波动率自适应调整追踪速度。",
  version: "1.0.0",
  author: "Zeiierman",
  parameters: [
    {
      id: "prd", name: "Swing Period", nameZh: "摆动周期",
      type: "int", defaultValue: 50, min: 2, max: 200, step: 1,
      group: "Swing Points",
      tooltip: "Number of bars used to detect swing highs and lows.",
    },
    {
      id: "baseAPT", name: "Adaptive Price Tracking", nameZh: "自适应价格追踪",
      type: "float", defaultValue: 20, min: 1, max: 300, step: 1,
      group: "Swing Points",
      tooltip: "Controls how quickly the VWAP adjusts to new price action.",
    },
    {
      id: "useAdapt", name: "Adapt by ATR Ratio", nameZh: "ATR自适应",
      type: "bool", defaultValue: false,
      group: "Swing Points",
      tooltip: "Automatically adjust APT based on market volatility.",
    },
    {
      id: "volBias", name: "Volatility Bias", nameZh: "波动率偏差",
      type: "float", defaultValue: 10, min: 0.1, max: 50, step: 0.1,
      group: "Swing Points",
      tooltip: "Controls how strongly volatility influences the VWAP reaction speed.",
    },
    {
      id: "upColor", name: "Uptrend Color", nameZh: "上升趋势颜色",
      type: "color", defaultValue: "#22c55e",
      group: "Style",
    },
    {
      id: "downColor", name: "Downtrend Color", nameZh: "下降趋势颜色",
      type: "color", defaultValue: "#ef4444",
      group: "Style",
    },
    {
      id: "lineWidth", name: "Line Width", nameZh: "线宽",
      type: "int", defaultValue: 2, min: 1, max: 4, step: 1,
      group: "Style",
    },
  ],
};

function alphaFromAPT(apt: number): number {
  const decay = Math.exp(-Math.log(2.0) / Math.max(1.0, apt));
  return 1.0 - decay;
}

function calculateATR(klines: KlineData[], period: number, index: number): number {
  if (index < 1) return 0;
  let sum = 0;
  const start = Math.max(1, index - period + 1);
  for (let i = start; i <= index; i++) {
    const tr = Math.max(
      klines[i].high - klines[i].low,
      Math.abs(klines[i].high - klines[i - 1].close),
      Math.abs(klines[i].low - klines[i - 1].close)
    );
    sum += tr;
  }
  return sum / (index - start + 1);
}

function calculateRMA(values: number[], period: number, index: number): number {
  const alpha = 1 / period;
  let rma = values[0];
  const start = Math.max(0, index - period + 1);
  for (let i = start; i <= index; i++) {
    rma = alpha * values[i] + (1 - alpha) * rma;
  }
  return rma;
}

export function calculateVWAP(klines: KlineData[], params: Record<string, any>): StrategyOutput {
  const prd = params.prd as number;
  const baseAPT = params.baseAPT as number;
  const useAdapt = params.useAdapt as boolean;
  const volBias = params.volBias as number;
  const upColor = params.upColor as string;
  const downColor = params.downColor as string;
  const lineWidth = params.lineWidth as number;

  const n = klines.length;
  if (n < prd + 1) return { lines: [], labels: [], signals: [], zones: [] };

  // 预计算ATR序列（如果启用自适应）
  let atrSeries: number[] = [];
  let atrAvgSeries: number[] = [];
  if (useAdapt) {
    const atrLen = 50;
    for (let i = 0; i < n; i++) {
      atrSeries.push(calculateATR(klines, atrLen, i));
    }
    for (let i = 0; i < n; i++) {
      atrAvgSeries.push(calculateRMA(atrSeries, atrLen, i));
    }
  }

  // 计算APT序列
  const aptSeries: number[] = [];
  for (let i = 0; i < n; i++) {
    let apt = baseAPT;
    if (useAdapt && atrAvgSeries[i] > 0) {
      const ratio = atrSeries[i] / atrAvgSeries[i];
      const aptRaw = baseAPT / Math.pow(ratio, volBias);
      apt = Math.max(5.0, Math.min(300.0, aptRaw));
    }
    aptSeries.push(Math.round(apt));
  }

  // 检测摆动点
  const swingHighs = new Array(n).fill(false);
  const swingLows = new Array(n).fill(false);

  for (let i = prd; i < n; i++) {
    let maxHigh = -Infinity;
    let maxIdx = i;
    for (let j = i - prd; j <= i; j++) {
      if (klines[j].high > maxHigh) {
        maxHigh = klines[j].high;
        maxIdx = j;
      }
    }
    if (maxIdx === i) swingHighs[i] = true;

    let minLow = Infinity;
    let minIdx = i;
    for (let j = i - prd; j <= i; j++) {
      if (klines[j].low < minLow) {
        minLow = klines[j].low;
        minIdx = j;
      }
    }
    if (minIdx === i) swingLows[i] = true;
  }

  // 跟踪方向和VWAP
  let dir: 0 | 1 | -1 = 0;
  let ph = 0, pl = 0;
  let phL = 0, plL = 0;
  let prev = 0;

  // 为每个方向段维护VWAP数据
  interface Segment {
    dir: number;
    startIndex: number;
    points: { time: number; value: number }[];
  }

  const segments: Segment[] = [];
  let currentSegment: Segment | null = null;

  // VWAP累加器（用于当前方向段内）
  let pAcc = 0;
  let vAcc = 0;

  for (let i = prd; i < n; i++) {
    if (swingHighs[i]) {
      ph = klines[i].high;
      phL = i;
    }
    if (swingLows[i]) {
      pl = klines[i].low;
      plL = i;
    }

    const newDir: 1 | -1 = phL > plL ? 1 : -1;

    if (newDir !== dir && dir !== 0) {
      // 方向改变：结束当前段，开始新段
      const anchorIdx = newDir > 0 ? plL : phL;
      const anchorPrice = newDir > 0 ? pl : ph;

      // 创建新段
      currentSegment = {
        dir: newDir,
        startIndex: anchorIdx,
        points: [],
      };
      segments.push(currentSegment);

      // 从锚点到当前，逐bar计算VWAP
      pAcc = anchorPrice * (klines[anchorIdx].volume || 1);
      vAcc = klines[anchorIdx].volume || 1;
      currentSegment.points.push({
        time: klines[anchorIdx].time,
        value: anchorPrice,
      });

      for (let j = anchorIdx + 1; j <= i; j++) {
        const apt = aptSeries[j];
        const alpha = alphaFromAPT(apt);
        const hlc3 = (klines[j].open + klines[j].high + klines[j].low) / 3;
        const pxv = hlc3 * (klines[j].volume || 1);
        const v = klines[j].volume || 1;

        pAcc = (1.0 - alpha) * pAcc + alpha * pxv;
        vAcc = (1.0 - alpha) * vAcc + alpha * v;
        const vwapVal = vAcc > 0 ? pAcc / vAcc : hlc3;

        currentSegment.points.push({
          time: klines[j].time,
          value: vwapVal,
        });
      }

      // 标签：HH/HL/LH/LL
      const labelText = newDir > 0 && pl < prev ? "LL" :
        newDir > 0 && pl > prev ? "HL" :
        newDir < 0 && ph < prev ? "LH" :
        newDir < 0 && ph > prev ? "HH" : "";

      if (labelText) {
        // 标签记录在anchor点
      }

      prev = newDir > 0 ? ph : pl;
    } else if (currentSegment) {
      // 方向不变，继续当前段
      const apt = aptSeries[i];
      const alpha = alphaFromAPT(apt);
      const hlc3 = (klines[i].open + klines[i].high + klines[i].low) / 3;
      const pxv = hlc3 * (klines[i].volume || 1);
      const v = klines[i].volume || 1;

      pAcc = (1.0 - alpha) * pAcc + alpha * pxv;
      vAcc = (1.0 - alpha) * vAcc + alpha * v;
      const vwapVal = vAcc > 0 ? pAcc / vAcc : hlc3;

      currentSegment.points.push({
        time: klines[i].time,
        value: vwapVal,
      });
    } else if (dir === 0) {
      // 第一个方向段
      const anchorIdx = newDir > 0 ? plL : phL;
      const anchorPrice = newDir > 0 ? pl : ph;

      currentSegment = {
        dir: newDir,
        startIndex: anchorIdx,
        points: [],
      };
      segments.push(currentSegment);

      pAcc = anchorPrice * (klines[anchorIdx].volume || 1);
      vAcc = klines[anchorIdx].volume || 1;
      currentSegment.points.push({
        time: klines[anchorIdx].time,
        value: anchorPrice,
      });

      for (let j = anchorIdx + 1; j <= i; j++) {
        const apt = aptSeries[j];
        const alpha = alphaFromAPT(apt);
        const hlc3 = (klines[j].open + klines[j].high + klines[j].low) / 3;
        const pxv = hlc3 * (klines[j].volume || 1);
        const v = klines[j].volume || 1;

        pAcc = (1.0 - alpha) * pAcc + alpha * pxv;
        vAcc = (1.0 - alpha) * vAcc + alpha * v;
        const vwapVal = vAcc > 0 ? pAcc / vAcc : hlc3;

        currentSegment.points.push({
          time: klines[j].time,
          value: vwapVal,
        });
      }

      prev = newDir > 0 ? ph : pl;
    }

    dir = newDir;
  }

  // 构建输出
  const lines = segments.map((seg, idx) => ({
    id: `vwap-seg-${idx}`,
    name: seg.dir > 0 ? "VWAP Support" : "VWAP Resistance",
    data: seg.points.map(p => ({ time: p.time, value: p.value })),
    color: seg.dir > 0 ? upColor : downColor,
    lineWidth,
    style: "solid" as const,
  }));

  // 生成信号：价格突破VWAP时产生信号
  const signals = [];
  for (let i = 1; i < segments.length; i++) {
    const prevSeg = segments[i - 1];
    const currSeg = segments[i];
    if (prevSeg.points.length > 0 && currSeg.points.length > 0) {
      const breakPoint = currSeg.points[0];
      const breakDir = currSeg.dir;
      signals.push({
        time: breakPoint.time,
        price: breakPoint.value,
        direction: breakDir > 0 ? "buy" as const : "sell" as const,
        label: breakDir > 0 ? "VWAP Bullish Flip" : "VWAP Bearish Flip",
        strength: 0.7,
      });
    }
  }

  // 标签：摆动点
  const labels = [];
  for (let i = prd; i < n; i++) {
    if (swingHighs[i]) {
      labels.push({
        time: klines[i].time,
        price: klines[i].high,
        text: "SH",
        color: downColor,
        textColor: "#ffffff",
        direction: "above" as const,
        size: 8,
      });
    }
    if (swingLows[i]) {
      labels.push({
        time: klines[i].time,
        price: klines[i].low,
        text: "SL",
        color: upColor,
        textColor: "#ffffff",
        direction: "below" as const,
        size: 8,
      });
    }
  }

  return { lines, labels, signals, zones: [] };
}

export const vwapStrategy: Strategy = {
  definition: DEFINITION,
  calculate(ctx) {
    return calculateVWAP(ctx.klines, ctx.params);
  },
};
