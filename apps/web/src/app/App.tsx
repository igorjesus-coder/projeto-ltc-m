import { AppShell } from '../layouts/AppShell';
import { ProtectedRoute } from '../auth/ProtectedRoute';
import { resolveRoute } from './routes';

interface AppProps {
  readonly pathname?: string;
}

export function App({ pathname = '/' }: AppProps) {
  const route = resolveRoute(pathname);
  const content = route.protected ? (
    <ProtectedRoute>{route.content}</ProtectedRoute>
  ) : (
    route.content
  );

  return <AppShell currentRoute={route.id}>{content}</AppShell>;
}
