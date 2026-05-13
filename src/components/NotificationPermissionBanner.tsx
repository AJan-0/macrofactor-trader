/**
 * 通知权限提示条
 * 当用户未授予通知权限时显示友好的提示
 */

import { useState } from 'react';
import { useNotificationPermission } from '@/hooks/useNotificationPermission';

export default function NotificationPermissionBanner() {
  const { permission, isSupported, requestPermission, shouldPrompt } = useNotificationPermission();
  const [isDismissed, setIsDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('notification-banner-dismissed') === 'true';
  });

  const isVisible = isSupported && shouldPrompt && permission !== 'granted' && !isDismissed;

  const handleEnable = async () => {
    await requestPermission();
  };

  const handleDismiss = () => {
    localStorage.setItem('notification-banner-dismissed', 'true');
    setIsDismissed(true);
  };

  if (!isVisible) return null;

  return (
    <div className="bg-blue-950/50 border-b border-blue-900 px-4 py-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 flex-1">
        <span className="text-lg">🔔</span>
        <div className="flex-1">
          <p className="text-sm font-medium text-blue-100">
            启用实时交易提醒
          </p>
          <p className="text-xs text-blue-300">
            收到重要信号时立即获得浏览器通知和声音警报
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={handleEnable}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded transition-colors"
        >
          启用
        </button>
        <button
          onClick={handleDismiss}
          className="px-3 py-1.5 text-blue-300 hover:text-blue-100 text-sm transition-colors"
        >
          稍后
        </button>
      </div>
    </div>
  );
}
