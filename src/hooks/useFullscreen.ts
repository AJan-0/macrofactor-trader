/**
 * 全屏模式 Hook
 * 支持移动端横屏自动全屏和手动全屏切换
 */

import { useState, useEffect, useCallback, useRef } from "react";

interface UseFullscreenOptions {
  enabled?: boolean;
  autoOnLandscape?: boolean;
}

interface VendorFullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
}

interface VendorFullscreenDocument extends Document {
  webkitExitFullscreen?: () => Promise<void> | void;
  msExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
  msFullscreenElement?: Element | null;
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
      } else {
        const vendorEl = el as VendorFullscreenElement;
        if (vendorEl.webkitRequestFullscreen) {
          await vendorEl.webkitRequestFullscreen();
        } else if (vendorEl.msRequestFullscreen) {
          await vendorEl.msRequestFullscreen();
        }
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
      } else {
        const vendorDocument = document as VendorFullscreenDocument;
        if (vendorDocument.webkitExitFullscreen) {
          await vendorDocument.webkitExitFullscreen();
        } else if (vendorDocument.msExitFullscreen) {
          await vendorDocument.msExitFullscreen();
        }
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
      const vendorDocument = document as VendorFullscreenDocument;
      setIsFullscreen(
        !!document.fullscreenElement ||
        !!vendorDocument.webkitFullscreenElement ||
        !!vendorDocument.msFullscreenElement
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
