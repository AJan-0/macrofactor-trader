/**
 * IndexedDB 持久化缓存层 (v0.4.0)
 *
 * —— 用途 ——
 *  1. 缓存 K 线数据（按 symbol+timeframe，避免刷新重新拉取）
 *  2. 缓存宏观事件（减少 /data/factors.json HTTP 请求）
 *  3. 缓存预警历史（本地审计 trail）
 *
 * —— 策略 ——
 *  - 读：先查 IndexedDB → 未命中或过期 → HTTP API → 写入 IndexedDB
 *  - 写：HTTP 成功后异步写入 IndexedDB（不阻塞 UI）
 *  - 过期：K 线 1 小时，事件 30 分钟，预警无过期
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

const DB_NAME = "macrofactor-trader";
const DB_VERSION = 1;

const STORE_KLINES   = "klines";
const STORE_FACTORS   = "factor_events";
const STORE_ALERTS   = "alert_history";

// ── 打开 DB（自动 upgrade 创建 object store）──

function openDB(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_KLINES)) {
        db.createObjectStore(STORE_KLINES, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(STORE_FACTORS)) {
        db.createObjectStore(STORE_FACTORS, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(STORE_ALERTS)) {
        const store = db.createObjectStore(STORE_ALERTS, {
          keyPath: "id", autoIncrement: true,
        });
        store.createIndex("alertId", "alertId");
        store.createIndex("triggeredAt", "triggeredAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror  = () => reject(req.error);
  });
}

// ── Kline 缓存 ──

export interface CachedKlines {
  key: string;   // "<SYMBOL>|<TF>"
  klines: Array<{
    time: number; open: number; high: number;
    low: number; close: number; volume: number;
  }>;
  updatedAt: number;
}

export async function getCachedKlines(
  symbol: string,
  timeframe: string,
  maxAgeMs: number = 3_600_000, // 1h
): Promise<CachedKlines["klines"] | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_KLINES, "readonly");
      const store = tx.objectStore(STORE_KLINES);
      const req = store.get(`${symbol}|${timeframe}`);
      req.onsuccess = () => {
        const row = req.result as CachedKlines | undefined;
        if (row && Date.now() - row.updatedAt < maxAgeMs) resolve(row.klines);
        else resolve(null);
      };
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    });
  } catch { return null; }
}

export async function setCachedKlines(
  symbol: string,
  timeframe: string,
  klines: CachedKlines["klines"],
): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_KLINES, "readwrite");
      tx.objectStore(STORE_KLINES).put({
        key: `${symbol}|${timeframe}`, klines, updatedAt: Date.now(),
      });
      tx.oncomplete = () => { db.close(); resolve(); };
    });
  } catch { /* ignore */ }
}

export async function clearAllKlineCache(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_KLINES, "readwrite");
      tx.objectStore(STORE_KLINES).clear();
      tx.oncomplete = () => { db.close(); resolve(); };
    });
  } catch { /* ignore */ }
}

// ── Factor / 宏观事件缓存 ──

interface CachedFactors {
  key: string;
  events: any[];
  updatedAt: number;
}

export async function getCachedFactors(
  cacheKey: string = "all",
  maxAgeMs: number = 1_800_000,
): Promise<unknown[] | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_FACTORS, "readonly");
      const req = tx.objectStore(STORE_FACTORS).get(cacheKey);
      req.onsuccess = () => {
        const row = req.result as CachedFactors | undefined;
        if (row && Date.now() - row.updatedAt < maxAgeMs) resolve(row.events);
        else resolve(null);
      };
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    });
  } catch { return null; }
}

export async function setCachedFactors(
  events: any[], cacheKey: string = "all",
): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_FACTORS, "readwrite");
      tx.objectStore(STORE_FACTORS).put({ key: cacheKey, events, updatedAt: Date.now() });
      tx.oncomplete = () => { db.close(); resolve(); };
    });
  } catch { /* ignore */ }
}

// ── 预警历史（本地）──

export interface LocalAlertRecord {
  id?: number;
  alertId: string;
  symbol: string;
  alertType: string;
  message: string;
  price: number;
  triggeredAt: number;
}

export async function saveLocalAlert(record: LocalAlertRecord): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_ALERTS, "readwrite");
      tx.objectStore(STORE_ALERTS).add(record);
      tx.oncomplete = () => { db.close(); resolve(); };
    });
  } catch { /* ignore */ }
}

export async function getLocalAlerts(limit: number = 50): Promise<LocalAlertRecord[]> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_ALERTS, "readonly");
      const store = tx.objectStore(STORE_ALERTS);
      const index = store.index("triggeredAt");
      const results: LocalAlertRecord[] = [];
      let count = 0;
      const cursorReq = index.openCursor(undefined, "prev");
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor && count < limit) {
          results.push(cursor.value); count++; cursor.continue();
        } else resolve(results);
      };
      cursorReq.onerror = () => resolve([]);
      tx.oncomplete = () => db.close();
    });
  } catch { return []; }
}