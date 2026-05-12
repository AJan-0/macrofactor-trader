import { useState, useEffect, useCallback } from "react";
import type { StrategySignal } from "@/services/strategyEngine";
import {
  getAlertConfig,
  saveAlertConfig,
  type AlertConfig,
  requestNotificationPermission,
  getNotificationPermission,
  clearAlertHistory,
  getTodayAlertCount,
} from "@/services/alertEngine";

interface AlertToast {
  id: string;
  strategyName: string;
  signal: StrategySignal;
  symbol: string;
}

interface AlertPanelProps {
  toasts: AlertToast[];
  onToastsChange: (toasts: AlertToast[]) => void;
}

export default function AlertPanel({ toasts, onToastsChange }: AlertPanelProps) {
  const [alertConfig, setAlertConfig] = useState<AlertConfig>(getAlertConfig);
  const [showAlertSettings, setShowAlertSettings] = useState(false);

  const dismissToast = useCallback(
    (id: string) => {
      onToastsChange(toasts.filter((t) => t.id !== id));
    },
    [toasts, onToastsChange]
  );

  // Auto-dismiss toasts after 5 seconds
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) =>
      setTimeout(() => {
        onToastsChange(toasts.filter((p) => p.id !== t.id));
      }, 5000)
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts, onToastsChange]);

  const updateAlertConfig = useCallback(
    (updates: Partial<AlertConfig>) => {
      const next = { ...alertConfig, ...updates };
      setAlertConfig(next);
      saveAlertConfig(next);
    },
    [alertConfig]
  );

  return (
    <>
      {/* Alert Settings Button */}
      <button
        onClick={() => setShowAlertSettings(!showAlertSettings)}
        className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
          showAlertSettings
            ? "bg-[#3b82f620] border-[#3b82f6] text-[#3b82f6]"
            : "border-[#1e293b] text-[#475569] hover:text-[#e2e8f0]"
        }`}
      >
        🔔 {getTodayAlertCount()}
      </button>

      {/* Alert Settings Panel */}
      {showAlertSettings && (
        <div className="mb-2 p-2 rounded bg-[#111827] border border-[#1e293b]/50 space-y-1.5">
          <div className="text-[10px] font-bold text-[#94a3b8] mb-1">预警设置</div>

          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-[10px] text-[#94a3b8]">启用预警</span>
            <input
              type="checkbox"
              checked={alertConfig.enabled}
              onChange={(e) => updateAlertConfig({ enabled: e.target.checked })}
              className="accent-[#3b82f6] w-3 h-3"
            />
          </label>

          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-[10px] text-[#94a3b8]">桌面通知</span>
            <div className="flex items-center gap-1">
              {getNotificationPermission() === "default" && (
                <button
                  onClick={() => requestNotificationPermission()}
                  className="text-[9px] px-1.5 py-0.5 rounded bg-[#3b82f620] text-[#3b82f6]"
                >
                  授权
                </button>
              )}
              <input
                type="checkbox"
                checked={alertConfig.browserNotify}
                disabled={getNotificationPermission() !== "granted"}
                onChange={(e) =>
                  updateAlertConfig({ browserNotify: e.target.checked })
                }
                className="accent-[#3b82f6] w-3 h-3"
              />
            </div>
          </label>

          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-[10px] text-[#94a3b8]">声音提醒</span>
            <input
              type="checkbox"
              checked={alertConfig.soundAlert}
              onChange={(e) => updateAlertConfig({ soundAlert: e.target.checked })}
              className="accent-[#3b82f6] w-3 h-3"
            />
          </label>

          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[#94a3b8]">最小强度</span>
            <div className="flex items-center gap-1 flex-1 ml-2">
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={alertConfig.minStrength}
                onChange={(e) =>
                  updateAlertConfig({ minStrength: parseFloat(e.target.value) })
                }
                className="flex-1 h-1 accent-[#3b82f6]"
              />
              <span className="text-[9px] font-mono text-[#e2e8f0] w-5">
                {alertConfig.minStrength}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[#94a3b8]">冷却(秒)</span>
            <div className="flex items-center gap-1 flex-1 ml-2">
              <input
                type="range"
                min={0}
                max={1800}
                step={60}
                value={alertConfig.cooldownSeconds}
                onChange={(e) =>
                  updateAlertConfig({ cooldownSeconds: parseInt(e.target.value) })
                }
                className="flex-1 h-1 accent-[#3b82f6]"
              />
              <span className="text-[9px] font-mono text-[#e2e8f0] w-8">
                {alertConfig.cooldownSeconds}s
              </span>
            </div>
          </div>

          <button
            onClick={() => clearAlertHistory()}
            className="w-full text-[9px] py-0.5 rounded border border-[#47556930] text-[#475569] hover:text-[#e2e8f0] hover:border-[#475569] transition-colors"
          >
            清除通知历史
          </button>
        </div>
      )}

      {/* Toast Notifications */}
      <div className="absolute top-2 right-2 z-30 flex flex-col gap-1.5 pointer-events-none">
        {toasts.map((toast) => {
          const isBuy = toast.signal.direction === "buy";
          const isSell = toast.signal.direction === "sell";
          const bg = isBuy
            ? "bg-[#22c55e15] border-[#22c55e40]"
            : isSell
            ? "bg-[#ef444415] border-[#ef444440]"
            : "bg-[#64748b15] border-[#64748b40]";
          const text = isBuy
            ? "text-[#22c55e]"
            : isSell
            ? "text-[#ef4444]"
            : "text-[#94a3b8]";
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto w-[200px] p-2 rounded-lg border ${bg} backdrop-blur-sm shadow-lg animate-in fade-in slide-in-from-right-2 duration-300`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className={`text-[9px] font-bold ${text}`}>
                  {isBuy ? "🟢 买入" : isSell ? "🔴 卖出" : "⚪ 中性"}
                </span>
                <button
                  onClick={() => dismissToast(toast.id)}
                  className="text-[8px] text-[#475569] hover:text-[#e2e8f0]"
                >
                  ✕
                </button>
              </div>
              <div className="text-[8px] text-[#e2e8f0] font-bold truncate">
                {toast.strategyName}
              </div>
              <div className="text-[8px] text-[#94a3b8] truncate">
                {toast.signal.label}
              </div>
              <div className="text-[9px] font-mono text-[#e2e8f0] mt-0.5">
                ${toast.signal.price.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}
                <span className="text-[7px] text-[#475569] ml-1">
                  {toast.symbol}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
