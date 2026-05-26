/**
 * K线数据长期存储服务 (v1.0.0)
 * 
 * 设计目标：
 *   - 支持5年+历史数据存储
 *   - 多时间周期统一存储 (1m, 3m, 5m, 15m, 1H, 4H, 1D)
 *   - 按年/月分区，高效查询
 *   - 自动降采样：大时间范围自动切换到低频数据
 *   - 数据完整性校验
 * 
 * 存储架构：
 *   IndexedDB: macrofactor-trader-v2
 *   ├── kline_chunks (ObjectStore) - 按年月分区的K线块
 *   │   └── key: "<SYMBOL>|<TF>|<YYYY-MM>"
   │   └── value: { bars: KlineData[], firstTime, lastTime, count, checksum }
 *   ├── kline_meta (ObjectStore) - 元数据索引
 *   │   └── key: "<SYMBOL>|<TF>"
 *   │   └── value: { symbol, tf, totalBars, firstTime, lastTime, chunkKeys[], lastUpdate }
 *   └── kline_daily (ObjectStore) - 日线汇总 (用于快速统计)
 *       └── key: "<SYMBOL>|<YYYY-MM-DD>"
 *       └── value: { open, high, low, close, volume, changePct }
 */

import type { Timeframe } from "@/store/appStore";

// ── 类型定义 ──

export interface KlineData {
  time: number;      // Unix timestamp (seconds)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface KlineChunk {
  key: string;           // "BTC-USDT|1D|2024-01"
  symbol: string;
  timeframe: string;
  yearMonth: string;     // "2024-01"
  bars: KlineData[];
  firstTime: number;
  lastTime: number;
  count: number;
  checksum: string;      // 简单校验
  createdAt: number;
  updatedAt: number;
}

export interface KlineMeta {
  key: string;           // "BTC-USDT|1D"
  symbol: string;
  timeframe: string;
  totalBars: number;
  firstTime: number;
  lastTime: number;
  chunkKeys: string[];   // 所有 chunk key 列表
  lastUpdate: number;
  version: number;       // 数据版本，用于增量更新
}

export interface KlineDailySummary {
  key: string;           // "BTC-USDT|2024-01-15"
  symbol: string;
  date: string;          // "2024-01-15"
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  changePct: number;
}

export interface StorageStats {
  symbol: string;
  timeframe: string;
  totalBars: number;
  totalChunks: number;
  dateRange: { start: Date; end: Date };
  storageSizeMB: number;
}

// ── 常量 ──

const DB_NAME = "macrofactor-trader-v2";
const DB_VERSION = 2;

const STORE_CHUNKS = "kline_chunks";
const STORE_META = "kline_meta";
const STORE_DAILY = "kline_daily";
const STORE_CONFIG = "storage_config";

// 5年存储目标
export const STORAGE_TARGET_YEARS = 5;
export const STORAGE_TARGET_DAYS = STORAGE_TARGET_YEARS * 365;

// Chunk 大小：按月分区
// 1D: ~30 bars/month
// 1H: ~720 bars/month  
// 15m: ~2880 bars/month
// 1m: ~43200 bars/month (建议只存最近1年)
export const TIMEFRAME_CONFIG: Record<Timeframe, {
  retentionDays: number;    // 保留天数
  chunkSize: number;        // 每个chunk多少条 (按月)
  downsampleFrom?: Timeframe; // 从哪个更大周期降采样
}> = {
  "1m":  { retentionDays: 90,   chunkSize: 43200 },   // 只存3个月
  "3m":  { retentionDays: 180,  chunkSize: 14400 },   // 只存6个月
  "5m":  { retentionDays: 365,  chunkSize: 8640 },    // 存1年
  "15m": { retentionDays: 730,  chunkSize: 2880 },    // 存2年
  "1H":  { retentionDays: 1825, chunkSize: 720 },     // 存5年
  "4H":  { retentionDays: 1825, chunkSize: 180 },     // 存5年
  "1D":  { retentionDays: 1825, chunkSize: 30 },      // 存5年
};

// ── 工具函数 ──

