/**
 * TradingView 热门指标库
 * 集成 WaveTrend, SuperTrend, VWAP, MACD 等经典指标
 */

import type {
  KlineData,
  StrategyDefinition,
  StrategyOutput,
  StrategyContext,
  StrategySignal,
  StrategyLine,
} from "../strategyEngine";
import { strategyRegistry } from "../strategyEngine";

// ═══════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════

/** 计算 SMA */
function sma(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j];
    }
    result.push(sum / period);
  }
  return result;
}

/** 计算 EMA */
function ema(data: number[], period: number): number[] {
  const result: number[] = [];
  const multiplier = 2 / (period + 1);
  
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      result.push(data[0]);
    } else if (i < period - 1) {
      result.push(NaN);
    } else {
      const prevEma = result[i - 1];
      if (isNaN(prevEma)) {
        // 首次计算，使用SMA作为初始值
        let sum = 0;
        for (let j = 0; j < period; j++) {
          sum += data[i - j];
        }
        result.push(sum / period);
      } else {
        result.push((data[i] - prevEma) * multiplier + prevEma);
      }
    }
  }
  return result;
}

/** 计算标准差 */
function stdev(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j];
    }
    const mean = sum / period;
    let variance = 0;
    for (let j = 0; j < period; j++) {
      variance += Math.pow(data[i - j] - mean, 2);
    }
    result.push(Math.sqrt(variance / period));
  }
  return result;
}

/** 计算 ATR */
function atr(klines: KlineData[], period: number): number[] {
  const tr: number[] = [];
  for (let i = 0; i < klines.length; i++) {
    const k = klines[i];
    const prevClose = i > 0 ? klines[i - 1].close : k.close;
    const tr1 = k.high - k.low;
    const tr2 = Math.abs(k.high - prevClose);
    const tr3 = Math.abs(k.low - prevClose);
    tr.push(Math.max(tr1, tr2, tr3));
  }
  return ema(tr, period);
}

/** 计算 VWAP */
function vwap(klines: KlineData[]): { vwap: number[]; upper1: number[]; lower1: number[]; upper2: number[]; lower2: number[] } {
  const vwap: number[] = [];
  const upper1: number[] = [];
  const lower1: number[] = [];
  const upper2: number[] = [];
  const lower2: number[] = [];
  
  let cumTPV = 0;
  let cumVol = 0;
  
  for (let i = 0; i < klines.length; i++) {
    const k = klines[i];
    const tp = (k.high + k.low + k.close) / 3;
    const pv = tp * k.volume;
    
    cumTPV += pv;
    cumVol += k.volume;
    
    const v = cumVol > 0 ? cumTPV / cumVol : tp;
    vwap.push(v);
    
    // 计算标准差带
    const variance = Math.pow(tp - v, 2) * k.volume;
    const std = cumVol > 0 ? Math.sqrt(variance / cumVol) : 0;
    
    upper1.push(v + std);
    lower1.push(v - std);
    upper2.push(v + 2 * std);
    lower2.push(v - 2 * std);
  }
  
  return { vwap, upper1, lower1, upper2, lower2 };
}

// ═══════════════════════════════════════════════════════════
// 1. WaveTrend Oscillator [LazyBear]
// ═══════════════════════════════════════════════════════════

