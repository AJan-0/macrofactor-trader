/**
 * useKlineData Hook — 解耦 K线数据管道 (v0.4.0)
 *
 * 职责：
 *   1. 按 symbol/timeframe 调用 REST fetchKlines 获取初始数据
 *   2. 维护 klinesRef（WebSocket 增量更新直接写入此 ref）
 *   3. 返回 dataVersion 供下游 useEffect 监听数据变化
 *   4. 返回 loading/error 状态
 *
 * 不负责：
 *   - WebSocket 连接与订阅（由 useKlineStream 管理）
 *   - 图表渲染 / 策略计算（由 ChartWidget 管理）
 *
 * 数据流:
 *   symbol/timeframe 变化 → fetchKlines → klinesRef.current = data → dataVersion++
 *   WebSocket candle arrive → (ChartWidget 直接修改 klinesRef.current)
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { fetchKlines, type KlineData } from '@/services/cryptoCompare';
import type { AssetSymbol, Timeframe } from '@/store/appStore';
import { getCachedKlines, setCachedKlines } from '@/hooks/useIndexedDB';

export interface UseKlineDataResult {
  /** K 线数据引用 — 不受 React 状态管理（避免高频 re-render） */
  klinesRef: React.MutableRefObject<KlineData[]>;
  /** 数据版本号 — REST 请求或 WebSocket 增量更新时自增 */
  dataVersion: number;
  /** 初始数据是否正在加载 */
  isLoading: boolean;
  /** 加载错误信息 */
  error: string | null;
  /** 手动触发版本号自增（WebSocket 增量更新时调用） */
  bumpVersion: () => void;
}

/**
 * 管理指定 symbol/timeframe 的 K 线数据获取。
 *
 * 每次 symbol 或 timeframe 变化时：
 *   1. 取消上一次请求（AbortController）
 *   2. 发起新的 REST API 请求
 *   3. 写入 klinesRef.current
 *   4. dataVersion += 1（触发下游重渲染逻辑）
 *
 * @example
 *   const { klinesRef, dataVersion, isLoading } = useKlineData(symbol, timeframe);
 *   // 在其他 useEffect 中监听 dataVersion 即可获知 K 线已更新
 */
export function useKlineData(
  symbol: AssetSymbol,
  timeframe: Timeframe,
): UseKlineDataResult {
  const klinesRef = useRef<KlineData[]>([]);
  const [dataVersion, setDataVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const abortCtrl = new AbortController();

    // 立即清空旧数据 + 重置版本号（防止下游渲染旧数据）
    klinesRef.current = [];
    queueMicrotask(() => {
      if (cancelled) return;
      setDataVersion(0);
      setIsLoading(true);
      setError(null);
    });

    // Step 1: 尝试 IndexedDB 缓存 → 先展示旧数据（乐观 UI）
    getCachedKlines(symbol, timeframe, 600_000)
      .then((cached) => {
        if (cancelled || !cached || cached.length === 0) return;
        // Guard: don't overwrite if API data already arrived
        if (klinesRef.current.length > 0) return;
        klinesRef.current = cached;
        setDataVersion((v) => v + 1);
        setIsLoading(false);
        console.log(
          `[useKlineData] 📦 ${cached.length} bars from IndexedDB cache (${symbol} ${timeframe})`,
        );
      })
      .catch(() => {});

    // Step 2: API 请求最新数据（30s timeout to prevent hanging）
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
        if (cancelled) return;
        klinesRef.current = data;
        const elapsed = (performance.now() - start).toFixed(0);
        console.log(
          `[useKlineData] ✅ ${data.length} bars (${symbol} ${timeframe}) in ${elapsed}ms`,
        );
        setDataVersion((v) => v + 1);
        setIsLoading(false);
        // 异步写入 IndexedDB（不阻塞 UI）
        setCachedKlines(symbol, timeframe, data).catch(() => {});
      })
      .catch((err) => {
        clearTimeout(fetchTimer);
        if (cancelled) return;
        if (err instanceof DOMException && err.name === 'AbortError') {
          if (fetchTimedOut) {
            // 超时发生时 klinesRef 可能依然为空
            setError('K线数据加载超时，请检查网络连接');
            setIsLoading(false);
          }
          return;
        }
        const msg = err instanceof Error ? err.message : 'Failed to load K-lines';
        console.error('[useKlineData] ❌', msg);
        // 如果已有缓存数据则不报错（离线场景）
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
