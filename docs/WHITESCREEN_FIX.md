# 白屏问题修复记录

## 问题描述
项目在本地运行后页面空白，移动端浏览器显示"无法建立安全连接"。

## 已修复的问题

### 1. React 无限循环问题 (Error #185)
**原因**: `useStrategyOverlay` hook 中 `klines` 数组作为依赖项，每次渲染都创建新引用，导致 `useEffect` 无限循环。

**修复**: 
- 使用 `useRef` 存储 `klines`，避免依赖数组变化
- 从依赖数组中移除 `klines`

```typescript
// 使用 ref 存储 klines 避免数组引用变化导致无限循环
const klinesRef = useRef(klines);
klinesRef.current = klines;
```

### 2. CSS 变量缺失
**原因**: Tailwind 配置中引用了 CSS 变量，但 `index.css` 中未定义。

**修复**: 在 `index.css` 中添加完整的 CSS 变量定义：

```css
:root {
  --background: 222 47% 6%;
  --foreground: 210 40% 90%;
  --card: 222 47% 8%;
  /* ... 其他变量 */
}
```

### 3. HTTPS 访问问题
**原因**: Vite dev 服务器默认使用 HTTP，移动端浏览器强制要求 HTTPS。

**修复**: 
- 安装 `@vitejs/plugin-basic-ssl` 插件
- 配置 Vite 使用 HTTPS

```typescript
// vite.config.ts
import basicSsl from "@vitejs/plugin-basic-ssl"

export default defineConfig({
  plugins: [react(), basicSsl()],
})
```

## 当前服务器状态

服务器运行在 HTTPS 上：
- **本机访问**: https://localhost:3007
- **局域网访问**: https://10.1.48.28:3007

## 移动端访问步骤

1. 确保手机和电脑在同一 Wi-Fi 网络
2. 在手机浏览器输入: **https://10.1.48.28:3007**
3. 如果出现证书警告，点击"继续访问"

## 文件修改记录

1. `src/hooks/useStrategyOverlay.ts` - 修复无限循环
2. `src/index.css` - 添加 CSS 变量
3. `vite.config.ts` - 添加 HTTPS 支持
4. `package.json` - 添加 `@vitejs/plugin-basic-ssl` 依赖

## 待验证

- [ ] 移动端实际访问测试
- [ ] 确认无白屏问题
- [ ] 确认图表正常显示
