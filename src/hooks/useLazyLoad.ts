// 懒加载 Hook - P1 性能优化
// 用于非首屏组件的按需加载

import { useEffect, useRef, useState, useCallback } from 'react';

interface UseLazyLoadOptions {
  rootMargin?: string;
  threshold?: number;
  triggerOnce?: boolean;
}

/**
 * 使用 Intersection Observer 实现懒加载
 */
export function useLazyLoad<T extends HTMLElement>(
  options: UseLazyLoadOptions = {}
) {
  const { rootMargin = '100px', threshold = 0.1, triggerOnce = true } = options;
  const ref = useRef<T>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          if (triggerOnce) {
            observer.disconnect();
          }
        } else if (!triggerOnce) {
          setIsVisible(false);
        }
      },
      { rootMargin, threshold }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin, threshold, triggerOnce]);

  return { ref, isVisible };
}

/**
 * 图片懒加载
 */
export function useLazyImage(src: string) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setLoaded(true);
    img.onerror = () => setError(true);
    img.src = src;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [src]);

  return { loaded, error };
}

/**
 * 分片加载大数据列表
 */
export function useChunkedLoad<T>(
  items: T[],
  chunkSize: number = 20,
  delay: number = 100
) {
  const [loadedItems, setLoadedItems] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const indexRef = useRef(0);

  const loadMore = useCallback(() => {
    if (isLoading || !hasMore) return;

    setIsLoading(true);
    const start = indexRef.current;
    const end = Math.min(start + chunkSize, items.length);
    const chunk = items.slice(start, end);

    setTimeout(() => {
      setLoadedItems((prev) => [...prev, ...chunk]);
      indexRef.current = end;
      setHasMore(end < items.length);
      setIsLoading(false);
    }, delay);
  }, [items, chunkSize, delay, isLoading, hasMore]);

  const reset = useCallback(() => {
    setLoadedItems([]);
    setHasMore(true);
    setIsLoading(false);
    indexRef.current = 0;
  }, []);

  return { loadedItems, isLoading, hasMore, loadMore, reset };
}