const waveTrendDefinition: StrategyDefinition = {
  id: "wave-trend",
  name: "WaveTrend Oscillator",
  nameZh: "WaveTrend 振荡器",
  description: "A popular oscillator that identifies overbought and oversold conditions with smooth wave-like movements.",
  descriptionZh: "流行的振荡器指标，通过平滑的波浪运动识别超买超卖状态。",
  version: "1.0",
  author: "LazyBear (ported)",
  parameters: [
    {
      id: "channelLength",
      name: "Channel Length",
      nameZh: "通道长度",
      type: "int",
      defaultValue: 10,
      min: 1,
      max: 50,
      step: 1,
    },
    {
      id: "averageLength",
      name: "Average Length",
      nameZh: "平均长度",
      type: "int",
      defaultValue: 21,
      min: 1,
      max: 100,
      step: 1,
    },
    {
      id: "overBought1",
      name: "Overbought Level 1",
      nameZh: "超买水平1",
      type: "float",
      defaultValue: 60,
      min: 0,
      max: 100,
      step: 5,
    },
    {
      id: "overBought2",
      name: "Overbought Level 2",
      nameZh: "超买水平2",
      type: "float",
      defaultValue: 53,
      min: 0,
      max: 100,
      step: 5,
    },
    {
      id: "overSold1",
      name: "Oversold Level 1",
      nameZh: "超卖水平1",
      type: "float",
      defaultValue: -60,
      min: -100,
      max: 0,
      step: 5,
    },
    {
      id: "overSold2",
      name: "Oversold Level 2",
      nameZh: "超卖水平2",
      type: "float",
      defaultValue: -53,
      min: -100,
      max: 0,
      step: 5,
    },
  ],
};

function calculateWaveTrend(ctx: StrategyContext): StrategyOutput {
  const { klines, params } = ctx;
  const channelLength = params.channelLength as number;
  const averageLength = params.averageLength as number;
  const ob1 = params.overBought1 as number;
  const ob2 = params.overBought2 as number;
  const os1 = params.overSold1 as number;
  const os2 = params.overSold2 as number;

  const hlc3 = klines.map(k => (k.high + k.low + k.close) / 3);
  const esa = ema(hlc3, channelLength);
  
  const de = hlc3.map((v, i) => {
    if (isNaN(esa[i])) return NaN;
    return Math.abs(v - esa[i]);
  });
  const deEma = ema(de, channelLength);
  
  const ci = hlc3.map((v, i) => {
    if (isNaN(esa[i]) || isNaN(deEma[i]) || deEma[i] === 0) return NaN;
    return (v - esa[i]) / (0.015 * deEma[i]);
  });
  
  const wt1 = ema(ci, averageLength);
  const wt2 = sma(wt1, 4);

  const lines: StrategyLine[] = [
    {
      id: "wt1",
      name: "WT1",
      data: wt1.map((v, i) => ({ time: klines[i].time, value: v })),
      color: "#00E5FF",
      lineWidth: 2,
    },
    {
      id: "wt2",
      name: "WT2",
      data: wt2.map((v, i) => ({ time: klines[i].time, value: v })),
      color: "#FF9100",
      lineWidth: 2,
      style: "dashed",
    },
    {
      id: "ob1",
      name: "Overbought 1",
      data: klines.map(k => ({ time: k.time, value: ob1 })),
      color: "rgba(255, 82, 82, 0.6)",
      lineWidth: 1,
      style: "dashed",
    },
    {
      id: "ob2",
      name: "Overbought 2",
      data: klines.map(k => ({ time: k.time, value: ob2 })),
      color: "rgba(255, 138, 128, 0.4)",
      lineWidth: 1,
      style: "dotted",
    },
    {
      id: "os1",
      name: "Oversold 1",
      data: klines.map(k => ({ time: k.time, value: os1 })),
      color: "rgba(105, 240, 174, 0.6)",
      lineWidth: 1,
      style: "dashed",
    },
    {
      id: "os2",
      name: "Oversold 2",
      data: klines.map(k => ({ time: k.time, value: os2 })),
      color: "rgba(185, 246, 202, 0.4)",
      lineWidth: 1,
      style: "dotted",
    },
  ];

  // 生成信号
  const signals: StrategySignal[] = [];
  for (let i = 1; i < wt1.length; i++) {
    if (isNaN(wt1[i]) || isNaN(wt2[i])) continue;
    
    // 买入信号：WT1 从下方穿越 WT2 且在超卖区
    if (wt1[i - 1] < wt2[i - 1] && wt1[i] >= wt2[i] && wt1[i] < os2) {
      signals.push({
        time: klines[i].time,
        price: klines[i].close,
        direction: "buy",
        label: "WT Buy",
        strength: Math.min(Math.abs(wt1[i] - os1) / 20, 1),
      });
    }
    // 卖出信号：WT1 从上方穿越 WT2 且在超买区
    else if (wt1[i - 1] > wt2[i - 1] && wt1[i] <= wt2[i] && wt1[i] > ob2) {
      signals.push({
        time: klines[i].time,
        price: klines[i].close,
        direction: "sell",
        label: "WT Sell",
        strength: Math.min(Math.abs(wt1[i] - ob1) / 20, 1),
      });
    }
  }

  return { lines, labels: [], signals, zones: [] };
}

