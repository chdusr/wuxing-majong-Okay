import React, { Component, ReactNode, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

class RootErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = { hasError: false, errorMessage: '' };

  constructor(props: ErrorBoundaryProps) {
    super(props);
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const msg = error instanceof Error ? error.message : String(error);
    return { hasError: true, errorMessage: msg };
  }

  override componentDidCatch(error: unknown, errorInfo: React.ErrorInfo) {
    console.error('[RootErrorBoundary] Caught UI error:', error, errorInfo);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0E0A17] text-slate-100 flex flex-col items-center justify-center p-6 text-center">
          <div className="max-w-md w-full bg-slate-900/95 border border-red-500/40 rounded-2xl p-6 shadow-2xl">
            <div className="text-3xl mb-3">🀄</div>
            <h2 className="text-lg font-bold text-amber-400 mb-2">五行麻将 · 运行恢复</h2>
            <p className="text-xs text-slate-400 mb-4">界面加载遇到轻微异常，点击下方按钮即可重置并进入：</p>
            <div className="text-xs text-rose-300 bg-black/60 p-3 rounded-lg font-mono mb-5 text-left break-all max-h-32 overflow-y-auto border border-rose-900/40">
              {this.state.errorMessage || 'Unknown Error'}
            </div>
            <button
              onClick={() => {
                this.setState({ hasError: false, errorMessage: '' });
                window.location.reload();
              }}
              className="w-full py-2.5 px-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-xl text-sm transition shadow-lg"
            >
              重新载入棋局
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function mountApp() {
  const container = document.getElementById('root');
  if (!container) return;

  const root = createRoot(container);
  root.render(
    <StrictMode>
      <RootErrorBoundary>
        <App />
      </RootErrorBoundary>
    </StrictMode>
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountApp);
} else {
  mountApp();
}

