# 移动端适配实施指南

> **目标**: 让 MacroFactor Trader 在移动设备上成为一流应用  
> **时间**: 2-3 周冲刺  
> **范围**: iOS + Android (Chrome/Safari) 6+ 英寸屏幕

---

## 一、移动端诊断与问题优先级

### 1.1 当前移动端截图问题分析

```
📱 iPhone SE (375px 宽)          📱 iPad (768px 宽)          🖥️ Desktop (1920px)
├─ Toolbar 按钮重叠            ├─ 侧面板宽度设定      ├─ 完美布局
├─ 图表被压扁                   ├─ 图表虽可见但小      ├─ 策略线清晰
├─ MobileNav 可用 ✅            ├─ 策略密集            ├─ 所有功能可达
├─ Sheet 内容溢出               ├─ 预警难看            └─ 桌面体验已优化
└─ 文字太小/太紧凑             └─ 总体还OK (60% 功能)

问题集中在:
1. 超小屏 (375-414px)
2. 实时交互 (缩放/拖动)
3. 触摸区域太小
```

### 1.2 优先级清单 (72 小时冲刺)

| 优先级 | 任务 | 工时 | 用户影响 | 预期收益 |
|-------|------|------|--------|--------|
| 🔴 P0 | 修复 Toolbar 响应式 | 2h | 按钮可点击 | 立即可用 |
| 🔴 P0 | 图表高度自适应 | 1h | 看得清 | 立即可用 |
| 🔴 P0 | 字体大小适配 | 1h | 易读性 | 立即可用 |
| 🟠 P1 | 触摸手势 (pinch/pan) | 8h | 能交互 | 完整体验 |
| 🟠 P1 | 虚拟键盘避挡 | 3h | 输入可用 | 完整体验 |
| 🟡 P2 | 预警面板移动端版 | 4h | 操作友好 | 细节优化 |
| 🟡 P2 | 因子编辑器移动端化 | 4h | 操作友好 | 细节优化 |

**立即修复**: P0 (4 小时) → 移动端 MVP 可用  
**一周完成**: P0 + P1 (12 小时) → 完整移动体验

---

## 二、P0 快速修复 (4 小时冲刺)

### 2.1 任务 1: Toolbar 响应式修复 (2h)

**问题**: 按钮横排拥挤, 在 < 480px 屏幕上重叠

**当前代码** (`src/components/Toolbar.tsx`):
```typescript
<div className="flex items-center gap-2 flex-wrap"> {/* 横排 */}
  <select>symbol</select>
  <select>timeframe</select>
  <button>strategy1</button>
  <button>strategy2</button>
  <button>strategy3</button>
</div>
```

**修复方案**:
```typescript
// 改用 md: 断点
const Toolbar = () => {
  const isMobile = useMediaQuery("(max-width: 768px)");
  
  return (
    <div className="flex md:flex-row flex-col gap-2 md:gap-4 p-2 md:p-4 
                    bg-slate-900 border-b border-slate-700">
      {/* 第一行: Symbol + Timeframe */}
      <div className="flex gap-2">
        <select className="px-2 py-1 text-sm md:text-base"> {/* 响应式字体 */}
          <option>BTC-USDT</option>
          <option>ETH-USDT</option>
        </select>
        <select className="px-2 py-1 text-sm md:text-base">
          <option>1m</option>
          <option>5m</option>
          {/* ... */}
        </select>
      </div>
      
      {/* 第二行: 策略按钮 (移动端改为分行) */}
      <div className="flex md:flex-row flex-col gap-2 overflow-x-auto md:overflow-visible">
        {STRATEGIES.map(s => (
          <button key={s.id} 
            className="px-3 py-2 text-sm md:text-base whitespace-nowrap
                       flex-shrink-0 md:flex-shrink-1"> {/* 移动端防止压缩 */}
            {s.name}
          </button>
        ))}
      </div>
    </div>
  );
};
```

**关键改动**:
1. ✅ 添加 `md:flex-row` (平板+桌面 横排) 默认 `flex-col` (移动端 竖排)
2. ✅ 响应式字体: `text-sm md:text-base`
3. ✅ 响应式内边距: `p-2 md:p-4`
4. ✅ 防止按钮压缩: `flex-shrink-0 md:flex-shrink-1`

**测试**:
```bash
# 在 375px 宽 iframe 中测试
npx vite preview  # 本地预览
# 用浏览器开发者工具的设备模拟器检查
```

**预期效果**:
- ✅ 375px: Toolbar 分为 2 行, 按钮纵向排列, 各占 100% 宽度
- ✅ 768px: Toolbar 恢复为 1-2 行混合布局
- ✅ 1920px: 保持当前横排布局

---

### 2.2 任务 2: 图表高度自适应 (1h)

