// 全局错误边界 - P0 核心稳定性
// 捕获渲染错误，防止白屏，提供降级 UI

import React, { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home, Bug } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorCount: number;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, errorCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
    
    this.setState(prev => ({
      errorInfo,
      errorCount: prev.errorCount + 1,
    }));

    // 上报错误（如果有配置）
    this.props.onError?.(error, errorInfo);

    // 发送给监控服务
    this.reportError(error, errorInfo);
  }

  private reportError(error: Error, errorInfo: ErrorInfo) {
    try {
      // 本地存储错误日志
      const logs = JSON.parse(localStorage.getItem("error_logs") || "[]");
      logs.push({
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
        timestamp: new Date().toISOString(),
        url: window.location.href,
        userAgent: navigator.userAgent,
      });
      // 只保留最近 10 条
      while (logs.length > 10) logs.shift();
      localStorage.setItem("error_logs", JSON.stringify(logs));
    } catch {
      // 忽略存储错误
    }
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  private handleReload = () => {
    window.location.reload();
  };

  private handleGoHome = () => {
    window.location.href = "/";
  };

  render() {
    if (this.state.hasError) {
      // 自定义 fallback
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return <ErrorFallback 
        error={this.state.error}
        errorCount={this.state.errorCount}
        onRetry={this.handleRetry}
        onReload={this.handleReload}
        onGoHome={this.handleGoHome}
      />;
    }

    return this.props.children;
  }
}

// 错误降级 UI
interface ErrorFallbackProps {
  error: Error | null;
  errorCount: number;
  onRetry: () => void;
  onReload: () => void;
  onGoHome: () => void;
}

function ErrorFallback({ error, errorCount, onRetry, onReload, onGoHome }: ErrorFallbackProps) {
  const [showDetails, setShowDetails] = React.useState(false);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-6 text-center">
        {/* 图标 */}
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-destructive" />
          </div>
        </div>

        {/* 标题 */}
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">
            出错了
          </h1>
          <p className="text-muted-foreground">
            应用遇到了意外错误，请尝试刷新页面
          </p>
        </div>

        {/* 错误次数警告 */}
        {errorCount > 1 && (
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-sm text-yellow-600">
            已连续发生 {errorCount} 次错误，建议刷新页面或返回首页
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex flex-col gap-2">
          <Button onClick={onRetry} variant="default" className="w-full">
            <RefreshCw className="w-4 h-4 mr-2" />
            重试
          </Button>
          <Button onClick={onReload} variant="outline" className="w-full">
            <RefreshCw className="w-4 h-4 mr-2" />
            刷新页面
          </Button>
          <Button onClick={onGoHome} variant="ghost" className="w-full">
            <Home className="w-4 h-4 mr-2" />
            返回首页
          </Button>
        </div>

        {/* 错误详情（可展开） */}
        <div className="pt-4 border-t">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-sm text-muted-foreground hover:text-foreground flex items-center justify-center gap-1 mx-auto"
          >
            <Bug className="w-3 h-3" />
            {showDetails ? "隐藏详情" : "查看错误详情"}
          </button>
          
          {showDetails && error && (
            <div className="mt-3 text-left">
              <div className="bg-muted rounded-lg p-3 overflow-auto max-h-48">
                <p className="text-sm font-mono text-destructive">{error.message}</p>
                {error.stack && (
                  <pre className="text-xs text-muted-foreground mt-2 whitespace-pre-wrap">
                    {error.stack}
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 联系支持 */}
        <p className="text-xs text-muted-foreground">
          如果问题持续存在，请联系技术支持
        </p>
      </div>
    </div>
  );
}

// 便捷 Hook：用于函数组件捕获异步错误
export function useErrorHandler() {
  const [error, setError] = React.useState<Error | null>(null);

  const handleError = React.useCallback((err: unknown) => {
    const error = err instanceof Error ? err : new Error(String(err));
    setError(error);
    console.error("[useErrorHandler]", error);
  }, []);

  const clearError = React.useCallback(() => {
    setError(null);
  }, []);

  return { error, handleError, clearError };
}

// 小型错误边界（用于局部组件）
export class MiniErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="p-4 text-center text-sm text-muted-foreground">
          组件加载失败
        </div>
      );
    }
    return this.props.children;
  }
}
