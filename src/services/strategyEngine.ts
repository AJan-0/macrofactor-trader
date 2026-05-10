/**
 * 策略引擎 —— 可扩展的技术指标与策略系统
 *
 * 设计目标：
 * 1. 类似 TradingView Pine Script 的策略注册与计算机制
 * 2. 策略输出统一为 lines/labels/signals 三种图层
 * 3. 支持参数化配置和实时重算
 */

export interface KlineData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StrategyParameter {
  id: string;
  name: string;
  nameZh?: string;
  type: "int" | "float" | "bool" | "color" | "string";
  defaultValue: any;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  group?: string;
  tooltip?: string;
}

export interface StrategyDefinition {
  id: string;
  name: string;
  nameZh: string;
  description: string;
  descriptionZh: string;
  version: string;
  author: string;
  parameters: StrategyParameter[];
}

export interface StrategyLine {
  id: string;
  name: string;
  data: { time: number; value: number | null }[];
  color: string;
  lineWidth: number;
  style?: "solid" | "dashed" | "dotted";
}

export interface StrategyLabel {
  time: number;
  price: number;
  text: string;
  color: string;
  textColor?: string;
  direction: "above" | "below";
  size?: number;
}

export interface StrategySignal {
  time: number;
  price: number;
  direction: "buy" | "sell" | "neutral";
  label: string;
  strength: number; // 0-1
  metadata?: Record<string, any>;
}

export interface StrategyZone {
  id: string;
  startTime: number;
  endTime: number;
  topPrice: number;
  bottomPrice: number;
  color: string;
  borderColor?: string;
  label?: string;
}

export interface StrategyOutput {
  lines: StrategyLine[];
  labels: StrategyLabel[];
  signals: StrategySignal[];
  zones: StrategyZone[];
}

export interface StrategyContext {
  klines: KlineData[];
  params: Record<string, any>;
}

export interface Strategy {
  definition: StrategyDefinition;
  calculate(ctx: StrategyContext): StrategyOutput;
}

// ──────────────────────────────
// 策略注册表
// ──────────────────────────────

class StrategyRegistry {
  private strategies = new Map<string, Strategy>();

  register(strategy: Strategy) {
    this.strategies.set(strategy.definition.id, strategy);
  }

  get(id: string): Strategy | undefined {
    return this.strategies.get(id);
  }

  getAll(): Strategy[] {
    return Array.from(this.strategies.values());
  }

  getDefinitions(): StrategyDefinition[] {
    return this.getAll().map(s => s.definition);
  }
}

export const strategyRegistry = new StrategyRegistry();

// ──────────────────────────────
// 默认参数工具
// ──────────────────────────────

export function getDefaultParams(def: StrategyDefinition): Record<string, any> {
  const params: Record<string, any> = {};
  for (const p of def.parameters) {
    params[p.id] = p.defaultValue;
  }
  return params;
}

// ──────────────────────────────
// 回测类型定义
// ──────────────────────────────

export interface StrategyBacktestResult {
  signals: StrategySignal[];
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgReturn: number;
  maxDrawdown: number;
  sharpeRatio: number;
  profitFactor: number;
  equityCurve: { time: number; equity: number }[];
}

export interface TradeRecord {
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  direction: "buy" | "sell";
  pnl: number;
  pnlPct: number;
  exitReason: "signal" | "stoploss" | "takeprofit" | "end";
}

/**
 * 简单回测引擎
 * 基于策略信号进行回测，假设每个信号反向平仓
 */