**问题**: 移动端图表被压扁, 看不清蜡烛线

**当前代码** (`src/components/ChartWidget.tsx`):
```typescript
<div ref={containerRef} style={{ width: "100%", height: "400px" }} />
```

**修复方案**:
```typescript
const ChartWidget = () => {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const isSmallMobile = useMediaQuery("(max-width: 480px)");
  
  // 动态计算图表高度
  const chartHeight = isSmallMobile 
    ? "calc(100vh - 200px)" // 移动端: 留出 Toolbar (60px) + MobileNav (56px) + 缓冲 (84px)
    : isMobile 
    ? "calc(100vh - 180px)" // 平板
    : "calc(100vh - 140px)"; // 桌面
  
  return (
    <div className="flex flex-col w-full h-screen bg-slate-950">
      <Toolbar />
      
      <div className="flex-1 overflow-hidden"> {/* 允许溢出, 由父容器剪裁 */}
        <div 
          ref={containerRef}
          className="w-full h-full"
          style={{ height: chartHeight }}
        />
      </div>
      
      <MobileNav active={mobileTab} onChange={setMobileTab} />
    </div>
  );
};
```

**关键改动**:
1. ✅ 使用 `calc()` 动态计算高度 (视口 - 其他组件)
2. ✅ 根据屏幕宽度分级调整
3. ✅ 避免固定高度导致的压缩

**测试**:
```typescript
// 在不同分辨率下测试高度
const heights = {
  "375px (iPhone SE)": "calc(100vh - 200px)",
  "414px (iPhone 12)": "calc(100vh - 200px)",
  "768px (iPad)": "calc(100vh - 180px)",
  "1920px (Desktop)": "calc(100vh - 140px)",
};
```

**预期效果**:
- ✅ 375px: 图表占 ~70% 屏幕高度 (足够看清 10-15 根蜡烛线)
- ✅ 768px: 图表占 ~75% 屏幕高度
- ✅ 1920px: 图表占 ~80% 屏幕高度

---

### 2.3 任务 3: 字体与间距响应式 (1h)

**问题**: 移动端字体太小/太紧凑, 难以阅读和点击

**修复方案**:
```css
/* Tailwind 配置 (tailwind.config.js) */
module.exports = {
  theme: {
    fontSize: {
      // 移动端优先
      xs: ['12px', { lineHeight: '16px' }], // 相比之前的 10px 增大
      sm: ['13px', { lineHeight: '20px' }], // 14px -> 13px
      base: ['15px', { lineHeight: '24px' }], // 16px -> 15px (避免太挤)
      lg: ['17px', { lineHeight: '28px' }],
      xl: ['19px', { lineHeight: '32px' }],
    },
    minWidth: {
      touch: '44px', // WCAG 建议的最小触摸区域 44x44px
    },
    spacing: {
      // 移动端更大的间距
      touch: '12px', // 触摸按钮之间的间距
    },
  },
};
```

**在组件中应用**:
```typescript
// 前: 紧凑
<button className="px-2 py-1 text-xs">Click</button>

// 后: 移动端友好
<button className="px-3 py-2 text-sm md:text-base 
                   min-w-touch md:min-w-fit 
                   rounded-lg transition-all active:opacity-80">
  Click
</button>
```

**关键改动**:
1. ✅ 最小触摸区域 44x44px (`w-11 h-11`)
2. ✅ 按钮间距 12px (`gap-3`)
3. ✅ 文字行高 >= 1.5 (更易读)
4. ✅ 添加 `:active` 反馈 (移动端无 hover)

**所有组件更新清单**:
```bash
# 需要更新的文件:
- src/components/AlertManager.tsx (按钮大小化)
- src/components/FactorDashboard.tsx (输入框宽度)
- src/components/MobileSheet.tsx (内容间距)
- src/components/Toolbar.tsx (已在任务 1 完成)
```

---

### 2.4 快速验证清单

完成上述 3 个任务后:

```bash
# 1. 验证 Tailwind 断点
✅ md: (768px) 以上是否生效
✅ 默认 (< 768px) 样式是否应用

# 2. 验证响应式字体
✅ 375px: 字体 >= 13px
✅ 768px: 字体 >= 14px
✅ 1920px: 字体 >= 16px

# 3. 验证触摸区域
✅ 所有按钮 >= 44x44px
✅ 间距 >= 12px
✅ 输入框高度 >= 44px

# 4. 验证布局
✅ 无水平滚动条 (除非必要)
✅ 图表清晰可见
✅ 无被虚拟键盘挡住的输入框
```

**部署前测试设备**:
- 🍎 iPhone SE (375px)
- 🍎 iPhone 12 (390px)
- 🤖 Pixel 4a (412px)
- 🤖 Pixel 6 (412px)
- 📱 iPad (768px)

---

