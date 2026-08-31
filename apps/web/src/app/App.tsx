import { AppShell } from '../layouts/AppShell';
import { ProtectedRoute } from '../auth/ProtectedRoute';
import { AuthorizationRoute } from '../auth/authorization';
import { resolveRoute } from './routes';

interface AppProps {
  readonly pathname?: string;
  readonly search?: string;
}

export function App({ pathname = '/', search = '' }: AppProps) {
  const route = resolveRoute(pathname, search);
  const content = route.protected ? (
    <ProtectedRoute>
      <AuthorizationRoute>{route.content}</AuthorizationRoute>
    </ProtectedRoute>
  ) : (
    route.content
  );

  return <AppShell currentRoute={route.id}>{content}</AppShell>;
}
