import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import Dashboard from './pages/Dashboard'
import { I18nProvider } from './i18n/I18nProvider'
import { ThemeProvider } from './components/providers/ThemeProvider'

// 全局错误处理
window.addEventListener('error', (event) => {
  console.error('[global error]', event.error)
})
window.addEventListener('unhandledrejection', (event) => {
  console.error('[unhandled rejection]', event.reason)
})

function updateStatus(msg: string) {
  const fallback = document.getElementById('loading-fallback')
  if (fallback) {
    fallback.innerHTML = `
      <div style="text-align:center;">
        <div style="font-size:24px;margin-bottom:8px;">⚡</div>
        <div style="font-size:14px;color:#e2e8f0;">${msg}</div>
      </div>
    `
  }
  console.log('[main]', msg)
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 2,
    },
  },
})

function showFatalError(error: unknown) {
  const root = document.getElementById('root')
  if (!root) return
  const stack = error instanceof Error ? `<strong>${error.name}:</strong> ${error.message}\n\n${error.stack}` : String(error)
  root.innerHTML = `
    <div style="padding:40px;color:#e2e8f0;font-family:monospace;background:#0a0e1a;min-height:100vh;overflow:auto;">
      <div style="font-size:32px;margin-bottom:16px;">⚠️</div>
      <h2 style="margin-bottom:12px;color:#ef4444;">应用加载失败</h2>
      <pre style="background:#111827;padding:16px;border-radius:8px;text-align:left;overflow:auto;font-size:12px;color:#94a3b8;border:1px solid #1e293b;white-space:pre-wrap;word-wrap:break-word;">${stack.replace(/</g, '&lt;')}</pre>
      <p style="margin-top:16px;color:#475569;font-size:12px;">请打开浏览器开发者工具（F12）查看 Console 获取更多详情</p>
      <button onclick="location.reload()" style="margin-top:16px;padding:8px 16px;background:#3b82f6;color:#fff;border:none;border-radius:4px;cursor:pointer;">刷新页面</button>
    </div>
  `
}

try {
  updateStatus('初始化中...')

  const rootEl = document.getElementById('root')
  if (!rootEl) {
    throw new Error('找不到 #root 元素，请检查 index.html')
  }
  updateStatus('创建React应用...')

  const root = createRoot(rootEl)
  updateStatus('挂载提供程序...')

  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <I18nProvider>
            <Dashboard />
          </I18nProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </StrictMode>,
  )
  updateStatus('应用已加载完成')
} catch (error) {
  console.error('[main.tsx] 致命错误:', error)
  showFatalError(error)
}