## 三、P1 触摸交互 (8 小时冲刺)

### 3.1 实现 Pinch-to-Zoom

**问题**: 移动端无法放大/缩小图表细节

**集成 react-touch-events 或自实现**:

```typescript
// 方案 A: 自实现 (推荐, 无依赖)
const useTouchZoom = (ref: React.RefObject<IChartApi>) => {
  const [scale, setScale] = useState(1);
  
  const handleTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const initialDistance = Math.sqrt(dx * dx + dy * dy);
      (e.currentTarget as HTMLElement).setAttribute('data-initial-distance', String(initialDistance));
    }
  };
  
  const handleTouchMove = (e: TouchEvent) => {
    if (e.touches.length === 2 && ref.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const currentDistance = Math.sqrt(dx * dx + dy * dy);
      const initialDistance = parseFloat((e.currentTarget as HTMLElement).getAttribute('data-initial-distance') || '100');
      const ratio = currentDistance / initialDistance;
      
      // 通过 timeScale 实现缩放 (缩小时间尺度 = 看更多根K线)
      if (ref.current) {
        const minBarsVisible = Math.max(10, Math.floor(50 / ratio));
        ref.current.timeScale().fitContent(); // 先重置
        // 后续可微调为自定义缩放倍数
      }
    }
  };
  
  return { handleTouchStart, handleTouchMove };
};

// 在 ChartWidget 中使用
export default function ChartWidget() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi>(null);
  const { handleTouchStart, handleTouchMove } = useTouchZoom(chartRef);
  
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    container.addEventListener('touchstart', handleTouchStart as any);
    container.addEventListener('touchmove', handleTouchMove as any);
    
    return () => {
      container.removeEventListener('touchstart', handleTouchStart as any);
      container.removeEventListener('touchmove', handleTouchMove as any);
    };
  }, []);
  
  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
```

**测试**:
```bash
# Chrome DevTools 移动设备模拟
1. 打开 DevTools (F12)
2. 切换设备工具栏 (Ctrl+Shift+M)
3. 打开两点模拟 (Shift + 拖拽)
4. 模拟捏合手势
```

---

### 3.2 实现 Pan-to-Scroll

**问题**: 移动端无法左右拖动查看历史 K 线

**实现**:

```typescript
const useTouchPan = (ref: React.RefObject<IChartApi>) => {
  const startXRef = useRef(0);
  
  const handleTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 1) {
      startXRef.current = e.touches[0].clientX;
    }
  };
  
  const handleTouchMove = (e: TouchEvent) => {
    if (e.touches.length === 1 && ref.current) {
      const currentX = e.touches[0].clientX;
      const delta = currentX - startXRef.current;
      
      // 将 delta 转换为时间滚动
      if (Math.abs(delta) > 5) { // 防止微小抖动
        const timeScale = ref.current.timeScale();
        const barsCount = timeScale.getVisibleLogicalRange()?.from ?? 0;
        const scrollBars = Math.round(delta / 2); // 1px = 0.5 根 K 线
        timeScale.scrollToPosition(barsCount - scrollBars, false);
        startXRef.current = currentX;
      }
    }
  };
  
  return { handleTouchStart, handleTouchMove };
};
```

---

## 四、虚拟键盘适配 (3 小时冲刺)

### 问题: 虚拟键盘挡住输入框

**在移动设备上**:
- 输入框获得焦点 → 虚拟键盘弹起 → 页面被压缩
- 输入框被键盘挡住 → 用户无法看到输入内容

**解决方案**:

```typescript
// 创建 Hook: useKeyboardAvoider
const useKeyboardAvoider = (ref: React.RefObject<HTMLInputElement>) => {
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    
    const handleFocus = () => {
      // 延迟滚动, 等待虚拟键盘完全弹起
      setTimeout(() => {
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // 同时调整 padding-bottom 给键盘腾空间
        document.body.style.paddingBottom = '300px'; // 估算虚拟键盘高度
      }, 300);
    };
    
    const handleBlur = () => {
      document.body.style.paddingBottom = '0px';
    };
    
    input.addEventListener('focus', handleFocus);
    input.addEventListener('blur', handleBlur);
    
    return () => {
      input.removeEventListener('focus', handleFocus);
      input.removeEventListener('blur', handleBlur);
    };
  }, [ref]);
};

// 在 AlertManager 中使用
export default function AlertManager() {
  const priceInputRef = useRef<HTMLInputElement>(null);
  useKeyboardAvoider(priceInputRef);
  
  return (
    <input
      ref={priceInputRef}
      type="number"
      placeholder="触发价格"
      className="px-3 py-2 text-sm border border-slate-500 rounded"
    />
  );
}
```

