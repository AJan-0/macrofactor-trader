/**
 * Push Notification Hook
 * 
 * 管理推送通知的全局状态：
 * - Web Push 订阅状态
 * - 通知权限状态
 * - iOS PWA 检测
 * - 信号通知发送
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { StrategySignal } from "@/services/strategyEngine";
import {
  getPushConfig,
  savePushConfig,
  subscribeWebPush,
  unsubscribeWebPush,
  isWebPushSupported,
  getWebPushSubscription,
  sendSignalNotification,
  sendTestPush,
  requestIOSPushPermission,
  isIOSStandalone,
  isIOSSupported,
  type PushConfig,
} from "@/services/pushNotification";

export interface PushState {
  // 支持状态
  isSupported: boolean;
  isIOSSupported: boolean;
  isStandalone: boolean;
  
  // 权限状态
  permission: NotificationPermission | "unsupported";
  
  // 订阅状态
  isSubscribed: boolean;
  
  // 配置
  config: PushConfig;
  
  // 加载状态
  isLoading: boolean;
}

export function usePushNotification() {
  const [state, setState] = useState<PushState>({
    isSupported: false,
    isIOSSupported: false,
    isStandalone: false,
    permission: "default",
    isSubscribed: false,
    config: getPushConfig(),
    isLoading: true,
  });

  const configRef = useRef(state.config);

  useEffect(() => {
    configRef.current = state.config;
  }, [state.config]);

  // 初始化：检查支持状态和权限
  useEffect(() => {
    const init = async () => {
      const supported = isWebPushSupported();
      const iosSupported = isIOSSupported();
      const standalone = isIOSStandalone();
      
      let permission: NotificationPermission | "unsupported" = "unsupported";
      let subscribed = false;

      if (supported) {
        permission = Notification.permission;
        try {
          const subscription = await getWebPushSubscription();
          subscribed = !!subscription;
        } catch {
          subscribed = false;
        }
      }

      setState(prev => ({
        ...prev,
        isSupported: supported,
        isIOSSupported: iosSupported,
        isStandalone: standalone,
        permission,
        isSubscribed: subscribed,
        isLoading: false,
      }));
    };

    init();
  }, []);

  // 注册 Service Worker
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const registerSW = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/service-worker.js");
        console.log("[Push] Service Worker registered:", registration.scope);

        // 监听 Service Worker 更新
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener("statechange", () => {
              if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                // 有新版本可用
                console.log("[Push] New Service Worker available");
              }
            });
          }
        });
      } catch (e) {
        console.warn("[Push] Service Worker registration failed:", e);
      }
    };

    registerSW();
  }, []);

  // 请求权限
  const requestPermission = useCallback(async (): Promise<boolean> => {
    setState(prev => ({ ...prev, isLoading: true }));
    
    try {
      const granted = await requestIOSPushPermission();
      
      setState(prev => ({
        ...prev,
        permission: granted ? "granted" : "denied",
        isLoading: false,
      }));
      
      return granted;
    } catch {
      setState(prev => ({ ...prev, isLoading: false }));
      return false;
    }
  }, []);

  // 订阅推送
  const subscribe = useCallback(async (): Promise<boolean> => {
    setState(prev => ({ ...prev, isLoading: true }));
    
    try {
      const success = await subscribeWebPush();
      
      setState(prev => ({
        ...prev,
        isSubscribed: success,
        isLoading: false,
      }));
      
      return success;
    } catch {
      setState(prev => ({ ...prev, isLoading: false }));
      return false;
    }
  }, []);

  // 取消订阅
  const unsubscribe = useCallback(async (): Promise<boolean> => {
    setState(prev => ({ ...prev, isLoading: true }));
    
    try {
      const success = await unsubscribeWebPush();
      
      setState(prev => ({
        ...prev,
        isSubscribed: !success,
        isLoading: false,
      }));
      
      return success;
    } catch {
      setState(prev => ({ ...prev, isLoading: false }));
      return false;
    }
  }, []);

  // 更新配置
  const updateConfig = useCallback((updates: Partial<PushConfig>) => {
    const newConfig = { ...configRef.current, ...updates };
    savePushConfig(newConfig);
    setState(prev => ({ ...prev, config: newConfig }));
  }, []);

  // 发送信号通知
  const sendSignal = useCallback(async (
    strategyId: string,
    strategyName: string,
    signal: StrategySignal,
    symbol: string
  ) => {
    await sendSignalNotification(strategyId, strategyName, signal, symbol);
  }, []);

  // 发送测试推送
  const sendTest = useCallback(async () => {
    await sendTestPush();
  }, []);

  // 检查是否需要显示 iOS 安装提示
  const showIOSInstallPrompt = useCallback((): boolean => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
    return isIOS && !isStandalone;
  }, []);

  return {
    ...state,
    requestPermission,
    subscribe,
    unsubscribe,
    updateConfig,
    sendSignal,
    sendTest,
    showIOSInstallPrompt,
  };
}
