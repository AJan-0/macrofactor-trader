/**
 * useKlineData Hook — 解耦 K线数据管道 (v0.4.1 修复版)
 *
 * 修复：
 *   1. 移除 queueMicrotask（useEffect 本身就是渲染后执行，不需要额外微任务）
 *   2. 添加 mounted ref 防止竞态
 *   3. 增加 symbol/timeframe 稳定性检查日志
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { fetchKlines, type KlineData } from '@/services/cryptoCompare';
import type { AssetSymbol, Timeframe } from '@/store/appStore';
import { getCachedKlines, setCachedKlines } from '@/hooks/useIndexedDB';

export interface UseKlineDataResult {
  klinesRef: React.MutableRefObject<KlineData[]>;
  dataVersion: number;
  isLoading: boolean;
  error: string | null;
  bumpVersion: () => void;
}

export function useKlineData(
  symbol: AssetSymbol,
  timeframe: Timeframe,
): UseKlineDataResult {
  const klinesRef = useRef<KlineData[]>([]);
  const [dataVersion, setDataVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // 防御：追踪当前请求标识，防止竞态
  const requestIdRef = useRef(0);

  useEffect(() => {
    // 防御性检查：symbol/timeframe 必须是基本类型（字符串/数字）
    // 如果是对象/数组，每次渲染都是新引用，会导致无限循环！
    if (typeof symbol !== 'string' || typeof timeframe !== 'string') {
      console.error(
        `[useKlineData] ⚠️ symbol/timeframe 必须是基本类型！当前 symbol=${typeof symbol}, timeframe=${typeof timeframe}。` +
        `如果是对象/数组，请在父组件用 useMemo 稳定引用，否则会导致 React 死循环。`
      );
    }

    const currentRequestId = ++requestIdRef.current;
    let cancelled = false;
    const abortCtrl = new AbortController();

    // 直接重置状态（useEffect 本来就是渲染后执行，不需要 queueMicrotask）
    klinesRef.current = [];
    setDataVersion(0);
    setIsLoading(true);
    setError(null);

    // Step 1: IndexedDB 缓存
    getCachedKlines(symbol, timeframe, 600_000)
      .then((cached) => {
        if (cancelled || currentRequestId !== requestIdRef.current) return;
        if (!cached || cached.length === 0) return;
        if (klinesRef.current.length > 0) return;
        klinesRef.current = cached;
        setDataVersion((v) => v + 1);
        setIsLoading(false);
        console.log(`[useKlineData] 📦 ${cached.length} bars from cache (${symbol} ${timeframe})`);
      })
      .catch(() => {});

    // Step 2: API 请求
    console.log(`[useKlineData] Fetching ${symbol} ${timeframe}`);
    const start = performance.now();
    let fetchTimedOut = false;
    const fetchTimer = setTimeout(() => {
      fetchTimedOut = true;
      abortCtrl.abort();
    }, 30_000);

    fetchKlines(symbol, timeframe, undefined, abortCtrl.signal)
      .then((data) => {
        clearTimeout(fetchTimer);
        if (cancelled || currentRequestId !== requestIdRef.current) return;
        klinesRef.current = data;
        const elapsed = (performance.now() - start).toFixed(0);
        console.log(`[useKlineData] ✅ ${data.length} bars (${symbol} ${timeframe}) in ${elapsed}ms`);
        setDataVersion((v) => v + 1);
        setIsLoading(false);
        setCachedKlines(symbol, timeframe, data).catch(() => {});
      })
      .catch((err) => {
        clearTimeout(fetchTimer);
        if (cancelled || currentRequestId !== requestIdRef.current) return;
        if (err instanceof DOMException && err.name === 'AbortError') {
          if (fetchTimedOut) {
            setError('K线数据加载超时，请检查网络连接');
            setIsLoading(false);
          }
          return;
        }
        const msg = err instanceof Error ? err.message : 'Failed to load K-lines';
        console.error('[useKlineData] ❌', msg);
        if (klinesRef.current.length === 0) setError(msg);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
      abortCtrl.abort();
    };
  }, [symbol, timeframe]);

  const bumpVersion = useCallback(() => setDataVersion(v => v + 1), []);

  return { klinesRef, dataVersion, isLoading, error, bumpVersion };
}
