import { useState, useEffect, useCallback } from "react";
import Toolbar from "@/components/Toolbar";
import ChartWidget from "@/components/ChartWidget";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import FactorDashboard from "@/components/FactorDashboard";
import FactorTimeline from "@/components/FactorTimeline";
import NarrativeBar from "@/components/NarrativeBar";
import UpcomingCalendar from "@/components/UpcomingCalendar";
import MobileNav from "@/components/MobileNav";
import MobileSheet from "@/components/MobileSheet";
import NewsFeed from "@/components/NewsFeed";
import { useAppStore } from "@/store/appStore";
import {
  loadUserFactors, saveUserFactors, resetToDefault, applyWeightTemplate,
  enableAll, disableAll, enableThisWeek, enableNextWeek,
} from "@/data/factorLibrary";
import type { WeightTemplate } from "@/data/factorLibrary";
import { analyzeFactors } from "@/services/factorEngine";
import type { FactorCombination, FactorItem } from "@/services/factorEngine";
import { loadBacktestData, calculateSummary } from "@/services/backtestEngine";
import type { BacktestRecord, BacktestSummary } from "@/services/backtestEngine";
import type { MobileTab } from "@/components/MobileNav";

interface FactorState {
  factors: FactorItem[];
  combo: FactorCombination;
}

function buildFactorState(factors: FactorItem[]): FactorState {
  return {
    factors,
    combo: analyzeFactors(factors),
  };
}

function loadInitialFactorState(): FactorState {
  return buildFactorState(loadUserFactors());
}