function yearMonthKey(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function dateKey(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function simpleChecksum(bars: KlineData[]): string {
  // 简单的校验和：首尾时间戳 + 总条数
  if (!bars.length) return "0";
  const first = bars[0].time;
  const last = bars[bars.length - 1].time;
  const sum = bars.reduce((s, b) => s + b.close, 0);
  return `${first}-${last}-${bars.length}-${sum.toFixed(2)}`;
}

// ── 数据库初始化 ──

let _dbPromise: Promise<IDBDatabase> | null = null;

export function openKlineDB(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;
  
  _dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      const oldVersion = e.oldVersion;
      
      // 创建 K线块存储
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        const store = db.createObjectStore(STORE_CHUNKS, { keyPath: "key" });
        store.createIndex("symbol_tf", ["symbol", "timeframe"], { unique: false });
        store.createIndex("timeRange", ["firstTime", "lastTime"], { unique: false });
      }
      
      // 创建元数据存储
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
      
      // 创建日线汇总存储
      if (!db.objectStoreNames.contains(STORE_DAILY)) {
        const store = db.createObjectStore(STORE_DAILY, { keyPath: "key" });
        store.createIndex("symbol_date", ["symbol", "date"], { unique: false });
      }
      
      // 创建配置存储
      if (!db.objectStoreNames.contains(STORE_CONFIG)) {
        db.createObjectStore(STORE_CONFIG, { keyPath: "key" });
      }
      
      // 从 v1 迁移数据
      if (oldVersion === 1) {
        migrateFromV1(db);
      }
    };
    
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  
  return _dbPromise;
}

