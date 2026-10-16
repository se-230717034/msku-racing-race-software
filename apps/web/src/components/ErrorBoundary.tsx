import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Unhandled MSKU Racing workspace error", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <main className="fatal-error">
          <span className="eyebrow">ÇALIŞMA ALANI HATASI</span>
          <h1>Mühendislik çalışma alanı görüntülenemedi.</h1>
          <p>{this.state.error.message}</p>
          <button type="button" onClick={() => window.location.reload()}>Uygulamayı yeniden yükle</button>
        </main>
      );
    }
    return this.props.children;
  }
}

