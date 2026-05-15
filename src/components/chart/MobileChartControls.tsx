/**
 * 移动端图表控制栏
 * 提供缩放、平移、重置等快捷操作
 * 参考 TradingView 移动端设计
 */

import { memo } from "react";
import { useI18n } from "@/i18n/context";

interface Props {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onToggleCrosshair: () => void;
  isCrosshairEnabled: boolean;
  timeframe: string;
}

const MobileChartControls = memo(function MobileChartControls({
  onZoomIn,
  onZoomOut,
  onReset,
  onToggleCrosshair,
  isCrosshairEnabled,
  timeframe,
}: Props) {
  const { t } = useI18n();

  return (
    <div className="lg:hidden absolute bottom-3 right-3 z-20 flex flex-col gap-1.5">
      {/* 十字光标切换 */}
      <button
        onClick={onToggleCrosshair}
        className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg shadow-lg backdrop-blur-sm transition-all active:scale-90 ${
          isCrosshairEnabled
            ? "bg-[#3b82f6] text-white"
            : "bg-[#1a2236]/90 text-[#94a3b8] border border-[#2d3a52]"
        }`}
        title={t("chart.crosshair") || "Crosshair"}
      >
        ╋
      </button>

      {/* 放大 */}
      <button
        onClick={onZoomIn}
        className="w-9 h-9 rounded-lg bg-[#1a2236]/90 border border-[#2d3a52] text-[#94a3b8] flex items-center justify-center text-lg shadow-lg backdrop-blur-sm transition-all active:scale-90 hover:text-white"
        title={t("chart.zoomIn") || "Zoom In"}
      >
        +
      </button>

      {/* 缩小 */}
      <button
        onClick={onZoomOut}
        className="w-9 h-9 rounded-lg bg-[#1a2236]/90 border border-[#2d3a52] text-[#94a3b8] flex items-center justify-center text-lg shadow-lg backdrop-blur-sm transition-all active:scale-90 hover:text-white"
        title={t("chart.zoomOut") || "Zoom Out"}
      >
        −
      </button>

      {/* 重置视图 */}
      <button
        onClick={onReset}
        className="w-9 h-9 rounded-lg bg-[#1a2236]/90 border border-[#2d3a52] text-[#94a3b8] flex items-center justify-center text-sm shadow-lg backdrop-blur-sm transition-all active:scale-90 hover:text-white"
        title={t("chart.reset") || "Reset View"}
      >
        ⌂
      </button>

      {/* 时间周期指示 */}
      <div className="w-9 h-6 rounded bg-[#1a2236]/90 border border-[#2d3a52] text-[#3b82f6] flex items-center justify-center text-[9px] font-bold shadow-lg backdrop-blur-sm">
        {timeframe}
      </div>
    </div>
  );
});

export default MobileChartControls;