// ═══════════════════════════════════════════════════════════
// 2. SuperTrend
// ═══════════════════════════════════════════════════════════

const superTrendDefinition: StrategyDefinition = {
  id: "super-trend",
  name: "SuperTrend",
  nameZh: "超级趋势",
  description: "A trend-following indicator that uses ATR to determine stop loss levels and trend direction.",
  descriptionZh: "使用ATR确定止损位和趋势方向的趋势跟踪指标。",
  version: "1.0",
  author: "Open Source",
  parameters: [
    {
      id: "atrPeriod",
      name: "ATR Period",
      nameZh: "ATR周期",
      type: "int",
      defaultValue: 10,
      min: 1,
      max: 50,
      step: 1,
    },
    {
      id: "factor",
      name: "Factor",
      nameZh: "倍数",
      type: "float",
      defaultValue: 3.0,
      min: 0.1,
      max: 10,
      step: 0.1,
    },
  ],
};

function calculateSuperTrend(ctx: StrategyContext): StrategyOutput {
  const { klines, params } = ctx;
  const atrPeriod = params.atrPeriod as number;
  const factor = params.factor as number;

  const atrValues = atr(klines, atrPeriod);
  const upperBand: number[] = [];
  const lowerBand: number[] = [];
  const superTrend: number[] = [];
  const direction: number[] = []; // 1 = up, -1 = down

  for (let i = 0; i < klines.length; i++) {
    const k = klines[i];
    const basicUpper = (k.high + k.low) / 2 + factor * atrValues[i];
    const basicLower = (k.high + k.low) / 2 - factor * atrValues[i];

    if (i === 0) {
      upperBand.push(basicUpper);
      lowerBand.push(basicLower);
      superTrend.push(basicLower);
      direction.push(1);
      continue;
    }

    // 调整上下轨
    const prevUpper = upperBand[i - 1];
    const prevLower = lowerBand[i - 1];
    
    upperBand.push(basicUpper < prevUpper || klines[i - 1].close > prevUpper ? basicUpper : prevUpper);
    lowerBand.push(basicLower > prevLower || klines[i - 1].close < prevLower ? basicLower : prevLower);

    // 确定趋势方向
    if (superTrend[i - 1] === upperBand[i - 1]) {
      direction.push(k.close > upperBand[i] ? 1 : -1);
    } else {
      direction.push(k.close < lowerBand[i] ? -1 : 1);
    }

    superTrend.push(direction[i] === 1 ? lowerBand[i] : upperBand[i]);
  }

  const lines: StrategyLine[] = [
    {
      id: "superTrend",
      name: "SuperTrend",
      data: superTrend.map((v, i) => ({ time: klines[i].time, value: v })),
      color: "#00B0FF",
      lineWidth: 2,
    },
  ];

  // 生成信号
  const signals: StrategySignal[] = [];
  for (let i = 1; i < direction.length; i++) {
    if (direction[i] !== direction[i - 1]) {
      signals.push({
        time: klines[i].time,
        price: klines[i].close,
        direction: direction[i] === 1 ? "buy" : "sell",
        label: direction[i] === 1 ? "ST Buy" : "ST Sell",
        strength: 0.8,
      });
    }
  }

  return { lines, labels: [], signals, zones: [] };
}

// ═══════════════════════════════════════════════════════════
// 3. VWAP + Bands
// ═══════════════════════════════════════════════════════════

