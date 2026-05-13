/**
 * 浏览器通知权限管理 Hook
 * 处理权限请求、检查权限状态、提供用户友好的交互
 */

import { useState, useEffect, useCallback } from 'react';

export type NotificationState = 'unsupported' | 'denied' | 'granted' | 'default';

interface UseNotificationPermissionReturn {
  permission: NotificationState;
  isSupported: boolean;
  isGranted: boolean;
  requestPermission: () => Promise<boolean>;
  shouldPrompt: boolean; // 是否应该显示权限提示
}

function getInitialPermission(): NotificationState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission as NotificationState;
}

export function useNotificationPermission(): UseNotificationPermissionReturn {
  const [permission, setPermission] = useState<NotificationState>(getInitialPermission);
  const [shouldPrompt, setShouldPrompt] = useState(false);

  // 延迟显示权限提示
  useEffect(() => {
    if (permission === 'default') {
      const timer = setTimeout(() => {
        setShouldPrompt(true);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [permission]);

  const isSupported = permission !== 'unsupported';
  const isGranted = permission === 'granted';

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      console.warn('[useNotificationPermission] 浏览器不支持通知 API');
      return false;
    }

    if (isGranted) {
      return true;
    }

    if (permission === 'denied') {
      console.warn('[useNotificationPermission] 用户已拒绝通知权限');
      return false;
    }

    try {
      const result = await Notification.requestPermission();
      setPermission(result as NotificationState);
      setShouldPrompt(false);
      return result === 'granted';
    } catch (error) {
      console.error('[useNotificationPermission] 权限请求失败:', error);
      return false;
    }
  }, [isSupported, isGranted, permission]);

  return {
    permission,
    isSupported,
    isGranted,
    requestPermission,
    shouldPrompt,
  };
}

/**
 * 发送系统通知的辅助函数
 */
export function sendSystemNotification(
  title: string,
  options?: NotificationOptions
): Notification | null {
  if (!('Notification' in window)) {
    console.warn('[sendSystemNotification] 浏览器不支持通知 API');
    return null;
  }

  if (Notification.permission !== 'granted') {
    console.warn('[sendSystemNotification] 未获得通知权限');
    return null;
  }

  try {
    return new Notification(title, {
      badge: '📊',
      tag: 'macrofactor-trader',
      requireInteraction: false,
      ...options,
    });
  } catch (error) {
    console.error('[sendSystemNotification] 发送通知失败:', error);
    return null;
  }
}
