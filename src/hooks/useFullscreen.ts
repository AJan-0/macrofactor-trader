/**
 * 全屏模式 Hook
 * 支持移动端横屏自动全屏和手动全屏切换
 */

import { useState, useEffect, useCallback, useRef } from "react";

interface UseFullscreenOptions {
  enabled?: boolean;
  autoOnLandscape?: boolean;
}

export function useFullscreen({ enabled = true, autoOnLandscape = true }: UseFullscreenOptions = {}) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const elementRef = useRef<HTMLElement | null>(null);

  const enterFullscreen = useCallback(async (element?: HTMLElement) => {
    const el = element || elementRef.current || document.documentElement;
    if (!el) return;

    try {
      if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else if ((el as any).webkitRequestFullscreen) {
        await (el as any).webkitRequestFullscreen();
      } else if ((el as any).msRequestFullscreen) {
        await (el as any).msRequestFullscreen();
      }
      elementRef.current = el;
    } catch (err) {
      console.warn("[useFullscreen] Failed to enter fullscreen:", err);
    }
  }, []);

  const exitFullscreen = useCallback(async () => {
    try {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if ((document as any).webkitExitFullscreen) {
        await (document as any).webkitExitFullscreen();
      } else if ((document as any).msExitFullscreen) {
        await (document as any).msExitFullscreen();
      }
    } catch (err) {
      console.warn("[useFullscreen] Failed to exit fullscreen:", err);
    }
  }, []);

  const toggleFullscreen = useCallback(async (element?: HTMLElement) => {
    if (isFullscreen) {
      await exitFullscreen();
    } else {
      await enterFullscreen(element);
    }
  }, [isFullscreen, enterFullscreen, exitFullscreen]);

  // 监听全屏状态变化
  useEffect(() => {
    if (!enabled) return;

    const handleChange = () => {
      setIsFullscreen(
        !!document.fullscreenElement ||
        !!(document as any).webkitFullscreenElement ||
        !!(document as any).msFullscreenElement
      );
    };

    document.addEventListener("fullscreenchange", handleChange);
    document.addEventListener("webkitfullscreenchange", handleChange);
    document.addEventListener("msfullscreenchange", handleChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleChange);
      document.removeEventListener("webkitfullscreenchange", handleChange);
      document.removeEventListener("msfullscreenchange", handleChange);
    };
  }, [enabled]);

  // 横屏自动全屏
  useEffect(() => {
    if (!enabled || !autoOnLandscape) return;

    const handleOrientationChange = () => {
      const isLandscape = window.matchMedia("(orientation: landscape)").matches;
      const isMobile = window.matchMedia("(max-width: 768px)").matches;
      
      if (isLandscape && isMobile && !isFullscreen) {
        enterFullscreen();
      } else if (!isLandscape && isFullscreen) {
        exitFullscreen();
      }
    };

    const mql = window.matchMedia("(orientation: landscape)");
    if (mql.addEventListener) {
      mql.addEventListener("change", handleOrientationChange);
    } else {
      mql.addListener(handleOrientationChange);
    }

    return () => {
      if (mql.removeEventListener) {
        mql.removeEventListener("change", handleOrientationChange);
      } else {
        mql.removeListener(handleOrientationChange);
      }
    };
  }, [enabled, autoOnLandscape, isFullscreen, enterFullscreen, exitFullscreen]);

  return {
    isFullscreen,
    enterFullscreen,
    exitFullscreen,
    toggleFullscreen,
    elementRef,
  };
}
