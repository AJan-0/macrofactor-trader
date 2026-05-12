/**
 * 性能监控模块
 * 用于测量首屏加载、图表切换、移动端响应等关键指标
 */

interface PerformanceMetrics {
  fcp?: number; // First Contentful Paint
  lcp?: number; // Largest Contentful Paint
  cls?: number; // Cumulative Layout Shift
  chartSwitchTime?: number; // 图表切换时间
  mobileRenderTime?: number; // 移动端渲染时间
}

let metrics: PerformanceMetrics = {};

/**
 * 初始化性能监控
 */
export function initPerformanceMonitoring() {
  if (!('PerformanceObserver' in window)) {
    console.warn('[Performance] 浏览器不支持 PerformanceObserver');
    return;
  }

  try {
    // 监控 Web Vitals
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const name = entry.name;
        const value = (entry as any).value;

        if (name === 'first-contentful-paint') {
          metrics.fcp = value;
          console.log(`[Performance] FCP: ${value.toFixed(0)}ms`);
        } else if (name === 'largest-contentful-paint') {
          metrics.lcp = value;
          console.log(`[Performance] LCP: ${value.toFixed(0)}ms`);
        } else if (name === 'layout-shift') {
          metrics.cls = (metrics.cls || 0) + value;
          console.log(`[Performance] CLS: ${metrics.cls?.toFixed(3)}`);
        }
      }
    });

    observer.observe({
      entryTypes: ['paint', 'largest-contentful-paint', 'layout-shift'],
      buffered: true,
    });
  } catch (error) {
    console.error('[Performance] 监控设置失败:', error);
  }

  // 监控导航时间
  window.addEventListener('load', () => {
    const navTiming = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    if (navTiming) {
      console.log('[Performance] 导航时间:', {
        'DNS 查询': `${(navTiming.domainLookupEnd - navTiming.domainLookupStart).toFixed(0)}ms`,
        'TCP 连接': `${(navTiming.connectEnd - navTiming.connectStart).toFixed(0)}ms`,
        '文件传输': `${(navTiming.responseEnd - navTiming.responseStart).toFixed(0)}ms`,
        '处理时间': `${(navTiming.domInteractive - navTiming.domLoading).toFixed(0)}ms`,
        '总加载时间': `${navTiming.loadEventEnd.toFixed(0)}ms`,
      });
    }
  });
}

/**
 * 测量操作耗时
 */
export function measureOperation<T>(
  name: string,
  fn: () => T | Promise<T>
): T | Promise<T> {
  const startTime = performance.now();

  const handleComplete = (result: T) => {
    const duration = performance.now() - startTime;
    console.log(`[Performance] ${name}: ${duration.toFixed(2)}ms`);

    // 存储特定指标
    if (name.includes('图表切换')) {
      metrics.chartSwitchTime = duration;
    } else if (name.includes('移动端渲染')) {
      metrics.mobileRenderTime = duration;
    }

    return result;
  };

  const result = fn();
  if (result instanceof Promise) {
    return (result as Promise<T>).then(handleComplete).catch(error => {
      const duration = performance.now() - startTime;
      console.warn(`[Performance] ${name} 失败: ${duration.toFixed(2)}ms`, error);
      throw error;
    });
  } else {
    return handleComplete(result);
  }
}

/**
 * 获取当前性能指标
 */
export function getMetrics(): PerformanceMetrics {
  return { ...metrics };
}

/**
 * 生成性能报告
 */
export function generatePerformanceReport(): string {
  const report = `
╔════════════════════════════════════════╗
║     MacroFactor Trader 性能报告      ║
╚════════════════════════════════════════╝

⏱️  首屏性能:
  • FCP (First Contentful Paint): ${metrics.fcp ? `${metrics.fcp.toFixed(0)}ms` : '未检测'}
  • LCP (Largest Contentful Paint): ${metrics.lcp ? `${metrics.lcp.toFixed(0)}ms` : '未检测'}
  • CLS (Cumulative Layout Shift): ${metrics.cls ? metrics.cls.toFixed(3) : '未检测'}

📊 交互性能:
  • 图表切换延迟: ${metrics.chartSwitchTime ? `${metrics.chartSwitchTime.toFixed(0)}ms` : '未检测'}
  • 移动端渲染: ${metrics.mobileRenderTime ? `${metrics.mobileRenderTime.toFixed(0)}ms` : '未检测'}

✅ 性能评估:
  ${evaluatePerformance()}

🎯 优化建议:
${getOptimizationSuggestions()}
  `;

  return report;
}

/**
 * 评估性能级别
 */
function evaluatePerformance(): string {
  const fcp = metrics.fcp || Infinity;
  const lcp = metrics.lcp || Infinity;
  const chartTime = metrics.chartSwitchTime || Infinity;

  const score =
    (fcp < 1500 ? 25 : fcp < 2500 ? 15 : 5) +
    (lcp < 2500 ? 25 : lcp < 4000 ? 15 : 5) +
    (chartTime < 500 ? 25 : chartTime < 1000 ? 15 : 5) +
    ((metrics.cls || 1) < 0.1 ? 25 : (metrics.cls || 1) < 0.25 ? 15 : 5);

  if (score >= 90) return '🟢 优秀 (90+分)';
  if (score >= 75) return '🟡 良好 (75-89分)';
  if (score >= 60) return '🟠 及格 (60-74分)';
  return '🔴 需改进 (< 60分)';
}

/**
 * 获取优化建议
 */
function getOptimizationSuggestions(): string {
  const suggestions: string[] = [];

  if (!metrics.fcp || metrics.fcp > 1500) {
    suggestions.push('  • 减少首屏 JavaScript 大小 (Code-splitting)');
    suggestions.push('  • 预加载关键资源 (Link rel="preload")');
  }

  if (!metrics.lcp || metrics.lcp > 2500) {
    suggestions.push('  • 优化图片加载 (WebP + 懒加载)');
    suggestions.push('  • 改善 Web Font 加载性能');
  }

  if (!metrics.chartSwitchTime || metrics.chartSwitchTime > 500) {
    suggestions.push('  • 使用 Web Worker 处理策略计算');
    suggestions.push('  • 缓存图表实例，避免重建');
  }

  if (suggestions.length === 0) {
    suggestions.push('  • 性能已优化，无紧急建议');
  }

  return suggestions.join('\n');
}

/**
 * 导出性能数据为 JSON
 */
export function exportMetricsAsJSON(): string {
  return JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      metrics,
      userAgent: navigator.userAgent,
      connection: (navigator as any).connection?.effectiveType || 'unknown',
    },
    null,
    2
  );
}

// 自动初始化
if (typeof window !== 'undefined') {
  initPerformanceMonitoring();
}