export default function Dashboard() {
  const events = useAppStore(s => s.events);

  const [{ factors, combo }, setFactorState] = useState<FactorState>(loadInitialFactorState);
  const [backtestRecords, setBacktestRecords] = useState<BacktestRecord[]>([]);
  const [backtestSummary, setBacktestSummary] = useState<BacktestSummary | null>(null);
  const [lastUpdate] = useState<string>(() => new Date().toLocaleTimeString());

  // 移动端状态
  const [mobileTab, setMobileTab] = useState<MobileTab>("chart");
  const [sheetOpen, setSheetOpen] = useState(false);

  // 初始化异步回测数据
  useEffect(() => {
    loadBacktestData().then(records => {
      setBacktestRecords(records);
      setBacktestSummary(calculateSummary(records));
    });
  }, []);

  const updateFactors = useCallback((recipe: (prev: FactorItem[]) => FactorItem[]) => {
    setFactorState(prev => {
      const next = recipe(prev.factors);
      saveUserFactors(next);
      return buildFactorState(next);
    });
  }, []);

  // 切换因子开关
  const toggleFactor = useCallback((id: string) => {
    updateFactors(prev => prev.map(f => f.id === id ? { ...f, enabled: !f.enabled } : f));
  }, [updateFactors]);

  // 调整概率
  const adjustProbability = useCallback((id: string, prob: number) => {
    updateFactors(prev => prev.map(f => f.id === id ? { ...f, probability: prob } : f));
  }, [updateFactors]);

  // 调整权重
  const adjustWeight = useCallback((id: string, weight: number) => {
    updateFactors(prev => prev.map(f => f.id === id ? { ...f, weight } : f));
  }, [updateFactors]);

  // 添加自定义因子
  const addCustom = useCallback((f: FactorItem) => {
    updateFactors(prev => [...prev, f]);
  }, [updateFactors]);

  // 重置
  const handleReset = useCallback(() => {
    setFactorState(buildFactorState(resetToDefault()));
  }, []);

  // 应用权重模板
  const handleApplyTemplate = useCallback((template: WeightTemplate) => {
    updateFactors(prev => applyWeightTemplate(prev, template));
  }, [updateFactors]);

  // 批量操作
  const handleEnableAll = useCallback(() => {
    updateFactors(enableAll);
  }, [updateFactors]);

  const handleDisableAll = useCallback(() => {
    updateFactors(disableAll);
  }, [updateFactors]);

  const handleEnableThisWeek = useCallback(() => {
    updateFactors(enableThisWeek);
  }, [updateFactors]);

  const handleEnableNextWeek = useCallback(() => {
    updateFactors(enableNextWeek);
  }, [updateFactors]);

  // 移动端 Tab 切换时自动打开 Sheet
  const handleMobileTabChange = useCallback((tab: MobileTab) => {
    setMobileTab(tab);
    if (tab !== "chart") {
      setSheetOpen(true);
    } else {
      setSheetOpen(false);
    }
  }, []);

  // Sheet 关闭时如果当前不是 chart，切回 chart
  const handleSheetClose = useCallback(() => {
    setSheetOpen(false);
    setMobileTab("chart");
  }, []);

  // Sheet 标题
  const sheetTitle =
    mobileTab === "factors" ? "因子面板"
    : mobileTab === "news" ? "新闻信息流"
    : mobileTab === "data" ? "回测数据"
    : "";

  // Sheet 内容
  const sheetContent = (
    mobileTab === "factors" ? (
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
    ) : mobileTab === "news" ? (
      <NewsFeed onAddAsFactor={addCustom} />
    ) : mobileTab === "data" ? (
      <div className="p-4 text-[12px] text-[#94a3b8]">
        <div className="mb-2 font-bold text-[#e2e8f0]">回测概览</div>
        {backtestSummary ? (
          <div className="space-y-1">
            <div>总样本: {backtestSummary.total}</div>
            <div>1日准确率: {backtestSummary.accuracy_1d.toFixed(1)}%</div>
            <div>7日准确率: {backtestSummary.accuracy_7d.toFixed(1)}%</div>
            <div>1日命中: {backtestSummary.correct_1d}/{backtestSummary.total}</div>
            <div>7日命中: {backtestSummary.correct_7d}/{backtestSummary.total}</div>
          </div>
        ) : (
          <div>暂无回测数据</div>
        )}
      </div>
    ) : null
  );

  return (
    <div className="flex flex-col h-screen bg-[#0a0e1a] overflow-hidden">
      <Toolbar />

      {/* 桌面端：叙事栏 + 焦点事件 */}
      <div className="hidden lg:block">
        <NarrativeBar combo={combo} lastUpdate={lastUpdate} />
        <UpcomingCalendar events={events} />
      </div>

      {/* 桌面端布局 */}
      <div className="hidden lg:flex flex-1 overflow-hidden">
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

      {/* 移动端布局 */}
      <div className="lg:hidden flex-1 flex flex-col min-h-0 pb-[56px]">
        {/* 移动端叙事摘要（精简） */}
        {combo && (
          <div className="px-3 py-1.5 border-b border-[#1e293b] bg-[#0a0e1a] flex items-center gap-2 overflow-x-auto scrollbar-hide">
            <span className={`text-[10px] font-bold shrink-0 ${combo.combinedDirection === "bullish" ? "text-[#22c55e]" : combo.combinedDirection === "bearish" ? "text-[#ef4444]" : "text-[#94a3b8]"}`}>
              {combo.combinedDirection === "bullish" ? "▲ 偏多" : combo.combinedDirection === "bearish" ? "▼ 偏空" : "◆ 中性"}
            </span>
            <span className="text-[10px] text-[#475569] shrink-0">
              置信度 {combo.overallConfidence.toFixed(0)}%
            </span>
            <span className="text-[10px] text-[#475569] shrink-0">
              {combo.enabledCount}/{combo.totalCount} 因子
            </span>
          </div>
        )}

        {/* 焦点事件（精简单行） */}
        <UpcomingCalendar events={events} />

        {/* 图表区域 */}
        <div className="flex-1 min-h-0">
          <div className="h-full overflow-hidden">
            <ErrorBoundary>
              <ChartWidget />
            </ErrorBoundary>
          </div>
        </div>
      </div>

      {/* 移动端底部导航 */}
      <MobileNav active={mobileTab} onChange={handleMobileTabChange} />

      {/* 移动端底部 Sheet */}
      <MobileSheet
        open={sheetOpen}
        onClose={handleSheetClose}
        title={sheetTitle}
      >
        {sheetContent}
      </MobileSheet>
    </div>
  );
}
