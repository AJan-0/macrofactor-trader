/**
 * 移动端时间周期选择器
 * TradingView 风格底部弹出选择器
 */

import { useState, memo } from "react";
import { useI18n } from "@/i18n/context";

interface Props {
  currentTimeframe: string;
  onChange: (tf: string) => void;
  timeframes: Array<{ key: string; label: string }>;
}

const TIMEFRAME_GROUPS = [
  { label: "分钟", labelEn: "Minutes", items: ["1m", "3m", "5m", "15m"] },
  { label: "小时", labelEn: "Hours", items: ["1H", "4H"] },
  { label: "日线", labelEn: "Daily", items: ["1D"] },
];

const MobileTimeframeSelector = memo(function MobileTimeframeSelector({
  currentTimeframe,
  onChange,
  timeframes,
}: Props) {
  const { t, locale } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const isZh = locale === "zh";

  const currentLabel = timeframes.find(tf => tf.key === currentTimeframe)?.label || currentTimeframe;

  return (
    <>
      {/* 当前时间周期按钮 */}
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#111827] border border-[#2d3a52] text-[#e2e8f0] text-xs font-bold min-w-touch min-h-touch active:scale-95 transition-transform"
      >
        <span>{currentLabel}</span>
        <span className="text-[8px] text-[#475569]">▼</span>
      </button>

      {/* 底部弹出选择器 */}
      {isOpen && (
        <div className="fixed inset-0 z-[70] flex flex-col justify-end">
          {/* 遮罩 */}
          <div 
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setIsOpen(false)}
          />
          
          {/* 选择器内容 */}
          <div className="relative bg-[#111827] rounded-t-xl border-t border-[#1e293b] max-h-[60vh] flex flex-col">
            {/* 拖动指示条 */}
            <div className="flex justify-center pt-2 pb-1">
              <div className="w-10 h-1 bg-[#475569] rounded-full" />
            </div>
            
            {/* 标题 */}
            <div className="px-4 py-2 border-b border-[#1e293b] flex items-center justify-between">
              <span className="text-[13px] font-bold text-[#e2e8f0]">
                {isZh ? "选择时间周期" : "Select Timeframe"}
              </span>
              <button
                onClick={() => setIsOpen(false)}
                className="text-[16px] text-[#475569] hover:text-[#e2e8f0] w-8 h-8 flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            {/* 时间周期列表 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {TIMEFRAME_GROUPS.map(group => (
                <div key={group.label}>
                  <div className="text-[10px] text-[#475569] font-bold mb-2 tracking-wider">
                    {isZh ? group.label : group.labelEn}
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {group.items.map(tfKey => {
                      const tf = timeframes.find(t => t.key === tfKey);
                      if (!tf) return null;
                      const isActive = currentTimeframe === tfKey;
                      
                      return (
                        <button
                          key={tfKey}
                          onClick={() => {
                            onChange(tfKey);
                            setIsOpen(false);
                          }}
                          className={`py-2.5 rounded-lg text-xs font-bold transition-all active:scale-95 ${
                            isActive
                              ? "bg-[#3b82f6] text-white shadow-lg shadow-[#3b82f6]/20"
                              : "bg-[#1a2236] text-[#94a3b8] border border-[#2d3a52] hover:border-[#475569]"
                          }`}
                        >
                          {t(tf.label)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* 底部安全区域 */}
            <div className="pb-[env(safe-area-inset-bottom)]" />
          </div>
        </div>
      )}
    </>
  );
});

export default MobileTimeframeSelector;
