/**
 * 图表触摸手势 Hook - TradingView 风格
 * 为 lightweight-charts 添加移动端完整手势支持
 * 
 * 修复：
 * - 手势初始化时机问题
 * - 平移计算错误（使用 scrollToPosition 替代 setVisibleLogicalRange）
 * - 添加错误边界防止崩溃
 * - 优化缩放体验
 */

import { useEffect, useRef, useCallback } from "react";
import type { IChartApi } from "lightweight-charts";

interface UseTouchGesturesOptions {
  chart: IChartApi | null;
  container: HTMLDivElement | null;
  enabled?: boolean;
  onLongPress?: (time: number, price: number) => void;
  onDoubleTap?: () => void;
}

export function useTouchGestures({ 
  chart, 
  container, 
  enabled = true,
  onLongPress,
  onDoubleTap 
}: UseTouchGesturesOptions) {
  const gestureRef = useRef<{
    startDistance: number;
    startBarSpacing: number;
    startX: number;
    startY: number;
    startScrollPosition: number;
    isPinching: boolean;
    isPanning: boolean;
    isLongPress: boolean;
    longPressTimer: ReturnType<typeof setTimeout> | null;
    lastTouchTime: number;
    lastTouchX: number;
    lastTouchY: number;
    velocityX: number;
    lastMoveTime: number;
    rafId: number | null;
    lastLogicalRange: { from: number; to: number } | null;
  } | null>(null);

  const getDistance = useCallback((t1: Touch, t2: Touch) => {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }, []);

  useEffect(() => {
    if (!enabled || !chart || !container) return;

    const state = {
      startDistance: 0,
      startBarSpacing: 6,
      startX: 0,
      startY: 0,
      startScrollPosition: 0,
      isPinching: false,
      isPanning: false,
      isLongPress: false,
      longPressTimer: null as ReturnType<typeof setTimeout> | null,
      lastTouchTime: 0,
      lastTouchX: 0,
      lastTouchY: 0,
      velocityX: 0,
      lastMoveTime: 0,
      rafId: null as number | null,
      lastLogicalRange: null as { from: number; to: number } | null,
    };
    gestureRef.current = state;

    const LONG_PRESS_DURATION = 600;
    const DOUBLE_TAP_INTERVAL = 300;
    const FRICTION = 0.92;
    const MIN_VELOCITY = 0.3;
    const PINCH_SENSITIVITY = 0.5;

    const handleTouchStart = (e: TouchEvent) => {
      if (state.rafId !== null) {
        cancelAnimationFrame(state.rafId);
        state.rafId = null;
      }

      if (e.touches.length === 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const distance = getDistance(t1, t2);
        const timeScale = chart.timeScale();
        const options = timeScale.options();
        
        state.isPinching = true;
        state.isPanning = false;
        state.isLongPress = false;
        state.startDistance = distance;
        state.startBarSpacing = options.barSpacing ?? 6;
        
        if (state.longPressTimer) {
          clearTimeout(state.longPressTimer);
          state.longPressTimer = null;
        }
      } else if (e.touches.length === 1) {
        const touch = e.touches[0];
        const timeScale = chart.timeScale();
        
        state.isPinching = false;
        state.isPanning = true;
        state.isLongPress = false;
        state.startX = touch.clientX;
        state.startY = touch.clientY;
        state.startScrollPosition = timeScale.scrollPosition() ?? 0;
        state.velocityX = 0;
        state.lastMoveTime = Date.now();

        const now = Date.now();
        const timeSinceLastTouch = now - state.lastTouchTime;
        const distanceFromLastTouch = Math.sqrt(
          Math.pow(touch.clientX - state.lastTouchX, 2) +
          Math.pow(touch.clientY - state.lastTouchY, 2)
        );
        
        if (timeSinceLastTouch < DOUBLE_TAP_INTERVAL && distanceFromLastTouch < 40) {
          e.preventDefault();
          chart.timeScale().fitContent();
          onDoubleTap?.();
          state.lastTouchTime = 0;
          return;
        }
        
        state.lastTouchTime = now;
        state.lastTouchX = touch.clientX;
        state.lastTouchY = touch.clientY;

        state.longPressTimer = setTimeout(() => {
          state.isLongPress = true;
          state.isPanning = false;
          
          const rect = container.getBoundingClientRect();
          const x = touch.clientX - rect.left;
          
          chart.applyOptions({
            crosshair: {
              vertLine: { visible: true, labelVisible: true },
              horzLine: { visible: true, labelVisible: true },
            }
          });
          
          const coordinateToTime = chart.timeScale().coordinateToTime(x);
          if (coordinateToTime !== null) {
            onLongPress?.(coordinateToTime as number, 0);
          }
        }, LONG_PRESS_DURATION);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (state.isLongPress) {
        e.preventDefault();
        return;
      }

      if (!state.isPinching && !state.isPanning) return;

      if (e.touches.length === 1 && state.longPressTimer) {
        const touch = e.touches[0];
        const moveDistance = Math.sqrt(
          Math.pow(touch.clientX - state.startX, 2) +
          Math.pow(touch.clientY - state.startY, 2)
        );
        if (moveDistance > 15) {
          clearTimeout(state.longPressTimer);
          state.longPressTimer = null;
        }
      }

      e.preventDefault();

      if (state.isPinching && e.touches.length === 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const distance = getDistance(t1, t2);
        const scale = distance / state.startDistance;
        
        const newBarSpacing = Math.max(1, Math.min(100, 
          state.startBarSpacing * Math.pow(scale, PINCH_SENSITIVITY)
        ));
        
        chart.timeScale().applyOptions({ barSpacing: newBarSpacing });
      } else if (state.isPanning && e.touches.length === 1) {
        const touch = e.touches[0];
        const deltaX = touch.clientX - state.startX;
        const timeScale = chart.timeScale();
        const barSpacing = timeScale.options().barSpacing ?? 6;
        
        const now = Date.now();
        const dt = now - state.lastMoveTime;
        if (dt > 0) {
          state.velocityX = (touch.clientX - state.lastTouchX) / dt * 16;
        }
        state.lastMoveTime = now;
        state.lastTouchX = touch.clientX;
        
        const scrollDelta = -deltaX / barSpacing;
        const newPosition = state.startScrollPosition + scrollDelta;
        
        try {
          timeScale.scrollToPosition(newPosition, false);
        } catch (err) {
          console.warn("Scroll error:", err);
        }
      }
    };

    const handleTouchEnd = () => {
      if (state.longPressTimer) {
        clearTimeout(state.longPressTimer);
        state.longPressTimer = null;
      }

      if (state.isLongPress) {
        chart.applyOptions({
          crosshair: {
            vertLine: { visible: true, labelVisible: false },
            horzLine: { visible: true, labelVisible: false },
          }
        });
      }

      if (state.isPanning && Math.abs(state.velocityX) > MIN_VELOCITY) {
        const timeScale = chart.timeScale();
        const barSpacing = timeScale.options().barSpacing ?? 6;
        
        const animate = () => {
          state.velocityX *= FRICTION;
          
          if (Math.abs(state.velocityX) < MIN_VELOCITY) {
            state.rafId = null;
            return;
          }
          
          const scrollDelta = -state.velocityX / barSpacing;
          const currentPosition = timeScale.scrollPosition() ?? 0;
          
          try {
            timeScale.scrollToPosition(currentPosition + scrollDelta, false);
          } catch (err) {
            console.warn("Inertial scroll error:", err);
            state.rafId = null;
            return;
          }
          
          state.rafId = requestAnimationFrame(animate);
        };
        
        state.rafId = requestAnimationFrame(animate);
      }

      state.isPinching = false;
      state.isPanning = false;
      state.isLongPress = false;
    };

    const handleTouchCancel = () => {
      if (state.longPressTimer) {
        clearTimeout(state.longPressTimer);
        state.longPressTimer = null;
      }
      if (state.rafId !== null) {
        cancelAnimationFrame(state.rafId);
        state.rafId = null;
      }
      state.isPinching = false;
      state.isPanning = false;
      state.isLongPress = false;
    };

    container.addEventListener("touchstart", handleTouchStart, { passive: false });
    container.addEventListener("touchmove", handleTouchMove, { passive: false });
    container.addEventListener("touchend", handleTouchEnd);
    container.addEventListener("touchcancel", handleTouchCancel);

    return () => {
      if (state.rafId !== null) {
        cancelAnimationFrame(state.rafId);
      }
      if (state.longPressTimer) {
        clearTimeout(state.longPressTimer);
      }
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [chart, container, enabled, getDistance, onLongPress, onDoubleTap]);
}
