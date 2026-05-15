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
 * LTTB (Largest Triangle Three Buckets) 降采样算法
 * 保持视觉形状的同时减少数据点数量
 */
function lttbDownsample(data: KlineData[], threshold: number): KlineData[] {
  if (data.length <= threshold || threshold === 0) return data;

  const sampled: KlineData[] = [];
  let sampledIndex = 0;

  // 始终保留第一个点
  sampled[sampledIndex++] = data[0];

  const a = 0; // 第一个点的索引
  let maxAreaPoint: KlineData = data[0];
  let maxArea = -1;
  let area: number;

  const every = (data.length - 2) / (threshold - 2);

  for (let i = 0; i < threshold - 2; i++) {
    const avgRangeStart = Math.floor((i + 1) * every) + 1;
    const avgRangeEnd = Math.floor((i + 2) * every) + 1;
    const avgRange = data.slice(avgRangeStart, avgRangeEnd);

    const avgPoint: KlineData = {
      time: avgRange.reduce((sum, p) => sum + p.time, 0) / avgRange.length,
      open: avgRange.reduce((sum, p) => sum + p.open, 0) / avgRange.length,
      high: avgRange.reduce((sum, p) => sum + p.high, 0) / avgRange.length,
      low: avgRange.reduce((sum, p) => sum + p.low, 0) / avgRange.length,
      close: avgRange.reduce((sum, p) => sum + p.close, 0) / avgRange.length,
      volume: avgRange.reduce((sum, p) => sum + p.volume, 0) / avgRange.length,
    };

    const rangeOffs = Math.floor((i) * every) + 1;
    const rangeTo = Math.floor((i + 1) * every) + 1;

    const pointA = data[a];
    const pointAx = pointA.time;
    const pointAy = (pointA.high + pointA.low) / 2;

    const avgX = avgPoint.time;
    const avgY = (avgPoint.high + avgPoint.low) / 2;

    maxArea = -1;

    for (let j = rangeOffs; j < rangeTo && j < data.length; j++) {
      const pointB = data[j];
      const pointBx = pointB.time;
      const pointBy = (pointB.high + pointB.low) / 2;

      area = Math.abs(
        (pointAx - avgX) * (pointBy - pointAy) -
        (pointAx - pointBx) * (avgY - pointAy)
      );

      if (area > maxArea) {
        maxArea = area;
        maxAreaPoint = pointB;
      }
    }

    sampled[sampledIndex++] = maxAreaPoint;
  }

  // 始终保留最后一个点
  sampled[sampledIndex] = data[data.length - 1];

  return sampled;
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
