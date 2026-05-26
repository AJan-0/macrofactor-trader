/**
 * useKlineData Hook — 增强版K线数据管道 (v1.0.0)
 * 
 * 升级内容：
 *   - 集成 klineStorage 长期存储
 *   - 支持5年历史数据
 *   - 自动增量更新
 *   - 智能降采样
 *   - 多时间周期统一管理
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
  error: string | null;
  bumpVersion: () => void;
  storageStats: {
    totalBars: number;
    storageSizeMB: number;
    dateRange: { start: Date; end: Date };
  } | null;
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

export function useKlineData(
  symbol: AssetSymbol,
  timeframe: Timeframe,
): UseKlineDataResult {
  const klinesRef = useRef<KlineData[]>([]);
  const [dataVersion, setDataVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<UseKlineDataResult['storageStats']>(null);
  
  // 防御：追踪当前请求标识，防止竞态
  const requestIdRef = useRef(0);
  const metaRef = useRef({
    latestStoredTime: 0,
    isInitialized: false,
  });

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

    // 重置状态
    klinesRef.current = [];
    setDataVersion(0);
    setIsLoading(true);
    setError(null);
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
          klinesRef.current = storedData;
          metaRef.current.latestStoredTime = storedData[storedData.length - 1].time;
          metaRef.current.isInitialized = true;
          setDataVersion(v => v + 1);
          setIsLoading(false);
          
          console.log(`[useKlineData] 📦 ${storedData.length} bars from storage (${symbol} ${timeframe})`);
          
          // 后台检查是否需要增量更新
          checkIncrementalUpdate(symbol, timeframe, storedData[storedData.length - 1].time);
        } else {
          // Step 2: 存储无数据，从API加载完整历史
          console.log(`[useKlineData] Fetching full history ${symbol} ${timeframe}`);
          await loadFullHistory(symbol, timeframe, abortCtrl.signal);
        }
      } catch (err) {
        if (cancelled || currentRequestId !== requestIdRef.current) return;
        
        const msg = err instanceof Error ? err.message : 'Failed to load K-lines';
        console.error(`[useKlineData] ❌ ${symbol} ${timeframe}:`, msg);
        setError(msg);
        setIsLoading(false);
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

  return { 
    klinesRef, 
    dataVersion, 
    isLoading, 
    error, 
    bumpVersion,
    storageStats: stats,
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
