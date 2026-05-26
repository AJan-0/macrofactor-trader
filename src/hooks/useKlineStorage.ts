/**
 * useKlineStorage Hook — 长期K线数据管理
 * 
 * 特性：
 *   - 自动加载5年历史数据
 *   - 多时间周期统一管理
 *   - 增量更新（只获取缺失数据）
 *   - 自动降采样优化性能
 *   - 存储空间监控
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { AssetSymbol, Timeframe } from '@/store/appStore';
import type { KlineData } from '@/services/klineStorage';
import {
  openKlineDB,
  storeKlines,
  queryKlines,
  getLatestKlines,
  getStorageStats,
  TIMEFRAME_CONFIG,
} from '@/services/klineStorage';
import { fetchKlines } from '@/services/cryptoCompare';

export interface UseKlineStorageResult {
  klines: KlineData[];
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  storageStats: {
    totalBars: number;
    storageSizeMB: number;
    dateRange: { start: Date; end: Date };
  } | null;
  
  // 操作
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  exportData: () => Promise<string>;
  clearStorage: () => Promise<void>;
}

export function useKlineStorage(
  symbol: AssetSymbol,
  timeframe: Timeframe,
): UseKlineStorageResult {
  const [klines, setKlines] = useState<KlineData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [stats, setStats] = useState<UseKlineStorageResult['storageStats']>(null);
  
  const metaRef = useRef<{
    earliestLoaded: number;
    latestLoaded: number;
    isInitialized: boolean;
  }>({ earliestLoaded: Infinity, latestLoaded: 0, isInitialized: false });
  
  // 初始化加载
  useEffect(() => {
    let cancelled = false;
    
    async function init() {
      setIsLoading(true);
      setError(null);
      metaRef.current = { earliestLoaded: Infinity, latestLoaded: 0, isInitialized: false };
      
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
        
        // 尝试从本地存储加载最新数据
        const latest = await getLatestKlines(symbol, timeframe, 1000);
        
        if (latest.length > 0 && !cancelled) {
          setKlines(latest);
          metaRef.current.latestLoaded = latest[latest.length - 1].time;
          metaRef.current.earliestLoaded = latest[0].time;
          metaRef.current.isInitialized = true;
          setIsLoading(false);
          
          // 后台检查是否需要更新
          checkAndUpdate(symbol, timeframe, latest[latest.length - 1].time);
        } else {
          // 本地无数据，从API加载
          await loadFromAPI(symbol, timeframe, true);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to initialize storage');
          setIsLoading(false);
        }
      }
    }
    
    init();
    
    return () => { cancelled = true; };
  }, [symbol, timeframe]);
  
  // 从API加载数据（支持增量）
  const loadFromAPI = useCallback(async (
    sym: AssetSymbol,
    tf: Timeframe,
    isInitial: boolean,
  ) => {
    const config = TIMEFRAME_CONFIG[tf];
    const now = Math.floor(Date.now() / 1000);
    
    try {
      let data: KlineData[];
      
      if (isInitial) {
        // 首次加载：获取全部目标历史数据
        const targetDays = config.retentionDays;
        console.log(`[useKlineStorage] Initial load: ${sym} ${tf}, target ${targetDays} days`);
        
        const rawData = await fetchKlines(sym, tf, targetDays);
        data = rawData.map(d => ({
          time: d.time,
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
          volume: d.volume,
        }));
      } else {
        // 增量更新：只获取新数据
        const fromTime = metaRef.current.latestLoaded;
        if (fromTime >= now - 60) {
          console.log(`[useKlineStorage] Data is up to date`);
          return;
        }
        
        console.log(`[useKlineStorage] Incremental update from ${new Date(fromTime * 1000).toISOString()}`);
        
        // 获取最新数据，然后过滤出新的
        const recentData = await fetchKlines(sym, tf, 1);
        data = recentData
          .map(d => ({
            time: d.time,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
            volume: d.volume,
          }))
          .filter(d => d.time > fromTime);
      }
      
      if (data.length > 0) {
        // 存储到 IndexedDB
        await storeKlines(sym, tf, data);
        
        // 更新状态
        setKlines(prev => {
          const merged = mergeKlines(prev, data);
          // 限制内存中的数据量，避免性能问题
          const maxBars = isInitial ? 5000 : 2000;
          return merged.slice(-maxBars);
        });
        
        // 更新元数据
        metaRef.current.latestLoaded = Math.max(
          metaRef.current.latestLoaded,
          data[data.length - 1].time
        );
        metaRef.current.earliestLoaded = Math.min(
          metaRef.current.earliestLoaded,
          data[0].time
        );
        
        // 更新统计
        const newStats = await getStorageStats(sym, tf);
        if (newStats) {
          setStats({
            totalBars: newStats.totalBars,
            storageSizeMB: newStats.storageSizeMB,
            dateRange: newStats.dateRange,
          });
        }
        
        console.log(`[useKlineStorage] Loaded ${data.length} bars, total in memory: ${data.length}`);
      }
      
      setHasMore(
        metaRef.current.earliestLoaded > now - config.retentionDays * 86400
      );
    } catch (err) {
      console.error('[useKlineStorage] API load failed:', err);
      throw err;
    }
  }, []);
  
  // 后台检查更新
  const checkAndUpdate = useCallback(async (
    sym: AssetSymbol,
    tf: Timeframe,
    lastTime: number,
  ) => {
    const now = Math.floor(Date.now() / 1000);
    // 如果最后数据是1小时前的，尝试更新
    if (now - lastTime > 3600) {
      try {
        await loadFromAPI(sym, tf, false);
      } catch (err) {
        console.warn('[useKlineStorage] Background update failed:', err);
      }
    }
  }, [loadFromAPI]);
  
  // 加载更多历史数据
  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    
    setIsLoadingMore(true);
    try {
      const config = TIMEFRAME_CONFIG[timeframe];
      const targetEarliest = metaRef.current.earliestLoaded - 30 * 86400; // 再往前30天
      
      // 从存储查询更早的数据
      const olderData = await queryKlines(symbol, timeframe, {
        endTime: metaRef.current.earliestLoaded - 1,
        limit: 2000,
      });
      
      if (olderData.length > 0) {
        setKlines(prev => {
          const merged = mergeKlines(olderData, prev);
          return merged.slice(-5000); // 限制内存数据量
        });
        metaRef.current.earliestLoaded = olderData[0].time;
      } else {
        // 本地没有更早数据，尝试从API加载
        const moreDays = Math.ceil((metaRef.current.earliestLoaded - targetEarliest) / 86400);
        if (moreDays > 0) {
          const rawData = await fetchKlines(symbol, timeframe, moreDays);
          const data = rawData.map(d => ({
            time: d.time,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
            volume: d.volume,
          }));
          
          if (data.length > 0) {
            await storeKlines(symbol, timeframe, data);
            setKlines(prev => {
              const merged = mergeKlines(data, prev);
              return merged.slice(-5000);
            });
            metaRef.current.earliestLoaded = data[0].time;
          }
        }
      }
      
      const now = Math.floor(Date.now() / 1000);
      setHasMore(metaRef.current.earliestLoaded > now - config.retentionDays * 86400);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more data');
    } finally {
      setIsLoadingMore(false);
    }
  }, [symbol, timeframe, isLoadingMore, hasMore]);
  
  // 刷新数据
  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      await loadFromAPI(symbol, timeframe, false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setIsLoading(false);
    }
  }, [symbol, timeframe, loadFromAPI]);
  
  // 导出数据
  const exportData = useCallback(async (): Promise<string> => {
    const { exportToCSV } = await import('@/services/klineStorage');
    return exportToCSV(symbol, timeframe);
  }, [symbol, timeframe]);
  
  // 清空存储
  const clearStorage = useCallback(async () => {
    const { clearAllKlineCache } = await import('@/hooks/useIndexedDB');
    await clearAllKlineCache();
    setKlines([]);
    setStats(null);
    metaRef.current = { earliestLoaded: Infinity, latestLoaded: 0, isInitialized: false };
  }, []);
  
  return {
    klines,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    storageStats: stats,
    loadMore,
    refresh,
    exportData,
    clearStorage,
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
