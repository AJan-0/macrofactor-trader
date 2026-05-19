import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    base: '/',
    plugins: [react()],
    server: {
      port: 3000,
      host: true,
      // https: false,
      cors: true,
      proxy: {
        // REST API proxy
        '/api': {
          target: env.VITE_API_URL || 'http://localhost:8000',
          changeOrigin: true,
        },
        // WebSocket proxy for real-time K-line
        '/ws': {
          target: env.VITE_WS_URL || 'ws://localhost:8000',
          ws: true,
          changeOrigin: true,
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks: {
            // 核心框架（首屏必需）
            vendor: ["react", "react-dom", "react-dom/client"],
            // UI 组件库（首屏必需）
            ui: ["@radix-ui/react-dialog", "@radix-ui/react-select", "@radix-ui/react-slider", "@radix-ui/react-tabs", "@radix-ui/react-tooltip", "class-variance-authority", "clsx", "tailwind-merge"],
            // 图表（首屏必需但可延后）
            charts: ["lightweight-charts"],
            // 数据可视化（非首屏）
            d3: ["d3"],
            // 状态管理（首屏必需）
            state: ["zustand", "@tanstack/react-query"],
            // 工具库（按需加载）
            utils: ["date-fns", "lucide-react"],
          },
        },
      },
    },
  };
});