const vwapDefinition: StrategyDefinition = {
  id: "vwap-bands",
  name: "VWAP with Bands",
  nameZh: "VWAP通道",
  description: "Volume Weighted Average Price with standard deviation bands for intraday trading.",
  descriptionZh: "成交量加权平均价，带标准差通道，适用于日内交易。",
  version: "1.0",
  author: "Open Source",
  parameters: [],
};

function calculateVWAP(ctx: StrategyContext): StrategyOutput {
  const { klines } = ctx;
  const { vwap: vwapValues, upper1, lower1, upper2, lower2 } = vwap(klines);

  const lines: StrategyLine[] = [
    {
      id: "vwap",
      name: "VWAP",
      data: vwapValues.map((v, i) => ({ time: klines[i].time, value: v })),
      color: "#FF9100",
      lineWidth: 2,
    },
    {
      id: "upper1",
      name: "Upper Band 1σ",
      data: upper1.map((v, i) => ({ time: klines[i].time, value: v })),
      color: "rgba(255, 138, 128, 0.6)",
      lineWidth: 1,
      style: "dashed",
    },
    {
      id: "lower1",
      name: "Lower Band 1σ",
      data: lower1.map((v, i) => ({ time: klines[i].time, value: v })),
      color: "rgba(105, 240, 174, 0.6)",
      lineWidth: 1,
      style: "dashed",
    },
    {
      id: "upper2",
      name: "Upper Band 2σ",
      data: upper2.map((v, i) => ({ time: klines[i].time, value: v })),
      color: "rgba(255, 82, 82, 0.4)",
      lineWidth: 1,
      style: "dotted",
    },
    {
      id: "lower2",
      name: "Lower Band 2σ",
      data: lower2.map((v, i) => ({ time: klines[i].time, value: v })),
      color: "rgba(0, 200, 83, 0.4)",
      lineWidth: 1,
      style: "dotted",
    },
  ];

  // 生成信号：价格穿越 VWAP
  const signals: StrategySignal[] = [];
  for (let i = 1; i < klines.length; i++) {
    const prevClose = klines[i - 1].close;
    const currClose = klines[i].close;
    const vwapValue = vwapValues[i];

    if (isNaN(vwapValue)) continue;

    if (prevClose < vwapValues[i - 1] && currClose > vwapValue) {
      signals.push({
        time: klines[i].time,
        price: currClose,
        direction: "buy",
        label: "VWAP Cross Up",
        strength: 0.6,
      });
    } else if (prevClose > vwapValues[i - 1] && currClose < vwapValue) {
      signals.push({
        time: klines[i].time,
        price: currClose,
        direction: "sell",
        label: "VWAP Cross Down",
        strength: 0.6,
      });
    }
  }

  return { lines, labels: [], signals, zones: [] };
}

// ═══════════════════════════════════════════════════════════
// 4. MACD Histogram with Signals
// ═══════════════════════════════════════════════════════════

const macdDefinition: StrategyDefinition = {
  id: "macd-enhanced",
  name: "MACD Enhanced",
  nameZh: "增强MACD",
  description: "MACD with histogram and divergence detection for stronger signals.",
  descriptionZh: "带柱状图和背离检测的MACD，信号更强。",
  version: "1.0",
  author: "Open Source",
  parameters: [
    {
      id: "fastLength",
      name: "Fast Length",
      nameZh: "快线长度",
      type: "int",
      defaultValue: 12,
      min: 2,
      max: 50,
      step: 1,
    },
    {
      id: "slowLength",
      name: "Slow Length",
      nameZh: "慢线长度",
      type: "int",
      defaultValue: 26,
      min: 5,
      max: 100,
      step: 1,
    },
    {
      id: "signalLength",
      name: "Signal Length",
      nameZh: "信号线长度",
      type: "int",
      defaultValue: 9,
      min: 2,
      max: 50,
      step: 1,
    },
  ],
};

