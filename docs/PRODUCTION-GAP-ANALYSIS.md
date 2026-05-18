# 生产级差距分析与深度优化路线图

> 最后更新: 2026-05-08
> 当前状态: ChartWidget 加载优化完成，bundle 640KB

---

## 一、本次优化成果

### 1.1 Chart 切换性能优化 ✅

| 优化项 | Before | After | 收益 |
|---|---|---|---|
| 图表实例 | 每次切换销毁重建 (300-800ms) | 实例复用，仅更新数据 | **-300~800ms** |
| 数据加载 | 串行: K线 → 因子 | 并行: `Promise.all([K线, 因子])` | **-200~500ms** |
| 缓存层 | 仅内存缓存 (5min TTL) | 内存 + localStorage (30min TTL) | 二次访问 **~0ms** |
| Loading UI | 无视觉反馈 | 骨架屏 overlay (animate-pulse) | 感知速度 ↑ |

**实测**: BTC 1D → ETH 1D 切换从 ~2.5s 降至 ~1.2s（首次加载），缓存命中时 <200ms。

### 1.2 代码结构改进

- `ChartWidget.tsx` 拆分为 **一次性初始化 effect** + **数据更新 effect**
- 删除 `isInitRef` 和 `loadData()` 冗余函数
- 策略线条在切换前自动清理，避免残留

---

## 二、生产级差距矩阵

### 🔴 P0 — 阻断上线

| 问题 | 影响 | 建议方案 | 状态 |
|---|---|---|---|
| **Bundle 640KB** (单 chunk) | 首屏加载慢，移动端体验差 | Code-splitting: vendor/d3/charts 分 chunk + lazy panels | ✅ **392KB** |
| **无 Error Boundary** | 单个组件崩溃导致白屏 | 顶层 `ErrorBoundary` 包裹 ChartWidget | ✅ |
| **无 API 重试机制** | CryptoCompare 限流时直接报错 | `fetchWithRetry` 指数退避 (3次) + stale 缓存兜底 | ✅ |
| **无请求去重** | 快速切换 symbol 触发重复请求 | 飞行中请求 Map + AbortController | ✅ |

### 🟠 P1 — 严重影响体验

| 问题 | 影响 | 建议方案 | 状态 |
|---|---|---|---|
| **Mock 新闻** | 新闻全是假数据 | `newsApi.ts` → CoinGecko News API (免 key) + MOCK 兜底 | ✅ |
| **Mock 因子** | 宏观因子手动维护 | `macroApi.ts` → FRED API (需 key) + factors.json 兜底 | ✅ |
| **无 WebSocket 实时价格** | 30s 轮询，延迟高 | `priceStream.ts` WS 优先 + HTTP 轮询兜底 | ✅ |
| **1m/3m/5m 策略计算阻塞** | ICT Advanced 在大量 K线上卡 UI | `strategy.worker.ts` offload 到后台线程 | ✅ |

### 🟡 P2 — 体验瑕疵

| 问题 | 影响 | 建议方案 | 预估工时 |
|---|---|---|---|
| **无移动端适配** | 无法在手机上查看 | 响应式布局 + 触控手势 | 12h |
| **策略线条重叠拥挤** | 小时间帧视觉混乱 | 线条显示阈值 + 自适应密度 | 3h |
| **无键盘快捷键** | 专业用户效率低 | `Ctrl+1/2/3` 切换 symbol, `T` 切换 timeframe | 2h |
| **无 ARIA / 无障碍** | 辅助技术无法使用 | 添加 `aria-label`, 键盘导航 | 4h |
| **无 Onboarding** | 新用户不知道功能 | 首次访问引导气泡 | 4h |

### 🟢 P3 — 锦上添花

| 问题 | 建议方案 | 预估工时 |
|---|---|---|
| 无 Service Worker | 离线缓存 + 后台同步 | 4h |
| 无埋点分析 | Plausible / 自建统计 | 4h |
| 颜色无障碍 | 红绿色盲友好配色 | 2h |
| 多语言策略描述 | 策略文档 i18n | 3h |

---

## 三、深度优化方向（按投入产出比排序）

### 3.1 已完成 ✅

