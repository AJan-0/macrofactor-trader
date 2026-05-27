// 性能监控 Hook - P1 性能优化
// 监控首屏加载时间、组件渲染性能

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';

interface PerformanceMetrics {
  // 首屏时间
  fcp: number | null;  // First Contentful Paint
  lcp: number | null;  // Largest Contentful Paint
  fid: number | null;  // First Input Delay
  cls: number | null;  // Cumulative Layout Shift
  // 自定义指标
  tti: number | null;  // Time to Interactive
  renderCount: number;
  renderTime: number;
}

interface LargestContentfulPaintEntry extends PerformanceEntry {
  startTime: number;
}

interface LayoutShiftEntry extends PerformanceEntry {
  hadRecentInput: boolean;
  value: number;
}

interface FirstInputEntry extends PerformanceEntry {
  processingStart: number;
}

export function usePerformanceMonitor(componentName: string) {
  const renderCount = useRef(0);
  const renderStartTime = useRef(0);
  const metricsRef = useRef<PerformanceMetrics>({
    fcp: null,
    lcp: null,
    fid: null,
    cls: null,
    tti: null,
    renderCount: 0,
    renderTime: 0,
  });

  // 记录渲染开始
  useEffect(() => {
    renderStartTime.current = performance.now();
  });

  // 记录渲染结束
  useEffect(() => {
    const renderTime = performance.now() - renderStartTime.current;
    renderCount.current += 1;
    metricsRef.current.renderCount = renderCount.current;
    metricsRef.current.renderTime = renderTime;

    if (renderTime > 16) {
      console.warn(`[Performance] ${componentName} 渲染耗时 ${renderTime.toFixed(2)}ms（超过 16ms 帧预算）`);
    }
  });

  // 监控 Web Vitals
  useEffect(() => {
    // FCP
    const fcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const fcp = entries[entries.length - 1];
      if (fcp) {
        metricsRef.current.fcp = fcp.startTime;
        console.log(`[Performance] FCP: ${fcp.startTime.toFixed(0)}ms`);
      }
    });
    fcpObserver.observe({ entryTypes: ['paint'] });

    // LCP
    const lcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const lcp = entries[entries.length - 1] as LargestContentfulPaintEntry | undefined;
      if (lcp) {
        metricsRef.current.lcp = lcp.startTime;
        console.log(`[Performance] LCP: ${lcp.startTime.toFixed(0)}ms`);
      }
    });
    lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] });

    // CLS
    const clsObserver = new PerformanceObserver((list) => {
      let clsValue = 0;
      for (const entry of list.getEntries()) {
        const layoutShift = entry as LayoutShiftEntry;
        if (!layoutShift.hadRecentInput) {
          clsValue += layoutShift.value;
        }
      }
      metricsRef.current.cls = clsValue;
    });
    clsObserver.observe({ entryTypes: ['layout-shift'] });

    // FID
    const fidObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const fid = entries[entries.length - 1] as FirstInputEntry | undefined;
      if (fid) {
        metricsRef.current.fid = fid.processingStart - fid.startTime;
        console.log(`[Performance] FID: ${metricsRef.current.fid.toFixed(0)}ms`);
      }
    });
    fidObserver.observe({ entryTypes: ['first-input'] });

    return () => {
      fcpObserver.disconnect();
      lcpObserver.disconnect();
      clsObserver.disconnect();
      fidObserver.disconnect();
    };
  }, []);

  const getMetrics = useCallback(() => metricsRef.current, []);

  return { metrics: metricsRef, getMetrics };
}

// 防抖函数（用于高频事件）
export function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  delay: number
): (...args: TArgs) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: TArgs) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// 节流函数
export function throttle<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  limit: number
): (...args: TArgs) => void {
  let inThrottle = false;
  return (...args: TArgs) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

// 虚拟滚动计算
export function useVirtualScroll(
  itemCount: number,
  itemHeight: number,
  containerHeight: number,
  overscan = 5
) {
  const [scrollTop, setScrollTop] = useState(0);

  const virtualItems = useMemo(() => {
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const endIndex = Math.min(
      itemCount - 1,
      Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
    );

    const items = [];
    for (let i = startIndex; i <= endIndex; i++) {
      items.push({
        index: i,
        style: {
          position: 'absolute' as const,
          top: i * itemHeight,
          height: itemHeight,
          left: 0,
          right: 0,
        },
      });
    }
    return { items, startIndex, endIndex, totalHeight: itemCount * itemHeight };
  }, [scrollTop, itemCount, itemHeight, containerHeight, overscan]);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  return { virtualItems, onScroll };
}