function calculateMACD(ctx: StrategyContext): StrategyOutput {
  const { klines, params } = ctx;
  const fastLength = params.fastLength as number;
  const slowLength = params.slowLength as number;
  const signalLength = params.signalLength as number;

  const closes = klines.map(k => k.close);
  const fastEMA = ema(closes, fastLength);
  const slowEMA = ema(closes, slowLength);
  
  const macdLine = fastEMA.map((v, i) => {
    if (isNaN(v) || isNaN(slowEMA[i])) return NaN;
    return v - slowEMA[i];
  });
  
  const signalLine = ema(macdLine.filter(v => !isNaN(v)), signalLength);
  
  // 对齐信号线
  const alignedSignal: number[] = [];
  let signalIdx = 0;
  for (let i = 0; i < macdLine.length; i++) {
    if (isNaN(macdLine[i])) {
      alignedSignal.push(NaN);
    } else {
      alignedSignal.push(signalIdx < signalLine.length ? signalLine[signalIdx++] : NaN);
    }
  }

  const histogram = macdLine.map((v, i) => {
    if (isNaN(v) || isNaN(alignedSignal[i])) return NaN;
    return v - alignedSignal[i];
  });

  const lines: StrategyLine[] = [
    {
      id: "macd",
      name: "MACD",
      data: macdLine.map((v, i) => ({ time: klines[i].time, value: v })),
      color: "#00E5FF",
      lineWidth: 2,
    },
    {
      id: "signal",
      name: "Signal",
      data: alignedSignal.map((v, i) => ({ time: klines[i].time, value: v })),
      color: "#FF9100",
      lineWidth: 2,
      style: "dashed",
    },
  ];

  // 柱状图用 zones 表示
  const zones = histogram.map((v, i) => {
    if (isNaN(v)) return null;
    return {
      id: `hist-${i}`,
      startTime: klines[i].time,
      endTime: klines[i].time,
      topPrice: Math.max(0, v),
      bottomPrice: Math.min(0, v),
      color: v >= 0 ? "rgba(0, 229, 255, 0.4)" : "rgba(255, 23, 68, 0.4)",
      label: "",
    };
  }).filter(Boolean) as StrategyOutput["zones"];

  // 生成信号
  const signals: StrategySignal[] = [];
  for (let i = 2; i < macdLine.length; i++) {
    if (isNaN(macdLine[i]) || isNaN(alignedSignal[i])) continue;

    // MACD 穿越信号线
    if (macdLine[i - 1] < alignedSignal[i - 1] && macdLine[i] >= alignedSignal[i]) {
      signals.push({
        time: klines[i].time,
        price: klines[i].close,
        direction: "buy",
        label: "MACD Bullish",
        strength: Math.min(Math.abs(histogram[i]) / 10, 1),
      });
    } else if (macdLine[i - 1] > alignedSignal[i - 1] && macdLine[i] <= alignedSignal[i]) {
      signals.push({
        time: klines[i].time,
        price: klines[i].close,
        direction: "sell",
        label: "MACD Bearish",
        strength: Math.min(Math.abs(histogram[i]) / 10, 1),
      });
    }

    // 背离检测（简化版）
    if (i >= 5) {
      const priceHigher = klines[i].close > klines[i - 5].close;
      const macdLower = macdLine[i] < macdLine[i - 5];
      if (priceHigher && macdLower && macdLine[i] > 0) {
        signals.push({
          time: klines[i].time,
          price: klines[i].close,
          direction: "sell",
          label: "MACD Bearish Divergence",
          strength: 0.7,
        });
      }
    }
  }

  return { lines, labels: [], signals, zones };
}

// ═══════════════════════════════════════════════════════════
// 5. Bollinger Bands Strategy
// ═══════════════════════════════════════════════════════════

const bollingerDefinition: StrategyDefinition = {
  id: "bollinger-bands",
  name: "Bollinger Bands Strategy",
  nameZh: "布林带策略",
  description: "Classic Bollinger Bands with squeeze detection and breakout signals.",
  descriptionZh: "经典布林带，带挤压检测和突破信号。",
  version: "1.0",
  author: "John Bollinger (ported)",
  parameters: [
    {
      id: "length",
      name: "Length",
      nameZh: "周期",
      type: "int",
      defaultValue: 20,
      min: 5,
      max: 100,
      step: 1,
    },
    {
      id: "mult",
      name: "Multiplier",
      nameZh: "倍数",
      type: "float",
      defaultValue: 2.0,
      min: 0.5,
      max: 5,
      step: 0.1,
    },
  ],
};

