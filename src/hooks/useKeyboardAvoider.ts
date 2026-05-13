/**
 * 虚拟键盘避让 Hook
 * 在移动端键盘弹出时，自动调整目标元素的位置，避免输入框被遮挡
 */

import { useEffect, useRef } from "react";

interface UseKeyboardAvoiderOptions {
  enabled?: boolean;
}

export function useKeyboardAvoider({ enabled = true }: UseKeyboardAvoiderOptions = {}) {
  const offsetRef = useRef(0);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    if (!("visualViewport" in window)) return;

    const viewport = window.visualViewport;
    if (!viewport) return;

    const initialHeight = viewport.height;

    const handleResize = () => {
      const currentHeight = viewport.height;
      const diff = initialHeight - currentHeight;

      if (diff > 100) {
        // 键盘弹出
        offsetRef.current = diff;
        document.body.style.transform = `translateY(-${diff * 0.3}px)`;
        document.body.style.transition = "transform 0.2s ease-out";
      } else {
        // 键盘收起
        offsetRef.current = 0;
        document.body.style.transform = "";
        document.body.style.transition = "";
      }
    };

    viewport.addEventListener("resize", handleResize);
    return () => {
      viewport.removeEventListener("resize", handleResize);
      document.body.style.transform = "";
      document.body.style.transition = "";
    };
  }, [enabled]);

  return offsetRef;
}
