/**
 * useKlineData Hook — 增强版K线数据管道 (v2.1)
 * 
 * 修复内容：
 *   - 修复 symbol 切换时缓存不更新的问题
 *   - 确保每次 symbol/timeframe 变化时重新加载数据
 *   - 清除旧数据避免显示错误
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
  isTransitioning: boolean;
  error: string | null;
  bumpVersion: () => void;
  storageStats: {
    totalBars: number;
    storageSizeMB: number;
    dateRange: { start: Date; end: Date };
  } | null;
  prefetch: (symbol: AssetSymbol, timeframe: Timeframe) => void;
}

export interface KlineData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// LRU 缓存条目
interface CacheEntry {
  symbol: AssetSymbol;
  timeframe: Timeframe;
  data: KlineData[];
  timestamp: number;
  accessCount: number;
}

// 全局 LRU 缓存（跨组件共享）
const GLOBAL_CACHE = new Map<string, CacheEntry>();
const MAX_CACHE_SIZE = 5;
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCacheKey(symbol: AssetSymbol, timeframe: Timeframe): string {
  return `${symbol}::${timeframe}`;
}

function getFromCache(symbol: AssetSymbol, timeframe: Timeframe): KlineData[] | null {
  const key = getCacheKey(symbol, timeframe);
  const entry = GLOBAL_CACHE.get(key);
  if (!entry) return null;
  
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    GLOBAL_CACHE.delete(key);
    return null;
  }
  
  entry.accessCount++;
  return entry.data;
}

function setCache(symbol: AssetSymbol, timeframe: Timeframe, data: KlineData[]) {
  const key = getCacheKey(symbol, timeframe);
  
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

// 后台预加载队列
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
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<UseKlineDataResult['storageStats']>(null);
  
  // 防御：追踪当前请求标识，防止竞态
  const requestIdRef = useRef(0);
  const metaRef = useRef({
    latestStoredTime: 0,
    isInitialized: false,
  });
  
  // 记录上一个有效的 symbol/timeframe
  const prevKeyRef = useRef<string>('');
  const prevDataRef = useRef<KlineData[]>([]);
  
  // 强制清空数据的标志
  const forceClearRef = useRef(false);

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
    
    // 如果 symbol/timeframe 变化了，强制清空旧数据
    if (prevKeyRef.current !== '' && prevKeyRef.current !== currentKey) {
      console.log(`[useKlineData] Symbol/Timeframe changed: ${prevKeyRef.current} -> ${currentKey}`);
      klinesRef.current = [];
      forceClearRef.current = true;
      setDataVersion(v => v + 1); // 触发重新渲染
    }

    // 检查缓存（symbol 切换后不使用缓存，强制重新加载）
    const cached = getFromCache(symbol, timeframe);
    if (cached && cached.length > 0 && !forceClearRef.current && prevKeyRef.current === currentKey) {
      // 有缓存且不是首次加载，直接显示
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
      forceClearRef.current = false;
      
      return () => {
        cancelled = true;
        abortCtrl.abort();
      };
    }
    
    forceClearRef.current = false;

    // 无缓存时，保留旧数据，标记为 transitioning
    const hasOldData = prevDataRef.current.length > 0 && prevKeyRef.current !== currentKey;
    queueMicrotask(() => {
      if (cancelled || currentRequestId !== requestIdRef.current) return;

      if (hasOldData) {
        setIsTransitioning(true);
      } else {
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
          // 保存到缓存
          setCache(symbol, timeframe, storedData);
          
          klinesRef.current = storedData;
          metaRef.current.latestStoredTime = storedData[storedData.length - 1].time;
          metaRef.current.isInitialized = true;
          setDataVersion(v => v + 1);
          setIsLoading(false);
          setIsTransitioning(false);
          
          console.log(`[useKlineData] 📦 ${storedData.length} bars from storage (${symbol} ${timeframe})`);
          
          // 后台检查是否需要增量更新
          checkIncrementalUpdate(symbol, timeframe, storedData[storedData.length - 1].time);
        } else {
          // Step 2: 存储无数据，从API加载完整历史
          console.log(`[useKlineData] Fetching full history ${symbol} ${timeframe}`);
          await loadFullHistory(symbol, timeframe, abortCtrl.signal);
        }
        
        // 保存当前状态
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
        
        // 保存到缓存
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
        setIsTransitioning(false);
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
          
          // 更新缓存
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
  
  // 预加载函数
  const prefetch = useCallback((prefetchSymbol: AssetSymbol, prefetchTimeframe: Timeframe) => {
    const key = getCacheKey(prefetchSymbol, prefetchTimeframe);
    
    if (getFromCache(prefetchSymbol, prefetchTimeframe)) return;
    if (PREFETCH_QUEUE.has(key)) return;
    
    PREFETCH_QUEUE.add(key);
    console.log(`[useKlineData] Queued prefetch: ${key}`);
    
    setTimeout(() => {
      processPrefetchQueue();
    }, 100);
  }, []);

  return { 
    klinesRef, 
    dataVersion, 
    isLoading, 
    isTransitioning,
    error, 
    bumpVersion,
    storageStats: stats,
    prefetch,
  };
}

// 辅助函数

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
