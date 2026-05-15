/**
 * 图表触摸手势 Hook - TradingView 风格
 * 为 lightweight-charts 添加移动端完整手势支持
 * 
 * 特性：
 * - 双指捏合缩放 (Pinch-to-Zoom)
 * - 单指平移滚动 (Pan-to-Scroll)
 * - 长按显示十字光标 (Long-press crosshair)
 * - 惯性滚动 (Inertial scrolling)
 * - 边缘回弹 (Edge bounce)
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
    startScrollPos: number;
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
      startScrollPos: 0,
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
    };
    gestureRef.current = state;

    // 长按检测时间 (ms)
    const LONG_PRESS_DURATION = 500;
    // 双击间隔 (ms)
    const DOUBLE_TAP_INTERVAL = 300;
    // 惯性滚动衰减系数
    const FRICTION = 0.95;
    // 最小速度阈值
    const MIN_VELOCITY = 0.5;

    const handleTouchStart = (e: TouchEvent) => {
      // 取消之前的惯性滚动
      if (state.rafId !== null) {
        cancelAnimationFrame(state.rafId);
        state.rafId = null;
      }

      if (e.touches.length === 2) {
        // Pinch start
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
        
        // 取消长按检测
        if (state.longPressTimer) {
          clearTimeout(state.longPressTimer);
          state.longPressTimer = null;
        }
      } else if (e.touches.length === 1) {
        const touch = e.touches[0];
        const timeScale = chart.timeScale();
        const logicalRange = timeScale.getVisibleLogicalRange();
        
        state.isPinching = false;
        state.isPanning = true;
        state.isLongPress = false;
        state.startX = touch.clientX;
        state.startY = touch.clientY;
        state.startScrollPos = logicalRange ? (logicalRange.from + logicalRange.to) / 2 : 0;
        state.velocityX = 0;
        state.lastMoveTime = Date.now();

        // 检测双击
        const now = Date.now();
        const timeSinceLastTouch = now - state.lastTouchTime;
        const distanceFromLastTouch = Math.sqrt(
          Math.pow(touch.clientX - state.lastTouchX, 2) +
          Math.pow(touch.clientY - state.lastTouchY, 2)
        );
        
        if (timeSinceLastTouch < DOUBLE_TAP_INTERVAL && distanceFromLastTouch < 30) {
          // 双击 - 重置缩放
          e.preventDefault();
          chart.timeScale().fitContent();
          onDoubleTap?.();
          state.lastTouchTime = 0; // 重置，防止三连击
          return;
        }
        
        state.lastTouchTime = now;
        state.lastTouchX = touch.clientX;
        state.lastTouchY = touch.clientY;

        // 长按检测
        state.longPressTimer = setTimeout(() => {
          state.isLongPress = true;
          state.isPanning = false;
          
          // 获取当前触摸位置对应的时间和价格
          const rect = container.getBoundingClientRect();
          const x = touch.clientX - rect.left;
          const y = touch.clientY - rect.top;
          
          // 模拟十字光标
          chart.applyOptions({
            crosshair: {
              vertLine: { visible: true, labelVisible: true },
              horzLine: { visible: true, labelVisible: true },
            }
          });
          
          // 触发十字光标移动事件
          const coordinateToTime = chart.timeScale().coordinateToTime(x);
          if (coordinateToTime !== null) {
            // 尝试获取价格 (通过模拟 crosshairMove)
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

      // 如果移动距离超过阈值，取消长按
      if (e.touches.length === 1 && state.longPressTimer) {
        const touch = e.touches[0];
        const moveDistance = Math.sqrt(
          Math.pow(touch.clientX - state.startX, 2) +
          Math.pow(touch.clientY - state.startY, 2)
        );
        if (moveDistance > 10) {
          clearTimeout(state.longPressTimer);
          state.longPressTimer = null;
        }
      }

      e.preventDefault(); // 阻止页面滚动

      if (state.isPinching && e.touches.length === 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const distance = getDistance(t1, t2);
        const scale = distance / state.startDistance;
        
        // 使用对数缩放，体验更平滑
        const logScale = Math.log(scale + 1) / Math.log(2);
        const newBarSpacing = Math.max(1, Math.min(100, state.startBarSpacing * (1 + logScale)));
        
        chart.timeScale().applyOptions({ barSpacing: newBarSpacing });
      } else if (state.isPanning && e.touches.length === 1) {
        const touch = e.touches[0];
        const deltaX = touch.clientX - state.startX;
        const timeScale = chart.timeScale();
        const barSpacing = timeScale.options().barSpacing ?? 6;
        
        // 计算速度用于惯性滚动
        const now = Date.now();
        const dt = now - state.lastMoveTime;
        if (dt > 0) {
          state.velocityX = (touch.clientX - state.lastTouchX) / dt * 16; // 归一化到 60fps
        }
        state.lastMoveTime = now;
        state.lastTouchX = touch.clientX;
        
        const scrollDelta = -deltaX / barSpacing;
        const logicalRange = timeScale.getVisibleLogicalRange();
        if (logicalRange) {
          const currentCenter = (logicalRange.from + logicalRange.to) / 2;
          const newCenter = currentCenter + scrollDelta;
          const halfWidth = (logicalRange.to - logicalRange.from) / 2;
          timeScale.setVisibleLogicalRange({ 
            from: newCenter - halfWidth, 
            to: newCenter + halfWidth 
          });
        }
      }
    };

    const handleTouchEnd = () => {
      // 取消长按检测
      if (state.longPressTimer) {
        clearTimeout(state.longPressTimer);
        state.longPressTimer = null;
      }

      // 恢复十字光标默认设置
      if (state.isLongPress) {
        chart.applyOptions({
          crosshair: {
            vertLine: { visible: true, labelVisible: false },
            horzLine: { visible: true, labelVisible: false },
          }
        });
      }

      // 惯性滚动
      if (state.isPanning && Math.abs(state.velocityX) > MIN_VELOCITY) {
        const timeScale = chart.timeScale();
        const barSpacing = timeScale.options().barSpacing ?? 6;
        
        const animate = () => {
          state.velocityX *= FRICTION;
          
          if (Math.abs(state.velocityX) < MIN_VELOCITY) {
            state.rafId = null;
            return;
          }
          
          const logicalRange = timeScale.getVisibleLogicalRange();
          if (logicalRange) {
            const scrollDelta = -state.velocityX / barSpacing;
            const currentCenter = (logicalRange.from + logicalRange.to) / 2;
            const newCenter = currentCenter + scrollDelta;
            const halfWidth = (logicalRange.to - logicalRange.from) / 2;
            timeScale.setVisibleLogicalRange({ 
              from: newCenter - halfWidth, 
              to: newCenter + halfWidth 
            });
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