export function backtestStrategy(
  signals: StrategySignal[],
  klines: KlineData[],
  options: {
    initialCapital?: number;
    positionSize?: number; // 固定仓位比例 0-1
    stopLossPct?: number;  // 止损比例
    takeProfitPct?: number; // 止盈比例
    maxHoldBars?: number;  // 最大持仓K线数
  } = {}
): StrategyBacktestResult & { trades: TradeRecord[] } {
  const {
    initialCapital = 10000,
    positionSize = 1.0,
    stopLossPct = 0.05,
    takeProfitPct = 0.1,
    maxHoldBars = 50,
  } = options;

  const trades: TradeRecord[] = [];
  let equity = initialCapital;
  const equityCurve: { time: number; equity: number }[] = [];

  let position: {
    direction: "buy" | "sell";
    entryPrice: number;
    entryTime: number;
    entryIndex: number;
  } | null = null;

  for (let i = 0; i < klines.length; i++) {
    const k = klines[i];
    equityCurve.push({ time: k.time, equity });

    // 检查是否有信号
    const signal = signals.find(s => s.time === k.time);

    // 如果有持仓，检查平仓条件
    if (position) {
      const holdBars = i - position.entryIndex;
      const currentReturn = position.direction === "buy"
        ? (k.close - position.entryPrice) / position.entryPrice
        : (position.entryPrice - k.close) / position.entryPrice;

      let shouldClose = false;
      let exitReason: TradeRecord["exitReason"] = "signal";

      if (signal && signal.direction !== "neutral") {
        // 反向信号平仓
        if ((position.direction === "buy" && signal.direction === "sell") ||
            (position.direction === "sell" && signal.direction === "buy")) {
          shouldClose = true;
          exitReason = "signal";
        }
      }

      if (!shouldClose && currentReturn <= -stopLossPct) {
        shouldClose = true;
        exitReason = "stoploss";
      }
      if (!shouldClose && currentReturn >= takeProfitPct) {
        shouldClose = true;
        exitReason = "takeprofit";
      }
      if (!shouldClose && holdBars >= maxHoldBars) {
        shouldClose = true;
        exitReason = "end";
      }

      if (shouldClose) {
        const pnl = position.direction === "buy"
          ? (k.close - position.entryPrice) * (equity * positionSize / position.entryPrice)
          : (position.entryPrice - k.close) * (equity * positionSize / position.entryPrice);
        const pnlPct = position.direction === "buy"
          ? (k.close - position.entryPrice) / position.entryPrice
          : (position.entryPrice - k.close) / position.entryPrice;

        equity += pnl;
        trades.push({
          entryTime: position.entryTime,
          entryPrice: position.entryPrice,
          exitTime: k.time,
          exitPrice: k.close,
          direction: position.direction,
          pnl,
          pnlPct,
          exitReason,
        });
        position = null;
      }
    }

    // 开新仓
    if (!position && signal && (signal.direction === "buy" || signal.direction === "sell")) {
      position = {
        direction: signal.direction,
        entryPrice: k.close,
        entryTime: k.time,
        entryIndex: i,
      };
    }
  }

  // 强制平仓最后一笔
  if (position && klines.length > 0) {
    const lastK = klines[klines.length - 1];
    const pnl = position.direction === "buy"
      ? (lastK.close - position.entryPrice) * (equity * positionSize / position.entryPrice)
      : (position.entryPrice - lastK.close) * (equity * positionSize / position.entryPrice);
    const pnlPct = position.direction === "buy"
      ? (lastK.close - position.entryPrice) / position.entryPrice
      : (position.entryPrice - lastK.close) / position.entryPrice;

    equity += pnl;
    trades.push({
      entryTime: position.entryTime,
      entryPrice: position.entryPrice,
      exitTime: lastK.time,
      exitPrice: lastK.close,
      direction: position.direction,
      pnl,
      pnlPct,
      exitReason: "end",
    });
  }

  const winningTrades = trades.filter(t => t.pnl > 0).length;
  const losingTrades = trades.filter(t => t.pnl < 0).length;
  const totalReturn = trades.reduce((sum, t) => sum + t.pnlPct, 0);
  const avgReturn = trades.length > 0 ? totalReturn / trades.length : 0;

  // 最大回撤
  let maxDrawdown = 0;
  let peak = initialCapital;
  for (const point of equityCurve) {
    if (point.equity > peak) peak = point.equity;
    const dd = (peak - point.equity) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // 夏普比率（简化版）
  const returns = trades.map(t => t.pnlPct);
  const mean = avgReturn;
  const variance = returns.length > 1
    ? returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1)
    : 0;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? mean / stdDev : 0;

  // 盈亏比
  const grossProfit = trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnlPct, 0);
  const grossLoss = Math.abs(trades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnlPct, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  return {
    signals: signals.filter(s => s.direction !== "neutral"),
    totalTrades: trades.length,
    winningTrades,
    losingTrades,
    winRate: trades.length > 0 ? Math.round((winningTrades / trades.length) * 100) : 0,
    avgReturn: Math.round(avgReturn * 10000) / 100,
    maxDrawdown: Math.round(maxDrawdown * 10000) / 100,
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    equityCurve,
    trades,
  };
}
