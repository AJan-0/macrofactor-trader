/**
 * useKlineData Hook — 增强版K线数据管道 (v2.0)
 * 
 * 升级内容：
 *   - 集成 klineStorage 长期存储
 *   - 支持5年历史数据
 *   - 自动增量更新
 *   - 智能降采样
 *   - 多时间周期统一管理
 *   - 【v2.0】预加载缓存 + 平滑过渡（解决切换卡顿）
 *   - 【v2.0】LRU 内存缓存，保留最近 5 个组合
 *   - 【v2.0】后台加载，避免空白闪烁
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { fetchKlines } from '@/services/cryptoCompare';
import type { AssetSymbol, Timeframe } from '@/store/appStore';
import {
  openKlineDB,
  storeKlines,
  getLatestKlines,
  getStorageStats,
  TIMEFRAME_CONFIG,
} from '@/services/klineStorage';

export interface UseKlineDataResult {
  klinesRef: React.MutableRefObject<KlineData[]>;
  dataVersion: number;
  isLoading: boolean;
  isTransitioning: boolean; // 【v2.0】过渡状态：正在切换到新数据
  error: string | null;
  bumpVersion: () => void;
  storageStats: {
    totalBars: number;
    storageSizeMB: number;
    dateRange: { start: Date; end: Date };
  } | null;
  // 【v2.0】预加载控制
  prefetch: (symbol: AssetSymbol, timeframe: Timeframe) => void;
}

// 兼容旧版类型
export interface KlineData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// 【v2.0】LRU 缓存条目
interface CacheEntry {
  symbol: AssetSymbol;
  timeframe: Timeframe;
  data: KlineData[];
  timestamp: number; // 缓存时间
  accessCount: number; // 访问次数（用于 LRU）
}

// 【v2.0】全局 LRU 缓存（跨组件共享）
const GLOBAL_CACHE = new Map<string, CacheEntry>();
const MAX_CACHE_SIZE = 5; // 最多缓存 5 个组合
const CACHE_TTL_MS = 5 * 60 * 1000; // 缓存有效期 5 分钟

function getCacheKey(symbol: AssetSymbol, timeframe: Timeframe): string {
  return `${symbol}::${timeframe}`;
}

function getFromCache(symbol: AssetSymbol, timeframe: Timeframe): KlineData[] | null {
  const key = getCacheKey(symbol, timeframe);
  const entry = GLOBAL_CACHE.get(key);
  if (!entry) return null;
  
  // 检查是否过期
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    GLOBAL_CACHE.delete(key);
    return null;
  }
  
  // 更新访问计数
  entry.accessCount++;
  return entry.data;
}

function setCache(symbol: AssetSymbol, timeframe: Timeframe, data: KlineData[]) {
  const key = getCacheKey(symbol, timeframe);
  
  // 如果缓存已满，淘汰最少使用的
  if (GLOBAL_CACHE.size >= MAX_CACHE_SIZE && !GLOBAL_CACHE.has(key)) {
    let minAccess = Infinity;
    let minKey = '';
    for (const [k, v] of GLOBAL_CACHE.entries()) {
      if (v.accessCount < minAccess) {
        minAccess = v.accessCount;
        minKey = k;
      }
    }
    if (minKey) {
      GLOBAL_CACHE.delete(minKey);
      console.log(`[useKlineData] Cache evicted: ${minKey}`);
    }
  }
  
  GLOBAL_CACHE.set(key, {
    symbol,
    timeframe,
    data,
    timestamp: Date.now(),
    accessCount: 1,
  });
}

// 【v2.0】后台预加载队列
const PREFETCH_QUEUE = new Set<string>();
let isPrefetching = false;

async function processPrefetchQueue() {
  if (isPrefetching) return;
  isPrefetching = true;
  
  while (PREFETCH_QUEUE.size > 0) {
    const key = PREFETCH_QUEUE.values().next().value as string;
    PREFETCH_QUEUE.delete(key);
    
    const [symbol, timeframe] = key.split('::') as [AssetSymbol, Timeframe];
    if (!symbol || !timeframe) continue;
    
    // 如果已经在缓存中，跳过
    if (getFromCache(symbol, timeframe)) continue;
    
    try {
      await openKlineDB();
      const storedData = await getLatestKlines(symbol, timeframe, 2000);
      if (storedData.length > 0) {
        setCache(symbol, timeframe, storedData);
        console.log(`[useKlineData] Prefetched ${storedData.length} bars for ${key}`);
      }
    } catch (err) {
      console.warn(`[useKlineData] Prefetch failed for ${key}:`, err);
    }
  }
  
  isPrefetching = false;
}

export function useKlineData(
  symbol: AssetSymbol,
  timeframe: Timeframe,
): UseKlineDataResult {
  const klinesRef = useRef<KlineData[]>([]);
  const [dataVersion, setDataVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isTransitioning, setIsTransitioning] = useState(false); // 【v2.0】
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<UseKlineDataResult['storageStats']>(null);
  
  // 防御：追踪当前请求标识，防止竞态
  const requestIdRef = useRef(0);
  const metaRef = useRef({
    latestStoredTime: 0,
    isInitialized: false,
  });
  
  // 【v2.0】记录上一个有效的 symbol/timeframe，用于保留旧数据
  const prevKeyRef = useRef<string>('');
  const prevDataRef = useRef<KlineData[]>([]);

  useEffect(() => {
    // 防御性检查
    if (typeof symbol !== 'string' || typeof timeframe !== 'string') {
      console.error(
        `[useKlineData] ⚠️ symbol/timeframe 必须是基本类型！当前 symbol=${typeof symbol}, timeframe=${typeof timeframe}`
      );
    }

    const currentRequestId = ++requestIdRef.current;
    let cancelled = false;
    const abortCtrl = new AbortController();
    const currentKey = getCacheKey(symbol, timeframe);

    // 【v2.0】检查缓存：如果缓存中有数据，先显示缓存数据，避免空白
    const cached = getFromCache(symbol, timeframe);
    if (cached && cached.length > 0) {
      // 有缓存，直接显示，不显示 loading
      klinesRef.current = cached;
      metaRef.current.latestStoredTime = cached[cached.length - 1].time;
      metaRef.current.isInitialized = true;
      queueMicrotask(() => {
        if (cancelled || currentRequestId !== requestIdRef.current) return;
        setDataVersion(v => v + 1);
        setIsLoading(false);
        setIsTransitioning(false);
      });
      console.log(`[useKlineData] ⚡ ${cached.length} bars from cache (${symbol} ${timeframe})`);
      
      // 后台检查增量更新
      checkIncrementalUpdate(symbol, timeframe, cached[cached.length - 1].time);
      
      // 保存当前状态用于下次切换
      prevKeyRef.current = currentKey;
      prevDataRef.current = [...cached];
      
      return () => {
        cancelled = true;
        abortCtrl.abort();
      };
    }

    // 【v2.0】无缓存时，保留旧数据，标记为 transitioning
    const hasOldData = prevDataRef.current.length > 0 && prevKeyRef.current !== currentKey;
    queueMicrotask(() => {
      if (cancelled || currentRequestId !== requestIdRef.current) return;

      if (hasOldData) {
        // 保留旧数据，但标记为过渡状态
        setIsTransitioning(true);
      } else {
        // 没有旧数据，显示 loading
        setIsLoading(true);
      }

      setError(null);
    });
    if (!hasOldData) {
      klinesRef.current = [];
    }
    metaRef.current = { latestStoredTime: 0, isInitialized: false };

    async function init() {
      try {
        // 确保数据库已打开
        await openKlineDB();
        
        // 获取存储统计
        const storageStats = await getStorageStats(symbol, timeframe);
        if (storageStats) {
          setStats({
            totalBars: storageStats.totalBars,
            storageSizeMB: storageStats.storageSizeMB,
            dateRange: storageStats.dateRange,
          });
        }
        
        // Step 1: 尝试从长期存储加载
        const storedData = await getLatestKlines(symbol, timeframe, 2000);
        
        if (storedData.length > 0 && !cancelled) {
          // 【v2.0】保存到缓存
          setCache(symbol, timeframe, storedData);
          
          klinesRef.current = storedData;
          metaRef.current.latestStoredTime = storedData[storedData.length - 1].time;
          metaRef.current.isInitialized = true;
          setDataVersion(v => v + 1);
          setIsLoading(false);
          setIsTransitioning(false); // 【v2.0】过渡完成
          
          console.log(`[useKlineData] 📦 ${storedData.length} bars from storage (${symbol} ${timeframe})`);
          
          // 后台检查是否需要增量更新
          checkIncrementalUpdate(symbol, timeframe, storedData[storedData.length - 1].time);
        } else {
          // Step 2: 存储无数据，从API加载完整历史
          console.log(`[useKlineData] Fetching full history ${symbol} ${timeframe}`);
          await loadFullHistory(symbol, timeframe, abortCtrl.signal);
        }
        
        // 【v2.0】保存当前状态
        if (!cancelled) {
          prevKeyRef.current = currentKey;
          prevDataRef.current = [...klinesRef.current];
        }
      } catch (err) {
        if (cancelled || currentRequestId !== requestIdRef.current) return;
        
        const msg = err instanceof Error ? err.message : 'Failed to load K-lines';
        console.error(`[useKlineData] ❌ ${symbol} ${timeframe}:`, msg);
        setError(msg);
        setIsLoading(false);
        setIsTransitioning(false);
      }
    }
    
    // 加载完整历史数据
    async function loadFullHistory(
      sym: AssetSymbol,
      tf: Timeframe,
      signal: AbortSignal,
    ) {
      const config = TIMEFRAME_CONFIG[tf];
      const start = performance.now();
      
      try {
        const rawData = await fetchKlines(sym, tf, config.retentionDays, signal);
        
        if (cancelled || currentRequestId !== requestIdRef.current) return;
        
        const data: KlineData[] = rawData.map(d => ({
          time: d.time,
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
          volume: d.volume,
        }));
        
        // 存储到 IndexedDB
        await storeKlines(sym, tf, data);
        
        // 【v2.0】保存到缓存
        setCache(sym, tf, data);
        
        klinesRef.current = data;
        metaRef.current.latestStoredTime = data[data.length - 1]?.time || 0;
        metaRef.current.isInitialized = true;
        
        const elapsed = (performance.now() - start).toFixed(0);
        console.log(`[useKlineData] ✅ ${data.length} bars loaded (${sym} ${tf}) in ${elapsed}ms`);
        
        // 更新统计
        const newStats = await getStorageStats(sym, tf);
        if (newStats) {
          setStats({
            totalBars: newStats.totalBars,
            storageSizeMB: newStats.storageSizeMB,
            dateRange: newStats.dateRange,
          });
        }
        
        setDataVersion(v => v + 1);
        setIsLoading(false);
        setIsTransitioning(false); // 【v2.0】过渡完成
      } catch (err) {
        if (signal.aborted) return;
        throw err;
      }
    }
    
    // 后台增量更新
    async function checkIncrementalUpdate(
      sym: AssetSymbol,
      tf: Timeframe,
      lastTime: number,
    ) {
      const now = Math.floor(Date.now() / 1000);
      
      // 根据时间周期决定更新频率
      const updateThreshold = tf === '1m' ? 60 : tf === '1H' ? 300 : 3600;
      
      if (now - lastTime < updateThreshold) {
        console.log(`[useKlineData] Data is fresh, skip update`);
        return;
      }
      
      console.log(`[useKlineData] Checking for incremental updates...`);
      
      try {
        // 只获取最近的数据
        const recentData = await fetchKlines(sym, tf, 1, abortCtrl.signal);
        
        if (cancelled) return;
        
        const newBars: KlineData[] = recentData
          .map(d => ({
            time: d.time,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
            volume: d.volume,
          }))
          .filter(d => d.time > lastTime);
        
        if (newBars.length > 0) {
          // 存储新数据
          await storeKlines(sym, tf, newBars);
          
          // 合并到当前显示
          klinesRef.current = mergeKlines(klinesRef.current, newBars);
          metaRef.current.latestStoredTime = newBars[newBars.length - 1].time;
          
          // 【v2.0】更新缓存
          setCache(sym, tf, klinesRef.current);
          
          setDataVersion(v => v + 1);
          
          console.log(`[useKlineData] Incremental update: +${newBars.length} bars`);
          
          // 更新统计
          const newStats = await getStorageStats(sym, tf);
          if (newStats) {
            setStats({
              totalBars: newStats.totalBars,
              storageSizeMB: newStats.storageSizeMB,
              dateRange: newStats.dateRange,
            });
          }
        }
      } catch (err) {
        console.warn(`[useKlineData] Incremental update failed:`, err);
      }
    }
    
    init();
    
    return () => {
      cancelled = true;
      abortCtrl.abort();
    };
  }, [symbol, timeframe]);

  const bumpVersion = useCallback(() => setDataVersion(v => v + 1), []);
  
  // 【v2.0】预加载函数：提前加载指定组合的数据到缓存
  const prefetch = useCallback((prefetchSymbol: AssetSymbol, prefetchTimeframe: Timeframe) => {
    const key = getCacheKey(prefetchSymbol, prefetchTimeframe);
    
    // 如果已经在缓存或队列中，跳过
    if (getFromCache(prefetchSymbol, prefetchTimeframe)) return;
    if (PREFETCH_QUEUE.has(key)) return;
    
    PREFETCH_QUEUE.add(key);
    console.log(`[useKlineData] Queued prefetch: ${key}`);
    
    // 延迟启动预加载，避免阻塞当前操作
    setTimeout(() => {
      processPrefetchQueue();
    }, 100);
  }, []);

  return { 
    klinesRef, 
    dataVersion, 
    isLoading, 
    isTransitioning, // 【v2.0】
    error, 
    bumpVersion,
    storageStats: stats,
    prefetch, // 【v2.0】
  };
}

// ── 辅助函数 ──

function mergeKlines(existing: KlineData[], incoming: KlineData[]): KlineData[] {
  const map = new Map<number, KlineData>();
  
  for (const bar of existing) {
    map.set(bar.time, bar);
  }
  
  for (const bar of incoming) {
    map.set(bar.time, bar);
  }
  
  return Array.from(map.values()).sort((a, b) => a.time - b.time);
}
