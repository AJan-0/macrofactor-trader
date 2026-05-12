import { createContext, useContext } from "react";

export type AssetSymbol = "BTC-USDT" | "ETH-USDT" | "GC=F";
export type Timeframe = "1m" | "3m" | "5m" | "15m" | "1H" | "4H" | "1D";
export type EventCategory = "Macro" | "GeoPolitics" | "CryptoNative";
export type EventSubcategory = "FOMC" | "CPI" | "NFP" | "War" | "ETF" | "FOMC_Forecast" | "CPI_Forecast" | "Other";
export type ImpactLevel = "high" | "medium" | "low";

/**
 * 增强型宏观因子事件模型
 * 包含：预期/实际/偏差、BTC价格影响分析、未来预测概率
 */
export interface MacroEvent {
  id: string;
  timestamp: number;
  date_str: string;
  category: EventCategory;
  subcategory: EventSubcategory;
  title: string;
  impact_level: ImpactLevel;
  // 预期 vs 实际
  expected: number | null;
  previous: number | null;
  actual_value: number | null;
  change: number | null;
  deviation: number | null; // 实际变化 - 预期变化
  unit: string;
  description: string;
  source_name: string;
  source_url: string;
  // 未来预测标记
  is_forecast: boolean;
  forecast_prob_hold?: number;
  forecast_prob_hike?: number;
  forecast_prob_cut?: number;
  // BTC价格影响分析（事件窗口）
  btc_impact_1d: number | null;
  btc_impact_3d: number | null;
  btc_impact_7d: number | null;
}

export interface AppState {
  currentSymbol: AssetSymbol;
  currentTimeframe: Timeframe;
  selectedCategories: EventCategory[];
  selectedImpacts: ImpactLevel[];
  selectedEventId: string | null;
  activeTimestamp: number | null;
  hoverTimestamp: number | null;
  events: MacroEvent[];
  isLoading: boolean;
  error: string | null;
}

export interface AppContextValue extends AppState {
  setSymbol: (s: AssetSymbol) => void;
  setTimeframe: (tf: Timeframe) => void;
  toggleCategory: (cat: EventCategory) => void;
  toggleImpact: (imp: ImpactLevel) => void;
  selectEvent: (id: string, ts: number) => void;
  setHoverTimestamp: (ts: number | null) => void;
  setEvents: (ev: MacroEvent[]) => void;
  setLoading: (v: boolean) => void;
  setError: (msg: string | null) => void;
}

export const INITIAL_APP_STATE: AppState = {
  currentSymbol: "BTC-USDT",
  currentTimeframe: "1D",
  selectedCategories: [],
  selectedImpacts: [],
  selectedEventId: null,
  activeTimestamp: null,
  hoverTimestamp: null,
  events: [],
  isLoading: false,
  error: null,
};

export const AppContext = createContext<AppContextValue | null>(null);

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppProvider");
  return ctx;
}

export const useChartConfig = () => {
  const ctx = useAppContext();
  return {
    symbol: ctx.currentSymbol, timeframe: ctx.currentTimeframe,
    setSymbol: ctx.setSymbol, setTimeframe: ctx.setTimeframe,
  };
};

export const useChartStatus = () => {
  const ctx = useAppContext();
  return { isLoading: ctx.isLoading, error: ctx.error };
};

export const useAppStore = <T,>(selector: (state: AppContextValue) => T): T => {
  const ctx = useAppContext();
  return selector(ctx);
};
