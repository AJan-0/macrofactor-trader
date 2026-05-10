/**
 * 回测引擎 —— 验证因子预测的历史准确率
 */

export interface BacktestRecord {
  factor_id: string;
  title: string;
  date: string;
  category: string;
  impact_level: string;
  engine_prediction: "bullish" | "bearish" | "neutral";
  actual_1d: "bullish" | "bearish" | "neutral" | null;
  actual_7d: "bullish" | "bearish" | "neutral" | null;
  returns: Record<string, number | null>;
}

export interface BacktestSummary {
  total: number;
  correct_1d: number;
  correct_7d: number;
  accuracy_1d: number;
  accuracy_7d: number;
  byCategory: Record<string, { total: number; correct_1d: number; correct_7d: number }>;
}

let _cache: BacktestRecord[] | null = null;

export async function loadBacktestData(): Promise<BacktestRecord[]> {
  if (_cache) return _cache;
  try {
    const resp = await fetch('/data/backtest.json');
    if (!resp.ok) throw new Error('Backtest data unavailable');
    _cache = await resp.json();
    return _cache || [];
  } catch (err) {
    console.warn('[Backtest] Failed to load:', err);
    return [];
  }
}

export function calculateSummary(records: BacktestRecord[]): BacktestSummary {
  const valid = records.filter(r => r.actual_1d !== null && r.engine_prediction !== 'neutral');
  
  const correct_1d = valid.filter(r => r.actual_1d === r.engine_prediction).length;
  const correct_7d = valid.filter(r => r.actual_7d === r.engine_prediction).length;
  
  const byCategory: Record<string, { total: number; correct_1d: number; correct_7d: number }> = {};
  
  for (const r of valid) {
    const cat = r.category;
    if (!byCategory[cat]) byCategory[cat] = { total: 0, correct_1d: 0, correct_7d: 0 };
    byCategory[cat].total++;
    if (r.actual_1d === r.engine_prediction) byCategory[cat].correct_1d++;
    if (r.actual_7d === r.engine_prediction) byCategory[cat].correct_7d++;
  }
  
  return {
    total: valid.length,
    correct_1d,
    correct_7d,
    accuracy_1d: valid.length > 0 ? Math.round((correct_1d / valid.length) * 100) : 0,
    accuracy_7d: valid.length > 0 ? Math.round((correct_7d / valid.length) * 100) : 0,
    byCategory,
  };
}

export function getFactorBacktest(records: BacktestRecord[], factorId: string): BacktestRecord | undefined {
  return records.find(r => r.factor_id === factorId);
}
