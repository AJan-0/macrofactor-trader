/**
 * 跨平台推送通知系统
 * 
 * 支持：
 * 1. Web Push (iOS 16.4+, Android, Desktop)
 * 2. PWA Service Worker 后台推送
 * 3. Telegram Bot 推送（备用方案）
 * 4. 浏览器桌面通知（降级方案）
 */

import type { StrategySignal } from "./strategyEngine";

// ── 配置 ──
const PUSH_CONFIG_KEY = "pushNotificationConfig";
const VAPID_PUBLIC_KEY = "YOUR_VAPID_PUBLIC_KEY"; // 需要替换为实际密钥

export interface PushConfig {
  enabled: boolean;
  webPush: boolean;
  telegramBot: boolean;
  telegramChatId?: string;
  telegramBotToken?: string;
  minStrength: number;
  cooldownSeconds: number;
}

const DEFAULT_PUSH_CONFIG: PushConfig = {
  enabled: true,
  webPush: true,
  telegramBot: false,
  minStrength: 0.3,
  cooldownSeconds: 300,
};

// ── 获取/保存配置 ──
export function getPushConfig(): PushConfig {
  try {
    const raw = localStorage.getItem(PUSH_CONFIG_KEY);
    if (raw) return { ...DEFAULT_PUSH_CONFIG, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_PUSH_CONFIG };
}

export function savePushConfig(config: PushConfig) {
  localStorage.setItem(PUSH_CONFIG_KEY, JSON.stringify(config));
}

// ── Web Push 订阅 ──
export async function subscribeWebPush(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  if (!("PushManager" in window)) return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    
    // 检查现有订阅
    let subscription = await registration.pushManager.getSubscription();
    
    if (!subscription) {
      // 请求新订阅
      const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey as unknown as ArrayBuffer,
      });
    }

    // 发送订阅到服务器（如果有后端）
    await sendSubscriptionToServer(subscription);
    
    return true;
  } catch (e) {
    console.warn("[Push] Web Push 订阅失败:", e);
    return false;
  }
}

export async function unsubscribeWebPush(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    
    if (subscription) {
      await subscription.unsubscribe();
      await deleteSubscriptionFromServer(subscription);
    }
    
    return true;
  } catch (e) {
    console.warn("[Push] Web Push 取消订阅失败:", e);
    return false;
  }
}

// ── 检查 Web Push 支持 ──
export function isWebPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window;
}

export async function getWebPushSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

// ── 发送测试推送 ──
export async function sendTestPush(): Promise<void> {
  const config = getPushConfig();
  
  if (config.webPush && isWebPushSupported()) {
    const registration = await navigator.serviceWorker.ready;
    registration.showNotification("📈 MacroFactor Trader", {
      body: "推送测试成功！您将收到指标信号通知。",
      icon: "/icon-192x192.png",
      badge: "/icon-192x192.png",
      tag: "test-push",
      requireInteraction: false,
      // vibrate: [200, 100, 200], // iOS 不支持 vibrate
    });
  }
}

// ── Telegram Bot 推送 ──
export async function sendTelegramAlert(
  botToken: string,
  chatId: string,
  strategyName: string,
  signal: StrategySignal,
  symbol: string
): Promise<boolean> {
  try {
    const directionEmoji = signal.direction === "buy" ? "🟢 买入" : signal.direction === "sell" ? "🔴 卖出" : "⚪ 中性";
    const strengthBars = "█".repeat(Math.ceil(signal.strength * 5)) + "░".repeat(5 - Math.ceil(signal.strength * 5));
    
    const text = `
📊 <b>MacroFactor Trader 信号</b>

${directionEmoji} <b>${strategyName}</b>
💱 交易对: <code>${symbol}</code>
💰 价格: $${signal.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
🏷️ 标签: ${signal.label}
💪 强度: ${strengthBars} ${(signal.strength * 100).toFixed(0)}%
⏰ 时间: ${new Date(signal.time * 1000).toLocaleString("zh-CN")}
    `.trim();

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    return response.ok;
  } catch (e) {
    console.warn("[Push] Telegram 发送失败:", e);
    return false;
  }
}

// ── 发送信号通知（统一入口）──
export async function sendSignalNotification(
  strategyId: string,
  strategyName: string,
  signal: StrategySignal,
  symbol: string
): Promise<void> {
  const config = getPushConfig();
  if (!config.enabled || signal.strength < config.minStrength) return;

  const directionEmoji = signal.direction === "buy" ? "🟢" : signal.direction === "sell" ? "🔴" : "⚪";
  const title = `${directionEmoji} ${strategyName} · ${symbol}`;
  const body = `${signal.direction === "buy" ? "买入" : signal.direction === "sell" ? "卖出" : "中性"}信号 @ $${signal.price.toLocaleString(undefined, { maximumFractionDigits: 2 })} — ${signal.label}`;

  // 1. Web Push (iOS 16.4+ PWA)
  if (config.webPush && isWebPushSupported()) {
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(title, {
        body,
        icon: "/icon-192x192.png",
        badge: "/icon-192x192.png",
        tag: `signal-${strategyId}-${signal.time}`,
        requireInteraction: true,
        // vibrate: signal.direction === "buy" ? [100, 50, 200] : [200, 50, 100], // iOS 不支持
        data: {
          strategyId,
          symbol,
          signal,
          url: `/chart/${symbol}`,
        },
        // actions: [ // iOS 不支持
        //   { action: "view", title: "查看图表" },
        //   { action: "dismiss", title: "忽略" },
        // ],
      });
    } catch (e) {
      console.warn("[Push] Web Push 发送失败:", e);
    }
  }

  // 2. Telegram Bot 推送
  if (config.telegramBot && config.telegramBotToken && config.telegramChatId) {
    await sendTelegramAlert(
      config.telegramBotToken,
      config.telegramChatId,
      strategyName,
      signal,
      symbol
    );
  }
}

// ── 工具函数 ──
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\\-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from(rawData.split("").map(c => c.charCodeAt(0)));
}

async function sendSubscriptionToServer(subscription: PushSubscription): Promise<void> {
  // TODO: 如果有后端，发送订阅信息到服务器
  console.log("[Push] 订阅信息:", subscription.toJSON());
}

async function deleteSubscriptionFromServer(subscription: PushSubscription): Promise<void> {
  // TODO: 如果有后端，从服务器删除订阅
  console.log("[Push] 取消订阅:", subscription.toJSON());
}

// ── 请求 iOS PWA 推送权限 ──
export async function requestIOSPushPermission(): Promise<boolean> {
  // iOS 16.4+ 支持 Web Push，但需要用户将网站添加到主屏幕
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
  
  if (isIOS && !isStandalone) {
    // 提示用户添加到主屏幕
    return false;
  }

  if (!("Notification" in window)) return false;
  
  const permission = await Notification.requestPermission();
  return permission === "granted";
}

// ── 检查是否在 iOS 主屏幕模式 ──
export function isIOSStandalone(): boolean {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
  return isIOS && isStandalone;
}

// ── 检查 iOS 版本是否支持 Web Push ──
export function isIOSSupported(): boolean {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (!isIOS) return true; // 非 iOS 设备
  
  // iOS 16.4+ 支持 Web Push
  const match = navigator.userAgent.match(/OS (\d+)_(\d+)/);
  if (!match) return false;
  
  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);
  
  return major > 16 || (major === 16 && minor >= 4);
}
