/**
 * useKlinesQuery — @tanstack/react-query 封装
 *
 * 基于 React Query 的 K 线数据获取 Hook，提供：
 * - 自动缓存与去重
 * - 后台刷新 (stale-while-revalidate)
 * - 错误重试（指数退避）
 * - 与 useKlineData 的兼容层
 *
 * 未来可逐步替换 useKlineData 为 useKlinesQuery。
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchKlines } from "@/services/cryptoCompare";
import type { AssetSymbol, Timeframe } from "@/store/appStore";

const QUERY_KEY_PREFIX = "klines" as const;

export function getKlinesQueryKey(symbol: AssetSymbol, timeframe: Timeframe) {
  return [QUERY_KEY_PREFIX, symbol, timeframe] as const;
}

export function useKlinesQuery(symbol: AssetSymbol, timeframe: Timeframe) {
  return useQuery({
    queryKey: getKlinesQueryKey(symbol, timeframe),
    queryFn: ({ signal }) => fetchKlines(symbol, timeframe, undefined, signal),
    staleTime: 30_000,      // 30s 内视为新鲜
    gcTime: 5 * 60_000,     // 5min 缓存
    refetchOnWindowFocus: false,
    retry: (failureCount, error) => {
      if (error instanceof DOMException && error.name === "AbortError") return false;
      return failureCount < 3;
    },
  });
}

export function usePrefetchKlines() {
  const queryClient = useQueryClient();
  return (symbol: AssetSymbol, timeframe: Timeframe) => {
    queryClient.prefetchQuery({
      queryKey: getKlinesQueryKey(symbol, timeframe),
      queryFn: ({ signal }) => fetchKlines(symbol, timeframe, undefined, signal),
      staleTime: 30_000,
    });
  };
}