function calculateBollinger(ctx: StrategyContext): StrategyOutput {
  const { klines, params } = ctx;
  const length = params.length as number;
  const mult = params.mult as number;

  const closes = klines.map(k => k.close);
  const basis = sma(closes, length);
  const dev = stdev(closes, length);
  
  const upper = basis.map((v, i) => isNaN(v) ? NaN : v + mult * dev[i]);
  const lower = basis.map((v, i) => isNaN(v) ? NaN : v - mult * dev[i]);

  const lines: StrategyLine[] = [
    {
      id: "basis",
      name: "Basis (SMA)",
      data: basis.map((v, i) => ({ time: klines[i].time, value: v })),
      color: "#FF9100",
      lineWidth: 2,
    },
    {
      id: "upper",
      name: "Upper Band",
      data: upper.map((v, i) => ({ time: klines[i].time, value: v })),
      color: "rgba(0, 176, 255, 0.6)",
      lineWidth: 1,
      style: "dashed",
    },
    {
      id: "lower",
      name: "Lower Band",
      data: lower.map((v, i) => ({ time: klines[i].time, value: v })),
      color: "rgba(0, 200, 83, 0.6)",
      lineWidth: 1,
      style: "dashed",
    },
  ];

  // 生成信号
  const signals: StrategySignal[] = [];
  for (let i = 1; i < klines.length; i++) {
    if (isNaN(upper[i]) || isNaN(lower[i])) continue;

    const k = klines[i];
    const prevK = klines[i - 1];

    // 价格从下方穿越下轨 - 买入
    if (prevK.close <= lower[i - 1] && k.close > lower[i]) {
      signals.push({
        time: k.time,
        price: k.close,
        direction: "buy",
        label: "BB Bounce",
        strength: 0.7,
      });
    }
    // 价格从上方穿越上轨 - 卖出
    else if (prevK.close >= upper[i - 1] && k.close < upper[i]) {
      signals.push({
        time: k.time,
        price: k.close,
        direction: "sell",
        label: "BB Reversal",
        strength: 0.7,
      });
    }

    // 挤压检测（带宽收窄）
    if (i >= 20) {
      const currentWidth = (upper[i] - lower[i]) / basis[i];
      const avgWidth = Array.from({ length: 20 }, (_, j) => {
        const idx = i - j;
        return (upper[idx] - lower[idx]) / basis[idx];
      }).reduce((a, b) => a + b, 0) / 20;
      
      if (currentWidth < avgWidth * 0.6 && currentWidth > 0) {
        signals.push({
          time: k.time,
          price: k.close,
          direction: "neutral",
          label: "BB Squeeze",
          strength: 0.5,
          metadata: { squeeze: true },
        });
      }
    }
  }

  return { lines, labels: [], signals, zones: [] };
}

// ═══════════════════════════════════════════════════════════
// 注册所有指标
// ═══════════════════════════════════════════════════════════

export function registerAllIndicators() {
  strategyRegistry.register({
    definition: waveTrendDefinition,
    calculate: calculateWaveTrend,
  });

  strategyRegistry.register({
    definition: superTrendDefinition,
    calculate: calculateSuperTrend,
  });

  strategyRegistry.register({
    definition: vwapDefinition,
    calculate: calculateVWAP,
  });

  strategyRegistry.register({
    definition: macdDefinition,
    calculate: calculateMACD,
  });

  strategyRegistry.register({
    definition: bollingerDefinition,
    calculate: calculateBollinger,
  });
}

// 自动注册
registerAllIndicators();

// 导出定义供 UI 使用
export const indicatorDefinitions = [
  waveTrendDefinition,
  superTrendDefinition,
  vwapDefinition,
  macdDefinition,
  bollingerDefinition,
];

console.log("[Indicators] Registered 5 popular TradingView indicators");
