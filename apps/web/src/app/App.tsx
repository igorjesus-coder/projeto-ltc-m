import { AppShell } from '../layouts/AppShell';
import { resolveRoute } from './routes';

interface AppProps {
  readonly pathname?: string;
}

export function App({ pathname = '/' }: AppProps) {
  const route = resolveRoute(pathname);

  return <AppShell currentRoute={route.id}>{route.content}</AppShell>;
}