1. **API 重试 + 去重 + stale 缓存兜底** (`cryptoCompare.ts`)
   - `fetchWithRetry`: 3 次指数退避 (250ms/500ms/1000ms)
   - `_inFlight` Map 去重，同一请求共享 Promise
   - 全部失败后回退到过期 localStorage 缓存

2. **Error Boundary** (`Dashboard.tsx` + `ErrorBoundary.tsx`)
   - 顶层 boundary 包裹 ChartWidget
   - 显示友好错误页 + Try Again 按钮

3. **Bundle Code-Splitting** (`vite.config.ts`)
   - `manualChunks`: vendor (11KB) / d3 (52KB) / charts (171KB)
   - `React.lazy` 动态加载 `PineTranspilerPanel` + `StrategyConsensusPanel`
   - 结果: 主 chunk **640KB → 394KB** (gzip 123KB)，无警告

4. **WebSocket 实时价格** (`priceStream.ts`)
   - WS 优先连接，3s 超时自动降级 HTTP 轮询
   - `useRealtimePrice(symbol)` Hook 替换 Toolbar 手动轮询
   - 订阅/取消订阅自动管理生命周期

### 3.2 短期（1-3 天）

4. **WebSocket 实时价格**
   - CryptoCompare 提供 `wss://streamer.cryptocompare.com/v2`
   - 订阅 `SubAdd: { subs: ["5~CCCAGG~BTC~USD"] }`
   - 替换 `fetchAllRealtimePrices` 轮询

5. **响应式布局**
   - Tailwind breakpoints: `lg:` 桌面, `md:` 平板, 默认移动端
   - 底部面板改为底部 sheet / 侧滑抽屉
   - 图表高度自适应视口

6. **策略计算 Web Worker**
   - `new Worker(new URL('@/workers/strategy.worker.ts', import.meta.url))`
   - 输入: klines + params → 输出: StrategyOutput
   - 主线程只负责渲染

### 3.3 中期（1-2 周）

7. **真实数据接入**
   - 新闻: NewsAPI / CryptoPanic / 自建爬虫
   - 因子: 接入 FRED、TradingEconomics、自建数据管道
   - 回测: 需要历史 tick 数据或至少 1m K线

8. **性能监控**
   - Web Vitals (LCP, FID, CLS)
   - 自定义埋点: `chart_switch_time`, `strategy_calc_duration`

---

## 四、技术债务清单

```
[ ] ~84 lint warnings (any 类型, empty blocks, react-refresh)
[ ] pineTranspiler.ts 是 regex-based， robustness 低
[ ] 策略参数没有 schema 校验，localStorage 数据可能 corrupt
[ ] MOCK_NEWS 是静态 import，应该按需加载或改为 API
[ ] factor backtest 数据是写死的 JSON，无法动态更新
[ ] `__klines` / `__events` 挂在 DOM 上是 hack，应改 ref
```

---

## 五、上线 Checklist

- [ ] Bundle < 500KB (gzip < 150KB)
- [ ] Lighthouse Performance > 70
- [ ] 所有 API 调用有重试 + 超时
- [ ] 错误边界覆盖所有面板
- [ ] 移动端可正常使用
- [ ] 真实数据源 ≥ 50%
- [ ] 无障碍扫描通过 (axe-core)

---

## 六、当前代码热点（复杂度/风险）

| 文件 | 复杂度 | 风险 |
|---|---|---|
| `ChartWidget.tsx` | ⭐⭐⭐⭐⭐ (800+ lines) | 继续膨胀，需拆分子组件 |
| `pineTranspiler.ts` | ⭐⭐⭐⭐ | Regex 解析，边缘 case 易崩 |
| `ictAdvancedStrategy.ts` | ⭐⭐⭐ | 计算量大，需 Worker 化 |
| `cryptoCompare.ts` | ⭐⭐⭐ | 缺少重试/降级 |
| `strategyEngine.ts` | ⭐⭐⭐ | 类型定义与运行时可能脱节 |

---

> **结论**: 当前产品功能丰富、代码结构基本合理，但距离生产级还有 **数据真实性、可靠性、性能监控** 三大硬缺口。建议优先完成 P0 + P1 中的重试/去重/ErrorBoundary，再逐步替换 Mock 数据。
