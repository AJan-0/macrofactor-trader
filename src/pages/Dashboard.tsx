import { useState, useEffect, useCallback } from "react";
import Toolbar from "@/components/Toolbar";
import ChartWidget from "@/components/ChartWidget";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import FactorDashboard from "@/components/FactorDashboard";
import FactorTimeline from "@/components/FactorTimeline";
import NarrativeBar from "@/components/NarrativeBar";
import UpcomingCalendar from "@/components/UpcomingCalendar";
import { useAppStore } from "@/store/appStore";
import {
  loadUserFactors, saveUserFactors, BUILTIN_LIBRARY, applyWeightTemplate,
  enableAll, disableAll, enableThisWeek, enableNextWeek,
} from "@/data/factorLibrary";
import type { WeightTemplate } from "@/data/factorLibrary";
import { analyzeFactors } from "@/services/factorEngine";
import type { FactorCombination, FactorItem } from "@/services/factorEngine";
import { loadBacktestData, calculateSummary } from "@/services/backtestEngine";
import type { BacktestRecord, BacktestSummary } from "@/services/backtestEngine";

export default function Dashboard() {
  const events = useAppStore(s => s.events);

  const [factors, setFactors] = useState<FactorItem[]>([]);
  const [combo, setCombo] = useState<FactorCombination | null>(null);
  const [backtestRecords, setBacktestRecords] = useState<BacktestRecord[]>([]);
  const [backtestSummary, setBacktestSummary] = useState<BacktestSummary | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string>("");

  // 初始化因子引擎
  useEffect(() => {
    const loaded = loadUserFactors();
    setFactors(loaded);
    setCombo(analyzeFactors(loaded));

    loadBacktestData().then(records => {
      setBacktestRecords(records);
      setBacktestSummary(calculateSummary(records));
    });

    setLastUpdate(new Date().toLocaleTimeString());
  }, []);

  // 切换因子开关
  const toggleFactor = useCallback((id: string) => {
    setFactors(prev => {
      const next = prev.map(f => f.id === id ? { ...f, enabled: !f.enabled } : f);
      saveUserFactors(next);
      const result = analyzeFactors(next);
      setCombo(result);
      return next;
    });
  }, []);

  // 调整概率
  const adjustProbability = useCallback((id: string, prob: number) => {
    setFactors(prev => {
      const next = prev.map(f => f.id === id ? { ...f, probability: prob } : f);
      saveUserFactors(next);
      setCombo(analyzeFactors(next));
      return next;
    });
  }, []);

  // 调整权重
  const adjustWeight = useCallback((id: string, weight: number) => {
    setFactors(prev => {
      const next = prev.map(f => f.id === id ? { ...f, weight } : f);
      saveUserFactors(next);
      setCombo(analyzeFactors(next));
      return next;
    });
  }, []);

  // 添加自定义因子
  const addCustom = useCallback((f: FactorItem) => {
    setFactors(prev => {
      const next = [...prev, f];
      saveUserFactors(next);
      setCombo(analyzeFactors(next));
      return next;
    });
  }, []);

  // 重置
  const handleReset = useCallback(() => {
    const def = BUILTIN_LIBRARY.map(f => ({ ...f }));
    setFactors(def);
    setCombo(analyzeFactors(def));
    saveUserFactors(def);
  }, []);

  // 应用权重模板
  const handleApplyTemplate = useCallback((template: WeightTemplate) => {
    setFactors(prev => {
      const next = applyWeightTemplate(prev, template);
      saveUserFactors(next);
      setCombo(analyzeFactors(next));
      return next;
    });
  }, []);

  // 批量操作
  const handleEnableAll = useCallback(() => {
    setFactors(prev => {
      const next = enableAll(prev);
      saveUserFactors(next);
      setCombo(analyzeFactors(next));
      return next;
    });
  }, []);

  const handleDisableAll = useCallback(() => {
    setFactors(prev => {
      const next = disableAll(prev);
      saveUserFactors(next);
      setCombo(analyzeFactors(next));
      return next;
    });
  }, []);

  const handleEnableThisWeek = useCallback(() => {
    setFactors(prev => {
      const next = enableThisWeek(prev);
      saveUserFactors(next);
      setCombo(analyzeFactors(next));
      return next;
    });
  }, []);

  const handleEnableNextWeek = useCallback(() => {
    setFactors(prev => {
      const next = enableNextWeek(prev);
      saveUserFactors(next);
      setCombo(analyzeFactors(next));
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col h-screen bg-[#0a0e1a] overflow-hidden">
      <Toolbar />
      {/* 核心叙事摘要 */}
      <NarrativeBar combo={combo} lastUpdate={lastUpdate} />
      {/* 本周Upcoming事件 */}
      <UpcomingCalendar events={events} />

      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：图表区域 */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 p-2 pb-0 min-h-0">
            <div className="h-full rounded-lg border border-[#1e293b] bg-[#111827] overflow-hidden">
              <ErrorBoundary>
                <ChartWidget />
              </ErrorBoundary>
            </div>
          </div>
          <FactorTimeline />
        </div>
        {/* 右侧：因子面板 */}
        <div className="w-[30%] min-w-[300px] max-w-[400px] border-l border-[#1e293b]">
          <FactorDashboard
            combo={combo}
            factors={factors}
            backtestRecords={backtestRecords}
            backtestSummary={backtestSummary}
            onToggleFactor={toggleFactor}
            onAdjustProb={adjustProbability}
            onAdjustWeight={adjustWeight}
            onAddCustom={addCustom}
            onReset={handleReset}
            onApplyTemplate={handleApplyTemplate}
            onEnableAll={handleEnableAll}
            onDisableAll={handleDisableAll}
            onEnableThisWeek={handleEnableThisWeek}
            onEnableNextWeek={handleEnableNextWeek}
          />
        </div>
      </div>
    </div>
  );
}
