import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Greebler encountered an unrecoverable rendering error.', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="min-h-screen bg-[#151619] text-[#e5e9f0] p-8 flex items-center justify-center">
        <section className="neu-flat max-w-xl rounded-2xl p-8 space-y-4">
          <p className="text-xs uppercase tracking-[0.2em] text-[#f27d26]">Greebler stopped safely</p>
          <h1 className="text-2xl font-semibold text-white">The preview could not be rendered.</h1>
          <p className="text-sm text-[#8e9299]">
            Reload the page to retry. If the problem continues, reduce the resolution or report the message below.
          </p>
          <pre className="max-h-32 overflow-auto rounded-lg bg-[#0a0a0c] p-3 text-xs text-[#f27d26] whitespace-pre-wrap">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={this.handleReload}
            className="rounded-lg neu-convex px-4 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-[#f27d26]"
          >
            Reload preview
          </button>
        </section>
      </main>
    );
  }
}
