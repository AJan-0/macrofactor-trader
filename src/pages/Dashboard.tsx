import { useState, useEffect, useCallback, useRef } from "react";
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
import { useFullscreen } from "@/hooks/useFullscreen";
import { TrendingUpIcon, TrendingDownIcon, MinusIcon, FullscreenIcon, FullscreenExitIcon } from "@/components/icons";
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
  const [mobileTab, setMobileTab] = useState<MobileTab>("chart");
  const [sheetOpen, setSheetOpen] = useState(false);

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

  const toggleFactor = useCallback((id: string) => {
    updateFactors(prev => prev.map(f => f.id === id ? { ...f, enabled: !f.enabled } : f));
  }, [updateFactors]);

  const adjustProbability = useCallback((id: string, prob: number) => {
    updateFactors(prev => prev.map(f => f.id === id ? { ...f, probability: prob } : f));
  }, [updateFactors]);

  const adjustWeight = useCallback((id: string, weight: number) => {
    updateFactors(prev => prev.map(f => f.id === id ? { ...f, weight } : f));
  }, [updateFactors]);

  const addCustom = useCallback((f: FactorItem) => {
    updateFactors(prev => [...prev, f]);
  }, [updateFactors]);

  const handleReset = useCallback(() => {
    setFactorState(buildFactorState(resetToDefault()));
  }, []);

  const handleApplyTemplate = useCallback((template: WeightTemplate) => {
    updateFactors(prev => applyWeightTemplate(prev, template));
  }, [updateFactors]);

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

  const handleMobileTabChange = useCallback((tab: MobileTab) => {
    setMobileTab(tab);
    if (tab !== "chart") {
      setSheetOpen(true);
    } else {
      setSheetOpen(false);
    }
  }, []);

  const handleSheetClose = useCallback(() => {
    setSheetOpen(false);
    setMobileTab("chart");
  }, []);

  const sheetTitle =
    mobileTab === "factors" ? "因子面板"
    : mobileTab === "news" ? "新闻信息流"
    : mobileTab === "data" ? "回测数据"
    : "";

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

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggleFullscreen } = useFullscreen({ autoOnLandscape: true });

  const DirectionIcon = combo.combinedDirection === "bullish" 
    ? TrendingUpIcon 
    : combo.combinedDirection === "bearish" 
      ? TrendingDownIcon 
      : MinusIcon;

  const directionColor = combo.combinedDirection === "bullish" 
    ? "text-[#22c55e]" 
    : combo.combinedDirection === "bearish" 
      ? "text-[#ef4444]" 
      : "text-[#94a3b8]";

  return (
    <div className={`flex flex-col h-[100dvh] bg-[#0a0e1a] overflow-hidden ${isFullscreen ? 'fixed inset-0 z-[100]' : ''}`}>
      {/* 全屏模式下隐藏 Toolbar */}
      {!isFullscreen && (
        <div className="shrink-0">
          <Toolbar />
        </div>
      )}

      {/* 桌面端：叙事栏 + 焦点事件 */}
      <div className="hidden lg:block shrink-0">
        <NarrativeBar combo={combo} lastUpdate={lastUpdate} />
        <UpcomingCalendar events={events} />
      </div>

      {/* 桌面端布局 */}
      <div className="hidden lg:flex flex-1 overflow-hidden min-h-0">
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
        <div className="w-[30%] min-w-[300px] max-w-[400px] border-l border-[#1e293b] overflow-y-auto">
          <ErrorBoundary>
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
          </ErrorBoundary>
        </div>
      </div>

      {/* 移动端布局 */}
      <div 
        ref={chartContainerRef}
        className={`lg:hidden flex-1 flex flex-col min-h-0 ${isFullscreen ? 'pb-0' : 'pb-[calc(52px+env(safe-area-inset-bottom))]'}`}
      >
        {/* 移动端叙事摘要 - 全屏时隐藏 */}
        {!isFullscreen && combo && (
          <div className="shrink-0 px-3 py-2 border-b border-[#1e293b]/60 bg-[#0a0e1a] flex items-center gap-3 overflow-x-auto scrollbar-hide">
            <div className={`flex items-center gap-1 shrink-0 ${directionColor}`}>
              <DirectionIcon size={14} />
              <span className="text-xs font-bold">
                {combo.combinedDirection === "bullish" ? "偏多" : combo.combinedDirection === "bearish" ? "偏空" : "中性"}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-[#475569] shrink-0">
              <span>置信度 {combo.overallConfidence.toFixed(0)}%</span>
              <span className="text-[#1e293b]">|</span>
              <span>{combo.enabledCount}/{combo.totalCount} 因子</span>
            </div>
            
            <button
              onClick={() => toggleFullscreen(chartContainerRef.current || undefined)}
              className="ml-auto w-7 h-7 flex items-center justify-center rounded-lg bg-[#1a2236] border border-[#2d3a52] text-[#475569] active:scale-90 transition-transform"
            >
              {isFullscreen ? <FullscreenExitIcon size={14} /> : <FullscreenIcon size={14} />}
            </button>
          </div>
        )}

        {/* 焦点事件（精简单行） - 全屏时隐藏 */}
        {!isFullscreen && <UpcomingCalendar events={events} />}

        {/* 图表区域 */}
        <div className="flex-1 min-h-0 overflow-hidden relative">
          <ErrorBoundary>
            <ChartWidget />
          </ErrorBoundary>
          
          {isFullscreen && (
            <button
              onClick={() => toggleFullscreen()}
              className="absolute top-3 right-3 z-50 w-9 h-9 rounded-lg bg-[#1a2236]/90 border border-[#2d3a52] text-[#94a3b8] flex items-center justify-center shadow-lg backdrop-blur-sm active:scale-90 transition-transform"
            >
              <FullscreenExitIcon size={16} />
            </button>
          )}
        </div>
      </div>

      {/* 移动端底部导航 - 全屏时隐藏 */}
      {!isFullscreen && (
        <div className="lg:hidden shrink-0">
          <MobileNav active={mobileTab} onChange={handleMobileTabChange} />
        </div>
      )}

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