// 从 v1 迁移
async function migrateFromV1(db: IDBDatabase): Promise<void> {
  try {
    // 尝试读取旧数据
    const oldDB = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("macrofactor-trader", 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    
    // 读取旧数据并转换
    const oldData = await new Promise<any[]>((resolve) => {
      const tx = oldDB.transaction("klines", "readonly");
      const store = tx.objectStore("klines");
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    
    console.log(`[KlineStorage] Migrating ${oldData.length} entries from v1...`);
    
    // 转换并写入新格式
    for (const entry of oldData) {
      if (!entry.key || !entry.klines) continue;
      const [symbol, timeframe] = entry.key.split("|");
      if (!symbol || !timeframe) continue;
      
      // 按年月分组
      const chunks = groupByYearMonth(entry.klines);
      for (const [ym, bars] of chunks) {
        const chunkKey = `${symbol}|${timeframe}|${ym}`;
        const chunk: KlineChunk = {
          key: chunkKey,
          symbol,
          timeframe,
          yearMonth: ym,
          bars,
          firstTime: bars[0]?.time || 0,
          lastTime: bars[bars.length - 1]?.time || 0,
          count: bars.length,
          checksum: simpleChecksum(bars),
          createdAt: entry.updatedAt || Date.now(),
          updatedAt: Date.now(),
        };
        
        const tx = db.transaction(STORE_CHUNKS, "readwrite");
        tx.objectStore(STORE_CHUNKS).put(chunk);
      }
      
      // 更新元数据
      await updateMeta(db, symbol, timeframe);
    }
    
    oldDB.close();
    console.log("[KlineStorage] Migration complete");
  } catch (err) {
    console.warn("[KlineStorage] Migration failed:", err);
  }
}

function groupByYearMonth(bars: KlineData[]): Map<string, KlineData[]> {
  const groups = new Map<string, KlineData[]>();
  for (const bar of bars) {
    const ym = yearMonthKey(bar.time);
    if (!groups.has(ym)) groups.set(ym, []);
    groups.get(ym)!.push(bar);
  }
  return groups;
}

// ── 核心存储操作 ──

/**
 * 批量存储K线数据（自动分区）
 */
export async function storeKlines(
  symbol: string,
  timeframe: Timeframe,
  bars: KlineData[],
): Promise<void> {
  if (!bars.length) return;
  
  const db = await openKlineDB();
  const chunks = groupByYearMonth(bars);
  
  // 写入每个 chunk
  for (const [ym, chunkBars] of chunks) {
    const chunkKey = `${symbol}|${timeframe}|${ym}`;
    
    // 检查是否已存在，合并数据
    const existing = await getChunk(db, chunkKey);
    const mergedBars = existing 
      ? mergeBars(existing.bars, chunkBars)
      : chunkBars;
    
    const chunk: KlineChunk = {
      key: chunkKey,
      symbol,
      timeframe,
      yearMonth: ym,
      bars: mergedBars,
      firstTime: mergedBars[0].time,
      lastTime: mergedBars[mergedBars.length - 1].time,
      count: mergedBars.length,
      checksum: simpleChecksum(mergedBars),
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CHUNKS, "readwrite");
      tx.objectStore(STORE_CHUNKS).put(chunk);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  
  // 更新元数据
  await updateMeta(db, symbol, timeframe);
  
  // 如果是日线，更新日线汇总
  if (timeframe === "1D") {
    await updateDailySummaries(db, symbol, bars);
  }
}

/**
 * 查询K线数据（支持时间范围）
 */
export async function queryKlines(
  symbol: string,
  timeframe: Timeframe,
  options?: {
    startTime?: number;    // 开始时间 (秒)
    endTime?: number;      // 结束时间 (秒)
    limit?: number;        // 最大条数
    offset?: number;       // 跳过条数
  },
): Promise<KlineData[]> {
  const db = await openKlineDB();
  const { startTime, endTime, limit = Infinity, offset = 0 } = options || {};
  
  // 获取元数据，确定需要读取哪些 chunk
  const meta = await getMeta(db, symbol, timeframe);
  if (!meta || !meta.chunkKeys.length) return [];
  
  // 筛选相关 chunks
  const relevantChunks = meta.chunkKeys.filter(key => {
    // 从 key 解析年月: "BTC-USDT|1D|2024-01"
    const parts = key.split("|");
    const ym = parts[2];
    if (!ym) return false;
    
    const [year, month] = ym.split("-").map(Number);
    const chunkStart = new Date(Date.UTC(year, month - 1, 1)).getTime() / 1000;
    const chunkEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59)).getTime() / 1000;
    
    if (startTime && chunkEnd < startTime) return false;
    if (endTime && chunkStart > endTime) return false;
    return true;
  });
  
  // 读取并合并
  let allBars: KlineData[] = [];
  for (const chunkKey of relevantChunks.sort()) {
    const chunk = await getChunk(db, chunkKey);
    if (!chunk) continue;
    
    let bars = chunk.bars;
    if (startTime) bars = bars.filter(b => b.time >= startTime);
    if (endTime) bars = bars.filter(b => b.time <= endTime);
    
    allBars.push(...bars);
  }
  
  // 去重排序
  allBars = dedupAndSort(allBars);
  
  // 应用 limit/offset
  if (offset > 0) allBars = allBars.slice(offset);
  if (limit < Infinity) allBars = allBars.slice(0, limit);
  
  return allBars;
}

/**
 * 获取最新 N 条K线
 */
export async function getLatestKlines(
  symbol: string,
  timeframe: Timeframe,
  count: number,
): Promise<KlineData[]> {
  const meta = await getMeta(await openKlineDB(), symbol, timeframe);
  if (!meta) return [];
  
  return queryKlines(symbol, timeframe, {
    endTime: meta.lastTime,
    limit: count,
  });
}

/**
 * 获取存储统计信息
 */
export async function getStorageStats(
  symbol: string,
  timeframe: Timeframe,
): Promise<StorageStats | null> {
  const db = await openKlineDB();
  const meta = await getMeta(db, symbol, timeframe);
  if (!meta) return null;
  
  // 估算存储大小
  let totalSize = 0;
  for (const chunkKey of meta.chunkKeys) {
    const chunk = await getChunk(db, chunkKey);
    if (chunk) {
      totalSize += JSON.stringify(chunk).length * 2; // UTF-16 估算
    }
  }
  
  return {
    symbol,
    timeframe,
    totalBars: meta.totalBars,
    totalChunks: meta.chunkKeys.length,
    dateRange: {
      start: new Date(meta.firstTime * 1000),
      end: new Date(meta.lastTime * 1000),
    },
    storageSizeMB: +(totalSize / 1024 / 1024).toFixed(2),
  };
}

/**
 * 清理过期数据
 */
export async function cleanupExpiredData(): Promise<{
  deletedChunks: number;
  freedMB: number;
}> {
  const db = await openKlineDB();
  let deletedChunks = 0;
  let freedBytes = 0;
  const now = Date.now() / 1000;
  
  // 获取所有 meta
  const allMeta = await new Promise<KlineMeta[]>((resolve) => {
    const tx = db.transaction(STORE_META, "readonly");
    const req = tx.objectStore(STORE_META).getAll();
    req.onsuccess = () => resolve(req.result as KlineMeta[]);
    req.onerror = () => resolve([]);
  });
  
  for (const meta of allMeta) {
    const config = TIMEFRAME_CONFIG[meta.timeframe as Timeframe];
    if (!config) continue;
    
    const cutoffTime = now - config.retentionDays * 86400;
    const chunksToDelete: string[] = [];
    
    for (const chunkKey of meta.chunkKeys) {
      const chunk = await getChunk(db, chunkKey);
      if (chunk && chunk.lastTime < cutoffTime) {
        chunksToDelete.push(chunkKey);
        freedBytes += JSON.stringify(chunk).length * 2;
      }
    }
    
    // 删除过期 chunks
    for (const key of chunksToDelete) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_CHUNKS, "readwrite");
        tx.objectStore(STORE_CHUNKS).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      deletedChunks++;
    }
    
    // 更新 meta
    if (chunksToDelete.length > 0) {
      meta.chunkKeys = meta.chunkKeys.filter(k => !chunksToDelete.includes(k));
      await updateMeta(db, meta.symbol, meta.timeframe);
    }
  }
  
  return {
    deletedChunks,
    freedMB: +(freedBytes / 1024 / 1024).toFixed(2),
  };
}

