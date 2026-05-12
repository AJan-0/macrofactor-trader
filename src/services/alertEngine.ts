/**
 * 策略预警引擎 —— P1 策略预警系统
 *
 * 功能：
 * 1. 浏览器桌面通知 (Web Notification API)
 * 2. 声音提醒 (Web Audio API)
 * 3. 信号去重（同一信号不重复通知）
 * 4. 配置持久化到 localStorage
 */
 

import type { StrategySignal } from "./strategyEngine";

// ── 配置类型 ──
export interface AlertConfig {
  enabled: boolean;        // 总开关
  browserNotify: boolean;  // 浏览器桌面通知
  soundAlert: boolean;     // 声音提醒
  minStrength: number;     // 最小信号强度 (0-1)
  cooldownSeconds: number; // 同一策略冷却时间（秒）
}

const DEFAULT_CONFIG: AlertConfig = {
  enabled: true,
  browserNotify: true,
  soundAlert: true,
  minStrength: 0.3,
  cooldownSeconds: 300, // 5分钟
};

const CONFIG_KEY = "strategyAlertConfig";
const HISTORY_KEY = "strategyAlertHistory";

// ── 已通知信号记录 ──
interface AlertRecord {
  key: string;
  time: number;
  strategyId: string;
}

// ── 获取/保存配置 ──
export function getAlertConfig(): AlertConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_CONFIG };
}

export function saveAlertConfig(config: AlertConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

// ── 获取已通知历史 ──
function getAlertHistory(): AlertRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function saveAlertHistory(history: AlertRecord[]) {
  // 只保留最近100条，避免localStorage膨胀
  const trimmed = history.slice(-100);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
}

// ── 信号唯一标识 ──
function signalKey(strategyId: string, signal: StrategySignal): string {
  return `${strategyId}::${signal.time}::${signal.direction}`;
}

// ── 请求浏览器通知权限 ──
export async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const permission = await Notification.requestPermission();
  return permission === "granted";
}

// ── 检查浏览器通知权限状态 ──
export function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

// ── 发送浏览器桌面通知 ──
function sendBrowserNotification(title: string, body: string, icon?: string) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, {
      body,
      icon: icon || "📈",
      badge: icon || "📈",
      tag: "strategy-alert",
      requireInteraction: false,
    });
  } catch (e) {
    console.warn("[AlertEngine] 通知发送失败:", e);
  }
}

// ── 播放提示音 ──
let _audioCtx: AudioContext | null = null;

function playBeep(frequency = 880, duration = 0.15, type: OscillatorType = "sine") {
  try {
    if (!_audioCtx) {
      _audioCtx = new (window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
    }
    const ctx = _audioCtx;
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

    gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration);
  } catch (e) {
    console.warn("[AlertEngine] 声音播放失败:", e);
  }
}

function playBuySound() {
  // 上升双音
  playBeep(523, 0.12, "sine");
  setTimeout(() => playBeep(659, 0.15, "sine"), 120);
}

function playSellSound() {
  // 下降双音
  playBeep(659, 0.12, "sine");
  setTimeout(() => playBeep(523, 0.15, "sine"), 120);
}

// ── 检查是否应该通知（去重 + 冷却 + 强度过滤）──
export function shouldAlert(
  strategyId: string,
  signal: StrategySignal,
  config: AlertConfig
): boolean {
  if (!config.enabled) return false;
  if (signal.strength < config.minStrength) return false;

  const key = signalKey(strategyId, signal);
  const now = Date.now();
  const history = getAlertHistory();

  // 检查是否已通知过完全相同的信号
  if (history.some(h => h.key === key)) return false;

  // 检查同一策略的冷却时间
  const cooldownMs = config.cooldownSeconds * 1000;
  const lastAlert = history
    .filter(h => h.strategyId === strategyId)
    .sort((a, b) => b.time - a.time)[0];

  if (lastAlert && now - lastAlert.time < cooldownMs) return false;

  return true;
}

// ── 发送预警（通知 + 声音 + 记录）──
export function sendAlert(
  strategyId: string,
  strategyName: string,
  signal: StrategySignal,
  symbol: string
): void {
  const config = getAlertConfig();
  if (!shouldAlert(strategyId, signal, config)) return;

  const directionText = signal.direction === "buy" ? "买入" : signal.direction === "sell" ? "卖出" : "中性";
  const directionEmoji = signal.direction === "buy" ? "🟢" : signal.direction === "sell" ? "🔴" : "⚪";
  const title = `${directionEmoji} ${strategyName} · ${symbol}`;
  const body = `${directionText}信号 @ $${signal.price.toLocaleString(undefined, { maximumFractionDigits: 2 })} — ${signal.label}`;

  // 浏览器通知
  if (config.browserNotify) {
    sendBrowserNotification(title, body);
  }

  // 声音
  if (config.soundAlert) {
    if (signal.direction === "buy") playBuySound();
    else if (signal.direction === "sell") playSellSound();
    else playBeep(440, 0.1);
  }

  // 记录到历史
  const history = getAlertHistory();
  history.push({
    key: signalKey(strategyId, signal),
    time: Date.now(),
    strategyId,
  });
  saveAlertHistory(history);
}

// ── 清除通知历史 ──
export function clearAlertHistory() {
  localStorage.removeItem(HISTORY_KEY);
}

// ── 获取最近的通知列表（用于UI展示）──
export function getRecentAlerts(limit = 20): { key: string; time: number; strategyId: string }[] {
  return getAlertHistory().slice(-limit).reverse();
}

// ── 统计今日通知数 ──
export function getTodayAlertCount(): number {
  const now = Date.now();
  const dayStart = new Date().setHours(0, 0, 0, 0);
  return getAlertHistory().filter(h => h.time >= dayStart && h.time <= now).length;
}
