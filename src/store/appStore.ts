import { create } from "zustand";

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

interface AppActions {
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

const INITIAL_APP_STATE: AppState = {
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

export const useAppStore = create<AppState & AppActions>()((set) => ({
  ...INITIAL_APP_STATE,
  setSymbol: (s) => set({ currentSymbol: s, isLoading: true, error: null }),
  setTimeframe: (tf) => set({ currentTimeframe: tf, isLoading: true, error: null }),
  toggleCategory: (cat) => set((state) => ({
    selectedCategories: state.selectedCategories.includes(cat)
      ? state.selectedCategories.filter((c) => c !== cat)
      : [...state.selectedCategories, cat],
  })),
  toggleImpact: (imp) => set((state) => ({
    selectedImpacts: state.selectedImpacts.includes(imp)
      ? state.selectedImpacts.filter((i) => i !== imp)
      : [...state.selectedImpacts, imp],
  })),
  selectEvent: (id, ts) => set({ selectedEventId: id, activeTimestamp: ts }),
  setHoverTimestamp: (ts) => set({ hoverTimestamp: ts }),
  setEvents: (ev) => set({ events: ev, isLoading: false }),
  setLoading: (v) => set({ isLoading: v }),
  setError: (msg) => set({ error: msg, isLoading: false }),
}));
