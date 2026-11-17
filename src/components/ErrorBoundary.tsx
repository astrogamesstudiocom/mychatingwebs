import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || 'An unexpected error occurred.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      let displayDetail = this.state.errorMessage;
      try {
        const parsed = JSON.parse(this.state.errorMessage) as { error?: string; operationType?: string };
        if (parsed && parsed.error) {
          displayDetail = `${parsed.operationType ? `[${parsed.operationType}] ` : ''}${parsed.error}`;
        }
      } catch {
        // Non-JSON message
      }

      return (
        <div className="min-h-dvh flex items-center justify-center bg-[#F0F2F5] dark:bg-[#0B141A] p-6">
          <div className="max-w-md w-full bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] rounded-2xl p-6 text-center shadow-sm">
            <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h1 className="text-lg font-semibold text-[#111B21] dark:text-[#E9EDEF] mb-2">
              Something went wrong
            </h1>
            <p className="text-sm text-[#667781] dark:text-[#8696A0] mb-6 break-words">
              {displayDetail}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#00A884] hover:bg-[#008F70] text-white text-sm font-medium transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Reload VerdeChat
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
