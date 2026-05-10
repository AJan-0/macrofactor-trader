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

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error, info);
    this.props.onError?.(error, info);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-center p-6 bg-[#111827] rounded-lg border border-[#1e293b]">
          <div className="text-3xl mb-3">⚠️</div>
          <div className="text-[13px] font-bold text-[#e2e8f0] mb-1">Something went wrong</div>
          <div className="text-[11px] text-[#475569] mb-3 max-w-[300px]">
            {this.state.error?.message || "An unexpected error occurred."}
          </div>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="text-[11px] px-3 py-1.5 rounded bg-[#3b82f620] text-[#3b82f6] border border-[#3b82f640] hover:bg-[#3b82f640] transition-colors"
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
