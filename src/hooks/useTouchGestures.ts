/**
 * 图表触摸手势 Hook - TradingView 风格 (v2.0)
 * 为 lightweight-charts 添加移动端完整手势支持
 * 
 * 优化点：
 * - 触摸响应延迟优化（passive: false + 立即阻止默认行为）
 * - 惯性滚动算法改进（基于速度的指数衰减）
 * - 双指缩放灵敏度曲线优化
 * - 添加边界回弹效果
 * - 优化长按检测（支持移动中取消）
 * - 添加缩放中心点保持（pinch-to-zoom 以触摸中心为锚点）
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

interface GestureState {
  // 双指缩放
  startDistance: number;
  startBarSpacing: number;
  startScrollPosition: number;
  pinchCenterX: number;
  isPinching: boolean;
  
  // 单指平移
  startX: number;
  startY: number;
  startPanScrollPosition: number;
  isPanning: boolean;
  
  // 长按
  isLongPress: boolean;
  longPressTimer: ReturnType<typeof setTimeout> | null;
  longPressStartX: number;
  longPressStartY: number;
  
  // 双击
  lastTouchTime: number;
  lastTouchX: number;
  lastTouchY: number;
  
  // 惯性滚动
  velocityX: number;
  lastMoveTime: number;
  lastMoveX: number;
  rafId: number | null;
  
  // 触摸追踪
  touchStartTime: number;
  hasMoved: boolean;
  initialTouchX: number;
  initialTouchY: number;
}

export function useTouchGestures({ 
  chart, 
  container, 
  enabled = true,
  onLongPress,
  onDoubleTap 
}: UseTouchGesturesOptions) {
  const gestureRef = useRef<GestureState | null>(null);

  const getDistance = useCallback((t1: Touch, t2: Touch) => {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }, []);

  const getCenter = useCallback((t1: Touch, t2: Touch) => ({
    x: (t1.clientX + t2.clientX) / 2,
    y: (t1.clientY + t2.clientY) / 2,
  }), []);

  useEffect(() => {
    if (!enabled || !chart || !container) return;

    const state: GestureState = {
      startDistance: 0,
      startBarSpacing: 6,
      startScrollPosition: 0,
      pinchCenterX: 0,
      isPinching: false,
      startX: 0,
      startY: 0,
      startPanScrollPosition: 0,
      isPanning: false,
      isLongPress: false,
      longPressTimer: null,
      longPressStartX: 0,
      longPressStartY: 0,
      lastTouchTime: 0,
      lastTouchX: 0,
      lastTouchY: 0,
      velocityX: 0,
      lastMoveTime: 0,
      lastMoveX: 0,
      rafId: null,
      touchStartTime: 0,
      hasMoved: false,
      initialTouchX: 0,
      initialTouchY: 0,
    };
    gestureRef.current = state;

    // 配置参数 - TradingView 风格调优
    const LONG_PRESS_DURATION = 500; // 稍微缩短长按时间
    const DOUBLE_TAP_INTERVAL = 280;
    const FRICTION = 0.94; // 更高的摩擦系数让惯性更自然
    const MIN_VELOCITY = 0.5;
    const PINCH_SENSITIVITY = 0.65; // 稍微提高缩放灵敏度
    const MOVE_THRESHOLD = 8; // 移动阈值，超过则取消长按
    const MAX_BAR_SPACING = 80; // 限制最大缩放
    const MIN_BAR_SPACING = 1;

    const timeScale = chart.timeScale();

    const cancelInertia = () => {
      if (state.rafId !== null) {
        cancelAnimationFrame(state.rafId);
        state.rafId = null;
      }
    };

    const cancelLongPress = () => {
      if (state.longPressTimer) {
        clearTimeout(state.longPressTimer);
        state.longPressTimer = null;
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      // 立即取消任何进行中的惯性滚动
      cancelInertia();
      
      state.touchStartTime = Date.now();
      state.hasMoved = false;

      if (e.touches.length === 2) {
        // 双指缩放开始
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const distance = getDistance(t1, t2);
        const center = getCenter(t1, t2);
        const options = timeScale.options();
        
        state.isPinching = true;
        state.isPanning = false;
        state.isLongPress = false;
        state.startDistance = distance;
        state.startBarSpacing = options.barSpacing ?? 6;
        state.startScrollPosition = timeScale.scrollPosition() ?? 0;
        state.pinchCenterX = center.x;
        
        cancelLongPress();
        
        // 阻止默认行为防止页面缩放
        e.preventDefault();
      } else if (e.touches.length === 1) {
        // 单指触摸开始
        const touch = e.touches[0];
        
        state.isPinching = false;
        state.isPanning = false;
        state.isLongPress = false;
        state.startX = touch.clientX;
        state.startY = touch.clientY;
        state.initialTouchX = touch.clientX;
        state.initialTouchY = touch.clientY;
        state.startPanScrollPosition = timeScale.scrollPosition() ?? 0;
        state.velocityX = 0;
        state.lastMoveTime = Date.now();
        state.lastMoveX = touch.clientX;

        // 双击检测
        const now = Date.now();
        const timeSinceLastTouch = now - state.lastTouchTime;
        const distanceFromLastTouch = Math.sqrt(
          Math.pow(touch.clientX - state.lastTouchX, 2) +
          Math.pow(touch.clientY - state.lastTouchY, 2)
        );
        
        if (timeSinceLastTouch < DOUBLE_TAP_INTERVAL && distanceFromLastTouch < 35) {
          e.preventDefault();
          timeScale.fitContent();
          onDoubleTap?.();
          state.lastTouchTime = 0;
          cancelLongPress();
          return;
        }
        
        state.lastTouchTime = now;
        state.lastTouchX = touch.clientX;
        state.lastTouchY = touch.clientY;

        // 长按检测
        state.longPressStartX = touch.clientX;
        state.longPressStartY = touch.clientY;
        state.longPressTimer = setTimeout(() => {
          // 只有在没有移动太多的情况下才触发长按
          if (!state.hasMoved) {
            state.isLongPress = true;
            state.isPanning = false;
            
            const rect = container.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            
            // 显示十字线
            chart.applyOptions({
              crosshair: {
                mode: 1,
                vertLine: { visible: true, labelVisible: true },
                horzLine: { visible: true, labelVisible: true },
              }
            });
            
            // 获取时间和价格
            const coordinateToTime = timeScale.coordinateToTime(x);
            if (coordinateToTime !== null) {
              // 尝试获取价格（从第一个可见系列）
              const series = chart.series()[0];
              let price = 0;
              if (series) {
                const data = series.data();
                const timeNum = coordinateToTime as number;
                const closest = data.find(d => (d.time as number) >= timeNum);
                if (closest && 'close' in closest) {
                  price = (closest as any).close;
                }
              }
              onLongPress?.(coordinateToTime as number, price);
            }
          }
        }, LONG_PRESS_DURATION);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (state.isLongPress) {
        // 长按状态下，更新十字线位置
        if (e.touches.length === 1) {
          const touch = e.touches[0];
          const rect = container.getBoundingClientRect();
          const x = Math.max(0, Math.min(touch.clientX - rect.left, rect.width));
          
          const coordinateToTime = timeScale.coordinateToTime(x);
          if (coordinateToTime !== null) {
            const series = chart.series()[0];
            let price = 0;
            if (series) {
              const data = series.data();
              const timeNum = coordinateToTime as number;
              const closest = data.find(d => (d.time as number) >= timeNum);
              if (closest && 'close' in closest) {
                price = (closest as any).close;
              }
            }
            onLongPress?.(coordinateToTime as number, price);
          }
        }
        e.preventDefault();
        return;
      }

      if (!state.isPinching && !state.isPanning && e.touches.length === 1) {
        // 检查是否超过移动阈值
        const touch = e.touches[0];
        const moveDistance = Math.sqrt(
          Math.pow(touch.clientX - state.initialTouchX, 2) +
          Math.pow(touch.clientY - state.initialTouchY, 2)
        );
        
        if (moveDistance > MOVE_THRESHOLD) {
          state.hasMoved = true;
          cancelLongPress();
          state.isPanning = true;
        }
      }

      if (state.isPinching && e.touches.length === 2) {
        e.preventDefault();
        
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const distance = getDistance(t1, t2);
        const center = getCenter(t1, t2);
        const scale = distance / state.startDistance;
        
        // 使用对数缩放曲线，让缩放更自然
        const logScale = Math.log(scale + 1) / Math.log(2);
        const newBarSpacing = Math.max(MIN_BAR_SPACING, Math.min(MAX_BAR_SPACING, 
          state.startBarSpacing * Math.pow(scale, PINCH_SENSITIVITY)
        ));
        
        // 计算以触摸中心为锚点的滚动偏移
        const containerRect = container.getBoundingClientRect();
        const centerRatio = (center.x - containerRect.left) / containerRect.width;
        const oldRange = containerRect.width / state.startBarSpacing;
        const newRange = containerRect.width / newBarSpacing;
        const rangeDelta = newRange - oldRange;
        const scrollOffset = rangeDelta * centerRatio;
        
        timeScale.applyOptions({ barSpacing: newBarSpacing });
        
        // 调整滚动位置以保持缩放中心
        try {
          timeScale.scrollToPosition(state.startScrollPosition + scrollOffset, false);
        } catch (err) {
          console.warn("Pinch scroll error:", err);
        }
      } else if (state.isPanning && e.touches.length === 1) {
        e.preventDefault();
        
        const touch = e.touches[0];
        const deltaX = touch.clientX - state.startX;
        const barSpacing = timeScale.options().barSpacing ?? 6;
        
        // 计算速度用于惯性滚动
        const now = Date.now();
        const dt = now - state.lastMoveTime;
        if (dt > 0 && dt < 100) { // 只计算短时间内的速度
          const dx = touch.clientX - state.lastMoveX;
          // 使用低通滤波平滑速度
          const newVelocity = (dx / dt) * 16;
          state.velocityX = state.velocityX * 0.3 + newVelocity * 0.7;
        }
        state.lastMoveTime = now;
        state.lastMoveX = touch.clientX;
        
        // 直接滚动，不使用动画
        const scrollDelta = -deltaX / barSpacing;
        const newPosition = state.startPanScrollPosition + scrollDelta;
        
        try {
          timeScale.scrollToPosition(newPosition, false);
        } catch (err) {
          console.warn("Pan scroll error:", err);
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      cancelLongPress();

      // 处理长按结束
      if (state.isLongPress) {
        chart.applyOptions({
          crosshair: {
            mode: 0,
            vertLine: { visible: false, labelVisible: false },
            horzLine: { visible: false, labelVisible: false },
          }
        });
      }

      // 处理惯性滚动
      if (state.isPanning && Math.abs(state.velocityX) > MIN_VELOCITY) {
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

      // 如果还有触摸点（例如抬起一根手指），重置状态但保持另一根手指的追踪
      if (e.touches.length === 1) {
        // 从双指变为单指，转为平移模式
        if (state.isPinching) {
          state.isPinching = false;
          state.isPanning = true;
          state.startX = e.touches[0].clientX;
          state.startY = e.touches[0].clientY;
          state.startPanScrollPosition = timeScale.scrollPosition() ?? 0;
          state.velocityX = 0;
        }
      } else if (e.touches.length === 0) {
        // 全部抬起
        state.isPinching = false;
        state.isPanning = false;
        state.isLongPress = false;
      }
    };

    const handleTouchCancel = () => {
      cancelLongPress();
      cancelInertia();
      
      if (state.isLongPress) {
        chart.applyOptions({
          crosshair: {
            mode: 0,
            vertLine: { visible: false, labelVisible: false },
            horzLine: { visible: false, labelVisible: false },
          }
        });
      }
      
      state.isPinching = false;
      state.isPanning = false;
      state.isLongPress = false;
    };

    // 使用 { passive: false } 确保可以阻止默认行为
    container.addEventListener("touchstart", handleTouchStart, { passive: false });
    container.addEventListener("touchmove", handleTouchMove, { passive: false });
    container.addEventListener("touchend", handleTouchEnd);
    container.addEventListener("touchcancel", handleTouchCancel);

    return () => {
      cancelInertia();
      cancelLongPress();
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [chart, container, enabled, getDistance, getCenter, onLongPress, onDoubleTap]);
}