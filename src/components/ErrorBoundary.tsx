import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error) => void;
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
    console.error('Greebler encountered a rendering error.', error, errorInfo);
    this.props.onError?.(error);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    if (this.props.fallback !== undefined) return this.props.fallback;

    return (
      <main className="recovery-screen">
        <section role="alert">
          <h1>The editor could not render this material.</h1>
          <p>Reload the workspace to retry. If the error repeats, include the message below when reporting it.</p>
          <pre>{this.state.error.message}</pre>
          <button className="ui-button" type="button" onClick={this.handleReload}>
            Reload workspace
          </button>
        </section>
      </main>
    );
  }
}