/**
 * 导出数据为 CSV
 */
export async function exportToCSV(
  symbol: string,
  timeframe: Timeframe,
  options?: { startTime?: number; endTime?: number },
): Promise<string> {
  const bars = await queryKlines(symbol, timeframe, options);
  
  const headers = ["time", "open", "high", "low", "close", "volume"];
  const rows = bars.map(b => [
    new Date(b.time * 1000).toISOString(),
    b.open,
    b.high,
    b.low,
    b.close,
    b.volume,
  ]);
  
  return [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
}

// ── 内部辅助函数 ──

async function getChunk(db: IDBDatabase, key: string): Promise<KlineChunk | null> {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_CHUNKS, "readonly");
    const req = tx.objectStore(STORE_CHUNKS).get(key);
    req.onsuccess = () => resolve(req.result as KlineChunk || null);
    req.onerror = () => resolve(null);
  });
}

async function getMeta(db: IDBDatabase, symbol: string, timeframe: string): Promise<KlineMeta | null> {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_META, "readonly");
    const req = tx.objectStore(STORE_META).get(`${symbol}|${timeframe}`);
    req.onsuccess = () => resolve(req.result as KlineMeta || null);
    req.onerror = () => resolve(null);
  });
}

async function updateMeta(db: IDBDatabase, symbol: string, timeframe: string): Promise<void> {
  // 获取该 symbol/tf 的所有 chunks
  const chunks = await new Promise<KlineChunk[]>((resolve) => {
    const tx = db.transaction(STORE_CHUNKS, "readonly");
    const index = tx.objectStore(STORE_CHUNKS).index("symbol_tf");
    const req = index.getAll([symbol, timeframe]);
    req.onsuccess = () => resolve(req.result as KlineChunk[]);
    req.onerror = () => resolve([]);
  });
  
  if (!chunks.length) return;
  
  // 排序并计算统计
  chunks.sort((a, b) => a.firstTime - b.firstTime);
  
  const totalBars = chunks.reduce((sum, c) => sum + c.count, 0);
  const firstTime = chunks[0].firstTime;
  const lastTime = chunks[chunks.length - 1].lastTime;
  
  const meta: KlineMeta = {
    key: `${symbol}|${timeframe}`,
    symbol,
    timeframe,
    totalBars,
    firstTime,
    lastTime,
    chunkKeys: chunks.map(c => c.key),
    lastUpdate: Date.now(),
    version: 1,
  };
  
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_META, "readwrite");
    tx.objectStore(STORE_META).put(meta);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function updateDailySummaries(
  db: IDBDatabase,
  symbol: string,
  bars: KlineData[],
): Promise<void> {
  const tx = db.transaction(STORE_DAILY, "readwrite");
  const store = tx.objectStore(STORE_DAILY);
  
  for (const bar of bars) {
    const key = `${symbol}|${dateKey(bar.time)}`;
    const summary: KlineDailySummary = {
      key,
      symbol,
      date: dateKey(bar.time),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      changePct: 0, // 需要前一天数据计算
    };
    store.put(summary);
  }
  
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function mergeBars(existing: KlineData[], incoming: KlineData[]): KlineData[] {
  const map = new Map<number, KlineData>();
  
  // 先放入现有数据
  for (const bar of existing) {
    map.set(bar.time, bar);
  }
  
  // 用新数据覆盖或添加
  for (const bar of incoming) {
    map.set(bar.time, bar);
  }
  
  // 按时间排序返回
  return Array.from(map.values()).sort((a, b) => a.time - b.time);
}

function dedupAndSort(bars: KlineData[]): KlineData[] {
  const seen = new Map<number, KlineData>();
  for (const bar of bars) {
    // 如果有重复，保留最新的
    seen.set(bar.time, bar);
  }
  return Array.from(seen.values()).sort((a, b) => a.time - b.time);
}

// ── 降采样工具 ──

/**
 * 将高频K线降采样为低频
 * 例如：1H -> 4H, 15m -> 1H
 */
export function resampleKlines(
  bars: KlineData[],
  targetIntervalSeconds: number,
): KlineData[] {
  if (!bars.length) return [];
  
  const groups = new Map<number, KlineData[]>();
  
  for (const bar of bars) {
    const bucketTime = Math.floor(bar.time / targetIntervalSeconds) * targetIntervalSeconds;
    if (!groups.has(bucketTime)) groups.set(bucketTime, []);
    groups.get(bucketTime)!.push(bar);
  }
  
  const result: KlineData[] = [];
  for (const [time, groupBars] of Array.from(groups.entries()).sort((a, b) => a[0] - b[0])) {
    if (!groupBars.length) continue;
    
    result.push({
      time,
      open: groupBars[0].open,
      high: Math.max(...groupBars.map(b => b.high)),
      low: Math.min(...groupBars.map(b => b.low)),
      close: groupBars[groupBars.length - 1].close,
      volume: groupBars.reduce((sum, b) => sum + b.volume, 0),
    });
  }
  
  return result;
}

/**
 * 自动选择最佳时间周期
 * 根据请求的时间范围，自动选择合适的数据周期
 */
export function autoSelectTimeframe(
  startTime: number,
  endTime: number,
): { timeframe: Timeframe; needResample: boolean } {
  const rangeDays = (endTime - startTime) / 86400;
  
  if (rangeDays <= 7) return { timeframe: "15m", needResample: false };
  if (rangeDays <= 30) return { timeframe: "1H", needResample: false };
  if (rangeDays <= 90) return { timeframe: "4H", needResample: false };
  if (rangeDays <= 365) return { timeframe: "1D", needResample: false };
  
  // 超过1年，使用日线并可能需要进一步降采样
  return { timeframe: "1D", needResample: rangeDays > 730 };
}

// ── 批量导入导出 ──

/**
 * 从外部数据源批量导入
 */
export async function bulkImportKlines(
  symbol: string,
  timeframe: Timeframe,
  bars: KlineData[],
  onProgress?: (current: number, total: number) => void,
): Promise<void> {
  const total = bars.length;
  const BATCH_SIZE = 5000;
  
  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = bars.slice(i, i + BATCH_SIZE);
    await storeKlines(symbol, timeframe, batch);
    onProgress?.(Math.min(i + BATCH_SIZE, total), total);
  }
}

