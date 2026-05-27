/**
 * 实时因子 Hook
 * 自动订阅实时数据，管理因子状态更新
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { FactorItem, FactorCombination } from "@/services/factorEngine";
import { analyzeFactors } from "@/services/factorEngine";
import { getRealtimeService, type RealtimeEvent } from "@/services/realtimeDataService";
import { recalculateProbability } from "@/services/probabilityEngine";
import { loadUserFactors, saveUserFactors } from "@/data/factorLibrary";

export interface FactorUpdate {
  factorId: string;
  reason: string;
  timestamp: number;
}

export interface UseRealtimeFactorsReturn {
  factors: FactorItem[];
  combination: FactorCombination;
  isRealtime: boolean;
  lastUpdate: number;
  updates: FactorUpdate[];
  refresh: () => void;
  toggleFactor: (id: string) => void;
  updateFactorWeight: (id: string, weight: number) => void;
  updateFactorDirection: (id: string, direction: FactorItem["directionOverride"]) => void;
}

export function useRealtimeFactors(): UseRealtimeFactorsReturn {
  const [factors, setFactors] = useState<FactorItem[]>(loadUserFactors);
  const combination = useMemo<FactorCombination>(() => analyzeFactors(factors), [factors]);
  const [isRealtime] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(() => Date.now());
  const [updates, setUpdates] = useState<FactorUpdate[]>([]);

  const factorHistory = useRef<Map<string, number[]>>(new Map());
  // 处理实时事件
  const handleEvent = useCallback((event: RealtimeEvent) => {
    setFactors(currentFactors => {
      const newFactors = [...currentFactors];
      let hasUpdate = false;
      const newUpdates: FactorUpdate[] = [];

      for (let i = 0; i < newFactors.length; i++) {
        const factor = newFactors[i];
        const history = factorHistory.current.get(factor.id) || [];

        const update = recalculateProbability(factor, event, history);

        if (update && update.confidence > 0.2) {
          // 更新概率
          newFactors[i] = {
            ...factor,
            probability: update.newProbability,
          };

          // 记录历史
          history.push(update.newProbability);
          if (history.length > 50) history.shift();
          factorHistory.current.set(factor.id, history);

          // 记录更新原因
          newUpdates.push({
            factorId: factor.id,
            reason: update.reason,
            timestamp: update.timestamp,
          });

          hasUpdate = true;
        }
      }

      if (newUpdates.length > 0) {
        setUpdates(prev => [...newUpdates, ...prev].slice(0, 20));
      }

      return hasUpdate ? newFactors : currentFactors;
    });
  }, []);

  // 启动实时数据
  useEffect(() => {
    const service = getRealtimeService();
    service.start();

    const unsubscribe = service.subscribe(handleEvent);

    return () => {
      unsubscribe();
      service.stop();
    };
  }, [handleEvent]);

  const refresh = useCallback(() => {
    const fresh = loadUserFactors();
    setFactors(fresh);
    setLastUpdate(Date.now());
  }, []);

  const toggleFactor = useCallback((id: string) => {
    setFactors(current => {
      const updated = current.map(f =>
        f.id === id ? { ...f, enabled: !f.enabled } : f
      );
      saveUserFactors(updated);
      return updated;
    });
  }, []);

  const updateFactorWeight = useCallback((id: string, weight: number) => {
    setFactors(current => {
      const updated = current.map(f =>
        f.id === id ? { ...f, weight: Math.max(0, Math.min(2, weight)) } : f
      );
      saveUserFactors(updated);
      return updated;
    });
  }, []);

  const updateFactorDirection = useCallback((id: string, direction: FactorItem["directionOverride"]) => {
    setFactors(current => {
      const updated = current.map(f =>
        f.id === id ? { ...f, directionOverride: direction } : f
      );
      saveUserFactors(updated);
      return updated;
    });
  }, []);

  return {
    factors,
    combination,
    isRealtime,
    lastUpdate,
    updates,
    refresh,
    toggleFactor,
    updateFactorWeight,
    updateFactorDirection,
  };
}
