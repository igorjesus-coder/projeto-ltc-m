import { Component, type ReactNode } from 'react';

interface AppErrorBoundaryProps {
  readonly children: ReactNode;
}

interface AppErrorBoundaryState {
  readonly hasError: boolean;
}

export function AppErrorFallback() {
  return (
    <main className="error-page" aria-labelledby="app-error-title">
      <h1 id="app-error-title">Não foi possível iniciar o LTC-M</h1>
      <p>Recarregue a página. Se o problema continuar, procure o suporte responsável.</p>
    </main>
  );
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  public state: AppErrorBoundaryState = { hasError: false };

  public static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  public componentDidCatch() {
    // Logging is intentionally deferred until the observability contract is approved.
  }

  public render() {
    return this.state.hasError ? <AppErrorFallback /> : this.props.children;
  }
}
