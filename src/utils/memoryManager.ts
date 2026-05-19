// 内存管理工具 - P0 核心稳定性
// 用于检测和清理内存泄漏

import React from "react";

interface CleanupFn {
  name: string;
  fn: () => void;
}

class MemoryManager {
  private cleanups = new Map<string, CleanupFn[]>();
  private intervals = new Map<string, ReturnType<typeof setInterval>[]>();
  private timeouts = new Map<string, ReturnType<typeof setTimeout>[]>();
  private observers = new Map<string, IntersectionObserver[]>();
  private abortControllers = new Map<string, AbortController[]>();

  /**
   * 注册组件级别的清理函数
   */
  register(componentId: string, name: string, cleanup: () => void) {
    if (!this.cleanups.has(componentId)) {
      this.cleanups.set(componentId, []);
    }
    this.cleanups.get(componentId)!.push({ name, fn: cleanup });
  }

  /**
   * 创建受管理的 setInterval
   */
  setInterval(componentId: string, callback: () => void, ms: number): ReturnType<typeof setInterval> {
    const id = setInterval(callback, ms);
    if (!this.intervals.has(componentId)) {
      this.intervals.set(componentId, []);
    }
    this.intervals.get(componentId)!.push(id);
    return id;
  }

  /**
   * 创建受管理的 setTimeout
   */
  setTimeout(componentId: string, callback: () => void, ms: number): ReturnType<typeof setTimeout> {
    const id = setTimeout(callback, ms);
    if (!this.timeouts.has(componentId)) {
      this.timeouts.set(componentId, []);
    }
    this.timeouts.get(componentId)!.push(id);
    return id;
  }

  /**
   * 创建受管理的 IntersectionObserver
   */
  observe(componentId: string, element: Element, callback: IntersectionObserverCallback, options?: IntersectionObserverInit): IntersectionObserver {
    const observer = new IntersectionObserver(callback, options);
    observer.observe(element);
    if (!this.observers.has(componentId)) {
      this.observers.set(componentId, []);
    }
    this.observers.get(componentId)!.push(observer);
    return observer;
  }

  /**
   * 创建受管理的 AbortController
   */
  createAbortController(componentId: string): AbortController {
    const controller = new AbortController();
    if (!this.abortControllers.has(componentId)) {
      this.abortControllers.set(componentId, []);
    }
    this.abortControllers.get(componentId)!.push(controller);
    return controller;
  }

  /**
   * 清理组件的所有资源
   */
  cleanup(componentId: string) {
    console.log(`[MemoryManager] Cleaning up ${componentId}`);

    // 执行清理函数
    const cleanups = this.cleanups.get(componentId);
    if (cleanups) {
      cleanups.forEach(({ name, fn }) => {
        try {
          fn();
        } catch (err) {
          console.warn(`[MemoryManager] Cleanup error in ${componentId}/${name}:`, err);
        }
      });
      this.cleanups.delete(componentId);
    }

    // 清除 intervals
    const intervals = this.intervals.get(componentId);
    if (intervals) {
      intervals.forEach(id => clearInterval(id));
      this.intervals.delete(componentId);
    }

    // 清除 timeouts
    const timeouts = this.timeouts.get(componentId);
    if (timeouts) {
      timeouts.forEach(id => clearTimeout(id));
      this.timeouts.delete(componentId);
    }

    // 断开 observers
    const observers = this.observers.get(componentId);
    if (observers) {
      observers.forEach(obs => obs.disconnect());
      this.observers.delete(componentId);
    }

    // 取消 abort controllers
    const controllers = this.abortControllers.get(componentId);
    if (controllers) {
      controllers.forEach(ctrl => ctrl.abort());
      this.abortControllers.delete(componentId);
    }
  }

  /**
   * 获取内存使用统计（如果可用）
   */
  getStats(): { used: number; total: number; limit: number } | null {
    const memory = (performance as any).memory;
    if (!memory) return null;
    return {
      used: Math.round(memory.usedJSHeapSize / 1048576),
      total: Math.round(memory.totalJSHeapSize / 1048576),
      limit: Math.round(memory.jsHeapSizeLimit / 1048576),
    };
  }

  /**
   * 打印内存报告
   */
  logMemoryReport() {
    const stats = this.getStats();
    if (stats) {
      const percent = ((stats.used / stats.limit) * 100).toFixed(1);
      console.log(`[MemoryManager] Heap: ${stats.used}MB / ${stats.limit}MB (${percent}%)`);
    }

    console.log(`[MemoryManager] Active components: ${this.cleanups.size}`);
    console.log(`[MemoryManager] Active intervals: ${Array.from(this.intervals.values()).flat().length}`);
    console.log(`[MemoryManager] Active timeouts: ${Array.from(this.timeouts.values()).flat().length}`);
    console.log(`[MemoryManager] Active observers: ${Array.from(this.observers.values()).flat().length}`);
  }

  /**
   * 全局清理（用于页面卸载）
   */
  cleanupAll() {
    const allIds = new Set([
      ...this.cleanups.keys(),
      ...this.intervals.keys(),
      ...this.timeouts.keys(),
      ...this.observers.keys(),
      ...this.abortControllers.keys(),
    ]);
    allIds.forEach(id => this.cleanup(id));
  }
}

// 单例
export const memoryManager = new MemoryManager();

// React Hook: 自动管理组件生命周期
export function useMemoryCleanup(componentId: string) {
  React.useEffect(() => {
    return () => {
      memoryManager.cleanup(componentId);
    };
  }, [componentId]);
}
