/**
 * 实时状态指示器
 * 显示实时连接状态和最近更新
 */

import { useEffect, useState } from "react";

interface RealtimeIndicatorProps {
  isRealtime: boolean;
  lastUpdate: number;
  updates: Array<{ factorId: string; reason: string; timestamp: number }>;
}

export function RealtimeIndicator({ isRealtime, lastUpdate, updates }: RealtimeIndicatorProps) {
  const [pulse, setPulse] = useState(false);
  const [timeAgo, setTimeAgo] = useState("");

  // 脉冲动画
  useEffect(() => {
    if (!isRealtime) return;
    const interval = setInterval(() => {
      setPulse(p => !p);
    }, 1000);
    return () => clearInterval(interval);
  }, [isRealtime]);

  // 更新时间显示
  useEffect(() => {
    const updateTime = () => {
      if (!lastUpdate) {
        setTimeAgo("never");
        return;
      }
      const seconds = Math.floor((Date.now() - lastUpdate) / 1000);
      if (seconds < 60) {
        setTimeAgo(`${seconds}s ago`);
      } else if (seconds < 3600) {
        setTimeAgo(`${Math.floor(seconds / 60)}m ago`);
      } else {
        setTimeAgo(`${Math.floor(seconds / 3600)}h ago`);
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 5000);
    return () => clearInterval(interval);
  }, [lastUpdate]);

  const latestUpdate = updates[0];

  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-slate-800/50 rounded-lg">
      {/* 实时状态点 */}
      <div className="relative flex-shrink-0">
        <div
          className={`w-2.5 h-2.5 rounded-full ${
            isRealtime ? "bg-green-500" : "bg-gray-500"
          }`}
        />
        {isRealtime && (
          <div
            className={`absolute inset-0 w-2.5 h-2.5 rounded-full bg-green-500 ${
              pulse ? "animate-ping opacity-75" : "opacity-0"
            }`}
          />
        )}
      </div>

      {/* 状态文字 */}
      <div className="flex flex-col">
        <span className="text-xs font-medium text-gray-300">
          {isRealtime ? (
            <span className="text-green-400">● Live</span>
          ) : (
            <span className="text-gray-500">○ Offline</span>
          )}
          <span className="text-gray-500 ml-1">· {timeAgo}</span>
        </span>

        {/* 最近更新 */}
        {latestUpdate && (
          <span className="text-[10px] text-blue-400 truncate max-w-[200px]">
            {latestUpdate.reason}
          </span>
        )}
      </div>

      {/* 更新计数 */}
      {updates.length > 0 && (
        <div className="ml-auto flex-shrink-0">
          <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded-full">
            {updates.length}
          </span>
        </div>
      )}
    </div>
  );
}