// ── 存储健康检查 ──

export async function checkStorageHealth(): Promise<{
  healthy: boolean;
  issues: string[];
  stats: { totalSymbols: number; totalTimeframes: number; totalBars: number };
}> {
  const db = await openKlineDB();
  const issues: string[] = [];
  
  // 获取所有 meta
  const allMeta = await new Promise<KlineMeta[]>((resolve) => {
    const tx = db.transaction(STORE_META, "readonly");
    const req = tx.objectStore(STORE_META).getAll();
    req.onsuccess = () => resolve(req.result as KlineMeta[]);
    req.onerror = () => resolve([]);
  });
  
  let totalBars = 0;
  const symbolSet = new Set<string>();
  const tfSet = new Set<string>();
  
  for (const meta of allMeta) {
    symbolSet.add(meta.symbol);
    tfSet.add(meta.timeframe);
    totalBars += meta.totalBars;
    
    // 检查数据一致性
    let actualBars = 0;
    for (const chunkKey of meta.chunkKeys) {
      const chunk = await getChunk(db, chunkKey);
      if (!chunk) {
        issues.push(`Missing chunk: ${chunkKey}`);
      } else {
        actualBars += chunk.count;
        // 校验 checksum
        const expectedChecksum = simpleChecksum(chunk.bars);
        if (chunk.checksum !== expectedChecksum) {
          issues.push(`Checksum mismatch: ${chunkKey}`);
        }
      }
    }
    
    if (actualBars !== meta.totalBars) {
      issues.push(`Bar count mismatch for ${meta.key}: meta=${meta.totalBars}, actual=${actualBars}`);
    }
  }
  
  return {
    healthy: issues.length === 0,
    issues,
    stats: {
      totalSymbols: symbolSet.size,
      totalTimeframes: tfSet.size,
      totalBars,
    },
  };
}
