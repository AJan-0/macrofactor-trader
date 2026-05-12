import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AppContext,
  INITIAL_APP_STATE,
  type AppContextValue,
  type AppState,
  type AssetSymbol,
  type EventCategory,
  type ImpactLevel,
  type MacroEvent,
  type Timeframe,
} from "./appStore";

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(INITIAL_APP_STATE);

  const setSymbol = useCallback((s: AssetSymbol) => {
    setState(p => ({ ...p, currentSymbol: s, isLoading: true, error: null }));
  }, []);

  const setTimeframe = useCallback((tf: Timeframe) => {
    setState(p => ({ ...p, currentTimeframe: tf, isLoading: true, error: null }));
  }, []);

  const toggleCategory = useCallback((cat: EventCategory) => setState(p => ({
    ...p,
    selectedCategories: p.selectedCategories.includes(cat)
      ? p.selectedCategories.filter(c => c !== cat)
      : [...p.selectedCategories, cat],
  })), []);

  const toggleImpact = useCallback((imp: ImpactLevel) => setState(p => ({
    ...p,
    selectedImpacts: p.selectedImpacts.includes(imp)
      ? p.selectedImpacts.filter(i => i !== imp)
      : [...p.selectedImpacts, imp],
  })), []);

  const selectEvent = useCallback((id: string, ts: number) => {
    setState(p => ({ ...p, selectedEventId: id, activeTimestamp: ts }));
  }, []);

  const setHoverTimestamp = useCallback((ts: number | null) => {
    setState(p => ({ ...p, hoverTimestamp: ts }));
  }, []);

  const setEvents = useCallback((ev: MacroEvent[]) => {
    setState(p => ({ ...p, events: ev, isLoading: false }));
  }, []);

  const setLoading = useCallback((v: boolean) => {
    setState(p => ({ ...p, isLoading: v }));
  }, []);

  const setError = useCallback((msg: string | null) => {
    setState(p => ({ ...p, error: msg, isLoading: false }));
  }, []);

  const value = useMemo<AppContextValue>(() => ({
    ...state,
    setSymbol,
    setTimeframe,
    toggleCategory,
    toggleImpact,
    selectEvent,
    setHoverTimestamp,
    setEvents,
    setLoading,
    setError,
  }), [
    state,
    setSymbol,
    setTimeframe,
    toggleCategory,
    toggleImpact,
    selectEvent,
    setHoverTimestamp,
    setEvents,
    setLoading,
    setError,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
