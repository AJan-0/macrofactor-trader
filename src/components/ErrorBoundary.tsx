/**
 * Error Boundary - 捕获子组件渲染错误，防止白屏
 *
 * 使用方式：
 * <ErrorBoundary>
 *   <YourComponent />
 * </ErrorBoundary>
 */

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary] 捕获到错误:", error);
    console.error("[ErrorBoundary] 组件栈:", info.componentStack);
    this.props.onError?.(error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-3 p-6 text-center" style={{ background: "#111827" }}>
          <div className="text-4xl mb-2">⚠️</div>
          <h3 className="text-[#e2e8f0] font-bold text-sm">组件渲染出错</h3>
          <p className="text-[#94a3b8] text-xs max-w-[280px]">
            {this.state.error?.message || "未知错误"}
          </p>
          <div className="flex gap-2 mt-2">
            <button
              onClick={this.handleReset}
              className="px-3 py-1.5 rounded bg-[#3b82f620] text-[#3b82f6] text-xs border border-[#3b82f6] hover:bg-[#3b82f640] transition-colors"
            >
              重试
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-3 py-1.5 rounded bg-[#1e293b] text-[#94a3b8] text-xs border border-[#1e293b] hover:text-[#e2e8f0] transition-colors"
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
