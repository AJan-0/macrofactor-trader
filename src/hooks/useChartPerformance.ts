/**
 * 图表性能优化 Hook
 * 针对移动端的 K 线数据降采样和渲染优化
 */

import { useMemo, useCallback } from "react";
import type { KlineData } from "@/components/chart/ChartCanvas";

interface UseChartPerformanceOptions {
  klines: KlineData[];
  maxPoints?: number;
  enabled?: boolean;
}

/**
 * 简单的数据桶降采样
 * 对于 OHLC 数据，合并桶内的极值
 */
function bucketDownsample(data: KlineData[], targetCount: number): KlineData[] {
  if (data.length <= targetCount) return data;

  const bucketSize = Math.ceil(data.length / targetCount);
  const result: KlineData[] = [];

  for (let i = 0; i < data.length; i += bucketSize) {
    const bucket = data.slice(i, i + bucketSize);
    if (bucket.length === 0) continue;

    result.push({
      time: bucket[0].time,
      open: bucket[0].open,
      high: Math.max(...bucket.map(d => d.high)),
      low: Math.min(...bucket.map(d => d.low)),
      close: bucket[bucket.length - 1].close,
      volume: bucket.reduce((sum, d) => sum + d.volume, 0),
    });
  }

  return result;
}

export function useChartPerformance({
  klines,
  maxPoints = 500,
  enabled = true,
}: UseChartPerformanceOptions) {
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const shouldOptimize = enabled && isMobile && klines.length > maxPoints;

  const optimizedKlines = useMemo(() => {
    if (!shouldOptimize) return klines;
    
    // 对于 K 线数据，使用桶降采样以保持极值
    return bucketDownsample(klines, maxPoints);
  }, [klines, shouldOptimize, maxPoints]);

  const getOriginalIndex = useCallback((optimizedIndex: number) => {
    if (!shouldOptimize) return optimizedIndex;
    
    const bucketSize = Math.ceil(klines.length / maxPoints);
    return optimizedIndex * bucketSize;
  }, [shouldOptimize, klines.length, maxPoints]);

  return {
    klines: optimizedKlines,
    isOptimized: shouldOptimize,
    originalLength: klines.length,
    optimizedLength: optimizedKlines.length,
    getOriginalIndex,
  };
}
