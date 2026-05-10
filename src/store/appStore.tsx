import { createContext, useContext, useState, useCallback } from "react";

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

interface AppState {
  currentSymbol: AssetSymbol;
  currentTimeframe: Timeframe;
  selectedCategories: EventCategory[];
  selectedImpacts: ImpactLevel[];
  selectedEventId: string | null;
  activeTimestamp: number | null;
  hoverTimestamp: number | null;  // 悬停因子对应的时间戳
  events: MacroEvent[];
  isLoading: boolean;
  error: string | null;
}

interface AppContextValue extends AppState {
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

export const AppContext = createContext<AppContextValue | null>(null);

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppProvider");
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>({
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
  });

  const setSymbol      = useCallback((s: AssetSymbol) => setState(p => ({ ...p, currentSymbol: s, isLoading: true, error: null })), []);
  const setTimeframe   = useCallback((tf: Timeframe) => setState(p => ({ ...p, currentTimeframe: tf, isLoading: true, error: null })), []);
  const toggleCategory = useCallback((cat: EventCategory) => setState(p => ({
    ...p, selectedCategories: p.selectedCategories.includes(cat)
      ? p.selectedCategories.filter(c => c !== cat)
      : [...p.selectedCategories, cat]
  })), []);
  const toggleImpact   = useCallback((imp: ImpactLevel) => setState(p => ({
    ...p, selectedImpacts: p.selectedImpacts.includes(imp)
      ? p.selectedImpacts.filter(i => i !== imp)
      : [...p.selectedImpacts, imp]
  })), []);
  const selectEvent    = useCallback((id: string, ts: number) => setState(p => ({ ...p, selectedEventId: id, activeTimestamp: ts })), []);
  const setHoverTimestamp = useCallback((ts: number | null) => setState(p => ({ ...p, hoverTimestamp: ts })), []);
  const setEvents      = useCallback((ev: MacroEvent[]) => setState(p => ({ ...p, events: ev, isLoading: false })), []);
  const setLoading     = useCallback((v: boolean) => setState(p => ({ ...p, isLoading: v })), []);
  const setError       = useCallback((msg: string | null) => setState(p => ({ ...p, error: msg, isLoading: false })), []);

  const value: AppContextValue = {
    ...state,
    setSymbol, setTimeframe, toggleCategory, toggleImpact,
    selectEvent, setHoverTimestamp, setEvents, setLoading, setError,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// Convenience hooks for components
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
