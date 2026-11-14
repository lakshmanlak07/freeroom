import { TriangleAlert } from 'lucide-react';
import { Component, type ReactNode } from 'react';
import { useRouteError } from 'react-router';
import { EmptyState } from './EmptyState';
import { Button } from './ui/button';

/** Catches render errors so one broken widget never blanks the app. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    if (this.state.error) return <Crash onRetry={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}

function Crash({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-xl p-6">
      <EmptyState
        tone="error"
        icon={TriangleAlert}
        title="Something went wrong"
        body="This part of FreeRoom hit an unexpected error. Your reservations are safe."
        action={<Button onClick={onRetry}>Try again</Button>}
      />
    </div>
  );
}

/** Router-level errors (loader/render failures). */
export function RouteError() {
  const error = useRouteError();
  console.error(error);
  return <Crash onRetry={() => window.location.reload()} />;
}