**CSS 方案** (更简洁):
```css
/* 在全局 CSS 中添加 */
@media (max-height: 600px) {
  /* 竖屏小屏设备 */
  body {
    overflow-y: auto;
    -webkit-overflow-scrolling: touch; /* 平滑滚动 */
  }
  
  input:focus {
    scroll-margin-top: 100px; /* 焦点元素距顶部至少 100px */
  }
}

/* 禁用缩放 (防止虚拟键盘导致的页面缩放) */
@viewport {
  width: device-width;
  initial-scale: 1;
  minimum-scale: 1;
  maximum-scale: 1;
  user-scalable: no;
}
```

---

## 五、完整实施检查表

### Phase 1: P0 修复 (4h, 第 1 天)

- [ ] 2h: Toolbar 响应式修复
  - [ ] 添加 `md:` 断点
  - [ ] 测试 375px / 768px / 1920px
  - [ ] 提交 PR #XX
  
- [ ] 1h: 图表高度自适应
  - [ ] 更新 ChartWidget 计算逻辑
  - [ ] 测试不同屏幕高度
  - [ ] 提交 PR #XX
  
- [ ] 1h: 字体和触摸区域
  - [ ] 更新 tailwind.config.js
  - [ ] 检查所有按钮 >= 44px
  - [ ] 提交 PR #XX

### Phase 2: P1 交互 (12h, 第 2-3 天)

- [ ] 8h: 触摸手势
  - [ ] 实现 pinch-to-zoom Hook
  - [ ] 实现 pan-to-scroll Hook
  - [ ] 在 ChartWidget 集成
  - [ ] 测试 iOS + Android
  - [ ] 提交 PR #XX
  
- [ ] 3h: 虚拟键盘适配
  - [ ] 添加 useKeyboardAvoider Hook
  - [ ] 更新所有输入组件
  - [ ] 测试虚拟键盘不挡住输入框
  - [ ] 提交 PR #XX
  
- [ ] 1h: 集成测试
  - [ ] 整体功能流测试
  - [ ] 性能检查 (Lighthouse)
  - [ ] 兼容性检查 (iOS Safari / Android Chrome)

### Phase 3: 验收 (2h, 第 4 天)

- [ ] 真机测试 (iPhone + Android)
  - [ ] 图表清晰度 ✅
  - [ ] 按钮可点击 ✅
  - [ ] 手势流畅 ✅
  - [ ] 输入无障碍 ✅
  
- [ ] 性能指标
  - [ ] FCP < 2s
  - [ ] LCP < 3s
  - [ ] 无明显卡顿
  
- [ ] 部署
  - [ ] merge 到 main
  - [ ] 灰度发布
  - [ ] 监控错误率

---

## 六、性能优化 (可选, 后续)

### 减少 JavaScript 大小

```bash
# 当前: 640KB (123KB gzip)
# 目标: 350KB (80KB gzip)

# 方案:
1. Code-splitting (分包 vendor/d3/charts)
2. 懒加载面板 (PineTranspiler/StrategyConsensus)
3. 移除未使用的依赖 (检查 package.json)
4. 压缩 PNG 图像 (使用 WebP)

# 检查命令
npm run build  # 查看 dist/ 文件大小
```

### 测试分数

```bash
# 运行 Lighthouse
npm run build && npx light-house https://localhost:3000 \
  --view --preset=mobile
  
# 目标:
- Performance: > 80
- Accessibility: > 90
- Best Practices: > 90
- SEO: > 90
```

---

## 七、常见问题排查

| 问题 | 症状 | 原因 | 解决 |
|-----|------|------|------|
| **双指缩放失效** | pinch 无反应 | 浏览器禁用了 touch-action | 移除 `touch-action: none` |
| **虚拟键盘挡住** | 输入框在键盘下方 | 页面没有滚动空间 | 添加 `padding-bottom` |
| **按钮区域太小** | 频繁误触其他按钮 | 触摸区域 < 44px | 增加 `w-11 h-11` |
| **图表卡顿** | 滑动/缩放时掉帧 | 策略计算阻塞主线程 | 使用 Worker 或节流 |
| **页面上下弹跳** | 滚动时闪烁 | iOS Safari 的自动隐藏地址栏 | 设置 `overflow: auto` |

---

## 八、参考资源

- **Tailwind 响应式设计**: https://tailwindcss.com/docs/responsive-design
- **WCAG 触摸指南**: https://www.w3.org/WAI/WCAG21/Understanding/target-size-enhanced.html
- **Lightweight Charts 移动端**: https://tradingview.github.io/lightweight-charts/docs/api/interface/TouchActionModifier
- **Chrome DevTools 移动模拟**: https://developer.chrome.com/docs/devtools/device-mode/

---

**预期完成时间**: 3-4 个工作日  
**需要角色**: 1 名前端工程师  
**验收标准**: 移动设备 (iOS + Android) 上所有主要功能可用且流畅
