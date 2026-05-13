/**
 * 图表触摸手势 Hook
 * 为 lightweight-charts 添加移动端 Pinch-to-Zoom 和 Pan-to-Scroll 支持
 */

import { useEffect, useRef } from "react";
import type { IChartApi } from "lightweight-charts";

interface UseTouchGesturesOptions {
  chart: IChartApi | null;
  container: HTMLDivElement | null;
  enabled?: boolean;
}

export function useTouchGestures({ chart, container, enabled = true }: UseTouchGesturesOptions) {
  const gestureRef = useRef<{
    startDistance: number;
    startBarSpacing: number;
    startX: number;
    startScrollPos: number;
    isPinching: boolean;
    isPanning: boolean;
  } | null>(null);

  useEffect(() => {
    if (!enabled || !chart || !container) return;

    const getDistance = (t1: Touch, t2: Touch) => {
      const dx = t1.clientX - t2.clientX;
      const dy = t1.clientY - t2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        // Pinch start
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const distance = getDistance(t1, t2);
        const timeScale = chart.timeScale();
        const options = timeScale.options();
        gestureRef.current = {
          startDistance: distance,
          startBarSpacing: options.barSpacing ?? 6,
          startX: 0,
          startScrollPos: 0,
          isPinching: true,
          isPanning: false,
        };
      } else if (e.touches.length === 1) {
        // Pan start
        const timeScale = chart.timeScale();
        const logicalRange = timeScale.getVisibleLogicalRange();
        gestureRef.current = {
          startDistance: 0,
          startBarSpacing: 0,
          startX: e.touches[0].clientX,
          startScrollPos: logicalRange ? (logicalRange.from + logicalRange.to) / 2 : 0,
          isPinching: false,
          isPanning: true,
        };
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!gestureRef.current) return;
      e.preventDefault(); // 阻止页面滚动

      if (gestureRef.current.isPinching && e.touches.length === 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const distance = getDistance(t1, t2);
        const scale = distance / gestureRef.current.startDistance;
        const newBarSpacing = Math.max(1, Math.min(100, gestureRef.current.startBarSpacing * scale));
        chart.timeScale().applyOptions({ barSpacing: newBarSpacing });
      } else if (gestureRef.current.isPanning && e.touches.length === 1) {
        const deltaX = e.touches[0].clientX - gestureRef.current.startX;
        const timeScale = chart.timeScale();
        // 将像素位移转换为逻辑位移（近似）
        const barSpacing = timeScale.options().barSpacing ?? 6;
        const scrollDelta = -deltaX / barSpacing;
        const logicalRange = timeScale.getVisibleLogicalRange();
        if (logicalRange) {
          const currentCenter = (logicalRange.from + logicalRange.to) / 2;
          const newCenter = currentCenter + scrollDelta;
          const halfWidth = (logicalRange.to - logicalRange.from) / 2;
          timeScale.setVisibleLogicalRange({ from: newCenter - halfWidth, to: newCenter + halfWidth });
        }
      }
    };

    const handleTouchEnd = () => {
      gestureRef.current = null;
    };

    container.addEventListener("touchstart", handleTouchStart, { passive: false });
    container.addEventListener("touchmove", handleTouchMove, { passive: false });
    container.addEventListener("touchend", handleTouchEnd);
    container.addEventListener("touchcancel", handleTouchEnd);

    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [chart, container, enabled]);
}
